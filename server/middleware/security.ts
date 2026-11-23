import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getEnvConfig } from '../config';
import { parseCookies } from './auth';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseOrigin(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export interface CsrfMiddlewareOptions {
  getConfig?: () => {
    trustedProxyHops: number | false;
    appUrl: string | null;
    isProduction?: boolean;
  };
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];
const JSON_REQUIRED_AUTH_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/recover',
  '/api/auth/update-password',
]);

export function createCsrfProtectionMiddleware(options?: CsrfMiddlewareOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const config = options?.getConfig ? options.getConfig() : getEnvConfig();
    const secFetchSite = req.header('sec-fetch-site')?.trim().toLowerCase();
    if (secFetchSite === 'cross-site') {
      res.status(403).json({
        ok: false,
        code: 'CSRF_VALIDATION_FAILED',
        message: 'Cross-site state-changing requests are not permitted.',
      });
      return;
    }

    const contentType = req.header('content-type')?.toLowerCase() ?? '';
    if (FORM_CONTENT_TYPES.some((t) => contentType.includes(t))) {
      res.status(415).json({
        ok: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Form-encoded and plain-text payloads are not permitted on API endpoints.',
      });
      return;
    }

    const rawPath = `${req.baseUrl || ''}${req.path || ''}`;
    const normalizedPath = rawPath.replace(/\/+$/, '') || '/';
    if (JSON_REQUIRED_AUTH_PATHS.has(normalizedPath) && !req.is('application/json')) {
      res.status(415).json({
        ok: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Authentication endpoints require application/json payloads.',
      });
      return;
    }

    const isProduction =
      config.isProduction ?? process.env.NODE_ENV?.trim().toLowerCase() === 'production';
    const configuredOrigin = parseOrigin(config.appUrl);

    // L-4: Never trust localhost or fall back to Host-header-only origins in production without APP_URL
    if (isProduction && !configuredOrigin) {
      res.status(503).json({
        ok: false,
        code: 'APP_URL_NOT_CONFIGURED',
        message: 'Server APP_URL origin must be configured in production for state-changing requests.',
      });
      return;
    }

    const allowedOrigins = new Set<string>();
    const trustProxy = config.trustedProxyHops !== false && config.trustedProxyHops > 0;
    const forwardedHost = trustProxy
      ? req.header('x-forwarded-host')?.split(',')[0]?.trim()
      : undefined;
    const host = forwardedHost || req.header('host')?.trim();
    if (host) {
      const requestOrigin = parseOrigin(`${req.protocol}://${host}`);
      if (requestOrigin) allowedOrigins.add(requestOrigin);
    }

    if (configuredOrigin) {
      allowedOrigins.add(configuredOrigin);
    }

    const originHeader = req.header('origin');
    if (originHeader !== undefined) {
      const parsedOrigin = parseOrigin(originHeader);
      if (!parsedOrigin || !allowedOrigins.has(parsedOrigin)) {
        res.status(403).json({
          ok: false,
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Request origin is not permitted for this endpoint.',
        });
        return;
      }
      next();
      return;
    }

    const refererHeader = req.header('referer');
    if (refererHeader !== undefined) {
      const parsedReferer = parseOrigin(refererHeader);
      if (!parsedReferer || !allowedOrigins.has(parsedReferer)) {
        res.status(403).json({
          ok: false,
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Request referer origin is not permitted for this endpoint.',
        });
        return;
      }
      next();
      return;
    }

    const cookies = parseCookies(req.header('cookie'));
    const hasAuthCookie = Boolean(cookies.sb_access_token || cookies.sb_refresh_token);
    const hasBearer = Boolean(req.header('authorization')?.toLowerCase().startsWith('bearer '));

    if (
      (hasAuthCookie && !hasBearer) ||
      (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none')
    ) {
      res.status(403).json({
        ok: false,
        code: 'CSRF_VALIDATION_FAILED',
        message: 'Same-origin verification headers are required for cookie-authenticated requests.',
      });
      return;
    }

    next();
  };
}

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  maxBuckets?: number;
  extractKeys?: (req: Request) => string[];
  now?: () => number;
}

export interface RateLimiterInstance {
  middleware: RequestHandler;
  clear: () => void;
  getBucketCount: () => number;
}

export function getClientRateLimitIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Creates a bounded in-memory sliding/fixed-window rate limiter.
 * Note: This Map-backed store is scoped to a single Node.js process and resets on restart;
 * multi-instance deployments require a shared external store (e.g., Redis) for global limits.
 */
export function createRateLimiter(rule: RateLimitRule): RateLimiterInstance {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const getNow = rule.now ?? (() => Date.now());
  const maxBuckets = Math.max(1, rule.maxBuckets ?? 10_000);

  const pruneExpired = (nowMs: number, force = false) => {
    if (!force && buckets.size < 256 && buckets.size < maxBuckets) return;
    for (const [key, entry] of buckets.entries()) {
      if (nowMs >= entry.resetAt) {
        buckets.delete(key);
      }
    }
  };

  const ensureCapacityForNewKey = (nowMs: number) => {
    if (buckets.size < maxBuckets) return;
    pruneExpired(nowMs, true);
    if (buckets.size < maxBuckets) return;

    // Prefer evicting the oldest non-blocked bucket so high-cardinality fuzzing cannot drop active bans
    let candidateKey: string | null = null;
    for (const [key, entry] of buckets.entries()) {
      if (entry.count < rule.maxRequests) {
        candidateKey = key;
        break;
      }
    }
    if (candidateKey === null) {
      candidateKey = buckets.keys().next().value ?? null;
    }
    if (candidateKey !== null) {
      buckets.delete(candidateKey);
    }
  };

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const nowMs = getNow();
    pruneExpired(nowMs);

    const rawKeys = rule.extractKeys
      ? rule.extractKeys(req)
      : [`ip:${getClientRateLimitIp(req)}`];
    const keys = [...new Set(rawKeys.filter(Boolean).map((k) => `${rule.keyPrefix}:${k}`))];

    let blockedResetAt: number | null = null;
    let lowestRemaining = rule.maxRequests;

    for (const key of keys) {
      const existing = buckets.get(key);
      if (!existing || nowMs >= existing.resetAt) {
        continue;
      }
      if (existing.count >= rule.maxRequests) {
        blockedResetAt =
          blockedResetAt === null ? existing.resetAt : Math.max(blockedResetAt, existing.resetAt);
      } else {
        lowestRemaining = Math.min(lowestRemaining, rule.maxRequests - existing.count - 1);
      }
    }

    if (blockedResetAt !== null) {
      const retryAfterSeconds = Math.max(1, Math.ceil((blockedResetAt - nowMs) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(rule.maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait before trying again.',
      });
      return;
    }

    for (const key of keys) {
      const existing = buckets.get(key);
      if (!existing || nowMs >= existing.resetAt) {
        if (existing) {
          buckets.delete(key);
        }
        ensureCapacityForNewKey(nowMs);
        buckets.set(key, { count: 1, resetAt: nowMs + rule.windowMs });
        lowestRemaining = Math.min(lowestRemaining, Math.max(0, rule.maxRequests - 1));
      } else {
        const nextCount = existing.count + 1;
        // Refresh insertion order for deterministic LRU eviction of stale active keys
        buckets.delete(key);
        buckets.set(key, { count: nextCount, resetAt: existing.resetAt });
        lowestRemaining = Math.min(lowestRemaining, Math.max(0, rule.maxRequests - nextCount));
      }
    }

    res.setHeader('X-RateLimit-Limit', String(rule.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, lowestRemaining)));
    next();
  };

  return {
    middleware,
    clear: () => buckets.clear(),
    getBucketCount: () => buckets.size,
  };
}

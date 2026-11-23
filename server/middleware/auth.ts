import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { dbQuery, getDbPool } from '../db';
import { getSupabaseAdminClient, getSupabaseAuthClient } from '../supabase';
import type { AccountStatus, AppRole, KycStatus } from '../../src/types/domain';

export interface AuthenticatedContext {
  userId: string;
  publicUserId: string;
  email: string;
  fullName: string;
  phone: string | null;
  twoFactorEnabled: boolean;
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  preferredLanguage: string;
  createdAt: string;
  role: AppRole;
  accessToken: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedContext;
    }
  }
}

export interface AuthSessionTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface ProfileAuthRow {
  id: string;
  public_user_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  totp_enabled: boolean;
  account_status: AccountStatus;
  kyc_status: KycStatus;
  preferred_language: string;
  created_at: string;
  role: AppRole | null;
}

export interface AuthMiddlewareDependencies {
  hasDatabase: () => boolean;
  getSupabaseAdmin: () => {
    auth: {
      getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
      admin: {
        signOut: (jwt: string, scope?: 'global' | 'local' | 'others') => Promise<unknown>;
      };
    };
  } | null;
  getSupabaseAuth: () => {
    auth: {
      refreshSession: (params: {
        refresh_token: string;
      }) => Promise<{ data: { session: AuthSessionTokens | null }; error: unknown }>;
    };
  } | null;
  queryAccountStatus: (userId: string) => Promise<AccountStatus | null>;
  queryAuthenticatedProfile: (userId: string) => Promise<ProfileAuthRow | null>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decodes an unverified JWT `sub` strictly as a pre-refresh hint to check if the
 * corresponding account is already suspended/closed before calling refreshSession().
 * Identity is NEVER trusted from this hint; verified identity always comes from
 * supabaseAdmin.auth.getUser(token) plus a database lookup.
 */
export function extractJwtSubjectHint(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(decoded) as { sub?: unknown };
    if (typeof payload.sub === 'string' && UUID_REGEX.test(payload.sub)) {
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractAccessToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.header('cookie'));
  return cookies.sb_access_token || null;
}

export function setAuthCookies(
  req: Request,
  res: Response,
  session: AuthSessionTokens
) {
  const isHttps = req.secure || req.protocol === 'https';
  const maxAgeMs = (session.expires_in ?? 3600) * 1000;

  res.cookie('sb_access_token', session.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: maxAgeMs,
  });

  if (session.refresh_token) {
    res.cookie('sb_refresh_token', session.refresh_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}

export function clearAuthCookies(req: Request, res: Response) {
  const isHttps = req.secure || req.protocol === 'https';
  res.clearCookie('sb_access_token', { httpOnly: true, sameSite: 'lax', secure: isHttps, path: '/' });
  res.clearCookie('sb_refresh_token', { httpOnly: true, sameSite: 'lax', secure: isHttps, path: '/' });
}

export function requireBackendReady(_req: Request, res: Response, next: NextFunction) {
  if (!getDbPool() || !getSupabaseAuthClient() || !getSupabaseAdminClient()) {
    res.status(503).json({
      ok: false,
      code: 'BACKEND_NOT_CONFIGURED',
      message:
        'Supabase PostgreSQL database and Auth secrets must be configured in the server environment before this operation can proceed.',
    });
    return;
  }
  next();
}

const defaultDeps: AuthMiddlewareDependencies = {
  hasDatabase: () => Boolean(getDbPool()),
  getSupabaseAdmin: () => getSupabaseAdminClient(),
  getSupabaseAuth: () => getSupabaseAuthClient(),
  queryAccountStatus: async (userId: string) => {
    const res = await dbQuery<{ account_status: AccountStatus }>(
      'SELECT account_status FROM public.profiles WHERE id = $1 LIMIT 1',
      [userId]
    );
    return res.rows[0]?.account_status ?? null;
  },
  queryAuthenticatedProfile: async (userId: string) => {
    const profileRes = await dbQuery<ProfileAuthRow>(
      `
      SELECT
        p.id,
        p.public_user_id,
        p.email,
        p.full_name,
        p.phone,
        p.totp_enabled,
        p.account_status,
        p.kyc_status,
        p.preferred_language,
        p.created_at::text AS created_at,
        ur.role
      FROM public.profiles p
      LEFT JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = $1
      ORDER BY CASE ur.role
        WHEN 'super_admin' THEN 1
        WHEN 'finance_admin' THEN 2
        WHEN 'operations_admin' THEN 3
        WHEN 'compliance_admin' THEN 4
        ELSE 5
      END
      LIMIT 1
      `,
      [userId]
    );
    return profileRes.rows[0] ?? null;
  },
};

export type ActiveSessionResolution =
  | {
      status: 'active';
      profile: ProfileAuthRow;
      accessToken: string;
      refreshedSession: AuthSessionTokens | null;
    }
  | {
      status: 'unconfigured';
    }
  | {
      status: 'missing_token' | 'invalid_session';
    }
  | {
      status: 'profile_not_initialized';
    }
  | {
      status: 'inactive_account';
      accountStatus: Exclude<AccountStatus, 'active'>;
    }
  | {
      status: 'lookup_error';
      error: unknown;
    };

/**
 * Resolves and verifies an active authenticated session without setting or rotating
 * auth cookies for suspended/closed accounts.
 * - If an expired access token carries an inactive account's `sub`, skips refreshSession()
 *   completely so no refresh token rotation occurs.
 * - If only a refresh token is present, refreshes into a temporary session, verifies the
 *   database profile `account_status === 'active'`, revokes the Supabase session globally
 *   if inactive, and ONLY emits `setAuthCookies` when verified active.
 */
export async function resolveSessionWithActiveCheck(
  req: Request,
  res: Response,
  deps: AuthMiddlewareDependencies = defaultDeps
): Promise<ActiveSessionResolution> {
  const hasDb = deps.hasDatabase();
  const supabaseAdmin = deps.getSupabaseAdmin();
  const supabaseAuth = deps.getSupabaseAuth();

  if (!hasDb || !supabaseAdmin || !supabaseAuth) {
    return { status: 'unconfigured' };
  }

  const hasBearerHeader = Boolean(req.header('authorization')?.toLowerCase().startsWith('bearer '));
  const cookies = parseCookies(req.header('cookie'));
  let token = extractAccessToken(req);
  const refreshToken = !hasBearerHeader ? cookies.sb_refresh_token || null : null;

  if (!token && !refreshToken) {
    return { status: 'missing_token' };
  }

  let verifiedUserId: string | null = null;
  let pendingRefreshedSession: AuthSessionTokens | null = null;

  if (token) {
    let userData: { data: { user: { id: string } | null }; error: unknown };
    try {
      userData = await supabaseAdmin.auth.getUser(token);
    } catch (err) {
      return { status: 'lookup_error', error: err };
    }

    if (!userData.error && userData.data.user) {
      verifiedUserId = userData.data.user.id;
    } else if (refreshToken) {
      const subjectHint = extractJwtSubjectHint(token);
      if (subjectHint) {
        try {
          const preStatus = await deps.queryAccountStatus(subjectHint);
          if (preStatus && preStatus !== 'active') {
            clearAuthCookies(req, res);
            return { status: 'inactive_account', accountStatus: preStatus };
          }
        } catch (err) {
          return { status: 'lookup_error', error: err };
        }
      }
    }
  }

  if (!verifiedUserId && refreshToken) {
    let refreshed: { data: { session: AuthSessionTokens | null }; error: unknown };
    try {
      refreshed = await supabaseAuth.auth.refreshSession({
        refresh_token: refreshToken,
      });
    } catch (err) {
      return { status: 'lookup_error', error: err };
    }

    const candidateSession = refreshed.data?.session;
    if (candidateSession?.access_token) {
      let refreshedUser: { data: { user: { id: string } | null }; error: unknown };
      try {
        refreshedUser = await supabaseAdmin.auth.getUser(candidateSession.access_token);
      } catch (err) {
        return { status: 'lookup_error', error: err };
      }

      if (!refreshedUser.error && refreshedUser.data?.user) {
        verifiedUserId = refreshedUser.data.user.id;
        token = candidateSession.access_token;
        pendingRefreshedSession = candidateSession;
      }
    }
  }

  if (!verifiedUserId || !token) {
    if (!hasBearerHeader) {
      clearAuthCookies(req, res);
    }
    return { status: 'invalid_session' };
  }

  let row: ProfileAuthRow | null = null;
  try {
    row = await deps.queryAuthenticatedProfile(verifiedUserId);
  } catch (err) {
    return { status: 'lookup_error', error: err };
  }

  if (!row) {
    if (!hasBearerHeader) {
      clearAuthCookies(req, res);
    }
    return { status: 'profile_not_initialized' };
  }

  if (row.account_status !== 'active') {
    clearAuthCookies(req, res);
    // Best-effort global revocation of the caller's verified JWT session in Supabase Auth.
    // Note: Supabase Admin signOut(jwt, 'global') requires a user JWT (not raw user_id),
    // so future admin suspension/closure endpoints should also ban/revoke user sessions.
    try {
      await supabaseAdmin.auth.admin.signOut(token, 'global');
    } catch {
      // Cookie clearing and 403 enforcement still take effect immediately
    }
    return { status: 'inactive_account', accountStatus: row.account_status };
  }

  if (pendingRefreshedSession) {
    setAuthCookies(req, res, pendingRefreshedSession);
  }

  return {
    status: 'active',
    profile: row,
    accessToken: token,
    refreshedSession: pendingRefreshedSession,
  };
}

export function createRequireAuth(
  deps: AuthMiddlewareDependencies = defaultDeps
): RequestHandler {
  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    const resolution = await resolveSessionWithActiveCheck(req, res, deps);

    switch (resolution.status) {
      case 'unconfigured':
        res.status(503).json({
          ok: false,
          code: 'BACKEND_NOT_CONFIGURED',
          message:
            'Supabase PostgreSQL database and Auth secrets must be configured in the server environment.',
        });
        return;
      case 'missing_token':
        res.status(401).json({
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'Authentication required.',
        });
        return;
      case 'invalid_session':
        res.status(401).json({
          ok: false,
          code: 'INVALID_SESSION',
          message: 'Session is invalid or expired. Please sign in again.',
        });
        return;
      case 'profile_not_initialized':
        res.status(403).json({
          ok: false,
          code: 'PROFILE_NOT_INITIALIZED',
          message: 'Account profile record is not initialized in the database.',
        });
        return;
      case 'inactive_account':
        res.status(403).json({
          ok: false,
          code: resolution.accountStatus === 'closed' ? 'ACCOUNT_CLOSED' : 'ACCOUNT_SUSPENDED',
          message:
            resolution.accountStatus === 'closed'
              ? 'This account has been closed and is no longer active.'
              : 'This account is suspended. Contact platform administration.',
        });
        return;
      case 'lookup_error':
        console.error('Authentication profile lookup failed:', resolution.error);
        res.status(500).json({
          ok: false,
          code: 'AUTH_LOOKUP_ERROR',
          message: 'Unable to verify authenticated account right now.',
        });
        return;
      case 'active': {
        const { profile: row, accessToken } = resolution;
        req.auth = {
          userId: row.id,
          publicUserId: row.public_user_id,
          email: row.email,
          fullName: row.full_name,
          phone: row.phone,
          twoFactorEnabled: row.totp_enabled,
          accountStatus: row.account_status,
          kycStatus: row.kyc_status,
          preferredLanguage: row.preferred_language,
          createdAt: row.created_at,
          role: row.role ?? 'customer',
          accessToken,
        };
        next();
      }
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(middleware(req, res, next)).catch(next);
  };
}

export const requireAuth = createRequireAuth();

export function requireRole(...allowedRoles: AppRole[]) {
  const allowed = new Set<AppRole>(allowedRoles);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
      return;
    }
    if (!allowed.has(req.auth.role)) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Insufficient administrative privileges for this operation.',
      });
      return;
    }
    next();
  };
}

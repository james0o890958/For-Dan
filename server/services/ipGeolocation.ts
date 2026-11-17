import { getEnvConfig } from '../config';
import { getDbPool } from '../db';
import { normalizeClientIp } from './connectionContext';

export const IP_GEOLOCATION_ENDPOINT = 'https://api.ipgeolocation.io/v3/ipgeo';
export const APPROXIMATE_LOCATION_NOTICE =
  'IP-based geolocation is approximate and does not represent a precise physical location.';

export type IpIntelligenceStatus =
  | 'success'
  | 'cached'
  | 'missing_api_key'
  | 'invalid_ip'
  | 'private_ip'
  | 'timeout'
  | 'provider_error'
  | 'unavailable';

export interface SecurityCheckCapability {
  status: 'unavailable';
  detected: null;
  reason: string;
}

export interface IpIntelligenceResult {
  provider: 'ipgeolocation.io';
  status: IpIntelligenceStatus;
  cached: boolean;
  ipAddress: string | null;
  ipVersion: 4 | 6 | null;
  isGeolocationApproximate: true;
  locationNotice: string;
  countryCode: string | null;
  countryName: string | null;
  regionState: string | null;
  approximateCity: string | null;
  isp: string | null;
  asn: string | null;
  asnOrganization: string | null;
  securityChecks: {
    vpn: SecurityCheckCapability;
    proxy: SecurityCheckCapability;
    residentialProxy: SecurityCheckCapability;
    datacenterProxy: SecurityCheckCapability;
    tor: SecurityCheckCapability;
  };
  error: string | null;
  checkedAt: string;
}

export interface IpGeolocationServiceOptions {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  enableDbCache?: boolean;
  now?: () => number;
}

interface CacheEntry {
  result: Omit<IpIntelligenceResult, 'status' | 'cached' | 'checkedAt'>;
  expiresAtMs: number;
}

interface IpGeolocationV3Payload {
  ip?: string;
  location?: {
    country_code2?: string;
    country_name?: string;
    state_prov?: string;
    city?: string;
  };
  country_code2?: string;
  country_name?: string;
  state_prov?: string;
  city?: string;
  asn?:
    | string
    | {
        as_number?: string;
        asn?: string;
        name?: string;
        organization?: string;
      };
  isp?: string;
  organization?: string;
  company?: {
    name?: string;
  };
  message?: string;
}

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MEMORY_CACHE_ENTRIES = 5_000;

export function unavailableSecurityChecks(): IpIntelligenceResult['securityChecks'] {
  return {
    vpn: {
      status: 'unavailable',
      detected: null,
      reason: 'IPGeolocation.io free plan does not include VPN detection.',
    },
    proxy: {
      status: 'unavailable',
      detected: null,
      reason: 'IPGeolocation.io free plan does not include proxy detection.',
    },
    residentialProxy: {
      status: 'unavailable',
      detected: null,
      reason: 'IPGeolocation.io free plan does not include residential proxy detection.',
    },
    datacenterProxy: {
      status: 'unavailable',
      detected: null,
      reason: 'IPGeolocation.io free plan does not include datacenter proxy detection.',
    },
    tor: {
      status: 'unavailable',
      detected: null,
      reason: 'IPGeolocation.io free plan does not include Tor exit node detection.',
    },
  };
}

function cleanText(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeProviderError(message: string, apiKey?: string | null): string {
  let sanitized = message;
  if (apiKey && sanitized.includes(apiKey)) {
    sanitized = sanitized.split(apiKey).join('[REDACTED]');
  }
  sanitized = sanitized.replace(/apiKey=[^&\s]+/gi, 'apiKey=[REDACTED]');
  return sanitized.slice(0, 240);
}

function buildBaseResult(
  status: IpIntelligenceStatus,
  overrides: Partial<IpIntelligenceResult> = {},
  checkedAt = new Date().toISOString()
): IpIntelligenceResult {
  return {
    provider: 'ipgeolocation.io',
    status,
    cached: status === 'cached',
    ipAddress: null,
    ipVersion: null,
    isGeolocationApproximate: true,
    locationNotice: APPROXIMATE_LOCATION_NOTICE,
    countryCode: null,
    countryName: null,
    regionState: null,
    approximateCity: null,
    isp: null,
    asn: null,
    asnOrganization: null,
    securityChecks: unavailableSecurityChecks(),
    error: null,
    checkedAt,
    ...overrides,
  };
}

export class IpGeolocationService {
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly apiKeyOverride?: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly enableDbCache: boolean;
  private readonly now: () => number;

  constructor(options: IpGeolocationServiceOptions = {}) {
    this.apiKeyOverride = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.enableDbCache = options.enableDbCache ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  private resolveApiKey(): string | null {
    if (this.apiKeyOverride !== undefined) {
      return this.apiKeyOverride ? this.apiKeyOverride.trim() || null : null;
    }
    return getEnvConfig().ipGeolocationApiKey;
  }

  public getCacheSize(): number {
    return this.memoryCache.size;
  }

  public clearMemoryCache(): void {
    this.memoryCache.clear();
  }

  private writeMemoryCache(
    ip: string,
    base: Omit<IpIntelligenceResult, 'status' | 'cached' | 'checkedAt'>
  ) {
    if (this.memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(ip, {
      result: base,
      expiresAtMs: this.now() + this.cacheTtlMs,
    });
  }

  private async readDbCache(ip: string, version: 4 | 6): Promise<IpIntelligenceResult | null> {
    if (!this.enableDbCache) return null;
    const pool = getDbPool();
    if (!pool) return null;

    try {
      const res = await pool.query<{
        country_code: string | null;
        country_name: string | null;
        region_state: string | null;
        approximate_city: string | null;
        isp: string | null;
        asn: string | null;
        asn_organization: string | null;
      }>(
        `
        SELECT
          country_code,
          country_name,
          region_state,
          approximate_city,
          isp,
          asn,
          asn_organization
        FROM public.ip_intelligence_cache
        WHERE ip_address = $1::inet
          AND expires_at > NOW()
        LIMIT 1
        `,
        [ip]
      );

      const row = res.rows[0];
      if (!row) return null;

      const base: Omit<IpIntelligenceResult, 'status' | 'cached' | 'checkedAt'> = {
        provider: 'ipgeolocation.io',
        ipAddress: ip,
        ipVersion: version,
        isGeolocationApproximate: true,
        locationNotice: APPROXIMATE_LOCATION_NOTICE,
        countryCode: row.country_code,
        countryName: row.country_name,
        regionState: row.region_state,
        approximateCity: row.approximate_city,
        isp: row.isp,
        asn: row.asn,
        asnOrganization: row.asn_organization,
        securityChecks: unavailableSecurityChecks(),
        error: null,
      };
      this.writeMemoryCache(ip, base);

      return buildBaseResult(
        'cached',
        base,
        new Date(this.now()).toISOString()
      );
    } catch {
      // Cache table may not exist yet before migrations run; fail gracefully
      return null;
    }
  }

  private async writeDbCache(
    ip: string,
    result: Omit<IpIntelligenceResult, 'status' | 'cached' | 'checkedAt'>
  ) {
    if (!this.enableDbCache) return;
    const pool = getDbPool();
    if (!pool) return;

    const expiresAtIso = new Date(this.now() + this.cacheTtlMs).toISOString();
    try {
      await pool.query(
        `
        INSERT INTO public.ip_intelligence_cache (
          ip_address,
          provider,
          country_code,
          country_name,
          region_state,
          approximate_city,
          isp,
          asn,
          asn_organization,
          vpn_detection_status,
          proxy_detection_status,
          tor_detection_status,
          fetched_at,
          expires_at
        )
        VALUES ($1::inet, 'ipgeolocation.io', $2, $3, $4, $5, $6, $7, $8, 'unavailable', 'unavailable', 'unavailable', NOW(), $9::timestamptz)
        ON CONFLICT (ip_address) DO UPDATE SET
          country_code = EXCLUDED.country_code,
          country_name = EXCLUDED.country_name,
          region_state = EXCLUDED.region_state,
          approximate_city = EXCLUDED.approximate_city,
          isp = EXCLUDED.isp,
          asn = EXCLUDED.asn,
          asn_organization = EXCLUDED.asn_organization,
          fetched_at = NOW(),
          expires_at = EXCLUDED.expires_at
        `,
        [
          ip,
          result.countryCode,
          result.countryName,
          result.regionState,
          result.approximateCity,
          result.isp,
          result.asn,
          result.asnOrganization,
          expiresAtIso,
        ]
      );
    } catch {
      // Non-fatal: cache persistence must never interrupt auth
    }
  }

  public async lookupIp(rawIp?: string | null): Promise<IpIntelligenceResult> {
    const checkedAt = new Date(this.now()).toISOString();
    const normalized = normalizeClientIp(rawIp);

    if (!normalized.isValid || !normalized.ip || !normalized.version) {
      return buildBaseResult(
        'invalid_ip',
        {
          error: 'Client IP address is missing or invalid.',
        },
        checkedAt
      );
    }

    if (normalized.isPrivateOrLoopback) {
      return buildBaseResult(
        'private_ip',
        {
          ipAddress: normalized.ip,
          ipVersion: normalized.version,
          error: 'Private, loopback, or reserved IP address skipped.',
        },
        checkedAt
      );
    }

    // 1. Check in-memory TTL cache first
    const memCached = this.memoryCache.get(normalized.ip);
    if (memCached && memCached.expiresAtMs > this.now()) {
      return buildBaseResult('cached', memCached.result, checkedAt);
    }
    if (memCached) {
      this.memoryCache.delete(normalized.ip);
    }

    // 2. Check optional database cache before spending API credits
    const dbCached = await this.readDbCache(normalized.ip, normalized.version);
    if (dbCached) {
      return dbCached;
    }

    // 3. Verify server-side IP_GEOLOCATION_API_KEY
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      return buildBaseResult(
        'missing_api_key',
        {
          ipAddress: normalized.ip,
          ipVersion: normalized.version,
          error: 'IP_GEOLOCATION_API_KEY is not configured in server environment.',
        },
        checkedAt
      );
    }

    const params = new URLSearchParams({
      apiKey,
      ip: normalized.ip,
    });
    const url = `${IP_GEOLOCATION_ENDPOINT}?${params.toString()}`;

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      let payload: IpGeolocationV3Payload | null = null;
      try {
        payload = (await response.json()) as IpGeolocationV3Payload;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload) {
        const providerMsg =
          cleanText(payload?.message) ?? `IPGeolocation.io returned HTTP ${response.status}.`;
        return buildBaseResult(
          'provider_error',
          {
            ipAddress: normalized.ip,
            ipVersion: normalized.version,
            error: sanitizeProviderError(providerMsg, apiKey),
          },
          checkedAt
        );
      }

      const asnObj = typeof payload.asn === 'object' && payload.asn !== null ? payload.asn : null;
      const asnString =
        cleanText(asnObj?.as_number) ??
        cleanText(asnObj?.asn) ??
        (typeof payload.asn === 'string' ? cleanText(payload.asn) : null);
      const asnOrg =
        cleanText(asnObj?.organization) ??
        cleanText(asnObj?.name) ??
        cleanText(payload.organization);
      const isp =
        cleanText(payload.company?.name) ??
        cleanText(payload.isp) ??
        asnOrg;

      const parsedBase: Omit<IpIntelligenceResult, 'status' | 'cached' | 'checkedAt'> = {
        provider: 'ipgeolocation.io',
        ipAddress: normalized.ip,
        ipVersion: normalized.version,
        isGeolocationApproximate: true,
        locationNotice: APPROXIMATE_LOCATION_NOTICE,
        countryCode: cleanText(payload.location?.country_code2 ?? payload.country_code2),
        countryName: cleanText(payload.location?.country_name ?? payload.country_name),
        regionState: cleanText(payload.location?.state_prov ?? payload.state_prov),
        approximateCity: cleanText(payload.location?.city ?? payload.city),
        isp,
        asn: asnString,
        asnOrganization: asnOrg,
        securityChecks: unavailableSecurityChecks(),
        error: null,
      };

      this.writeMemoryCache(normalized.ip, parsedBase);
      await this.writeDbCache(normalized.ip, parsedBase);

      return buildBaseResult('success', parsedBase, checkedAt);
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      const errMessage = err instanceof Error ? err.message : 'Request failed';
      const isTimeout =
        errName === 'TimeoutError' ||
        errName === 'AbortError' ||
        /timed?\s*out|aborted/i.test(errMessage);

      return buildBaseResult(
        isTimeout ? 'timeout' : 'provider_error',
        {
          ipAddress: normalized.ip,
          ipVersion: normalized.version,
          error: sanitizeProviderError(
            isTimeout ? `IPGeolocation.io request timed out after ${this.timeoutMs}ms.` : errMessage,
            apiKey
          ),
        },
        checkedAt
      );
    }
  }
}

export const defaultIpGeolocationService = new IpGeolocationService();

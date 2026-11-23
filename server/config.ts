export interface ParsedDatabaseConfig {
  valid: boolean;
  host: string | null;
  port: number;
  database: string;
  user: string | null;
  password: string | null;
  sslMode: string | null;
  hadQuotes: boolean;
  repairedUnencodedPassword: boolean;
  parseError: string | null;
}

export interface ServerConfigStatus {
  supabaseUrlConfigured: boolean;
  supabaseUrlHadRestSuffix: boolean;
  supabaseAnonKeyConfigured: boolean;
  supabaseAnonKeyFormat: 'jwt' | 'sb_publishable' | 'unknown' | null;
  supabaseServiceRoleKeyConfigured: boolean;
  supabaseServiceRoleKeyFormat: 'jwt' | 'sb_secret' | 'unknown' | null;
  databaseUrlConfigured: boolean;
  databasePasswordIsPlaceholder: boolean;
  databaseHost: string | null;
  databasePort: number | null;
  databaseUser: string | null;
  databaseUrlParseValid: boolean;
  databaseUrlParseError: string | null;
  normalizedSupabaseUrl: string | null;
  ipGeolocationConfigured: boolean;
  trustedProxyHops: number | false;
  isProduction: boolean;
  appUrlConfigured: boolean;
  appUrlError: string | null;
}

export function stripSurroundingQuotes(raw?: string): { value: string; hadQuotes: boolean } {
  if (!raw) return { value: '', hadQuotes: false };
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return { value: trimmed.slice(1, -1).trim(), hadQuotes: true };
  }
  return { value: trimmed, hadQuotes: false };
}

/**
 * Resolves Express `trust proxy` hop count.
 * Defaults to `1` for standard single reverse-proxy deployments (e.g., Cloud Run / Nginx / ALB)
 * where the proxy appends/overwrites forwarding headers. Operators deploying the Express server
 * directly on the public internet without a trusted reverse proxy stripping `X-Forwarded-For`
 * and `X-Forwarded-Host` MUST explicitly configure `TRUSTED_PROXY_HOPS=0` (or `false`).
 */
export function parseTrustedProxyHops(raw?: string): number | false {
  const { value } = stripSurroundingQuotes(raw);
  if (!value) return 1;
  const lowered = value.toLowerCase();
  if (lowered === 'false' || lowered === 'off') {
    return false;
  }
  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10) {
      return parsed;
    }
  }
  return 1;
}

export function normalizeAppOrigin(rawUrl?: string): string | null {
  const { value } = stripSurroundingQuotes(rawUrl);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeSupabaseProjectUrl(rawUrl?: string): string | null {
  const { value } = stripSurroundingQuotes(rawUrl);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    // Strip accidental REST/Auth path suffixes if provided (e.g. /rest/v1/)
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function hasDatabasePasswordPlaceholder(rawDbUrl?: string): boolean {
  const { value } = stripSurroundingQuotes(rawDbUrl);
  if (!value) return false;
  return (
    value.includes('[YOUR-PASSWORD]') ||
    value.includes('%5BYOUR-PASSWORD%5D') ||
    value.includes('YOUR-PASSWORD')
  );
}

export function detectSupabaseKeyFormat(
  rawKey?: string | null,
  kind: 'anon' | 'service' = 'anon'
): 'jwt' | 'sb_publishable' | 'sb_secret' | 'unknown' | null {
  if (!rawKey) return null;
  const trimmed = rawKey.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('sb_publishable_')) return 'sb_publishable';
  if (trimmed.startsWith('sb_secret_')) return 'sb_secret';
  if (trimmed.split('.').length === 3 && trimmed.startsWith('eyJ')) return 'jwt';
  return kind === 'anon' || kind === 'service' ? 'unknown' : null;
}

export function parseDatabaseUrl(rawDbUrl?: string): ParsedDatabaseConfig {
  const { value, hadQuotes } = stripSurroundingQuotes(rawDbUrl);
  if (!value) {
    return {
      valid: false,
      host: null,
      port: 5432,
      database: 'postgres',
      user: null,
      password: null,
      sslMode: null,
      hadQuotes,
      repairedUnencodedPassword: false,
      parseError: 'DATABASE_URL is empty.',
    };
  }

  // First try robust right-aligned credential split so unencoded @, #, or ? in password still parses cleanly
  const schemeMatch = value.match(/^(postgres(?:ql)?):\/\/(.*)$/i);
  if (!schemeMatch) {
    let hint = 'DATABASE_URL must begin with postgresql:// or postgres://.';
    if (/^DATABASE_URL\s*=/i.test(value)) {
      hint = 'DATABASE_URL value begins with "DATABASE_URL=" — enter only the postgresql://... connection string without the variable name prefix.';
    } else if (/^psql\b/i.test(value)) {
      hint = 'DATABASE_URL value begins with "psql" — enter only the postgresql://... connection string without the psql CLI command.';
    } else if (/postgres(?:ql)?:\/\//i.test(value)) {
      hint = 'DATABASE_URL contains postgresql:// after unexpected leading text or characters.';
    } else if (!value.includes('://') && !value.includes('@')) {
      hint = 'DATABASE_URL appears to be a bare string/password rather than a full postgresql://user:password@host:5432/postgres connection URI.';
    }
    return {
      valid: false,
      host: null,
      port: 5432,
      database: 'postgres',
      user: null,
      password: null,
      sslMode: null,
      hadQuotes,
      repairedUnencodedPassword: false,
      parseError: hint,
    };
  }

  const rest = schemeMatch[2];
  const lastAtIdx = rest.lastIndexOf('@');
  if (lastAtIdx === -1) {
    return {
      valid: false,
      host: null,
      port: 5432,
      database: 'postgres',
      user: null,
      password: null,
      sslMode: null,
      hadQuotes,
      repairedUnencodedPassword: false,
      parseError: 'DATABASE_URL is missing user/host separator (@).',
    };
  }

  const userInfoPart = rest.slice(0, lastAtIdx);
  const hostAndPathPart = rest.slice(lastAtIdx + 1);
  const firstColonIdx = userInfoPart.indexOf(':');
  const rawUser = firstColonIdx >= 0 ? userInfoPart.slice(0, firstColonIdx) : userInfoPart;
  const rawPassword = firstColonIdx >= 0 ? userInfoPart.slice(firstColonIdx + 1) : '';

  let decodedUser = rawUser;
  let decodedPassword = rawPassword;
  try {
    decodedUser = decodeURIComponent(rawUser);
  } catch {
    decodedUser = rawUser;
  }
  try {
    decodedPassword = decodeURIComponent(rawPassword);
  } catch {
    decodedPassword = rawPassword;
  }

  // Parse host:port/database?query
  let parsedHostPortPath: URL;
  try {
    parsedHostPortPath = new URL(`postgresql://${hostAndPathPart}`);
  } catch {
    return {
      valid: false,
      host: null,
      port: 5432,
      database: 'postgres',
      user: decodedUser || null,
      password: decodedPassword || null,
      sslMode: null,
      hadQuotes,
      repairedUnencodedPassword: false,
      parseError: 'DATABASE_URL host/port/database segment is malformed.',
    };
  }

  const repairedUnencodedPassword =
    /[#@/?]/.test(rawPassword) || (rawPassword.includes(':') && !rawPassword.includes('%3A'));

  const dbPath = parsedHostPortPath.pathname.replace(/^\/+/, '') || 'postgres';
  const port = parsedHostPortPath.port ? Number(parsedHostPortPath.port) : 5432;
  const sslMode = parsedHostPortPath.searchParams.get('sslmode');

  return {
    valid: Boolean(parsedHostPortPath.hostname) && Number.isFinite(port) && port > 0,
    host: parsedHostPortPath.hostname || null,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    database: dbPath,
    user: decodedUser || null,
    password: decodedPassword || null,
    sslMode,
    hadQuotes,
    repairedUnencodedPassword,
    parseError: null,
  };
}

export function getEnvConfig() {
  const rawSupabaseUrl = process.env.SUPABASE_URL;
  const { value: cleanRawUrl } = stripSurroundingQuotes(rawSupabaseUrl);
  const normalizedSupabaseUrl = normalizeSupabaseProjectUrl(rawSupabaseUrl);
  const supabaseAnonKey = stripSurroundingQuotes(process.env.SUPABASE_ANON_KEY).value || null;
  const supabaseServiceRoleKey =
    stripSurroundingQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY).value || null;
  const databaseUrl = stripSurroundingQuotes(process.env.DATABASE_URL).value || null;
  const parsedDb = parseDatabaseUrl(process.env.DATABASE_URL);
  const isProduction = process.env.NODE_ENV?.trim().toLowerCase() === 'production';
  const rawAppUrl = stripSurroundingQuotes(process.env.APP_URL).value;
  const normalizedConfiguredAppUrl = normalizeAppOrigin(rawAppUrl);
  const appUrl = normalizedConfiguredAppUrl ?? (isProduction ? null : 'http://localhost:3000');
  const appUrlError =
    isProduction && !normalizedConfiguredAppUrl
      ? rawAppUrl
        ? 'APP_URL is invalid; configure a valid http(s) origin when NODE_ENV=production.'
        : 'APP_URL must be configured to a valid http(s) origin when NODE_ENV=production.'
      : null;
  const ipGeolocationApiKey =
    stripSurroundingQuotes(process.env.IP_GEOLOCATION_API_KEY).value || null;
  const trustedProxyHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);

  const status: ServerConfigStatus = {
    supabaseUrlConfigured: Boolean(normalizedSupabaseUrl),
    supabaseUrlHadRestSuffix:
      Boolean(cleanRawUrl) &&
      Boolean(normalizedSupabaseUrl) &&
      cleanRawUrl.replace(/\/+$/, '') !== normalizedSupabaseUrl,
    supabaseAnonKeyConfigured: Boolean(supabaseAnonKey),
    supabaseAnonKeyFormat: detectSupabaseKeyFormat(supabaseAnonKey, 'anon') as
      | 'jwt'
      | 'sb_publishable'
      | 'unknown'
      | null,
    supabaseServiceRoleKeyConfigured: Boolean(supabaseServiceRoleKey),
    supabaseServiceRoleKeyFormat: detectSupabaseKeyFormat(supabaseServiceRoleKey, 'service') as
      | 'jwt'
      | 'sb_secret'
      | 'unknown'
      | null,
    databaseUrlConfigured: Boolean(databaseUrl),
    databasePasswordIsPlaceholder: hasDatabasePasswordPlaceholder(databaseUrl ?? undefined),
    databaseHost: parsedDb.host,
    databasePort: parsedDb.valid ? parsedDb.port : null,
    databaseUser: parsedDb.user,
    databaseUrlParseValid: parsedDb.valid,
    databaseUrlParseError: parsedDb.parseError,
    normalizedSupabaseUrl,
    ipGeolocationConfigured: Boolean(ipGeolocationApiKey),
    trustedProxyHops,
    isProduction,
    appUrlConfigured: Boolean(normalizedConfiguredAppUrl),
    appUrlError,
  };

  return {
    normalizedSupabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    databaseUrl,
    parsedDb,
    appUrl,
    isProduction,
    ipGeolocationApiKey,
    trustedProxyHops,
    status,
  };
}

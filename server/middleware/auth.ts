import type { NextFunction, Request, Response } from 'express';
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
  session: { access_token: string; refresh_token?: string; expires_in?: number }
) {
  const isHttps = req.secure || req.header('x-forwarded-proto') === 'https';
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
  const isHttps = req.secure || req.header('x-forwarded-proto') === 'https';
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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const pool = getDbPool();
  const supabaseAdmin = getSupabaseAdminClient();
  const supabaseAuth = getSupabaseAuthClient();

  if (!pool || !supabaseAdmin || !supabaseAuth) {
    res.status(503).json({
      ok: false,
      code: 'BACKEND_NOT_CONFIGURED',
      message:
        'Supabase PostgreSQL database and Auth secrets must be configured in the server environment.',
    });
    return;
  }

  let token = extractAccessToken(req);
  const cookies = parseCookies(req.header('cookie'));

  if (!token && cookies.sb_refresh_token) {
    const refreshed = await supabaseAuth.auth.refreshSession({
      refresh_token: cookies.sb_refresh_token,
    });
    if (refreshed.data.session?.access_token) {
      token = refreshed.data.session.access_token;
      setAuthCookies(req, res, refreshed.data.session);
    }
  }

  if (!token) {
    res.status(401).json({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
    return;
  }

  let userData = await supabaseAdmin.auth.getUser(token);
  if ((userData.error || !userData.data.user) && cookies.sb_refresh_token) {
    const refreshed = await supabaseAuth.auth.refreshSession({
      refresh_token: cookies.sb_refresh_token,
    });
    if (refreshed.data.session?.access_token) {
      token = refreshed.data.session.access_token;
      setAuthCookies(req, res, refreshed.data.session);
      userData = await supabaseAdmin.auth.getUser(token);
    }
  }

  if (userData.error || !userData.data.user) {
    clearAuthCookies(req, res);
    res.status(401).json({
      ok: false,
      code: 'INVALID_SESSION',
      message: 'Session is invalid or expired. Please sign in again.',
    });
    return;
  }

  const authUserId = userData.data.user.id;

  try {
    const profileRes = await dbQuery<{
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
    }>(
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
      [authUserId]
    );

    const row = profileRes.rows[0];
    if (!row) {
      res.status(403).json({
        ok: false,
        code: 'PROFILE_NOT_INITIALIZED',
        message: 'Account profile record is not initialized in the database.',
      });
      return;
    }

    if (row.account_status !== 'active') {
      clearAuthCookies(req, res);
      res.status(403).json({
        ok: false,
        code: row.account_status === 'closed' ? 'ACCOUNT_CLOSED' : 'ACCOUNT_SUSPENDED',
        message:
          row.account_status === 'closed'
            ? 'This account has been closed and is no longer active.'
            : 'This account is suspended. Contact platform administration.',
      });
      return;
    }

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
      accessToken: token,
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database lookup failed';
    res.status(500).json({
      ok: false,
      code: 'AUTH_LOOKUP_ERROR',
      message: `Failed to resolve authenticated account: ${message}`,
    });
  }
}

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

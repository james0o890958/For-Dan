import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import { getEnvConfig } from '../config';
import { dbQuery, withTransaction } from '../db';
import {
  clearAuthCookies,
  createRequireAuth,
  extractAccessToken,
  requireAuth,
  requireBackendReady,
  resolveSessionWithActiveCheck,
  setAuthCookies,
  type AuthMiddlewareDependencies,
  type AuthSessionTokens,
} from '../middleware/auth';
import {
  asyncHandler,
  createRateLimiter,
  getClientRateLimitIp,
  type RateLimiterInstance,
} from '../middleware/security';
import { getSupabaseAdminClient, getSupabaseAuthClient } from '../supabase';
import { normalizePhoneNumber, parseLoginIdentifier } from '../services/phone';
import { captureAndRecordAuthSecurityEvent } from '../services/securityEvents';
import type { AccountStatus, AppRole, KycStatus } from '../../src/types/domain';

function generateCandidatePublicUserId(): string {
  const randomDigits = Math.floor(100000000 + Math.random() * 899999999);
  return String(randomDigits);
}

async function fetchAccountSnapshot(userId: string) {
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
  }>(
    `
    SELECT
      id,
      public_user_id,
      email,
      full_name,
      phone,
      totp_enabled,
      account_status,
      kyc_status,
      preferred_language,
      created_at::text AS created_at
    FROM public.profiles
    WHERE id = $1
    `,
    [userId]
  );

  const roleRes = await dbQuery<{
    id: string;
    user_id: string;
    role: AppRole;
    assigned_by: string | null;
    created_at: string;
  }>(
    `
    SELECT
      id,
      user_id,
      role,
      assigned_by,
      created_at::text AS created_at
    FROM public.user_roles
    WHERE user_id = $1
    ORDER BY CASE role
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

  const balanceRes = await dbQuery<{
    id: string;
    user_id: string;
    asset_symbol: string;
    available: string;
    reserved: string;
    updated_at: string;
  }>(
    `
    SELECT
      id,
      user_id,
      asset_symbol,
      available::text AS available,
      reserved::text AS reserved,
      updated_at::text AS updated_at
    FROM public.wallet_balances
    WHERE user_id = $1
    ORDER BY asset_symbol ASC
    `,
    [userId]
  );

  const p = profileRes.rows[0];
  if (!p) return null;

  return {
    profile: {
      id: p.id,
      publicUserId: p.public_user_id,
      email: p.email,
      fullName: p.full_name,
      phone: p.phone,
      twoFactorEnabled: p.totp_enabled,
      accountStatus: p.account_status,
      kycStatus: p.kyc_status,
      preferredLanguage: p.preferred_language,
      createdAt: p.created_at,
    },
    role: roleRes.rows[0]?.role ?? ('customer' as AppRole),
    balances: balanceRes.rows.map((b) => ({
      id: b.id,
      userId: b.user_id,
      assetSymbol: b.asset_symbol,
      available: Number(b.available),
      reserved: Number(b.reserved),
      updatedAt: b.updated_at,
    })),
  };
}

export function buildCanonicalRateLimitIdentifier(rawIdentifier: unknown): string | null {
  if (typeof rawIdentifier !== 'string') return null;
  const trimmed = rawIdentifier.trim();
  if (!trimmed) return null;

  const parsed = parseLoginIdentifier(trimmed);
  switch (parsed.kind) {
    case 'email':
      return `email:${parsed.email}`;
    case 'phone':
      return `phone:${parsed.phone}`;
    case 'public_user_id':
      return `uid:${parsed.publicUserId}`;
    case 'invalid':
      // Collapse all malformed/invalid identifiers into one constant bucket to prevent cardinality DoS
      return 'invalid:__unclassified__';
  }
}

export function hashRateLimitIdentifier(canonicalIdentifier: string): string {
  return crypto.createHash('sha256').update(canonicalIdentifier).digest('hex').slice(0, 32);
}

function extractNormalizedIdentifierKey(req: Request): string[] {
  const ipKey = `ip:${getClientRateLimitIp(req)}`;
  const canonical = buildCanonicalRateLimitIdentifier(req.body?.identifier);
  if (!canonical) return [ipKey];
  return [ipKey, `id:${hashRateLimitIdentifier(canonical)}`];
}

export interface AuthRouteServiceOverrides {
  isBackendReady?: () => boolean;
  lookupEmailByPublicUserId?: (publicUserId: string) => Promise<string | null>;
  lookupEmailByPhone?: (phone: string) => Promise<string | null>;
  signInWithPassword?: (params: {
    email: string;
    password: string;
  }) => Promise<{
    data: {
      session: AuthSessionTokens | null;
      user: { id: string } | null;
    };
    error: { message?: string } | null;
  }>;
  signOut?: (jwt: string, scope?: 'global' | 'local' | 'others') => Promise<unknown>;
  updateUserPassword?: (
    userId: string,
    newPassword: string
  ) => Promise<{ error: { message?: string } | null }>;
  fetchAccountSnapshot?: (userId: string) => Promise<Awaited<ReturnType<typeof fetchAccountSnapshot>>>;
  recordSecurityEvent?: (params: {
    req: Request;
    eventType: 'register' | 'login_success' | 'login_failure';
    userId: string | null;
    identifierAttempted?: string | null;
  }) => Promise<unknown>;
}

export interface AuthRouterOptions {
  rateLimits?: {
    windowMs?: number;
    maxBuckets?: number;
    loginMax?: number;
    registerMax?: number;
    recoverMax?: number;
    updatePasswordMax?: number;
    now?: () => number;
  };
  sessionDeps?: AuthMiddlewareDependencies;
  authService?: AuthRouteServiceOverrides;
  fetchBalancesForUser?: (userId: string) => Promise<
    Array<{
      id: string;
      userId: string;
      assetSymbol: string;
      available: number;
      reserved: number;
      updatedAt: string;
    }>
  >;
}

export interface AuthRouterWithLimiters {
  router: Router;
  limiters: {
    register: RateLimiterInstance;
    login: RateLimiterInstance;
    recover: RateLimiterInstance;
    updatePassword: RateLimiterInstance;
  };
}

export function createAuthRouterWithLimiters(
  options?: AuthRouterOptions
): AuthRouterWithLimiters {
  const router = Router();
  const windowMs = options?.rateLimits?.windowMs ?? 15 * 60 * 1000;
  const maxBuckets = options?.rateLimits?.maxBuckets;
  const now = options?.rateLimits?.now;

  const ensureBackendReady: RequestHandler = options?.authService?.isBackendReady
    ? (_req, res, next) => {
        if (!options.authService!.isBackendReady!()) {
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
    : requireBackendReady;

  const requireAuthMiddleware = options?.sessionDeps
    ? createRequireAuth(options.sessionDeps)
    : requireAuth;

  const recordSecurityEvent =
    options?.authService?.recordSecurityEvent ?? captureAndRecordAuthSecurityEvent;
  const loadAccountSnapshot = options?.authService?.fetchAccountSnapshot ?? fetchAccountSnapshot;

  const registerLimiter = createRateLimiter({
    keyPrefix: 'auth:register',
    windowMs,
    maxBuckets,
    maxRequests: options?.rateLimits?.registerMax ?? 5,
    now,
  });

  const loginLimiter = createRateLimiter({
    keyPrefix: 'auth:login',
    windowMs,
    maxBuckets,
    maxRequests: options?.rateLimits?.loginMax ?? 10,
    extractKeys: extractNormalizedIdentifierKey,
    now,
  });

  const recoverLimiter = createRateLimiter({
    keyPrefix: 'auth:recover',
    windowMs,
    maxBuckets,
    maxRequests: options?.rateLimits?.recoverMax ?? 5,
    extractKeys: extractNormalizedIdentifierKey,
    now,
  });

  const updatePasswordLimiter = createRateLimiter({
    keyPrefix: 'auth:update-password',
    windowMs,
    maxBuckets,
    maxRequests: options?.rateLimits?.updatePasswordMax ?? 8,
    extractKeys: (req) => {
      const keys = [`ip:${getClientRateLimitIp(req)}`];
      if (req.auth?.userId) keys.push(`uid:${req.auth.userId}`);
      return keys;
    },
    now,
  });

  router.post(
    '/register',
    registerLimiter.middleware,
    ensureBackendReady,
    asyncHandler(async (req, res) => {
      const { fullName, email, phone, password, preferredLanguage } = req.body ?? {};
      const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const cleanName = typeof fullName === 'string' ? fullName.trim() : '';
      const cleanLang =
        typeof preferredLanguage === 'string' && preferredLanguage.trim()
          ? preferredLanguage.trim()
          : 'English';

      const phoneResult = normalizePhoneNumber(phone);
      if (phoneResult.ok === false) {
        res.status(400).json({
          ok: false,
          code: phoneResult.code,
          message: phoneResult.message,
        });
        return;
      }
      const normalizedPhone = phoneResult.value;

      if (
        !cleanName ||
        !cleanEmail ||
        !cleanEmail.includes('@') ||
        typeof password !== 'string' ||
        password.length < 8
      ) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Full name, valid email, and password (minimum 8 characters) are required.',
        });
        return;
      }

      const supabaseAdmin = getSupabaseAdminClient()!;
      const supabaseAuth = getSupabaseAuthClient()!;

      const existing = await dbQuery<{ id: string }>(
        'SELECT id FROM public.profiles WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [cleanEmail]
      );
      if (existing.rows.length > 0) {
        res.status(409).json({
          ok: false,
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists.',
        });
        return;
      }

      if (normalizedPhone !== null) {
        const existingPhone = await dbQuery<{ id: string }>(
          'SELECT id FROM public.profiles WHERE phone = $1 AND phone IS NOT NULL LIMIT 1',
          [normalizedPhone]
        );
        if (existingPhone.rows.length > 0) {
          res.status(409).json({
            ok: false,
            code: 'PHONE_EXISTS',
            message: 'An account with this phone number already exists.',
          });
          return;
        }
      }

      const createdAuth = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: cleanName,
          ...(normalizedPhone !== null ? { phone: normalizedPhone } : {}),
          preferred_language: cleanLang,
        },
      });

      if (createdAuth.error || !createdAuth.data.user) {
        const rawErrMsg = createdAuth.error?.message ?? 'Unknown auth registration error';
        console.warn('Supabase Auth createUser failed:', rawErrMsg);
        const isAlreadyRegistered = rawErrMsg.toLowerCase().includes('already');
        res.status(isAlreadyRegistered ? 409 : 400).json({
          ok: false,
          code: isAlreadyRegistered ? 'EMAIL_EXISTS' : 'AUTH_REGISTRATION_FAILED',
          message: isAlreadyRegistered
            ? 'An account with this email already exists.'
            : 'Unable to register account with the provided details.',
        });
        return;
      }

      const authUserId = createdAuth.data.user.id;

      try {
        await withTransaction(async (client) => {
          let publicUserId = generateCandidatePublicUserId();
          for (let i = 0; i < 5; i += 1) {
            const collision = await client.query(
              'SELECT 1 FROM public.profiles WHERE public_user_id = $1 LIMIT 1',
              [publicUserId]
            );
            if (collision.rows.length === 0) break;
            publicUserId = generateCandidatePublicUserId();
          }

          await client.query(
            `
            INSERT INTO public.profiles (
              id,
              public_user_id,
              email,
              full_name,
              phone,
              totp_enabled,
              account_status,
              kyc_status,
              preferred_language
            )
            VALUES ($1, $2, $3, $4, $5, FALSE, 'active', 'not_submitted', $6)
            ON CONFLICT (id) DO NOTHING
            `,
            [authUserId, publicUserId, cleanEmail, cleanName, normalizedPhone, cleanLang]
          );

          await client.query(
            `
            INSERT INTO public.user_roles (user_id, role, assigned_by)
            VALUES ($1, 'customer', NULL)
            ON CONFLICT (user_id, role) DO NOTHING
            `,
            [authUserId]
          );

          // Every new customer account starts strictly with 0.00 available and 0.00 reserved balances
          await client.query(
            `
            INSERT INTO public.wallet_balances (user_id, asset_symbol, available, reserved)
            SELECT $1, a.symbol, 0, 0
            FROM public.assets a
            WHERE a.is_enabled = TRUE
            ON CONFLICT (user_id, asset_symbol) DO NOTHING
            `,
            [authUserId]
          );
        });
      } catch (dbErr) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(authUserId);
        } catch (cleanupErr) {
          console.error('Failed to roll back Supabase Auth user after DB error:', cleanupErr);
        }
        const pgErr = dbErr as { code?: string; constraint?: string; detail?: string } | undefined;
        if (pgErr?.code === '23505') {
          const isPhoneConflict =
            pgErr.constraint === 'uq_profiles_phone_normalized' ||
            (pgErr.detail ?? '').toLowerCase().includes('phone');
          res.status(409).json({
            ok: false,
            code: isPhoneConflict ? 'PHONE_EXISTS' : 'EMAIL_EXISTS',
            message: isPhoneConflict
              ? 'An account with this phone number already exists.'
              : 'An account with this email already exists.',
          });
          return;
        }

        console.error('Database profile creation failed during register:', dbErr);
        res.status(500).json({
          ok: false,
          code: 'PROFILE_CREATION_FAILED',
          message: 'Account initialization failed. Please try again later.',
        });
        return;
      }

      const signIn = await supabaseAuth.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signIn.data.session) {
        setAuthCookies(req, res, signIn.data.session);
      }

      const snapshot = await fetchAccountSnapshot(authUserId);

      await captureAndRecordAuthSecurityEvent({
        req,
        eventType: 'register',
        userId: authUserId,
        identifierAttempted: cleanEmail,
      });

      res.status(201).json({
        ok: true,
        message: `Account created with User ID ${snapshot?.profile.publicUserId ?? ''}. Starting balances are 0.00.`,
        data: snapshot,
      });
    })
  );

  router.post(
    '/login',
    loginLimiter.middleware,
    ensureBackendReady,
    asyncHandler(async (req, res) => {
      const { identifier, password } = req.body ?? {};
      const cleanIdentifier = typeof identifier === 'string' ? identifier.trim() : '';

      if (!cleanIdentifier || typeof password !== 'string' || !password) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Account email, phone, or User ID and password are required.',
        });
        return;
      }

      const parsedIdentifier = parseLoginIdentifier(cleanIdentifier);
      if (parsedIdentifier.kind === 'invalid') {
        await recordSecurityEvent({
          req,
          eventType: 'login_failure',
          userId: null,
          identifierAttempted: cleanIdentifier,
        });
        res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid account credentials.',
        });
        return;
      }

      let resolvedEmail = '';
      if (parsedIdentifier.kind === 'email') {
        resolvedEmail = parsedIdentifier.email;
      } else {
        let lookedUpEmail: string | null = null;
        if (parsedIdentifier.kind === 'public_user_id') {
          if (options?.authService?.lookupEmailByPublicUserId) {
            lookedUpEmail = await options.authService.lookupEmailByPublicUserId(
              parsedIdentifier.publicUserId
            );
          } else {
            const lookup = await dbQuery<{ email: string }>(
              `
              SELECT email
              FROM public.profiles
              WHERE public_user_id = $1
              LIMIT 1
              `,
              [parsedIdentifier.publicUserId]
            );
            lookedUpEmail = lookup.rows[0]?.email ?? null;
          }
        } else if (options?.authService?.lookupEmailByPhone) {
          lookedUpEmail = await options.authService.lookupEmailByPhone(parsedIdentifier.phone);
        } else {
          const lookup = await dbQuery<{ email: string }>(
            `
            SELECT email
            FROM public.profiles
            WHERE phone = $1 AND phone IS NOT NULL
            LIMIT 1
            `,
            [parsedIdentifier.phone]
          );
          lookedUpEmail = lookup.rows[0]?.email ?? null;
        }

        if (!lookedUpEmail) {
          await recordSecurityEvent({
            req,
            eventType: 'login_failure',
            userId: null,
            identifierAttempted: cleanIdentifier,
          });
          res.status(401).json({
            ok: false,
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid account credentials.',
          });
          return;
        }
        resolvedEmail = lookedUpEmail.toLowerCase();
      }

      const signInFn =
        options?.authService?.signInWithPassword ??
        ((params: { email: string; password: string }) =>
          getSupabaseAuthClient()!.auth.signInWithPassword(params));
      const signOutFn =
        options?.authService?.signOut ??
        ((jwt: string, scope?: 'global' | 'local' | 'others') =>
          getSupabaseAdminClient()!.auth.admin.signOut(jwt, scope));

      const signIn = await signInFn({
        email: resolvedEmail,
        password,
      });

      if (signIn.error || !signIn.data.session || !signIn.data.user) {
        await recordSecurityEvent({
          req,
          eventType: 'login_failure',
          userId: null,
          identifierAttempted: resolvedEmail,
        });
        res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid account credentials.',
        });
        return;
      }

      const snapshot = await loadAccountSnapshot(signIn.data.user.id);
      if (!snapshot) {
        clearAuthCookies(req, res);
        try {
          await signOutFn(signIn.data.session.access_token, 'global');
        } catch {
          // Best-effort revocation; login still fails closed without cookies
        }
        await recordSecurityEvent({
          req,
          eventType: 'login_failure',
          userId: signIn.data.user.id,
          identifierAttempted: resolvedEmail,
        });
        res.status(403).json({
          ok: false,
          code: 'PROFILE_NOT_FOUND',
          message: 'Authenticated user does not have an initialized exchange profile.',
        });
        return;
      }

      if (snapshot.profile.accountStatus !== 'active') {
        clearAuthCookies(req, res);
        try {
          await signOutFn(signIn.data.session.access_token, 'global');
        } catch {
          // Best-effort revocation; cookies cleared and no tokens returned
        }
        await recordSecurityEvent({
          req,
          eventType: 'login_failure',
          userId: signIn.data.user.id,
          identifierAttempted: resolvedEmail,
        });
        res.status(403).json({
          ok: false,
          code: 'ACCOUNT_INACTIVE',
          message: 'This account is not active and cannot be signed into. Contact platform administration.',
        });
        return;
      }

      await recordSecurityEvent({
        req,
        eventType: 'login_success',
        userId: signIn.data.user.id,
        identifierAttempted: resolvedEmail,
      });

      setAuthCookies(req, res, signIn.data.session);

      res.json({
        ok: true,
        message: 'Signed in successfully.',
        data: snapshot,
      });
    })
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token = extractAccessToken(req);
      const signOutFn =
        options?.authService?.signOut ??
        (getSupabaseAdminClient()
          ? (jwt: string, scope?: 'global' | 'local' | 'others') =>
              getSupabaseAdminClient()!.auth.admin.signOut(jwt, scope)
          : null);
      if (token && signOutFn) {
        try {
          await signOutFn(token, 'global');
        } catch {
          // Cookie clearing still completes logout locally
        }
      }
      clearAuthCookies(req, res);
      res.json({ ok: true, message: 'Signed out.' });
    })
  );

  router.post(
    '/recover',
    recoverLimiter.middleware,
    ensureBackendReady,
    asyncHandler(async (req, res) => {
      const { identifier } = req.body ?? {};
      const cleanIdentifier = typeof identifier === 'string' ? identifier.trim() : '';

      if (!cleanIdentifier) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Enter your account email, phone, or User ID.',
        });
        return;
      }

      const parsedIdentifier = parseLoginIdentifier(cleanIdentifier);
      let emailToRecover: string | null = null;

      if (parsedIdentifier.kind === 'email') {
        const lookup = await dbQuery<{ email: string }>(
          `
          SELECT email
          FROM public.profiles
          WHERE LOWER(email) = LOWER($1) AND account_status <> 'closed'
          LIMIT 1
          `,
          [parsedIdentifier.email]
        );
        emailToRecover = lookup.rows[0]?.email ?? null;
      } else if (parsedIdentifier.kind === 'public_user_id') {
        const lookup = await dbQuery<{ email: string }>(
          `
          SELECT email
          FROM public.profiles
          WHERE public_user_id = $1 AND account_status <> 'closed'
          LIMIT 1
          `,
          [parsedIdentifier.publicUserId]
        );
        emailToRecover = lookup.rows[0]?.email ?? null;
      } else if (parsedIdentifier.kind === 'phone') {
        const lookup = await dbQuery<{ email: string }>(
          `
          SELECT email
          FROM public.profiles
          WHERE phone = $1 AND phone IS NOT NULL AND account_status <> 'closed'
          LIMIT 1
          `,
          [parsedIdentifier.phone]
        );
        emailToRecover = lookup.rows[0]?.email ?? null;
      }

      if (emailToRecover) {
        const supabaseAuth = getSupabaseAuthClient()!;
        const { appUrl } = getEnvConfig();
        const cleanAppUrl = appUrl?.replace(/\/+$/, '');
        await supabaseAuth.auth.resetPasswordForEmail(
          emailToRecover,
          cleanAppUrl ? { redirectTo: `${cleanAppUrl}/login` } : undefined
        );
      }

      // Non-enumerating response regardless of whether account matched
      res.json({
        ok: true,
        message:
          'If an active account matches those details, a password recovery email has been dispatched via Supabase Auth.',
      });
    })
  );

  router.post(
    '/update-password',
    requireAuthMiddleware,
    updatePasswordLimiter.middleware,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body ?? {};
      if (
        typeof currentPassword !== 'string' ||
        !currentPassword ||
        typeof newPassword !== 'string' ||
        newPassword.length < 8
      ) {
        res.status(400).json({
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Current password and new password (minimum 8 characters) are required.',
        });
        return;
      }

      const signInFn =
        options?.authService?.signInWithPassword ??
        ((params: { email: string; password: string }) =>
          getSupabaseAuthClient()!.auth.signInWithPassword(params));
      const signOutFn =
        options?.authService?.signOut ??
        ((jwt: string, scope?: 'global' | 'local' | 'others') =>
          getSupabaseAdminClient()!.auth.admin.signOut(jwt, scope));
      const updateUserPasswordFn =
        options?.authService?.updateUserPassword ??
        ((userId: string, password: string) =>
          getSupabaseAdminClient()!.auth.admin.updateUserById(userId, { password }));

      const verify = await signInFn({
        email: req.auth!.email,
        password: currentPassword,
      });

      const tempAccessToken = verify.data?.session?.access_token;
      if (tempAccessToken) {
        try {
          // Immediately revoke the temporary password-verification session
          await signOutFn(tempAccessToken, 'local');
        } catch {
          // Best-effort local cleanup of verification session
        }
      }

      if (verify.error || !verify.data.user) {
        res.status(401).json({
          ok: false,
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect.',
        });
        return;
      }

      const currentSnapshot = await loadAccountSnapshot(req.auth!.userId);
      if (!currentSnapshot || currentSnapshot.profile.accountStatus !== 'active') {
        clearAuthCookies(req, res);
        try {
          await signOutFn(req.auth!.accessToken, 'global');
        } catch {
          // Best-effort revocation
        }
        res.status(403).json({
          ok: false,
          code: 'ACCOUNT_INACTIVE',
          message: 'This account is not active. Contact platform administration.',
        });
        return;
      }

      const updated = await updateUserPasswordFn(req.auth!.userId, newPassword);

      if (updated.error) {
        console.warn('Supabase Auth updateUserById password failure:', updated.error.message);
        res.status(400).json({
          ok: false,
          code: 'PASSWORD_UPDATE_FAILED',
          message: 'Unable to update password. Ensure the new password meets security requirements.',
        });
        return;
      }

      res.json({
        ok: true,
        message: 'Password updated successfully.',
      });
    })
  );

  router.get(
    '/session',
    asyncHandler(async (req, res) => {
      const resolution = await resolveSessionWithActiveCheck(req, res, options?.sessionDeps);

      if (resolution.status === 'unconfigured') {
        res.json({
          ok: true,
          authenticated: false,
          backendConfigured: false,
          data: null,
        });
        return;
      }

      if (resolution.status === 'lookup_error') {
        console.error('Session lookup failed:', resolution.error);
        res.json({
          ok: true,
          authenticated: false,
          backendConfigured: false,
          data: null,
        });
        return;
      }

      if (resolution.status !== 'active') {
        res.json({
          ok: true,
          authenticated: false,
          backendConfigured: true,
          data: null,
        });
        return;
      }

      const { profile: p } = resolution;
      let balances: Array<{
        id: string;
        userId: string;
        assetSymbol: string;
        available: number;
        reserved: number;
        updatedAt: string;
      }> = [];

      if (options?.fetchBalancesForUser) {
        balances = await options.fetchBalancesForUser(p.id);
      } else {
        const balanceRes = await dbQuery<{
          id: string;
          user_id: string;
          asset_symbol: string;
          available: string;
          reserved: string;
          updated_at: string;
        }>(
          `
          SELECT
            id,
            user_id,
            asset_symbol,
            available::text AS available,
            reserved::text AS reserved,
            updated_at::text AS updated_at
          FROM public.wallet_balances
          WHERE user_id = $1
          ORDER BY asset_symbol ASC
          `,
          [p.id]
        );
        balances = balanceRes.rows.map((b) => ({
          id: b.id,
          userId: b.user_id,
          assetSymbol: b.asset_symbol,
          available: Number(b.available),
          reserved: Number(b.reserved),
          updatedAt: b.updated_at,
        }));
      }

      res.json({
        ok: true,
        authenticated: true,
        backendConfigured: true,
        data: {
          profile: {
            id: p.id,
            publicUserId: p.public_user_id,
            email: p.email,
            fullName: p.full_name,
            phone: p.phone,
            twoFactorEnabled: p.totp_enabled,
            accountStatus: p.account_status,
            kycStatus: p.kyc_status,
            preferredLanguage: p.preferred_language,
            createdAt: p.created_at,
          },
          role: p.role ?? ('customer' as AppRole),
          balances,
        },
      });
    })
  );

  router.get(
    '/me',
    requireAuthMiddleware,
    asyncHandler(async (req, res) => {
      const snapshot = await loadAccountSnapshot(req.auth!.userId);
      if (!snapshot) {
        res.status(404).json({
          ok: false,
          code: 'PROFILE_NOT_FOUND',
          message: 'Account profile not found.',
        });
        return;
      }

      res.json({
        ok: true,
        data: snapshot,
      });
    })
  );

  return {
    router,
    limiters: {
      register: registerLimiter,
      login: loginLimiter,
      recover: recoverLimiter,
      updatePassword: updatePasswordLimiter,
    },
  };
}

export function createAuthRouter(options?: AuthRouterOptions): Router {
  return createAuthRouterWithLimiters(options).router;
}

export default createAuthRouter();

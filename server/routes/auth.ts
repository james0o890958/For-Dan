import { Router } from 'express';
import { getEnvConfig } from '../config';
import { dbQuery, withTransaction } from '../db';
import {
  clearAuthCookies,
  extractAccessToken,
  requireAuth,
  requireBackendReady,
  setAuthCookies,
} from '../middleware/auth';
import { getSupabaseAdminClient, getSupabaseAuthClient } from '../supabase';
import { normalizePhoneNumber, parseLoginIdentifier } from '../services/phone';
import { captureAndRecordAuthSecurityEvent } from '../services/securityEvents';
import type { AccountStatus, AppRole, KycStatus } from '../../src/types/domain';

const router = Router();

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

router.post('/register', requireBackendReady, async (req, res) => {
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
    const status = createdAuth.error?.message?.toLowerCase().includes('already') ? 409 : 400;
    res.status(status).json({
      ok: false,
      code: 'AUTH_REGISTRATION_FAILED',
      message: createdAuth.error?.message ?? 'Unable to register account in Supabase Auth.',
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
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
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

    const msg = dbErr instanceof Error ? dbErr.message : 'Database initialization error';
    res.status(500).json({
      ok: false,
      code: 'PROFILE_CREATION_FAILED',
      message: `Account initialization failed cleanly: ${msg}`,
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
});

router.post('/login', requireBackendReady, async (req, res) => {
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
    await captureAndRecordAuthSecurityEvent({
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
    const lookup =
      parsedIdentifier.kind === 'public_user_id'
        ? await dbQuery<{ email: string }>(
            `
            SELECT email
            FROM public.profiles
            WHERE public_user_id = $1
            LIMIT 1
            `,
            [parsedIdentifier.publicUserId]
          )
        : await dbQuery<{ email: string }>(
            `
            SELECT email
            FROM public.profiles
            WHERE phone = $1 AND phone IS NOT NULL
            LIMIT 1
            `,
            [parsedIdentifier.phone]
          );

    if (lookup.rows.length === 0) {
      await captureAndRecordAuthSecurityEvent({
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
    resolvedEmail = lookup.rows[0].email.toLowerCase();
  }

  const supabaseAuth = getSupabaseAuthClient()!;
  const signIn = await supabaseAuth.auth.signInWithPassword({
    email: resolvedEmail,
    password,
  });

  if (signIn.error || !signIn.data.session || !signIn.data.user) {
    await captureAndRecordAuthSecurityEvent({
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

  const snapshot = await fetchAccountSnapshot(signIn.data.user.id);
  if (!snapshot) {
    await captureAndRecordAuthSecurityEvent({
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
    await captureAndRecordAuthSecurityEvent({
      req,
      eventType: 'login_failure',
      userId: signIn.data.user.id,
      identifierAttempted: resolvedEmail,
    });
    res.status(403).json({
      ok: false,
      code: snapshot.profile.accountStatus === 'closed' ? 'ACCOUNT_CLOSED' : 'ACCOUNT_SUSPENDED',
      message:
        snapshot.profile.accountStatus === 'closed'
          ? 'This account has been closed and cannot be signed into.'
          : 'This account is suspended. Contact platform administration.',
    });
    return;
  }

  await captureAndRecordAuthSecurityEvent({
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
});

router.post('/logout', async (req, res) => {
  const token = extractAccessToken(req);
  const supabaseAdmin = getSupabaseAdminClient();
  if (token && supabaseAdmin) {
    try {
      await supabaseAdmin.auth.admin.signOut(token);
    } catch {
      // Cookie clearing still completes logout locally
    }
  }
  clearAuthCookies(req, res);
  res.json({ ok: true, message: 'Signed out.' });
});

router.post('/recover', requireBackendReady, async (req, res) => {
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
    await supabaseAuth.auth.resetPasswordForEmail(emailToRecover, {
      redirectTo: `${appUrl.replace(/\/+$/, '')}/login`,
    });
  }

  // Non-enumerating response regardless of whether account matched
  res.json({
    ok: true,
    message:
      'If an active account matches those details, a password recovery email has been dispatched via Supabase Auth.',
  });
});

router.post('/update-password', requireAuth, async (req, res) => {
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

  const supabaseAuth = getSupabaseAuthClient()!;
  const supabaseAdmin = getSupabaseAdminClient()!;

  const verify = await supabaseAuth.auth.signInWithPassword({
    email: req.auth!.email,
    password: currentPassword,
  });

  if (verify.error) {
    res.status(401).json({
      ok: false,
      code: 'INVALID_CURRENT_PASSWORD',
      message: 'Current password is incorrect.',
    });
    return;
  }

  const updated = await supabaseAdmin.auth.admin.updateUserById(req.auth!.userId, {
    password: newPassword,
  });

  if (updated.error) {
    res.status(400).json({
      ok: false,
      code: 'PASSWORD_UPDATE_FAILED',
      message: updated.error.message,
    });
    return;
  }

  res.json({
    ok: true,
    message: 'Password updated successfully.',
  });
});

router.get('/session', async (req, res) => {
  const token = extractAccessToken(req);
  const supabaseAdmin = getSupabaseAdminClient();
  const supabaseAuth = getSupabaseAuthClient();

  if (!token || !supabaseAdmin || !supabaseAuth) {
    res.json({
      ok: true,
      authenticated: false,
      backendConfigured: Boolean(supabaseAdmin && supabaseAuth),
      data: null,
    });
    return;
  }

  const userData = await supabaseAdmin.auth.getUser(token);
  if (userData.error || !userData.data.user) {
    clearAuthCookies(req, res);
    res.json({
      ok: true,
      authenticated: false,
      backendConfigured: true,
      data: null,
    });
    return;
  }

  try {
    const snapshot = await fetchAccountSnapshot(userData.data.user.id);
    if (!snapshot || snapshot.profile.accountStatus !== 'active') {
      clearAuthCookies(req, res);
      res.json({
        ok: true,
        authenticated: false,
        backendConfigured: true,
        data: null,
      });
      return;
    }

    res.json({
      ok: true,
      authenticated: true,
      backendConfigured: true,
      data: snapshot,
    });
  } catch {
    res.json({
      ok: true,
      authenticated: false,
      backendConfigured: false,
      data: null,
    });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const snapshot = await fetchAccountSnapshot(req.auth!.userId);
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
});

export default router;

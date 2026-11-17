import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { User } from '@supabase/supabase-js';
import { getDbPool, testDatabaseConnection, withTransaction } from './db';
import { getSupabaseAdminClient } from './supabase';

export const INITIAL_SUPER_ADMIN_EMAIL = 'coin.base.official01@gmail.com';
export const BOOTSTRAP_AUDIT_ACTION = 'INITIAL_SUPER_ADMIN_BOOTSTRAP';
const BOOTSTRAP_ADVISORY_LOCK_KEY = 88420101;

export interface BootstrapEligibilityInput {
  authUserId: string | null;
  authEmail: string | null;
  emailConfirmedAt: string | null;
  profileExists: boolean;
  profileEmail: string | null;
  profilePublicUserId: string | null;
  profileAccountStatus: 'active' | 'suspended' | 'closed' | null;
  existingSuperAdminCount: number;
  bootstrapAuditCount: number;
}

export interface BootstrapEligibilityResult {
  eligible: boolean;
  code:
    | 'ELIGIBLE'
    | 'BOOTSTRAP_ALREADY_CONSUMED'
    | 'AUTH_USER_NOT_FOUND'
    | 'EMAIL_MISMATCH'
    | 'EMAIL_NOT_VERIFIED'
    | 'PROFILE_NOT_READY'
    | 'ACCOUNT_SUSPENDED'
    | 'ACCOUNT_CLOSED';
  reason: string;
}

export interface BootstrapExecutionResult {
  ok: boolean;
  code: BootstrapEligibilityResult['code'] | 'BACKEND_NOT_CONFIGURED' | 'MIGRATIONS_NOT_APPLIED' | 'AUTH_LOOKUP_FAILED';
  message: string;
  userId?: string;
  publicUserId?: string;
  email?: string;
  role?: 'super_admin';
}

export function normalizeBootstrapEmail(email?: string | null): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function evaluateBootstrapEligibility(
  input: BootstrapEligibilityInput
): BootstrapEligibilityResult {
  if (input.existingSuperAdminCount > 0 || input.bootstrapAuditCount > 0) {
    return {
      eligible: false,
      code: 'BOOTSTRAP_ALREADY_CONSUMED',
      reason:
        'One-time Super Admin bootstrap has already been consumed or a super_admin already exists.',
    };
  }

  if (!input.authUserId) {
    return {
      eligible: false,
      code: 'AUTH_USER_NOT_FOUND',
      reason: `Designated account (${INITIAL_SUPER_ADMIN_EMAIL}) has not registered through Supabase Auth yet.`,
    };
  }

  if (normalizeBootstrapEmail(input.authEmail) !== INITIAL_SUPER_ADMIN_EMAIL) {
    return {
      eligible: false,
      code: 'EMAIL_MISMATCH',
      reason: `Bootstrap is strictly locked to ${INITIAL_SUPER_ADMIN_EMAIL}.`,
    };
  }

  if (!input.emailConfirmedAt) {
    return {
      eligible: false,
      code: 'EMAIL_NOT_VERIFIED',
      reason: 'The Supabase Auth user email is not verified yet.',
    };
  }

  if (
    !input.profileExists ||
    !input.profilePublicUserId ||
    normalizeBootstrapEmail(input.profileEmail) !== INITIAL_SUPER_ADMIN_EMAIL
  ) {
    return {
      eligible: false,
      code: 'PROFILE_NOT_READY',
      reason:
        'Linked public.profiles row is missing or does not match the verified Supabase Auth user.',
    };
  }

  if (input.profileAccountStatus !== 'active') {
    const isClosed = input.profileAccountStatus === 'closed';
    return {
      eligible: false,
      code: isClosed ? 'ACCOUNT_CLOSED' : 'ACCOUNT_SUSPENDED',
      reason: isClosed
        ? 'Designated account is closed and cannot be promoted.'
        : 'Designated account is suspended and cannot be promoted.',
    };
  }

  return {
    eligible: true,
    code: 'ELIGIBLE',
    reason: 'Designated Supabase Auth account is verified and eligible for one-time promotion.',
  };
}

async function findSupabaseAuthUserByEmail(targetEmail: string): Promise<User | null> {
  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const normalizedTarget = normalizeBootstrapEmail(targetEmail);
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message);
    }

    const users = data?.users ?? [];
    const matched = users.find((u) => normalizeBootstrapEmail(u.email) === normalizedTarget);
    if (matched) {
      const detail = await supabaseAdmin.auth.admin.getUserById(matched.id);
      if (detail.error || !detail.data.user) {
        throw new Error(detail.error?.message ?? 'Failed to fetch Supabase Auth user details.');
      }
      return detail.data.user;
    }

    if (users.length < perPage) {
      return null;
    }
    page += 1;
  }
}

export async function bootstrapInitialSuperAdmin(): Promise<BootstrapExecutionResult> {
  const pool = getDbPool();
  const supabaseAdmin = getSupabaseAdminClient();
  if (!pool || !supabaseAdmin) {
    return {
      ok: false,
      code: 'BACKEND_NOT_CONFIGURED',
      message:
        'PostgreSQL DATABASE_URL and Supabase Admin credentials must be configured in the server runtime.',
    };
  }

  const tableCheck = await pool.query<{
    profiles_exists: boolean;
    roles_exists: boolean;
    audit_exists: boolean;
  }>(`
    SELECT
      to_regclass('public.profiles') IS NOT NULL AS profiles_exists,
      to_regclass('public.user_roles') IS NOT NULL AS roles_exists,
      to_regclass('public.admin_audit_logs') IS NOT NULL AS audit_exists
  `);

  const tables = tableCheck.rows[0];
  if (!tables?.profiles_exists || !tables?.roles_exists || !tables?.audit_exists) {
    return {
      ok: false,
      code: 'MIGRATIONS_NOT_APPLIED',
      message:
        'Core exchange schema migrations (001-004) must be applied before running the Super Admin bootstrap.',
    };
  }

  let authUser: User | null;
  try {
    authUser = await findSupabaseAuthUserByEmail(INITIAL_SUPER_ADMIN_EMAIL);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supabase Auth Admin lookup failed';
    return {
      ok: false,
      code: 'AUTH_LOOKUP_FAILED',
      message: `Unable to verify Supabase Auth account: ${message}`,
    };
  }

  return withTransaction(async (client) => {
    // Serialize bootstrap execution across processes to enforce strict one-time execution
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_ADVISORY_LOCK_KEY]);

    const lockCheck = await client.query<{
      super_admin_count: string;
      bootstrap_audit_count: string;
    }>(
      `
      SELECT
        (SELECT COUNT(*)::text FROM public.user_roles WHERE role = 'super_admin') AS super_admin_count,
        (SELECT COUNT(*)::text FROM public.admin_audit_logs WHERE action = $1) AS bootstrap_audit_count
      `,
      [BOOTSTRAP_AUDIT_ACTION]
    );

    const existingSuperAdminCount = Number(lockCheck.rows[0]?.super_admin_count ?? 0);
    const bootstrapAuditCount = Number(lockCheck.rows[0]?.bootstrap_audit_count ?? 0);

    let dbAuthConfirmedAt: string | null = null;
    let dbAuthEmail: string | null = null;
    let profileRow:
      | {
          id: string;
          email: string;
          public_user_id: string;
          account_status: 'active' | 'suspended' | 'closed';
        }
      | undefined;

    if (authUser?.id) {
      const dbAuthRes = await client.query<{
        id: string;
        email: string | null;
        email_confirmed_at: string | null;
      }>(
        `
        SELECT id::text AS id, email, email_confirmed_at::text AS email_confirmed_at
        FROM auth.users
        WHERE id = $1
        LIMIT 1
        `,
        [authUser.id]
      );
      dbAuthEmail = dbAuthRes.rows[0]?.email ?? null;
      dbAuthConfirmedAt = dbAuthRes.rows[0]?.email_confirmed_at ?? null;

      const profRes = await client.query<{
        id: string;
        email: string;
        public_user_id: string;
        account_status: 'active' | 'suspended' | 'closed';
      }>(
        `
        SELECT id::text AS id, email, public_user_id, account_status
        FROM public.profiles
        WHERE id = $1
        LIMIT 1
        `,
        [authUser.id]
      );
      profileRow = profRes.rows[0];
    }

    const verifiedEmail =
      normalizeBootstrapEmail(authUser?.email) === INITIAL_SUPER_ADMIN_EMAIL &&
      normalizeBootstrapEmail(dbAuthEmail) === INITIAL_SUPER_ADMIN_EMAIL
        ? dbAuthEmail
        : authUser?.email ?? null;

    const eligibility = evaluateBootstrapEligibility({
      authUserId: authUser?.id ?? null,
      authEmail: verifiedEmail,
      emailConfirmedAt: authUser?.email_confirmed_at && dbAuthConfirmedAt ? dbAuthConfirmedAt : null,
      profileExists: Boolean(profileRow),
      profileEmail: profileRow?.email ?? null,
      profilePublicUserId: profileRow?.public_user_id ?? null,
      profileAccountStatus: profileRow?.account_status ?? null,
      existingSuperAdminCount,
      bootstrapAuditCount,
    });

    if (!eligibility.eligible || !authUser || !profileRow) {
      return {
        ok: false,
        code: eligibility.code,
        message: eligibility.reason,
      };
    }

    await client.query(
      `
      INSERT INTO public.user_roles (user_id, role, assigned_by)
      VALUES ($1, 'super_admin', NULL)
      ON CONFLICT (user_id, role) DO NOTHING
      `,
      [authUser.id]
    );

    await client.query(
      `
      INSERT INTO public.admin_audit_logs (
        admin_user_id,
        admin_label,
        action,
        affected_user_id,
        affected_public_user_id,
        record_type,
        record_id,
        details
      )
      VALUES ($1, 'SYSTEM_BOOTSTRAP', $2, $1, $3, 'user_roles', $1::text, $4)
      `,
      [
        authUser.id,
        BOOTSTRAP_AUDIT_ACTION,
        profileRow.public_user_id,
        `One-time initial Super Admin bootstrap completed for verified Supabase Auth user ${authUser.id} (${INITIAL_SUPER_ADMIN_EMAIL}).`,
      ]
    );

    return {
      ok: true,
      code: 'ELIGIBLE',
      message: `Promoted verified account ${INITIAL_SUPER_ADMIN_EMAIL} (${authUser.id}) to super_admin and permanently locked the bootstrap.`,
      userId: authUser.id,
      publicUserId: profileRow.public_user_id,
      email: profileRow.email,
      role: 'super_admin',
    };
  });
}

// Execute ONLY when explicitly invoked as a CLI command with --promote
const isDirectCliExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectCliExecution && process.argv.includes('--promote')) {
  (async () => {
    const dbHealth = await testDatabaseConnection();
    if (!dbHealth.connected) {
      console.error('Super Admin bootstrap aborted:', dbHealth.reason);
      process.exit(1);
    }

    const result = await bootstrapInitialSuperAdmin();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  })().catch((err) => {
    console.error('Super Admin bootstrap failed:', err);
    process.exit(1);
  });
}

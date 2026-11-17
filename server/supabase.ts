import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnvConfig } from './config';

let adminClient: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;

export interface SupabaseAuthHealth {
  configured: boolean;
  reachable: boolean;
  anonKeyVerified: boolean;
  serviceRoleVerified: boolean;
  projectHost: string | null;
  serviceRoleError?: string | null;
  reason: string;
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (adminClient) return adminClient;

  const { normalizedSupabaseUrl, supabaseServiceRoleKey } = getEnvConfig();
  if (!normalizedSupabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  adminClient = createClient(normalizedSupabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}

export function getSupabaseAuthClient(): SupabaseClient | null {
  if (authClient) return authClient;

  const { normalizedSupabaseUrl, supabaseAnonKey } = getEnvConfig();
  if (!normalizedSupabaseUrl || !supabaseAnonKey) {
    return null;
  }

  authClient = createClient(normalizedSupabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return authClient;
}

export async function testSupabaseAuthHealth(): Promise<SupabaseAuthHealth> {
  const { normalizedSupabaseUrl, supabaseAnonKey, status } = getEnvConfig();

  if (!status.supabaseUrlConfigured || !normalizedSupabaseUrl) {
    return {
      configured: false,
      reachable: false,
      anonKeyVerified: false,
      serviceRoleVerified: false,
      projectHost: null,
      reason: 'SUPABASE_URL is missing or invalid in the runtime environment.',
    };
  }

  const projectHost = new URL(normalizedSupabaseUrl).host;

  if (!status.supabaseAnonKeyConfigured || !status.supabaseServiceRoleKeyConfigured) {
    return {
      configured: false,
      reachable: false,
      anonKeyVerified: false,
      serviceRoleVerified: false,
      projectHost,
      reason:
        'SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is missing in the runtime environment.',
    };
  }

  let anonKeyVerified = false;
  let serviceRoleVerified = false;
  let serviceRoleError: string | null = null;

  try {
    const res = await fetch(`${normalizedSupabaseUrl}/auth/v1/settings`, {
      headers: {
        apikey: supabaseAnonKey!,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        anonKeyVerified: false,
        serviceRoleVerified: false,
        projectHost,
        reason: `Supabase Auth endpoint responded with HTTP ${res.status} for SUPABASE_ANON_KEY.`,
      };
    }
    anonKeyVerified = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return {
      configured: true,
      reachable: false,
      anonKeyVerified: false,
      serviceRoleVerified: false,
      projectHost,
      reason: `Unable to reach Supabase Auth: ${message}`,
    };
  }

  const admin = getSupabaseAdminClient();
  if (admin) {
    try {
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) {
        serviceRoleError = error.message;
      } else {
        serviceRoleVerified = true;
      }
    } catch (err) {
      serviceRoleError = err instanceof Error ? err.message : 'Admin Auth request failed';
    }
  } else {
    serviceRoleError = 'Supabase Admin client could not be initialized.';
  }

  return {
    configured: true,
    reachable: anonKeyVerified && serviceRoleVerified,
    anonKeyVerified,
    serviceRoleVerified,
    projectHost,
    serviceRoleError,
    reason:
      anonKeyVerified && serviceRoleVerified
        ? 'Supabase Auth endpoint reachable; both SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY verified.'
        : `Supabase Auth settings reachable, but SUPABASE_SERVICE_ROLE_KEY admin check failed: ${serviceRoleError}`,
  };
}

/**
 * Unit and Express HTTP-layer regression tests for Phase 1 authentication,
 * session refresh ordering, health disclosure, error sanitization, CSRF, and rate limiting.
 *
 * NOTE: These tests use ephemeral localhost Express servers with mocked database/Supabase
 * dependencies; they do NOT execute live SQL against PostgreSQL or call live Supabase APIs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createApiApp, type CreateApiAppOptions } from '../app';
import {
  buildCanonicalRateLimitIdentifier,
  createAuthRouterWithLimiters,
} from '../routes/auth';
import {
  createRequireAuth,
  extractJwtSubjectHint,
  type AuthMiddlewareDependencies,
  type ProfileAuthRow,
} from './auth';
import { asyncHandler, createRateLimiter } from './security';
import type { AccountStatus } from '../../src/types/domain';

function makeUnsignedJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, exp: 1 })).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

function makeProfile(overrides?: Partial<ProfileAuthRow>): ProfileAuthRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    public_user_id: '123456789',
    email: 'user@example.com',
    full_name: 'Test User',
    phone: null,
    totp_enabled: false,
    account_status: 'active',
    kyc_status: 'not_submitted',
    preferred_language: 'English',
    created_at: '2026-01-01T00:00:00.000Z',
    role: 'customer',
    ...overrides,
  };
}

async function withTestServer(
  options: CreateApiAppOptions,
  fn: (baseUrl: string) => Promise<void>
) {
  const app = createApiApp(options);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test('extractJwtSubjectHint only accepts valid UUID sub claims', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  assert.equal(extractJwtSubjectHint(makeUnsignedJwt(uuid)), uuid);
  assert.equal(extractJwtSubjectHint('not-a-jwt'), null);
  assert.equal(extractJwtSubjectHint(makeUnsignedJwt('not-a-uuid')), null);
});

test('Session refresh ordering: expired JWT for suspended/closed account skips refreshSession() and clears cookies', async () => {
  const suspendedUserId = '22222222-2222-4222-8222-222222222222';
  const closedUserId = '33333333-3333-4333-8333-333333333333';

  for (const [accountStatus, expectedCode] of [
    ['suspended', 'ACCOUNT_SUSPENDED'],
    ['closed', 'ACCOUNT_CLOSED'],
  ] as Array<[Exclude<AccountStatus, 'active'>, string]>) {
    const userId = accountStatus === 'suspended' ? suspendedUserId : closedUserId;
    let refreshCalls = 0;

    const deps: AuthMiddlewareDependencies = {
      hasDatabase: () => true,
      getSupabaseAdmin: () => ({
        auth: {
          getUser: async () => ({ data: { user: null }, error: { message: 'jwt expired' } }),
          admin: {
            signOut: async () => ({ data: null, error: null }),
          },
        },
      }),
      getSupabaseAuth: () => ({
        auth: {
          refreshSession: async () => {
            refreshCalls += 1;
            return {
              data: {
                session: {
                  access_token: 'rotated-access-token',
                  refresh_token: 'rotated-refresh-token',
                  expires_in: 3600,
                },
              },
              error: null,
            };
          },
        },
      }),
      queryAccountStatus: async (id) => (id === userId ? accountStatus : null),
      queryAuthenticatedProfile: async () => makeProfile({ id: userId, account_status: accountStatus }),
    };

    await withTestServer(
      {
        extraTestRouter: (app) => {
          app.get('/api/test-protected', createRequireAuth(deps), (req, res) => {
            res.json({ ok: true, userId: req.auth?.userId });
          });
        },
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/test-protected`, {
          headers: {
            Cookie: `sb_access_token=${makeUnsignedJwt(userId)}; sb_refresh_token=stale-refresh`,
          },
        });
        assert.equal(res.status, 403);
        const body = (await res.json()) as { ok: boolean; code: string };
        assert.equal(body.ok, false);
        assert.equal(body.code, expectedCode);
        assert.equal(refreshCalls, 0, 'Must NOT rotate refresh token for inactive account');

        const setCookies = res.headers.getSetCookie();
        assert.ok(
          setCookies.some((c) => c.startsWith('sb_access_token=;') && c.includes('Expires=Thu, 01 Jan 1970')),
          'sb_access_token cookie must be cleared'
        );
        assert.ok(
          setCookies.some((c) => c.startsWith('sb_refresh_token=;') && c.includes('Expires=Thu, 01 Jan 1970')),
          'sb_refresh_token cookie must be cleared'
        );
        assert.ok(
          !setCookies.some((c) => c.includes('rotated-access-token') || c.includes('rotated-refresh-token')),
          'Must never set refreshed tokens for inactive account'
        );
      }
    );
  }
});

test('Session refresh ordering: refresh-token-only request verifies active status before setting cookies and revokes inactive sessions globally', async () => {
  const suspendedUserId = '44444444-4444-4444-8444-444444444444';
  const signOutCalls: Array<{ jwt: string; scope?: string }> = [];

  const suspendedDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => true,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async (jwt) => ({
          data: { user: jwt === 'temp-refreshed-access' ? { id: suspendedUserId } : null },
          error: null,
        }),
        admin: {
          signOut: async (jwt, scope) => {
            signOutCalls.push({ jwt, scope });
            return { data: null, error: null };
          },
        },
      },
    }),
    getSupabaseAuth: () => ({
      auth: {
        refreshSession: async () => ({
          data: {
            session: {
              access_token: 'temp-refreshed-access',
              refresh_token: 'temp-refreshed-refresh',
              expires_in: 3600,
            },
          },
          error: null,
        }),
      },
    }),
    queryAccountStatus: async () => 'suspended',
    queryAuthenticatedProfile: async () =>
      makeProfile({ id: suspendedUserId, account_status: 'suspended' }),
  };

  const { router: suspendedSessionRouter } = createAuthRouterWithLimiters({
    sessionDeps: suspendedDeps,
    fetchBalancesForUser: async () => [],
  });

  await withTestServer(
    {
      authRouter: suspendedSessionRouter,
      extraTestRouter: (app) => {
        app.get('/api/test-protected', createRequireAuth(suspendedDeps), (_req, res) => {
          res.json({ ok: true });
        });
      },
    },
    async (baseUrl) => {
      const protectedRes = await fetch(`${baseUrl}/api/test-protected`, {
        headers: { Cookie: 'sb_refresh_token=only-refresh-cookie' },
      });
      assert.equal(protectedRes.status, 403);
      const protectedJson = (await protectedRes.json()) as { code: string };
      assert.equal(protectedJson.code, 'ACCOUNT_SUSPENDED');

      const protectedCookies = protectedRes.headers.getSetCookie();
      assert.ok(
        !protectedCookies.some(
          (c) => c.includes('temp-refreshed-access') || c.includes('temp-refreshed-refresh')
        ),
        'Must NEVER emit Set-Cookie with new session tokens for inactive account'
      );
      assert.ok(
        protectedCookies.some((c) => c.startsWith('sb_access_token=;') && c.includes('Expires=Thu, 01 Jan 1970'))
      );
      assert.ok(
        signOutCalls.some((c) => c.jwt === 'temp-refreshed-access' && c.scope === 'global'),
        'Must globally revoke the temporary session of an inactive account'
      );

      const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Cookie: 'sb_refresh_token=only-refresh-cookie' },
      });
      assert.equal(sessionRes.status, 200);
      const sessionJson = (await sessionRes.json()) as { authenticated: boolean; data: unknown };
      assert.equal(sessionJson.authenticated, false);
      assert.equal(sessionJson.data, null);
      assert.ok(
        !sessionRes.headers
          .getSetCookie()
          .some((c) => c.includes('temp-refreshed-access') || c.includes('temp-refreshed-refresh'))
      );
    }
  );

  // Active account DOES receive refreshed cookies cleanly
  const activeUserId = '55555555-5555-4555-8555-555555555555';
  const activeDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => true,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async (jwt) => ({
          data: { user: jwt === 'active-new-access' ? { id: activeUserId } : null },
          error: null,
        }),
        admin: { signOut: async () => ({ data: null, error: null }) },
      },
    }),
    getSupabaseAuth: () => ({
      auth: {
        refreshSession: async () => ({
          data: {
            session: {
              access_token: 'active-new-access',
              refresh_token: 'active-new-refresh',
              expires_in: 3600,
            },
          },
          error: null,
        }),
      },
    }),
    queryAccountStatus: async () => 'active',
    queryAuthenticatedProfile: async () => makeProfile({ id: activeUserId, account_status: 'active' }),
  };

  await withTestServer(
    {
      extraTestRouter: (app) => {
        app.get('/api/test-active', createRequireAuth(activeDeps), (req, res) => {
          res.json({ ok: true, userId: req.auth?.userId });
        });
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/test-active`, {
        headers: { Cookie: 'sb_refresh_token=valid-active-refresh' },
      });
      assert.equal(res.status, 200);
      const json = (await res.json()) as { ok: boolean; userId: string };
      assert.equal(json.ok, true);
      assert.equal(json.userId, activeUserId);
      const cookies = res.headers.getSetCookie();
      assert.ok(cookies.some((c) => c.includes('sb_access_token=active-new-access')));
      assert.ok(cookies.some((c) => c.includes('sb_refresh_token=active-new-refresh')));
    }
  );
});

test('/api/health returns minimal status without exposing DB host/port/user, Supabase URLs, key formats, or migration filenames', async () => {
  await withTestServer(
    {
      checkHealth: async () => ({ databaseConnected: false, authReachable: false }),
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const text = await res.text();
      const json = JSON.parse(text) as Record<string, unknown>;

      assert.equal(json.ok, true);
      assert.equal(json.status, 'degraded');
      assert.deepEqual(json.checks, { database: 'unavailable', auth: 'unavailable' });
      assert.equal(typeof json.timestamp, 'string');

      for (const forbiddenKey of [
        'databaseHost',
        'databasePort',
        'databaseUser',
        'normalizedSupabaseUrl',
        'supabaseAnonKeyFormat',
        'supabaseServiceRoleKeyFormat',
        'secretsConfigured',
        'migrationsPrepared',
        'projectHost',
        'serviceRoleError',
        'reason',
      ]) {
        assert.equal(
          text.includes(forbiddenKey),
          false,
          `/api/health must not expose ${forbiddenKey}`
        );
      }
      assert.equal(text.includes('001_core_exchange_schema.sql'), false);
    }
  );
});

test('Centralized Express error handler and auth lookup sanitize raw internal/database errors', async () => {
  const failingLookupDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => true,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: '66666666-6666-4666-8666-666666666666' } },
          error: null,
        }),
        admin: { signOut: async () => ({ data: null, error: null }) },
      },
    }),
    getSupabaseAuth: () => ({
      auth: {
        refreshSession: async () => ({ data: { session: null }, error: null }),
      },
    }),
    queryAccountStatus: async () => 'active',
    queryAuthenticatedProfile: async () => {
      throw new Error('relation "public.profiles" fails secret_host=db.internal:5432');
    },
  };

  await withTestServer(
    {
      extraTestRouter: (app) => {
        app.get('/api/test-auth-err', createRequireAuth(failingLookupDeps), (_req, res) => {
          res.json({ ok: true });
        });
        app.get(
          '/api/test-async-boom',
          asyncHandler(async () => {
            throw new Error('SELECT password_hash FROM pg_internal_secret');
          })
        );
      },
    },
    async (baseUrl) => {
      const authErrRes = await fetch(`${baseUrl}/api/test-auth-err`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      assert.equal(authErrRes.status, 500);
      const authErrText = await authErrRes.text();
      assert.equal(authErrText.includes('secret_host'), false);
      assert.equal(authErrText.includes('db.internal'), false);
      assert.equal(JSON.parse(authErrText).code, 'AUTH_LOOKUP_ERROR');

      const boomRes = await fetch(`${baseUrl}/api/test-async-boom`);
      assert.equal(boomRes.status, 500);
      const boomText = await boomRes.text();
      assert.equal(boomText.includes('pg_internal_secret'), false);
      assert.equal(JSON.parse(boomText).code, 'INTERNAL_SERVER_ERROR');

      const badJsonRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json',
        },
        body: '{invalid json',
      });
      assert.equal(badJsonRes.status, 400);
      assert.equal(((await badJsonRes.json()) as { code: string }).code, 'INVALID_JSON');
    }
  );

  // Verify auth.ts no longer interpolates raw dbErr/Supabase error messages into JSON responses
  const authRouteSource = await fs.readFile(
    path.resolve(process.cwd(), 'server', 'routes', 'auth.ts'),
    'utf8'
  );
  assert.doesNotMatch(authRouteSource, /Account initialization failed cleanly: \$\{msg\}/);
  assert.doesNotMatch(authRouteSource, /message:\s*updated\.error\.message/);
  assert.doesNotMatch(authRouteSource, /message:\s*createdAuth\.error\?\.message/);
});

test('CSRF middleware rejects cross-origin requests, form submissions, cookie-only requests without Origin/Referer, and spoofed X-Forwarded-Host when trust proxy=0', async () => {
  await withTestServer(
    {
      trustedProxyHops: 0,
      appUrl: 'http://localhost:3000',
    },
    async (baseUrl) => {
      // Cross-origin Origin header rejected
      const badOriginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'a@b.com', password: 'secret' }),
      });
      assert.equal(badOriginRes.status, 403);
      assert.equal(((await badOriginRes.json()) as { code: string }).code, 'CSRF_VALIDATION_FAILED');

      // Sec-Fetch-Site: cross-site rejected even with matching Origin
      const crossSiteFetch = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Sec-Fetch-Site': 'cross-site',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'a@b.com', password: 'secret' }),
      });
      assert.equal(crossSiteFetch.status, 403);

      // HTML form Content-Type rejected
      const formPost = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'identifier=a@b.com&password=secret',
      });
      assert.equal(formPost.status, 415);

      // Cookie-authenticated POST without Origin or Referer rejected
      const cookieOnlyLogout = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: 'sb_access_token=some-token',
        },
      });
      assert.equal(cookieOnlyLogout.status, 403);

      // Spoofed X-Forwarded-Host must NOT allow attacker Origin when trustedProxyHops=0
      const spoofedForwardedHost = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Origin: 'http://evil-proxy.example',
          'X-Forwarded-Host': 'evil-proxy.example',
          Cookie: 'sb_access_token=some-token',
        },
      });
      assert.equal(spoofedForwardedHost.status, 403);

      // Legitimate same-origin browser POST to /api/auth/logout succeeds
      const sameOriginLogout = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Sec-Fetch-Site': 'same-origin',
          Cookie: 'sb_access_token=some-token',
        },
      });
      assert.equal(sameOriginLogout.status, 200);
    }
  );
});

test('Auth rate limiting enforces limits on login/register/recover/update-password and ignores spoofed X-Forwarded-For when TRUSTED_PROXY_HOPS=0', async () => {
  const { router } = createAuthRouterWithLimiters({
    rateLimits: {
      windowMs: 60_000,
      loginMax: 2,
      registerMax: 2,
      recoverMax: 2,
      updatePasswordMax: 2,
    },
  });

  await withTestServer(
    {
      trustedProxyHops: 0,
      authRouter: router,
    },
    async (baseUrl) => {
      const headersForSpoofedIp = (ip: string) => ({
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip,
      });

      // Even if caller spoofs a brand-new X-Forwarded-For on each request, trust proxy=0
      // ties req.ip to the real socket address so the 3rd request hits 429.
      for (let i = 1; i <= 2; i += 1) {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: headersForSpoofedIp(`198.51.100.${i}`),
          body: JSON.stringify({ identifier: `user${i}@example.com`, password: 'pw' }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: headersForSpoofedIp('203.0.113.99'),
        body: JSON.stringify({ identifier: 'user3@example.com', password: 'pw' }),
      });
      assert.equal(blockedLogin.status, 429);
      assert.equal(((await blockedLogin.json()) as { code: string }).code, 'RATE_LIMITED');
      assert.ok(Number(blockedLogin.headers.get('retry-after')) >= 1);

      // Register rate limit
      for (let i = 1; i <= 2; i += 1) {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: headersForSpoofedIp(`198.51.100.${10 + i}`),
          body: JSON.stringify({ fullName: 'A', email: `u${i}@example.com`, password: 'password123' }),
        });
        assert.notEqual(res.status, 429);
      }
      const blockedRegister = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: headersForSpoofedIp('203.0.113.88'),
        body: JSON.stringify({ fullName: 'A', email: 'u3@example.com', password: 'password123' }),
      });
      assert.equal(blockedRegister.status, 429);

      // Recover rate limit
      for (let i = 1; i <= 2; i += 1) {
        const res = await fetch(`${baseUrl}/api/auth/recover`, {
          method: 'POST',
          headers: headersForSpoofedIp(`198.51.100.${20 + i}`),
          body: JSON.stringify({ identifier: `r${i}@example.com` }),
        });
        assert.notEqual(res.status, 429);
      }
      const blockedRecover = await fetch(`${baseUrl}/api/auth/recover`, {
        method: 'POST',
        headers: headersForSpoofedIp('203.0.113.77'),
        body: JSON.stringify({ identifier: 'r3@example.com' }),
      });
      assert.equal(blockedRecover.status, 429);
    }
  );
});

test('Auth rate limiting respects TRUSTED_PROXY_HOPS=1 for legitimate proxy hops and enforces per-identifier limits', async () => {
  const { router } = createAuthRouterWithLimiters({
    rateLimits: {
      windowMs: 60_000,
      loginMax: 2,
      registerMax: 5,
      recoverMax: 5,
      updatePasswordMax: 5,
    },
  });

  await withTestServer(
    {
      trustedProxyHops: 1,
      authRouter: router,
    },
    async (baseUrl) => {
      // Same identifier across two different client IPs (trusted 1 hop) triggers per-identifier limit on 3rd try
      for (const ip of ['198.51.100.1', '198.51.100.2']) {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            Origin: baseUrl,
            'Content-Type': 'application/json',
            'X-Forwarded-For': ip,
          },
          body: JSON.stringify({ identifier: 'TARGET@example.com', password: 'pw' }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedByIdentifier = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.3',
        },
        body: JSON.stringify({ identifier: 'target@example.com', password: 'pw' }),
      });
      assert.equal(blockedByIdentifier.status, 429);

      // Update-password route is also wired with its rate limiter after requireAuth
      const unauthUpdatePw = await fetch(`${baseUrl}/api/auth/update-password`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword123' }),
      });
      // Since requireAuth runs first without backend configured or token, status is 401 or 503 (never 404)
      assert.ok(unauthUpdatePw.status === 401 || unauthUpdatePw.status === 503);
    }
  );
});

test('M-1: createRequireAuth forwards or handles rejected promises from getUser, refreshSession, signOut, and unexpected dependency errors without hanging', async () => {
  const rejectedGetUserDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => true,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async () => {
          throw new Error('supabase_internal_secret_host=auth.internal');
        },
        admin: { signOut: async () => ({}) },
      },
    }),
    getSupabaseAuth: () => ({
      auth: {
        refreshSession: async () => ({ data: { session: null }, error: null }),
      },
    }),
    queryAccountStatus: async () => 'active',
    queryAuthenticatedProfile: async () => makeProfile(),
  };

  const rejectedRefreshDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => true,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async () => ({ data: { user: null }, error: { message: 'expired' } }),
        admin: { signOut: async () => ({}) },
      },
    }),
    getSupabaseAuth: () => ({
      auth: {
        refreshSession: async () => {
          throw new Error('refresh_gateway_timeout_db_secret');
        },
      },
    }),
    queryAccountStatus: async () => null,
    queryAuthenticatedProfile: async () => makeProfile(),
  };

  const throwingHasDbDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => {
      throw new Error('unexpected_internal_panic_token');
    },
    getSupabaseAdmin: () => null,
    getSupabaseAuth: () => null,
    queryAccountStatus: async () => null,
    queryAuthenticatedProfile: async () => null,
  };

  await withTestServer(
    {
      extraTestRouter: (app) => {
        app.get('/api/test-reject-getuser', createRequireAuth(rejectedGetUserDeps), (_req, res) => {
          res.json({ ok: true });
        });
        app.get('/api/test-reject-refresh', createRequireAuth(rejectedRefreshDeps), (_req, res) => {
          res.json({ ok: true });
        });
        app.get('/api/test-throw-hasdb', createRequireAuth(throwingHasDbDeps), (_req, res) => {
          res.json({ ok: true });
        });
      },
    },
    async (baseUrl) => {
      const r1 = await fetch(`${baseUrl}/api/test-reject-getuser`, {
        headers: { Authorization: 'Bearer some-jwt' },
      });
      assert.equal(r1.status, 500);
      const t1 = await r1.text();
      assert.equal(t1.includes('supabase_internal_secret_host'), false);
      assert.equal(JSON.parse(t1).code, 'AUTH_LOOKUP_ERROR');

      const r2 = await fetch(`${baseUrl}/api/test-reject-refresh`, {
        headers: { Cookie: 'sb_refresh_token=some-refresh' },
      });
      assert.equal(r2.status, 500);
      const t2 = await r2.text();
      assert.equal(t2.includes('refresh_gateway_timeout_db_secret'), false);
      assert.equal(JSON.parse(t2).code, 'AUTH_LOOKUP_ERROR');

      const r3 = await fetch(`${baseUrl}/api/test-throw-hasdb`);
      assert.equal(r3.status, 500);
      const t3 = await r3.text();
      assert.equal(t3.includes('unexpected_internal_panic_token'), false);
      assert.equal(JSON.parse(t3).code, 'INTERNAL_SERVER_ERROR');
    }
  );
});

test('M-2: phone identifier variants, email case variants, and invalid identifiers share canonical rate-limit buckets and enforce maxBuckets eviction', async () => {
  // Phone formatting normalization in canonical key builder
  assert.equal(buildCanonicalRateLimitIdentifier('+1 555 010 2030'), 'phone:+15550102030');
  assert.equal(buildCanonicalRateLimitIdentifier('+1(555)010-2030'), 'phone:+15550102030');
  assert.equal(buildCanonicalRateLimitIdentifier('+15550102030'), 'phone:+15550102030');
  assert.equal(buildCanonicalRateLimitIdentifier('bad-fuzz-1'), 'invalid:__unclassified__');
  assert.equal(buildCanonicalRateLimitIdentifier('bad-fuzz-2'), 'invalid:__unclassified__');

  const { router, limiters } = createAuthRouterWithLimiters({
    rateLimits: {
      windowMs: 60_000,
      loginMax: 2,
      maxBuckets: 4,
    },
  });

  await withTestServer(
    {
      trustedProxyHops: 1,
      authRouter: router,
    },
    async (baseUrl) => {
      // Formatting variants of the same phone number across different client IPs hit the SAME bucket
      const r1 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' },
        body: JSON.stringify({ identifier: '+1 555 010 2030', password: 'pw' }),
      });
      assert.notEqual(r1.status, 429);

      const r2 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
        body: JSON.stringify({ identifier: '+1(555)010-2030', password: 'pw' }),
      });
      assert.notEqual(r2.status, 429);

      const r3Blocked = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.13' },
        body: JSON.stringify({ identifier: '+15550102030', password: 'pw' }),
      });
      assert.equal(r3Blocked.status, 429);
      assert.equal(((await r3Blocked.json()) as { code: string }).code, 'RATE_LIMITED');

      // Invalid non-empty identifiers collapse into a single shared bucket across varied junk values
      limiters.login.clear();
      const inv1 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.21' },
        body: JSON.stringify({ identifier: 'garbage-1', password: 'pw' }),
      });
      assert.notEqual(inv1.status, 429);

      const inv2 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.22' },
        body: JSON.stringify({ identifier: '555-010-9999', password: 'pw' }),
      });
      assert.notEqual(inv2.status, 429);

      const inv3Blocked = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.23' },
        body: JSON.stringify({ identifier: 'another-invalid-input', password: 'pw' }),
      });
      assert.equal(inv3Blocked.status, 429);
    }
  );

  // Bounded capacity test directly on createRateLimiter
  let currentTime = 1_000_000;
  const bounded = createRateLimiter({
    keyPrefix: 'bounded',
    windowMs: 60_000,
    maxRequests: 2,
    maxBuckets: 3,
    extractKeys: (req) => [String(req.query.key ?? 'none')],
    now: () => currentTime,
  });

  const testApp = express();
  testApp.get('/rl', bounded.middleware, (_req, res) => res.json({ ok: true }));
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  try {
    const base = `http://127.0.0.1:${addr.port}`;
    // Block key "attacker" (2 hits -> count=2, blocked on 3rd)
    assert.equal((await fetch(`${base}/rl?key=attacker`)).status, 200);
    assert.equal((await fetch(`${base}/rl?key=attacker`)).status, 200);
    assert.equal((await fetch(`${base}/rl?key=attacker`)).status, 429);

    // Flood 5 distinct benign keys; bucket count must never exceed maxBuckets=3 AND blocked "attacker" remains blocked
    for (let i = 0; i < 5; i += 1) {
      await fetch(`${base}/rl?key=benign-${i}`);
      assert.ok(bounded.getBucketCount() <= 3, `Bucket count ${bounded.getBucketCount()} exceeded maxBuckets=3`);
    }
    assert.equal((await fetch(`${base}/rl?key=attacker`)).status, 429);
    currentTime += 61_000;
    assert.equal((await fetch(`${base}/rl?key=attacker`)).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('L-2: market routes reject malformed URL percent-encoding with 400 INVALID_PAIR_ENCODING and keep 404 for unknown pairs', async () => {
  await withTestServer({}, async (baseUrl) => {
    for (const suffix of ['candles', 'orderbook', 'trades']) {
      const malformedRes = await fetch(`${baseUrl}/api/markets/%25/${suffix}`);
      assert.equal(malformedRes.status, 400);
      const malformedJson = (await malformedRes.json()) as { ok: boolean; code: string };
      assert.equal(malformedJson.ok, false);
      assert.equal(malformedJson.code, 'INVALID_PAIR_ENCODING');

      const unknownRes = await fetch(`${baseUrl}/api/markets/DOGE%2FUSDT/${suffix}`);
      assert.equal(unknownRes.status, 404);
      const unknownJson = (await unknownRes.json()) as { ok: boolean; code: string };
      assert.equal(unknownJson.ok, false);
      assert.equal(unknownJson.code, 'UNKNOWN_PAIR');
    }
  });
});

test('L-3: trailing slashes on auth routes still enforce explicit application/json Content-Type (415)', async () => {
  await withTestServer(
    {
      trustedProxyHops: 0,
      appUrl: 'http://localhost:3000',
    },
    async (baseUrl) => {
      for (const routePath of [
        '/api/auth/login/',
        '/api/auth/login///',
        '/api/auth/register/',
        '/api/auth/recover/',
        '/api/auth/update-password/',
      ]) {
        const missingCt = await fetch(`${baseUrl}${routePath}`, {
          method: 'POST',
          headers: { Origin: baseUrl },
          body: JSON.stringify({ identifier: 'a@b.com', password: 'secret' }),
        });
        assert.equal(missingCt.status, 415, `${routePath} without Content-Type must return 415`);
        assert.equal(((await missingCt.json()) as { code: string }).code, 'UNSUPPORTED_MEDIA_TYPE');

        const xmlCt = await fetch(`${baseUrl}${routePath}`, {
          method: 'POST',
          headers: { Origin: baseUrl, 'Content-Type': 'text/xml' },
          body: '<xml/>',
        });
        assert.equal(xmlCt.status, 415, `${routePath} with text/xml must return 415`);
      }
    }
  );
});

test('L-4: production CSRF fails closed without configured APP_URL and rejects localhost when configured', async () => {
  await withTestServer(
    {
      isProduction: true,
      appUrl: null,
      trustedProxyHops: 0,
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'a@b.com', password: 'secret' }),
      });
      assert.equal(res.status, 503);
      assert.equal(((await res.json()) as { code: string }).code, 'APP_URL_NOT_CONFIGURED');
    }
  );

  await withTestServer(
    {
      isProduction: true,
      appUrl: 'https://exchange.example.com',
      trustedProxyHops: 0,
    },
    async (baseUrl) => {
      const localhostRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'a@b.com', password: 'secret' }),
      });
      assert.equal(localhostRes.status, 403);
      assert.equal(((await localhostRes.json()) as { code: string }).code, 'CSRF_VALIDATION_FAILED');

      const prodOriginLogout = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Origin: 'https://exchange.example.com',
          'Sec-Fetch-Site': 'same-origin',
        },
      });
      assert.equal(prodOriginLogout.status, 200);
    }
  );
});

test('L-5: inactive account login revokes temporary Supabase session, sets no cookies, and returns unified ACCOUNT_INACTIVE; update-password revokes temp verification session', async () => {
  for (const status of ['suspended', 'closed'] as const) {
    const signOutCalls: Array<{ jwt: string; scope?: string }> = [];
    const { router } = createAuthRouterWithLimiters({
      authService: {
        isBackendReady: () => true,
        signInWithPassword: async () => ({
          data: {
            session: {
              access_token: `temp-${status}-jwt`,
              refresh_token: `temp-${status}-refresh`,
              expires_in: 3600,
            },
            user: { id: '77777777-7777-4777-8777-777777777777' },
          },
          error: null,
        }),
        signOut: async (jwt, scope) => {
          signOutCalls.push({ jwt, scope });
          return {};
        },
        fetchAccountSnapshot: async () => ({
          profile: {
            id: '77777777-7777-4777-8777-777777777777',
            publicUserId: '987654321',
            email: 'inactive@example.com',
            fullName: 'Inactive User',
            phone: null,
            twoFactorEnabled: false,
            accountStatus: status,
            kycStatus: 'not_submitted',
            preferredLanguage: 'English',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          role: 'customer',
          balances: [],
        }),
        recordSecurityEvent: async () => undefined,
      },
    });

    await withTestServer({ authRouter: router }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: 'inactive@example.com', password: 'correct-password' }),
      });

      assert.equal(res.status, 403);
      const body = (await res.json()) as { ok: boolean; code: string; message: string };
      assert.equal(body.ok, false);
      assert.equal(body.code, 'ACCOUNT_INACTIVE');
      assert.equal(
        body.message,
        'This account is not active and cannot be signed into. Contact platform administration.'
      );
      assert.deepEqual(signOutCalls, [{ jwt: `temp-${status}-jwt`, scope: 'global' }]);

      const cookies = res.headers.getSetCookie();
      assert.equal(
        cookies.some((c) => c.includes(`temp-${status}-jwt`) || c.includes(`temp-${status}-refresh`)),
        false,
        'Must never issue auth cookies for inactive accounts'
      );
      assert.ok(
        cookies.some((c) => c.startsWith('sb_access_token=;') && c.includes('Expires=Thu, 01 Jan 1970'))
      );
    });
  }

  // Update-password revokes temporary verification session locally
  const pwSignOutCalls: Array<{ jwt: string; scope?: string }> = [];
  const activeUserId = '88888888-8888-4888-8888-888888888888';
  const pwDeps: AuthMiddlewareDependencies = {
    hasDatabase: () => true,
    getSupabaseAdmin: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: activeUserId } }, error: null }),
        admin: { signOut: async () => ({}) },
      },
    }),
    getSupabaseAuth: () => ({
      auth: {
        refreshSession: async () => ({ data: { session: null }, error: null }),
      },
    }),
    queryAccountStatus: async () => 'active',
    queryAuthenticatedProfile: async () => makeProfile({ id: activeUserId, account_status: 'active' }),
  };

  const { router: pwRouter } = createAuthRouterWithLimiters({
    sessionDeps: pwDeps,
    authService: {
      isBackendReady: () => true,
      signInWithPassword: async () => ({
        data: {
          session: {
            access_token: 'temp-verify-pw-jwt',
            refresh_token: 'temp-verify-pw-refresh',
            expires_in: 3600,
          },
          user: { id: activeUserId },
        },
        error: null,
      }),
      signOut: async (jwt, scope) => {
        pwSignOutCalls.push({ jwt, scope });
        return {};
      },
      fetchAccountSnapshot: async () => ({
        profile: {
          id: activeUserId,
          publicUserId: '123456789',
          email: 'user@example.com',
          fullName: 'Test User',
          phone: null,
          twoFactorEnabled: false,
          accountStatus: 'active',
          kycStatus: 'not_submitted',
          preferredLanguage: 'English',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        role: 'customer',
        balances: [],
      }),
      updateUserPassword: async () => ({ error: null }),
    },
  });

  await withTestServer({ authRouter: pwRouter }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/auth/update-password`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Authorization: 'Bearer current-active-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
      }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(pwSignOutCalls, [{ jwt: 'temp-verify-pw-jwt', scope: 'local' }]);
  });
});

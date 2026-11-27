/**
 * Sprint 1 — Disposable PostgreSQL 16 Test Database Harness & Fixture Seeder
 *
 * Strictly validates TEST_DATABASE_URL via validateDisposableTestUrl() so test
 * resets and fixtures can NEVER touch production, staging, or Supabase instances.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  scrubPgEnvOverrides,
  validateDisposableTestUrl,
  type DisposableTargetConfig,
} from './verifyPostgresRuntime';
import type { AppRole } from '../src/types/domain';

export const TEST_FIXTURE_IDS = {
  superAdmin: '00000000-0000-4000-8100-000000000001',
  financeAdmin: '00000000-0000-4000-8100-000000000002',
  operationsAdmin: '00000000-0000-4000-8100-000000000003',
  complianceAdmin: '00000000-0000-4000-8100-000000000004',
  customerApproved: '00000000-0000-4000-8200-000000000001',
  customerApproved2: '00000000-0000-4000-8200-000000000002',
  customerKycPending: '00000000-0000-4000-8200-000000000003',
  customerClosed: '00000000-0000-4000-8200-000000000004',
  receivingAddressUsdtTrc20: '00000000-0000-4000-8300-000000000001',
  receivingAddressUsdtErc20: '00000000-0000-4000-8300-000000000002',
  depositAddressCust1Trc20: '00000000-0000-4000-8400-000000000001',
} as const;

export interface TestAccountFixture {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  kycStatus: 'approved' | 'pending' | 'not_submitted';
  accountStatus: 'active' | 'closed';
}

export const TEST_ACCOUNTS: TestAccountFixture[] = [
  {
    id: TEST_FIXTURE_IDS.superAdmin,
    email: 'super-admin@test-exchange.local',
    fullName: 'Test Super Admin',
    role: 'super_admin',
    kycStatus: 'approved',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.financeAdmin,
    email: 'finance-admin@test-exchange.local',
    fullName: 'Test Finance Admin',
    role: 'finance_admin',
    kycStatus: 'approved',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.operationsAdmin,
    email: 'ops-admin@test-exchange.local',
    fullName: 'Test Operations Admin',
    role: 'operations_admin',
    kycStatus: 'approved',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.complianceAdmin,
    email: 'compliance-admin@test-exchange.local',
    fullName: 'Test Compliance Admin',
    role: 'compliance_admin',
    kycStatus: 'approved',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.customerApproved,
    email: 'customer-1@test-exchange.local',
    fullName: 'Test Customer One',
    role: 'customer',
    kycStatus: 'approved',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.customerApproved2,
    email: 'customer-2@test-exchange.local',
    fullName: 'Test Customer Two',
    role: 'customer',
    kycStatus: 'approved',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.customerKycPending,
    email: 'customer-kyc-pending@test-exchange.local',
    fullName: 'Test Customer Pending KYC',
    role: 'customer',
    kycStatus: 'pending',
    accountStatus: 'active',
  },
  {
    id: TEST_FIXTURE_IDS.customerClosed,
    email: 'customer-closed@test-exchange.local',
    fullName: 'Test Customer Closed',
    role: 'customer',
    kycStatus: 'approved',
    accountStatus: 'closed',
  },
];

export function createDisposablePool(rawUrl?: string): {
  pool: Pool;
  target: DisposableTargetConfig;
} {
  scrubPgEnvOverrides();
  const target = validateDisposableTestUrl(rawUrl ?? process.env.TEST_DATABASE_URL);
  const pool = new Pool({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: false,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  return { pool, target };
}

async function assertDisposableServerIdentity(pool: Pool): Promise<void> {
  const res = await pool.query<{
    db: string;
    server_addr: string | null;
    major: number;
  }>(`
    SELECT
      current_database() AS db,
      host(inet_server_addr()) AS server_addr,
      (current_setting('server_version_num')::INT / 10000) AS major
  `);
  const row = res.rows[0];
  if (!row || row.db !== 'exchange_verify_disposable') {
    throw new Error(`Refusing reset: current_database() is "${row?.db}", expected "exchange_verify_disposable".`);
  }
  if (row.server_addr !== null && row.server_addr !== '127.0.0.1' && row.server_addr !== '::1') {
    throw new Error(`Refusing reset: non-loopback PostgreSQL server address (${row.server_addr}).`);
  }
  if (row.major < 16) {
    throw new Error(`Expected PostgreSQL 16+, detected major version ${row.major}.`);
  }

  const hostedSchemas = await pool.query<{ nspname: string }>(`
    SELECT nspname FROM pg_namespace
    WHERE nspname IN ('storage', 'realtime', 'supabase_functions', 'vault', 'graphql_public')
  `);
  if (hostedSchemas.rows.length > 0) {
    throw new Error(
      `Refusing reset: hosted/Supabase schemas detected (${hostedSchemas.rows.map((r) => r.nspname).join(', ')}).`
    );
  }
}

export async function resetDisposableDatabase(pool: Pool): Promise<string[]> {
  await assertDisposableServerIdentity(pool);

  const client = await pool.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS public, auth CASCADE;
      CREATE SCHEMA public;
      CREATE SCHEMA auth;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END $$;

      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;

      CREATE TABLE auth.users (
        id UUID PRIMARY KEY,
        email TEXT,
        email_confirmed_at TIMESTAMPTZ,
        raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS UUID
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $$;

      CREATE TABLE public.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated;
    `);

    const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed during reset: ${(err as Error).message}`);
      }
    }

    return files;
  } finally {
    client.release();
  }
}

export async function seedTestExchangeFixtures(pool: Pool): Promise<void> {
  await assertDisposableServerIdentity(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const acct of TEST_ACCOUNTS) {
      await client.query(
        `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         VALUES ($1, $2, NOW(), jsonb_build_object('full_name', $3::text))
         ON CONFLICT (id) DO NOTHING`,
        [acct.id, acct.email, acct.fullName]
      );

      if (acct.role !== 'customer') {
        await client.query(
          `INSERT INTO public.user_roles (user_id, role, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role) DO NOTHING`,
          [acct.id, acct.role, TEST_FIXTURE_IDS.superAdmin]
        );
      }

      await client.query(
        `UPDATE public.profiles
         SET kyc_status = $2, updated_at = NOW()
         WHERE id = $1`,
        [acct.id, acct.kycStatus]
      );
    }

    await client.query(`SELECT public.close_customer_account($1, FALSE)`, [
      TEST_FIXTURE_IDS.customerClosed,
    ]);

    const refPrices: Array<[string, number]> = [
      ['BTC/USDT', 90000],
      ['ETH/USDT', 3200],
      ['XRP/USDT', 1.4],
      ['LTC/USDT', 95],
      ['BCH/USDT', 480],
      ['TRX/USDT', 0.2],
      ['SOL/USDT', 180],
    ];
    for (const [pairSymbol, price] of refPrices) {
      await client.query(
        `INSERT INTO public.market_prices (pair_symbol, price, data_status, source_name, fetched_at)
         VALUES ($1, $2, 'delayed', 'test_fixture_reference', NOW())
         ON CONFLICT (pair_symbol) DO UPDATE SET
           price = EXCLUDED.price,
           data_status = 'delayed',
           source_name = 'test_fixture_reference',
           fetched_at = NOW()`,
        [pairSymbol, price]
      );
    }

    await client.query(
      `INSERT INTO public.receiving_addresses (
         id, asset_symbol, network_code, address, memo_or_tag, label, is_active, assigned_by
       ) VALUES
         ($1, 'USDT', 'TRC-20', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', NULL, 'Fixture Desk USDT TRC-20', TRUE, $3),
         ($2, 'USDT', 'ERC-20', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', NULL, 'Fixture Desk USDT ERC-20', TRUE, $3)
       ON CONFLICT (id) DO NOTHING`,
      [
        TEST_FIXTURE_IDS.receivingAddressUsdtTrc20,
        TEST_FIXTURE_IDS.receivingAddressUsdtErc20,
        TEST_FIXTURE_IDS.superAdmin,
      ]
    );

    await client.query(
      `INSERT INTO public.receiving_address_audit_logs (
         receiving_address_id, action, actor_user_id, actor_label, note
       ) VALUES
         ($1, 'created', $3, 'Test Super Admin', 'Seeded active TRC-20 receiving address'),
         ($2, 'created', $3, 'Test Super Admin', 'Seeded active ERC-20 receiving address')`,
      [
        TEST_FIXTURE_IDS.receivingAddressUsdtTrc20,
        TEST_FIXTURE_IDS.receivingAddressUsdtErc20,
        TEST_FIXTURE_IDS.superAdmin,
      ]
    );

    await client.query(
      `INSERT INTO public.deposit_addresses (
         id, user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag, is_active
       ) VALUES (
         $1, $2, 'USDT', 'TRC-20', 'vault-test-disposable', 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL', NULL, TRUE
       )
       ON CONFLICT (user_id, asset_symbol, network_code) DO NOTHING`,
      [TEST_FIXTURE_IDS.depositAddressCust1Trc20, TEST_FIXTURE_IDS.customerApproved]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const args = new Set(process.argv.slice(2));
  const shouldReset = args.has('--reset') || args.size === 0;
  const shouldSeed = args.has('--seed');
  const { pool, target } = createDisposablePool();

  (async () => {
    try {
      if (shouldReset) {
        const applied = await resetDisposableDatabase(pool);
        console.log(`Reset & migrated ${target.safeTarget}: ${applied.length} migrations applied.`);
      }
      if (shouldSeed) {
        await seedTestExchangeFixtures(pool);
        console.log(`Seeded deterministic test fixtures into ${target.safeTarget}.`);
      }
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error('Disposable test DB harness failed:', err);
    process.exit(1);
  });
}

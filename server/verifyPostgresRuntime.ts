/**
 * Phase 1.3 — Isolated PostgreSQL 16 Runtime & Multi-Session Concurrency Verifier
 *
 * Strictly connects ONLY to TEST_DATABASE_URL pointing at an isolated, disposable
 * PostgreSQL 16 test database. Never reads DATABASE_URL or production credentials.
 * Intended to run inside an ephemeral CI service container or local disposable Docker DB.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export interface DisposableTargetConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  safeTarget: string;
}

export interface ExplainPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Scan Direction'?: string;
  'Sort Key'?: string[];
  Plans?: ExplainPlanNode[];
}

export interface ProfileLockExplainAnalysis {
  ok: boolean;
  hasLockRows: boolean;
  orderingStrategy: string;
  reason: string;
  limitationNote: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  sqlstate?: string;
  details: string;
}

const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ALLOWED_DISPOSABLE_PORTS = new Set([55432, 55433]);
const ALLOWED_DISPOSABLE_DATABASES = new Set(['exchange_verify_disposable']);
const PG_ENV_OVERRIDE_KEYS = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSSLMODE',
  'PGSSLROOTCERT',
  'PGSSLCERT',
  'PGSSLKEY',
  'PGOPTIONS',
  'PGAPPNAME',
  'PGREQUIREPEER',
  'PGREQUIRESSL',
] as const;

const results: CheckResult[] = [];

function record(name: string, passed: boolean, details: string, sqlstate?: string) {
  results.push({ name, passed, details, sqlstate });
  const tag = passed ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${sqlstate ? ` (SQLSTATE=${sqlstate})` : ''}: ${details}`);
}

export function scrubPgEnvOverrides(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of PG_ENV_OVERRIDE_KEYS) {
    delete env[key];
  }
}

export function validateDisposableTestUrl(rawUrl: string | undefined): DisposableTargetConfig {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(
      'TEST_DATABASE_URL is required and must point to an isolated disposable PostgreSQL 16 instance (DATABASE_URL is never used).'
    );
  }

  const trimmed = rawUrl.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    /[\r\n\t\0\s]/.test(trimmed)
  ) {
    throw new Error('TEST_DATABASE_URL contains unexpected quotes or whitespace.');
  }

  const lowered = trimmed.toLowerCase();
  for (const forbidden of ['supabase.co', 'supabase.com', 'neon.tech', 'amazonaws.com', 'rds.']) {
    if (lowered.includes(forbidden)) {
      throw new Error(`Refusing to run against hosted/production database URL pattern (${forbidden}).`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid PostgreSQL connection URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`Unsupported TEST_DATABASE_URL protocol: ${parsed.protocol}`);
  }

  if (parsed.search !== '' || parsed.hash !== '') {
    throw new Error(
      'TEST_DATABASE_URL must not include query parameters or fragments (prevents host/port/dbname/sslmode/service overrides).'
    );
  }

  if (lowered.includes('%2f') || parsed.pathname.includes('/var/run') || parsed.pathname.includes('/tmp')) {
    throw new Error('TEST_DATABASE_URL must not specify Unix socket or encoded path overrides.');
  }

  const normalizedHost = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(normalizedHost)) {
    throw new Error(
      `Refusing non-loopback host "${parsed.hostname}". Allowed loopback hosts: 127.0.0.1, localhost, [::1].`
    );
  }

  if (!parsed.port || !/^\d+$/.test(parsed.port)) {
    throw new Error(
      'TEST_DATABASE_URL must explicitly specify an approved disposable port (default 5432 is rejected).'
    );
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!ALLOWED_DISPOSABLE_PORTS.has(port)) {
    throw new Error(
      `Refusing unapproved PostgreSQL port ${port}. Approved disposable ports: ${Array.from(ALLOWED_DISPOSABLE_PORTS).join(', ')}.`
    );
  }

  const pathMatch = parsed.pathname.match(/^\/([A-Za-z0-9_]+)$/);
  if (!pathMatch) {
    throw new Error('TEST_DATABASE_URL must explicitly specify a single clean disposable database name.');
  }
  const database = pathMatch[1];
  if (!ALLOWED_DISPOSABLE_DATABASES.has(database)) {
    throw new Error(
      `Refusing unapproved database name "${database}". Approved disposable database: ${Array.from(ALLOWED_DISPOSABLE_DATABASES).join(', ')}.`
    );
  }

  let user: string;
  let password: string;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error('TEST_DATABASE_URL contains malformed percent-encoded credentials.');
  }

  if (!user || !password) {
    throw new Error(
      'TEST_DATABASE_URL must explicitly include non-empty disposable credentials (prevents PGUSER/OS defaults).'
    );
  }

  const connectHost = normalizedHost === '[::1]' ? '::1' : normalizedHost;
  return {
    host: connectHost,
    port,
    database,
    user,
    password,
    safeTarget: `postgresql://${user}@${parsed.hostname.toLowerCase()}:${port}/${database}`,
  };
}

export function analyzeProfileLockExplainPlan(rawPlanOutput: unknown): ProfileLockExplainAnalysis {
  const limitationNote =
    'EXPLAIN inspects planner AST (LockRows + ascending p.id input) for current statistics; runtime EvalPlanQual re-fetches and multi-profile contention order require live concurrency tests.';

  if (!Array.isArray(rawPlanOutput) || rawPlanOutput.length === 0) {
    return {
      ok: false,
      hasLockRows: false,
      orderingStrategy: 'none',
      reason: 'EXPLAIN (FORMAT JSON) output was empty or not an array.',
      limitationNote,
    };
  }

  const rootPlan = (rawPlanOutput[0] as { Plan?: ExplainPlanNode })?.Plan;
  if (!rootPlan || typeof rootPlan['Node Type'] !== 'string') {
    return {
      ok: false,
      hasLockRows: false,
      orderingStrategy: 'none',
      reason: 'Missing top-level Plan object in EXPLAIN (FORMAT JSON) output.',
      limitationNote,
    };
  }

  function findNode(node: ExplainPlanNode, predicate: (n: ExplainPlanNode) => boolean): ExplainPlanNode | null {
    if (predicate(node)) return node;
    for (const child of node.Plans ?? []) {
      const hit = findNode(child, predicate);
      if (hit) return hit;
    }
    return null;
  }

  const lockRowsNode = findNode(rootPlan, (n) => n['Node Type'] === 'LockRows');
  if (!lockRowsNode) {
    return {
      ok: false,
      hasLockRows: false,
      orderingStrategy: 'none',
      reason: 'Plan does not contain a LockRows node (FOR KEY SHARE OF p locking missing).',
      limitationNote,
    };
  }

  const REORDERING_NODES = new Set(['Hash', 'Hash Join', 'Bitmap Heap Scan', 'Gather', 'Gather Merge']);
  function verifyOrderedInput(node: ExplainPlanNode): { ordered: boolean; strategy: string; detail: string } {
    const nodeType = node['Node Type'];
    if (nodeType === 'Sort') {
      const keys = node['Sort Key'] ?? [];
      const firstKey = keys[0]?.trim() ?? '';
      const isAscProfileId =
        (firstKey === 'id' || firstKey === 'p.id' || firstKey.startsWith('p.id ') || firstKey.startsWith('id ')) &&
        !/\bDESC\b/i.test(firstKey);
      if (isAscProfileId) {
        return { ordered: true, strategy: `Sort(${keys.join(', ')})`, detail: 'Sort emits p.id ASC directly into LockRows' };
      }
      return { ordered: false, strategy: `Sort(${keys.join(', ')})`, detail: `Unexpected Sort Key "${firstKey}"` };
    }

    if ((nodeType === 'Index Scan' || nodeType === 'Index Only Scan') && node['Relation Name'] === 'profiles') {
      const dir = node['Scan Direction'] ?? 'Forward';
      if (node['Index Name'] === 'profiles_pkey' && dir === 'Forward') {
        return { ordered: true, strategy: 'Forward Index Scan on profiles_pkey', detail: 'Primary-key index order emits p.id ASC' };
      }
      return {
        ordered: false,
        strategy: `${dir} ${nodeType} on ${node['Index Name'] ?? 'unknown'}`,
        detail: 'Profiles scan does not guarantee ascending UUID order without Sort',
      };
    }

    if (REORDERING_NODES.has(nodeType)) {
      return {
        ordered: false,
        strategy: nodeType,
        detail: `Reordering operator ${nodeType} appears between ordering node and LockRows`,
      };
    }

    const children = node.Plans ?? [];
    if (children.length === 1) {
      return verifyOrderedInput(children[0]);
    }
    return {
      ordered: false,
      strategy: nodeType,
      detail: `Unhandled node "${nodeType}" under LockRows`,
    };
  }

  const lockChild = (lockRowsNode.Plans ?? [])[0];
  if (!lockChild) {
    return {
      ok: false,
      hasLockRows: true,
      orderingStrategy: 'none',
      reason: 'LockRows node has no input child plan.',
      limitationNote,
    };
  }

  const orderCheck = verifyOrderedInput(lockChild);
  return {
    ok: orderCheck.ordered,
    hasLockRows: true,
    orderingStrategy: orderCheck.strategy,
    reason: orderCheck.detail,
    limitationNote,
  };
}

async function connectIsolatedClient(target: DisposableTargetConfig): Promise<Client> {
  scrubPgEnvOverrides();
  const client = new Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: false,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    lock_timeout: 10_000,
  });
  await client.connect();
  return client;
}

async function verifyDisposableTargetIdentity(admin: Client, target: DisposableTargetConfig): Promise<string> {
  const idRes = await admin.query<{
    db_name: string;
    pg_user: string;
    pg_version: string;
  }>(`
    SELECT
      current_database() AS db_name,
      current_user AS pg_user,
      version() AS pg_version
  `);
  const identity = idRes.rows[0];
  if (!identity) {
    throw new Error('Failed to query PostgreSQL target database identity.');
  }
  if (identity.db_name !== target.database) {
    throw new Error(
      `Target database mismatch: expected "${target.database}", connected to "${identity.db_name}".`
    );
  }
  if (identity.pg_user !== target.user) {
    throw new Error(
      `Target user mismatch: expected "${target.user}", connected as "${identity.pg_user}".`
    );
  }
  if (!/PostgreSQL 16\./.test(identity.pg_version)) {
    throw new Error(`Expected disposable PostgreSQL 16 server, got: ${identity.pg_version}`);
  }

  const hostedSchemas = await admin.query<{ nspname: string }>(`
    SELECT nspname
    FROM pg_namespace
    WHERE nspname IN ('auth', 'storage', 'realtime', 'supabase_functions')
    ORDER BY nspname ASC
  `);
  if (hostedSchemas.rows.length > 0) {
    throw new Error(
      `Refusing bootstrap: non-empty/Supabase schemas already present (${hostedSchemas.rows.map((r) => r.nspname).join(', ')}).`
    );
  }

  const existingTables = await admin.query<{ schemaname: string; tablename: string }>(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname IN ('public', 'auth')
    ORDER BY schemaname ASC, tablename ASC
  `);
  if (existingTables.rows.length > 0) {
    throw new Error(
      `Refusing bootstrap: target database already contains tables (${existingTables.rows.map((r) => `${r.schemaname}.${r.tablename}`).join(', ')}). Must be an empty disposable database.`
    );
  }

  return identity.pg_version;
}

async function expectSqlError(
  client: Client,
  sql: string,
  params: unknown[],
  pattern: RegExp,
  expectedSqlstate: string
): Promise<{ code: string; message: string }> {
  try {
    await client.query(sql, params);
    throw new Error(`Expected SQL error matching ${pattern} (SQLSTATE=${expectedSqlstate}), but query succeeded.`);
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    const message = pgErr.message ?? String(err);
    assert.equal(
      pgErr.code,
      expectedSqlstate,
      `Expected SQLSTATE ${expectedSqlstate}, got ${pgErr.code ?? 'NONE'} (${message})`
    );
    assert.match(message, pattern, `Unexpected error message: ${message}`);
    return { code: pgErr.code ?? 'UNKNOWN', message };
  }
}

async function waitForSessionLockWait(
  inspector: Client,
  waitingPid: number,
  timeoutMs = 5000
): Promise<{ locktype: string; mode: string; relation: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await inspector.query<{
      locktype: string;
      mode: string;
      relation: string | null;
    }>(
      `
      SELECT l.locktype, l.mode, l.relation::regclass::text AS relation
      FROM pg_locks l
      WHERE l.pid = $1
        AND l.granted = FALSE
      LIMIT 1
      `,
      [waitingPid]
    );
    if (res.rows.length > 0) {
      return res.rows[0];
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for pid ${waitingPid} to block on a PostgreSQL lock.`);
}

async function getBackendPid(client: Client): Promise<number> {
  const res = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  return res.rows[0].pid;
}

async function main() {
  const target = validateDisposableTestUrl(process.env.TEST_DATABASE_URL);
  console.log(`Validated disposable target: ${target.safeTarget}`);

  const admin = await connectIsolatedClient(target);
  const inspector = await connectIsolatedClient(target);

  try {
    const pgVersion = await verifyDisposableTargetIdentity(admin, target);
    console.log(`Connected to verified clean disposable PostgreSQL 16: ${pgVersion}`);

    // 1. Create minimal disposable Supabase-compatible auth schema & client roles
    await admin.query(`
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

      CREATE SCHEMA auth;
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
    record('Environment & Supabase auth stub bootstrap', true, `${target.safeTarget} (${pgVersion})`);

    // 2. Execute migrations 001-009 sequentially inside transactions
    const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    assert.deepEqual(files, [
      '001_core_exchange_schema.sql',
      '002_company_inventory_treasury_pricing.sql',
      '003_rls_and_permissions.sql',
      '004_auth_bootstrap_and_catalog.sql',
      '005_security_events_and_ip_intelligence.sql',
      '006_security_and_rls_hardening.sql',
      '007_account_closure_concurrency_and_approval_hardening.sql',
      '008_closed_account_integrity_hardening.sql',
      '009_manual_crypto_purchases.sql',
    ]);

    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await admin.query('BEGIN');
      try {
        await admin.query(sql);
        await admin.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [file]);
        await admin.query('COMMIT');
        record(`Migration ${file}`, true, 'Executed cleanly');
      } catch (err) {
        await admin.query('ROLLBACK');
        throw err;
      }
    }

    // 3. Verify functions, search_path, triggers, privileges, CHECK constraints, and RLS
    const fnCheck = await admin.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      anon_exec: boolean;
      auth_exec: boolean;
    }>(`
      SELECT
        p.proname,
        p.prosecdef,
        p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'acquire_user_account_lock',
          'guard_closed_account_obligation_write',
          'guard_closed_account_approval_request_write',
          'close_customer_account',
          'enforce_approval_request_rules'
        )
      ORDER BY p.proname ASC
    `);
    assert.equal(fnCheck.rows.length, 5);
    for (const row of fnCheck.rows) {
      assert.equal(row.prosecdef, true, `${row.proname} must be SECURITY DEFINER`);
      assert.ok(row.proconfig?.includes('search_path=public'), `${row.proname} must pin search_path=public`);
      assert.equal(row.anon_exec, false, `${row.proname} must revoke EXECUTE from anon`);
      assert.equal(row.auth_exec, false, `${row.proname} must revoke EXECUTE from authenticated`);
    }
    record('Function search_path & REVOKE privileges', true, 'Verified all 5 core functions in pg_proc');

    const trigOrder = await admin.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'public.approval_requests'::regclass
        AND NOT tgisinternal
      ORDER BY tgname ASC
    `);
    assert.deepEqual(
      trigOrder.rows.map((r) => r.tgname),
      [
        'trg_enforce_approval_request_rules',
        'trg_guard_closed_account_approval_requests',
        'trg_prevent_delete_approval_requests',
      ]
    );
    record('Trigger ordering on approval_requests', true, trigOrder.rows.map((r) => r.tgname).join(' -> '));

    // Seed synthetic disposable test users via auth.users (fires handle_new_auth_user trigger)
    const U_ADMIN_1 = '00000000-0000-4000-8000-000000000001';
    const U_ADMIN_2 = '00000000-0000-4000-8000-000000000002';
    const U_ADMIN_3 = '00000000-0000-4000-8000-000000000003';
    const U_ADMIN_4 = '00000000-0000-4000-8000-000000000004';
    const U_CUST_1 = '00000000-0000-4000-8000-000000000010';
    const U_CUST_2 = '00000000-0000-4000-8000-000000000020';
    const U_CUST_3 = '00000000-0000-4000-8000-000000000030';
    const U_CUST_4 = '00000000-0000-4000-8000-000000000040';

    for (const [id, email, name] of [
      [U_ADMIN_1, 'verify-a1@disposable.local', 'Admin One'],
      [U_ADMIN_2, 'verify-a2@disposable.local', 'Admin Two'],
      [U_ADMIN_3, 'verify-a3@disposable.local', 'Admin Three'],
      [U_ADMIN_4, 'verify-a4@disposable.local', 'Admin Four'],
      [U_CUST_1, 'verify-c1@disposable.local', 'Cust One'],
      [U_CUST_2, 'verify-c2@disposable.local', 'Cust Two'],
      [U_CUST_3, 'verify-c3@disposable.local', 'Cust Three'],
      [U_CUST_4, 'verify-c4@disposable.local', 'Cust Four'],
    ]) {
      await admin.query(
        `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
         VALUES ($1, $2, NOW(), jsonb_build_object('full_name', $3::text))`,
        [id, email, name]
      );
    }
    await admin.query(
      `INSERT INTO public.user_roles (user_id, role)
       VALUES ($1, 'finance_admin'), ($2, 'operations_admin'), ($3, 'compliance_admin'), ($4, 'super_admin')`,
      [U_ADMIN_1, U_ADMIN_2, U_ADMIN_3, U_ADMIN_4]
    );

    // Verify RLS behavior for anon and authenticated (active vs closed)
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE anon');
    const anonAssets = await admin.query('SELECT COUNT(*)::int AS c FROM public.assets WHERE is_enabled = TRUE');
    assert.ok(anonAssets.rows[0].c > 0);
    await expectSqlError(admin, 'SELECT * FROM public.profiles', [], /permission denied/i, '42501');
    await admin.query('ROLLBACK');

    await admin.query('BEGIN');
    await admin.query(`SET LOCAL request.jwt.claim.sub = '${U_CUST_1}'`);
    await admin.query('SET LOCAL ROLE authenticated');
    const ownProfile = await admin.query('SELECT id FROM public.profiles');
    assert.equal(ownProfile.rows.length, 1);
    assert.equal(ownProfile.rows[0].id, U_CUST_1);
    await admin.query('ROLLBACK');
    record('RLS & anon/authenticated policies', true, 'anon/authenticated isolation verified');

    // Verify chk_approval_requests_state_attribution CHECK constraint independently of triggers
    await admin.query('BEGIN');
    await admin.query("SET LOCAL session_replication_role = 'replica'");
    const chkErr = await expectSqlError(
      admin,
      `INSERT INTO public.approval_requests (request_type, target_table, payload, reason_code, summary, status, requested_by, approved_by, approved_at, idempotency_key)
       VALUES ('manual_balance_adjustment', 'wallet_balances', '{}'::jsonb, 'CHK', 'Chk', 'APPROVED', $1, $2, NULL, 'idem-chk-1')`,
      [U_ADMIN_1, U_ADMIN_2],
      /chk_approval_requests_state_attribution/,
      '23514'
    );
    await admin.query('ROLLBACK');
    record('CHECK constraint chk_approval_requests_state_attribution', true, chkErr.message, chkErr.code);

    // 4. CD-1 Runtime verification
    const daIdRes = await admin.query<{ id: string }>(
      `INSERT INTO public.deposit_addresses (user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag, is_active)
       VALUES ($1, 'USDT', 'TRC-20', 'vault-test-1', 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', NULL, TRUE)
       RETURNING id`,
      [U_CUST_1]
    );
    const daId = daIdRes.rows[0].id;
    await admin.query('SELECT public.close_customer_account($1, TRUE)', [U_CUST_1]);

    const daAfterClose = await admin.query<{ is_active: boolean }>(
      'SELECT is_active FROM public.deposit_addresses WHERE id = $1',
      [daId]
    );
    assert.equal(daAfterClose.rows[0].is_active, false);

    // Closed customer RLS read must now return 0 rows
    await admin.query('BEGIN');
    await admin.query(`SET LOCAL request.jwt.claim.sub = '${U_CUST_1}'`);
    await admin.query('SET LOCAL ROLE authenticated');
    const closedOwnProfile = await admin.query('SELECT id FROM public.profiles');
    assert.equal(closedOwnProfile.rows.length, 0);
    await admin.query('ROLLBACK');

    await expectSqlError(
      admin,
      `INSERT INTO public.deposit_addresses (user_id, asset_symbol, network_code, custody_vault_id, address, is_active)
       VALUES ($1, 'USDT', 'ERC-20', 'vault-2', '0x1111111111111111111111111111111111111111', FALSE)`,
      [U_CUST_1],
      /Cannot create or modify deposit_addresses for closed account/,
      'P0001'
    );

    for (const [label, col, val] of [
      ['address', 'address', 'TModifiedEvilAddr1111111111111111'],
      ['memo_or_tag', 'memo_or_tag', '123456'],
      ['network_code', 'network_code', 'ERC-20'],
      ['asset_symbol', 'asset_symbol', 'BTC'],
      ['custody_vault_id', 'custody_vault_id', 'vault-evil'],
      ['created_at', 'created_at', '2027-01-01T00:00:00Z'],
      ['reactivate', 'is_active', true],
    ] as Array<[string, string, unknown]>) {
      await expectSqlError(
        admin,
        `UPDATE public.deposit_addresses SET ${col} = $1 WHERE id = $2`,
        [val, daId],
        /Cannot create or modify deposit_addresses for closed account/,
        'P0001'
      );
      record(`CD-1 closed inactive address ${label} blocked`, true, 'Trigger raised expected P0001 exception', 'P0001');
    }

    // Seed an active address inside replica mode on closed U_CUST_1, recover via SAVEPOINT after expected error,
    // then verify narrow TRUE->FALSE deactivation succeeds in the same transaction.
    await admin.query('BEGIN');
    await admin.query("SET LOCAL session_replication_role = 'replica'");
    const daStragglerRes = await admin.query<{ id: string }>(
      `INSERT INTO public.deposit_addresses (user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag, is_active)
       VALUES ($1, 'BTC', 'BTC', 'vault-btc-1', 'bc1qstraggler0000000000000000000000', NULL, TRUE)
       RETURNING id`,
      [U_CUST_1]
    );
    await admin.query("SET LOCAL session_replication_role = 'origin'");
    const daStragglerId = daStragglerRes.rows[0].id;
    await admin.query('SAVEPOINT sp_cd1_tamper');
    await expectSqlError(
      admin,
      `UPDATE public.deposit_addresses SET is_active = FALSE, address = 'bc1qevil0000000000000000000000' WHERE id = $1`,
      [daStragglerId],
      /Cannot create or modify deposit_addresses for closed account/,
      'P0001'
    );
    await admin.query('ROLLBACK TO SAVEPOINT sp_cd1_tamper');
    await admin.query('RELEASE SAVEPOINT sp_cd1_tamper');
    const cleanDeactivate = await admin.query<{ is_active: boolean }>(
      'UPDATE public.deposit_addresses SET is_active = FALSE WHERE id = $1 RETURNING is_active',
      [daStragglerId]
    );
    assert.equal(cleanDeactivate.rowCount, 1);
    assert.equal(cleanDeactivate.rows[0].is_active, false);
    await admin.query('ROLLBACK');
    record(
      'CD-1 narrow TRUE->FALSE deactivation vs frozen column tampering',
      true,
      'Tampered deactivation raised P0001, SAVEPOINT recovered cleanly, clean TRUE->FALSE deactivation succeeded',
      'P0001'
    );

    // 5. CD-2 Runtime verification: ownership reassignment across all 5 tables + legitimate updates
    const depRes = await admin.query<{ id: string }>(
      `INSERT INTO public.deposits (user_id, asset_symbol, network_code, deposit_address, tx_hash, amount, required_confirmations, status)
       VALUES ($1, 'USDT', 'TRC-20', 'TAddr', '0xdep1', 10, 20, 'PENDING_DETECTION') RETURNING id`,
      [U_CUST_2]
    );
    await admin.query(`UPDATE public.deposits SET status = 'CREDITED' WHERE id = $1`, [depRes.rows[0].id]);

    const wdRes = await admin.query<{ id: string }>(
      `INSERT INTO public.withdrawals (user_id, asset_symbol, network_code, destination_address, gross_amount, network_fee, net_amount, required_confirmations, status, idempotency_key)
       VALUES ($1, 'USDT', 'TRC-20', 'TDest', 25, 1, 24, 20, 'COMPLETED', 'idem-wd-1') RETURNING id`,
      [U_CUST_2]
    );
    const ordRes = await admin.query<{ id: string }>(
      `INSERT INTO public.spot_orders (user_id, pair_symbol, side, requested_amount, reserved_asset, reserved_amount, status, idempotency_key)
       VALUES ($1, 'BTC/USDT', 'buy', 50, 'USDT', 50, 'FILLED', 'idem-ord-1') RETURNING id`,
      [U_CUST_2]
    );

    const da2Res = await admin.query<{ id: string }>(
      `INSERT INTO public.deposit_addresses (user_id, asset_symbol, network_code, custody_vault_id, address, memo_or_tag, is_active)
       VALUES ($1, 'USDT', 'ERC-20', 'vault-test-2', '0x2222222222222222222222222222222222222222', NULL, TRUE)
       RETURNING id`,
      [U_CUST_2]
    );

    for (const [tbl, cond, param] of [
      ['wallet_balances', 'user_id = $2', U_CUST_2],
      ['deposits', 'id = $2', depRes.rows[0].id],
      ['withdrawals', 'id = $2', wdRes.rows[0].id],
      ['spot_orders', 'id = $2', ordRes.rows[0].id],
      ['deposit_addresses', 'id = $2', da2Res.rows[0].id],
    ]) {
      const err = await expectSqlError(
        admin,
        `UPDATE public.${tbl} SET user_id = $1 WHERE ${cond}`,
        [U_CUST_1, param],
        /Ownership \(user_id\) of .* cannot be reassigned/,
        'P0001'
      );
      record(`CD-2 user_id reassignment rejected on ${tbl}`, true, err.message, err.code);
    }

    // 6. CD-3 + Approval integrity runtime verification
    await admin.query('SELECT public.close_customer_account($1, FALSE)', [U_ADMIN_2]);
    await expectSqlError(
      admin,
      `INSERT INTO public.approval_requests (request_type, target_table, target_id, payload, reason_code, summary, requested_by, idempotency_key)
       VALUES ('manual_balance_adjustment', 'wallet_balances', NULL, jsonb_build_object('userId', $1::text), 'AUDIT', 'Closed requester', $2, 'idem-ar-closed-req')`,
      [U_CUST_2, U_ADMIN_2],
      /must be an active authorized administrator/,
      'P0001'
    );
    record('CD-3 closed requester blocked on INSERT', true, 'Closed ADMIN_2 rejected with P0001', 'P0001');

    const arRes = await admin.query<{ id: string }>(
      `INSERT INTO public.approval_requests (request_type, target_table, target_id, payload, reason_code, summary, requested_by, idempotency_key)
       VALUES ('manual_balance_adjustment', 'wallet_balances', NULL, jsonb_build_object('userId', $1::text), 'AUDIT', 'Test', $2, 'idem-ar-rt-1')
       RETURNING id`,
      [U_CUST_2, U_ADMIN_1]
    );
    const arId = arRes.rows[0].id;

    // Closed approver, closed rejector, closed canceller blocked
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'APPROVED', approved_by = $1 WHERE id = $2`,
      [U_ADMIN_2, arId],
      /must be an active authorized administrator/,
      'P0001'
    );
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'REJECTED', rejected_by = $1, decision_note = 'No' WHERE id = $2`,
      [U_ADMIN_2, arId],
      /must be an active authorized administrator/,
      'P0001'
    );
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'CANCELLED', cancelled_by = $1 WHERE id = $2`,
      [U_ADMIN_2, arId],
      /must be an active authorized administrator/,
      'P0001'
    );

    // Self-approval / maker-checker check on non-treasury
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'APPROVED', approved_by = $1 WHERE id = $2`,
      [U_ADMIN_1, arId],
      /Maker-checker violation/,
      'P0001'
    );

    // Active ADMIN_3 approves -> closes ADMIN_3 -> closed ADMIN_3 cannot execute -> active ADMIN_4 executes cleanly
    const approvedRow = await admin.query<{ approved_at: string }>(
      `UPDATE public.approval_requests SET status = 'APPROVED', approved_by = $1, decision_note = 'Approved OK' WHERE id = $2 RETURNING approved_at::text`,
      [U_ADMIN_3, arId]
    );
    await admin.query('SELECT public.close_customer_account($1, FALSE)', [U_ADMIN_3]);
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'EXECUTED', executed_by = $1 WHERE id = $2`,
      [U_ADMIN_3, arId],
      /must be an active authorized administrator/,
      'P0001'
    );
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'EXECUTED', executed_by = $1, approved_at = '2020-01-01T00:00:00Z' WHERE id = $2`,
      [U_ADMIN_4, arId],
      /Original approval attribution, timestamps, and decision_note cannot be altered/,
      'P0001'
    );
    await admin.query(
      `UPDATE public.approval_requests SET status = 'EXECUTED', executed_by = $1 WHERE id = $2`,
      [U_ADMIN_4, arId]
    );
    // Terminal state immutable
    await expectSqlError(
      admin,
      `UPDATE public.approval_requests SET status = 'REJECTED', rejected_by = $1, decision_note = 'Revert' WHERE id = $2`,
      [U_ADMIN_4, arId],
      /terminal status EXECUTED cannot be modified/,
      'P0001'
    );
    assert.ok(approvedRow.rows[0].approved_at);
    record('CD-3 & Approval Integrity full lifecycle', true, 'Closed actors, maker-checker, historical approver, timestamp freeze, and terminal immutability verified (P0001)');

    // EXPLAIN (FORMAT JSON) AST verification on the actual approval-request profile-lock query shape from 008
    const explainRes = await admin.query<{ 'QUERY PLAN': unknown }>(
      `
      EXPLAIN (FORMAT JSON)
      SELECT p.id, p.account_status
      FROM public.profiles p
      WHERE p.id = $1::uuid
         OR p.id = $2::uuid
         OR ($3::text IS NOT NULL AND p.id::TEXT = $3::text)
         OR ($3::text IS NOT NULL AND p.public_user_id = $3::text)
         OR ($4::jsonb ? 'userId' AND p.id::TEXT = $4::jsonb->>'userId')
         OR ($4::jsonb ? 'user_id' AND p.id::TEXT = $4::jsonb->>'user_id')
         OR ($4::jsonb ? 'publicUserId' AND p.public_user_id = $4::jsonb->>'publicUserId')
         OR ($4::jsonb ? 'public_user_id' AND p.public_user_id = $4::jsonb->>'public_user_id')
         OR (
           $5::text = 'wallet_balances'
           AND $3::text IS NOT NULL
           AND p.id IN (
             SELECT wb.user_id
             FROM public.wallet_balances wb
             WHERE wb.id::TEXT = $3::text
           )
         )
      ORDER BY p.id ASC
      FOR KEY SHARE OF p
      `,
      [U_ADMIN_1, U_ADMIN_4, U_CUST_2, JSON.stringify({ userId: U_CUST_2 }), 'wallet_balances']
    );
    const planAnalysis = analyzeProfileLockExplainPlan(explainRes.rows[0]['QUERY PLAN']);
    assert.equal(planAnalysis.ok, true, `EXPLAIN lock plan check failed: ${planAnalysis.reason}`);
    record(
      'EXPLAIN lock plan AST inspection',
      planAnalysis.ok,
      `${planAnalysis.orderingStrategy}: ${planAnalysis.reason}. Note: ${planAnalysis.limitationNote}`
    );

    // 7. Real Multi-Session Concurrency Tests (Session A vs Session B)
    const sA = await connectIsolatedClient(target);
    const sB = await connectIsolatedClient(target);
    const pidA = await getBackendPid(sA);
    const pidB = await getBackendPid(sB);

    try {
      // 7a. Advisory lock serialization + savepoint rollback persistence + unrelated user non-blocking
      // Note: pg_advisory_xact_lock acquired at top-level persists across subtransaction savepoint rollbacks;
      // locks acquired strictly inside a rolled-back savepoint are released upon ROLLBACK TO SAVEPOINT.
      await sA.query('BEGIN');
      await sA.query('SELECT public.acquire_user_account_lock($1)', [U_CUST_3]);
      await sA.query('SAVEPOINT sp1');
      await sA.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [U_CUST_3]);
      await sA.query('ROLLBACK TO SAVEPOINT sp1');

      // Unrelated user lock on sB must not block
      await sB.query('BEGIN');
      await sB.query('SELECT public.acquire_user_account_lock($1)', [U_CUST_4]);
      await sB.query('ROLLBACK');

      // Same user lock on sB MUST still block after sA rolled back savepoint sp1
      await sB.query('BEGIN');
      const advWait = sB
        .query('SELECT public.acquire_user_account_lock($1)', [U_CUST_3])
        .then(() => ({ ok: true as const }))
        .catch((err: { code?: string; message?: string }) => ({
          ok: false as const,
          code: err.code,
          message: err.message,
        }));
      const advLock = await waitForSessionLockWait(inspector, pidB);
      assert.equal(advLock.locktype, 'advisory');
      await sA.query('COMMIT');
      const advOutcome = await advWait;
      assert.equal(
        advOutcome.ok,
        true,
        `Expected sB advisory lock acquisition to succeed after sA COMMIT, got ${advOutcome.ok ? '' : `${advOutcome.code}: ${advOutcome.message}`}`
      );
      await sB.query('ROLLBACK');
      record('Multi-session advisory lock + savepoint + unrelated users', true, `pid ${pidB} blocked on ${advLock.locktype} until pid ${pidA} committed`);

      // 7b. Writer-first (uncommitted deposit) vs Closure-second -> writer commits -> closure rejects
      await sA.query('BEGIN');
      await sA.query(
        `INSERT INTO public.deposits (user_id, asset_symbol, network_code, deposit_address, tx_hash, amount, required_confirmations, status)
         VALUES ($1, 'USDT', 'TRC-20', 'TAddr', '0xconc_wf1', 15, 20, 'PENDING_DETECTION')`,
        [U_CUST_3]
      );
      await sB.query('BEGIN');
      const closeWait = sB
        .query('SELECT public.close_customer_account($1, FALSE)', [U_CUST_3])
        .then(() => ({ ok: true as const }))
        .catch((err: { code?: string; message?: string }) => ({ ok: false as const, code: err.code, message: err.message }));
      const closeLock = await waitForSessionLockWait(inspector, pidB);
      assert.ok(closeLock.locktype === 'tuple' || closeLock.locktype === 'transactionid', `Unexpected locktype ${closeLock.locktype}`);
      await sA.query('COMMIT');
      const closeOutcome = await closeWait;
      await sB.query('ROLLBACK');
      assert.equal(closeOutcome.ok, false);
      assert.equal(closeOutcome.code, 'P0001');
      assert.match(closeOutcome.message ?? '', /Cannot close account .* unresolved deposit records remain/);
      record(
        'Multi-session concurrency: Writer-first (commit) vs Closure',
        true,
        `Closure (${pidB}) blocked on ${closeLock.locktype}/${closeLock.mode} and rejected after commit: ${closeOutcome.message}`,
        closeOutcome.code
      );

      // 7c. Closure-first vs Deposit insert -> Closure commits -> EPQ aborts writer
      await sA.query('BEGIN');
      await sA.query('SELECT public.close_customer_account($1, FALSE)', [U_CUST_4]);
      await sB.query('BEGIN');
      const epqPromise = sB
        .query(
          `INSERT INTO public.deposits (user_id, asset_symbol, network_code, deposit_address, tx_hash, amount, required_confirmations, status)
           VALUES ($1, 'USDT', 'TRC-20', 'TAddr', '0xconc_cf1', 15, 20, 'PENDING_DETECTION')`,
          [U_CUST_4]
        )
        .then(() => ({ ok: true as const }))
        .catch((err: { code?: string; message?: string }) => ({ ok: false as const, code: err.code, message: err.message }));
      const epqLock = await waitForSessionLockWait(inspector, pidB);
      assert.ok(epqLock.locktype === 'tuple' || epqLock.locktype === 'transactionid', `Unexpected locktype ${epqLock.locktype}`);
      await sA.query('COMMIT');
      const epqOutcome = await epqPromise;
      await sB.query('ROLLBACK');
      assert.equal(epqOutcome.ok, false);
      assert.equal(epqOutcome.code, 'P0001');
      assert.match(epqOutcome.message ?? '', /Cannot create or modify deposits financial obligation for closed account/);
      record(
        'Multi-session concurrency: Closure-first vs Deposit-insert (EPQ)',
        true,
        `Writer (${pidB}) blocked on ${epqLock.locktype}/${epqLock.mode}, then aborted after COMMIT: ${epqOutcome.message}`,
        epqOutcome.code
      );

      // 7d. Approval concurrency: Admin closure vs approval transition (EPQ abort)
      const U_ADMIN_5 = '00000000-0000-4000-8000-000000000005';
      await admin.query(
        `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES ($1, 'verify-a5@disposable.local', NOW(), '{"full_name":"Admin Five"}'::jsonb)`,
        [U_ADMIN_5]
      );
      await admin.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'finance_admin')`, [U_ADMIN_5]);
      const arConc = await admin.query<{ id: string }>(
        `INSERT INTO public.approval_requests (request_type, target_table, payload, reason_code, summary, requested_by, idempotency_key)
         VALUES ('manual_balance_adjustment', 'wallet_balances', '{}'::jsonb, 'CONC', 'Concurrent approve', $1, 'idem-conc-ap') RETURNING id`,
        [U_ADMIN_1]
      );

      await sA.query('BEGIN');
      await sA.query('SELECT public.close_customer_account($1, FALSE)', [U_ADMIN_5]);
      await sB.query('BEGIN');
      const approveWait = sB
        .query(`UPDATE public.approval_requests SET status = 'APPROVED', approved_by = $1 WHERE id = $2`, [
          U_ADMIN_5,
          arConc.rows[0].id,
        ])
        .then(() => ({ ok: true as const }))
        .catch((err: { code?: string; message?: string }) => ({ ok: false as const, code: err.code, message: err.message }));
      const appLock = await waitForSessionLockWait(inspector, pidB);
      assert.ok(appLock.locktype === 'tuple' || appLock.locktype === 'transactionid', `Unexpected locktype ${appLock.locktype}`);
      await sA.query('COMMIT');
      const approveOutcome = await approveWait;
      await sB.query('ROLLBACK');
      assert.equal(approveOutcome.ok, false);
      assert.equal(approveOutcome.code, 'P0001');
      assert.match(approveOutcome.message ?? '', /Approval request actor .* must be an active authorized administrator/);
      record(
        'Multi-session concurrency: Admin closure vs Approval (CD-3)',
        true,
        `Approval (${pidB}) blocked on ${appLock.locktype}/${appLock.mode}, aborted after admin closure: ${approveOutcome.message}`,
        approveOutcome.code
      );
    } finally {
      await sA.end();
      await sB.end();
    }

    // 8. Migration 009 Manual Crypto Purchase Runtime Verification (triggers, RLS, partial unique tx_hash, closure guard)
    const fn009Check = await admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; anon_exec: boolean; auth_exec: boolean }>(`
      SELECT p.proname, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'enforce_manual_purchase_order_rules'
    `);
    assert.equal(fn009Check.rows.length, 1);
    assert.equal(fn009Check.rows[0].prosecdef, true);
    assert.ok(fn009Check.rows[0].proconfig?.includes('search_path=public'));
    assert.equal(fn009Check.rows[0].anon_exec, false);
    assert.equal(fn009Check.rows[0].auth_exec, false);

    const recAddrRes = await admin.query<{ id: string }>(
      `INSERT INTO public.receiving_addresses (asset_symbol, network_code, address, label, is_active, assigned_by)
       VALUES ('USDT', 'TRC-20', 'TVerifyRuntimeReceiving1111111111111', 'Verify Recv', TRUE, $1)
       RETURNING id`,
      [U_ADMIN_1]
    );
    const recAddrId = recAddrRes.rows[0].id;
    await admin.query(`UPDATE public.profiles SET kyc_status = 'approved' WHERE id = $1`, [U_CUST_2]);

    const mpo1Res = await admin.query<{ id: string }>(
      `INSERT INTO public.manual_purchase_orders (
         order_ref, user_id, pair_symbol, base_asset, quote_asset, side, order_type,
         requested_quote_amount, reference_price, fee_rate, estimated_fee_usdt, estimated_crypto_amount,
         total_payment_amount, payment_asset, receiving_network, receiving_address_id, receiving_address,
         status, idempotency_key
       ) VALUES (
         'MPO-VERIFY-001', $1, 'BTC/USDT', 'BTC', 'USDT', 'buy', 'MARKET',
         1000, 90000, 0.001, 1, 0.0111, 1000, 'USDT', 'TRC-20', $2, 'TVerifyRuntimeReceiving1111111111111',
         'PENDING_PAYMENT', 'mpo-verify-idem-1'
       ) RETURNING id`,
      [U_CUST_2, recAddrId]
    );
    const mpo1Id = mpo1Res.rows[0].id;

    // Cannot close customer account while unresolved manual_purchase_order exists
    await expectSqlError(
      admin,
      `SELECT public.close_customer_account($1, FALSE)`,
      [U_CUST_2],
      /unresolved manual purchase orders remain/,
      'P0001'
    );

    // Invalid state transition PENDING_PAYMENT -> COMPLETED blocked by trigger
    await expectSqlError(
      admin,
      `UPDATE public.manual_purchase_orders SET status = 'COMPLETED', fulfilled_by = $1, fulfilled_at = NOW(), credited_tx_id = $2, final_crypto_amount = 0.0111, payment_tx_hash = '0xverifyhash1234' WHERE id = $3`,
      [U_ADMIN_1, mpo1Id, mpo1Id],
      /Invalid manual purchase status transition/,
      'P0001'
    );

    // Submit payment -> duplicate tx_hash blocked on second active order -> rejected order frees tx_hash reuse
    await admin.query(
      `UPDATE public.manual_purchase_orders
       SET status = 'PAYMENT_SUBMITTED', payment_tx_hash = '0xVerifyDupHash123456', actual_amount_sent = 1000
       WHERE id = $1`,
      [mpo1Id]
    );

    // Payment immutability after submission
    await expectSqlError(
      admin,
      `UPDATE public.manual_purchase_orders SET payment_tx_hash = '0xTamperedHash99999' WHERE id = $1`,
      [mpo1Id],
      /immutable once submitted/,
      'P0001'
    );

    // Incomplete checklist approval blocked
    await admin.query(`UPDATE public.manual_purchase_orders SET status = 'UNDER_REVIEW' WHERE id = $1`, [mpo1Id]);
    await expectSqlError(
      admin,
      `UPDATE public.manual_purchase_orders SET status = 'APPROVED', tx_hash_checked = TRUE WHERE id = $1`,
      [mpo1Id],
      /All verification checklist checks must be true/,
      'P0001'
    );

    // Partial unique index blocks duplicate active payment_tx_hash (case-insensitive)
    const mpo2Res = await admin.query<{ id: string }>(
      `INSERT INTO public.manual_purchase_orders (
         order_ref, user_id, pair_symbol, base_asset, quote_asset, side, order_type,
         requested_quote_amount, reference_price, fee_rate, estimated_fee_usdt, estimated_crypto_amount,
         total_payment_amount, payment_asset, receiving_network, receiving_address_id, receiving_address,
         status, idempotency_key
       ) VALUES (
         'MPO-VERIFY-002', $1, 'BTC/USDT', 'BTC', 'USDT', 'buy', 'MARKET',
         500, 90000, 0.001, 0.5, 0.00555, 500, 'USDT', 'TRC-20', $2, 'TVerifyRuntimeReceiving1111111111111',
         'PENDING_PAYMENT', 'mpo-verify-idem-2'
       ) RETURNING id`,
      [U_CUST_2, recAddrId]
    );
    await expectSqlError(
      admin,
      `UPDATE public.manual_purchase_orders SET status = 'PAYMENT_SUBMITTED', payment_tx_hash = '0xverifyduphash123456', actual_amount_sent = 500 WHERE id = $1`,
      [mpo2Res.rows[0].id],
      /uq_manual_purchase_orders_network_tx_hash/,
      '23505'
    );
    record(
      'Migration 009 manual purchase rules, triggers & unique tx_hash index',
      true,
      'Verified trigger state guards, payment immutability, checklist gate, closure lock, and 23505 duplicate tx_hash index'
    );

    const failed = results.filter((r) => !r.passed);
    console.log(`\nSummary: ${results.length} checks, ${failed.length} failed.`);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await inspector.end();
    await admin.end();
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((err) => {
    console.error('PostgreSQL runtime verification aborted:', err);
    process.exit(1);
  });
}

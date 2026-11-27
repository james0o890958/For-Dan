import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db', 'migrations');

async function readMigration(file: string): Promise<string> {
  return fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
}

function stripSqlCommentsAndDollarBlocks(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

function checkBalancedDelimiters(sql: string) {
  const dollarMatches = sql.match(/\$\$/g) ?? [];
  assert.equal(
    dollarMatches.length % 2,
    0,
    `Unbalanced $$ dollar-quote delimiters (found ${dollarMatches.length})`
  );

  const cleaned = stripSqlCommentsAndDollarBlocks(sql).replace(/'(?:''|[^'])*'/g, "''");
  let depth = 0;
  for (const ch of cleaned) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    assert.ok(depth >= 0, 'Unexpected closing parenthesis in SQL');
  }
  assert.equal(depth, 0, `Unclosed parenthesis in SQL (depth=${depth})`);
}

test('all five migration files pass structural SQL validation', async () => {
  const files = [
    '001_core_exchange_schema.sql',
    '002_company_inventory_treasury_pricing.sql',
    '003_rls_and_permissions.sql',
    '004_auth_bootstrap_and_catalog.sql',
    '005_security_events_and_ip_intelligence.sql',
  ];

  for (const file of files) {
    const sql = await readMigration(file);
    assert.ok(sql.trim().length > 0, `${file} must not be empty`);
    checkBalancedDelimiters(sql);
  }
});

test('all helper and trigger functions explicitly pin SET search_path = public', async () => {
  const m001 = await readMigration('001_core_exchange_schema.sql');
  const m002 = await readMigration('002_company_inventory_treasury_pricing.sql');
  const m003 = await readMigration('003_rls_and_permissions.sql');
  const m004 = await readMigration('004_auth_bootstrap_and_catalog.sql');
  const m005 = await readMigration('005_security_events_and_ip_intelligence.sql');

  assert.match(m001, /CREATE OR REPLACE FUNCTION public\.normalize_phone_e164[\s\S]*?SET search_path = public/i);
  assert.match(m001, /CREATE OR REPLACE FUNCTION public\.prevent_immutable_record_mutation[\s\S]*?SET search_path = public/i);
  assert.match(m001, /CREATE OR REPLACE FUNCTION public\.close_customer_account[\s\S]*?SET search_path = public/i);
  assert.match(m002, /CREATE OR REPLACE FUNCTION public\.enforce_treasury_funding_approval_rules[\s\S]*?SET search_path = public/i);
  assert.match(m002, /CREATE OR REPLACE FUNCTION public\.enforce_approval_request_rules[\s\S]*?SET search_path = public/i);
  for (const fn of [
    'has_admin_role',
    'is_admin_user',
    'is_super_admin',
    'can_read_kyc_records',
    'can_read_financial_records',
    'can_read_security_events',
  ]) {
    assert.match(m003, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public`, 'i'));
  }
  assert.match(m004, /CREATE OR REPLACE FUNCTION public\.generate_public_user_id[\s\S]*?SET search_path = public/i);
  assert.match(m004, /CREATE OR REPLACE FUNCTION public\.handle_new_auth_user[\s\S]*?SET search_path = public/i);
  assert.match(m005, /CREATE OR REPLACE FUNCTION public\.guard_auth_security_events_immutability[\s\S]*?SET search_path = public/i);
  assert.match(m005, /CREATE OR REPLACE FUNCTION public\.anonymize_expired_auth_security_events[\s\S]*?SET search_path = public/i);
  assert.match(m005, /CREATE OR REPLACE FUNCTION public\.purge_expired_ip_intelligence_cache[\s\S]*?SET search_path = public/i);
});

test('H-1: administrator authorization helpers bind strictly to auth.uid(), require active status, prevent UUID enumeration, and scope roles cleanly', async () => {
  const m003 = await readMigration('003_rls_and_permissions.sql');
  const m005 = await readMigration('005_security_events_and_ip_intelligence.sql');

  // Legacy arbitrary-UUID helper signature must be dropped and never recreated
  assert.match(m003, /DROP FUNCTION IF EXISTS public\.is_admin_user\(UUID\);/i);
  assert.doesNotMatch(m003, /CREATE OR REPLACE FUNCTION public\.is_admin_user\s*\(\s*check_user_id/i);
  assert.doesNotMatch(m003, /public\.is_admin_user\(auth\.uid\(\)\)/i);
  assert.doesNotMatch(m005, /public\.is_admin_user\(auth\.uid\(\)\)/i);

  // has_admin_role must require auth.uid() IS NOT NULL, p.account_status = 'active', and ur.user_id = auth.uid()
  assert.match(
    m003,
    /CREATE OR REPLACE FUNCTION public\.has_admin_role\(allowed_roles TEXT\[\]\)[\s\S]*?auth\.uid\(\) IS NOT NULL[\s\S]*?JOIN public\.profiles p ON p\.id = ur\.user_id[\s\S]*?ur\.user_id = auth\.uid\(\)[\s\S]*?p\.account_status = 'active'[\s\S]*?ur\.role = ANY\(allowed_roles\)/i
  );

  // Role-specific helpers: security events & KYC exclude finance_admin; user_roles enumeration restricted to super_admin
  const securityHelper = m003.match(/CREATE OR REPLACE FUNCTION public\.can_read_security_events\(\)[\s\S]*?\$\$;/i);
  assert.ok(securityHelper, 'can_read_security_events() must exist');
  assert.match(securityHelper[0], /'super_admin'/);
  assert.match(securityHelper[0], /'compliance_admin'/);
  assert.match(securityHelper[0], /'operations_admin'/);
  assert.doesNotMatch(securityHelper[0], /'finance_admin'/);

  const kycHelper = m003.match(/CREATE OR REPLACE FUNCTION public\.can_read_kyc_records\(\)[\s\S]*?\$\$;/i);
  assert.ok(kycHelper, 'can_read_kyc_records() must exist');
  assert.doesNotMatch(kycHelper[0], /'finance_admin'/);

  assert.match(m003, /CREATE POLICY user_roles_select_own ON public\.user_roles[\s\S]*?USING \(auth\.uid\(\) = user_id OR public\.is_super_admin\(\)\)/i);
  assert.match(m003, /CREATE POLICY kyc_select_own ON public\.kyc_submissions[\s\S]*?USING \(auth\.uid\(\) = user_id OR public\.can_read_kyc_records\(\)\)/i);
  assert.match(m005, /CREATE POLICY auth_security_events_admin_read ON public\.auth_security_events[\s\S]*?USING \(public\.can_read_security_events\(\)\)/i);

  // Anon must not be able to execute any admin helpers; internal trigger/maintenance functions revoked from client roles
  assert.match(m003, /REVOKE ALL ON FUNCTION public\.is_admin_user\(\) FROM PUBLIC, anon, authenticated;/i);
  assert.match(m003, /GRANT EXECUTE ON FUNCTION public\.is_admin_user\(\) TO authenticated;/i);
  assert.match(m003, /REVOKE ALL ON FUNCTION public\.close_customer_account\(UUID, BOOLEAN\) FROM PUBLIC, anon, authenticated;/i);
});

test('H-7: migration 002 enforces attribution columns, immutable request fields, strict state transitions, and DELETE prevention triggers', async () => {
  const m002 = await readMigration('002_company_inventory_treasury_pricing.sql');

  const treasuryBlock = m002.match(/CREATE TABLE IF NOT EXISTS public\.treasury_funding_records\s*\(([\s\S]*?)\);/i);
  assert.ok(treasuryBlock, 'treasury_funding_records table definition must exist in 002');
  for (const col of ['approved_by', 'approved_at', 'confirmed_by', 'confirmed_at', 'rejected_by', 'rejected_at', 'decision_note']) {
    assert.match(treasuryBlock[1], new RegExp(`\\b${col}\\b`, 'i'));
  }
  assert.match(
    treasuryBlock[1],
    /CONSTRAINT chk_treasury_funding_approver_present CHECK\s*\(\s*status NOT IN \('APPROVED', 'CONFIRMED'\) OR approved_by IS NOT NULL\s*\)/i
  );
  assert.match(treasuryBlock[1], /CONSTRAINT chk_treasury_funding_state_attribution CHECK/i);

  assert.match(m002, /CREATE TRIGGER trg_enforce_treasury_funding_approval_rules\s+BEFORE INSERT OR UPDATE ON public\.treasury_funding_records/i);
  assert.match(m002, /CREATE TRIGGER trg_prevent_delete_treasury_funding_records\s+BEFORE DELETE ON public\.treasury_funding_records/i);
  assert.match(m002, /Immutable treasury funding request fields cannot be modified after creation/i);
  assert.match(m002, /OLD\.status IN \('CONFIRMED', 'REJECTED'\)/i);
  assert.match(m002, /PENDING_APPROVAL -> REJECTED requires rejected_by and a non-empty decision_note/i);

  const approvalBlock = m002.match(/CREATE TABLE IF NOT EXISTS public\.approval_requests\s*\(([\s\S]*?)\);/i);
  assert.ok(approvalBlock, 'approval_requests table definition must exist in 002');
  for (const col of ['approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'executed_by', 'executed_at', 'cancelled_by', 'cancelled_at']) {
    assert.match(approvalBlock[1], new RegExp(`\\b${col}\\b`, 'i'));
  }
  assert.match(
    approvalBlock[1],
    /CONSTRAINT chk_approval_requests_self_approval CHECK\s*\(\s*approved_by IS NULL OR approved_by <> requested_by OR request_type = 'treasury_funding'\s*\)/i
  );
  assert.match(approvalBlock[1], /CONSTRAINT chk_approval_requests_state_attribution CHECK/i);
  assert.match(m002, /CREATE TRIGGER trg_enforce_approval_request_rules\s+BEFORE INSERT OR UPDATE ON public\.approval_requests/i);
  assert.match(m002, /CREATE TRIGGER trg_prevent_delete_approval_requests\s+BEFORE DELETE ON public\.approval_requests/i);
  assert.match(m002, /Immutable approval request fields \(%\) cannot be modified after creation/i);
  assert.match(m002, /OLD\.status IN \('REJECTED', 'EXECUTED', 'CANCELLED'\)/i);
  assert.match(m002, /IF NEW\.request_type <> 'treasury_funding' OR NOT v_actor_is_super_admin THEN/i);
});

test('H-8: decouples audit/actor FKs from profile deletions, enforces ON DELETE RESTRICT on financial tables, and implements security-event retention anonymization', async () => {
  const m001 = await readMigration('001_core_exchange_schema.sql');
  const m002 = await readMigration('002_company_inventory_treasury_pricing.sql');
  const m005 = await readMigration('005_security_events_and_ip_intelligence.sql');

  // Account closure support in 001
  assert.match(m001, /CHECK \(account_status IN \('active', 'suspended', 'closed'\)\)/i);
  assert.match(m001, /CREATE OR REPLACE FUNCTION public\.close_customer_account/i);

  // Financial ownership tables must block accidental cascade deletion
  for (const table of ['deposits', 'withdrawals', 'spot_orders', 'trades', 'ledger_transactions', 'ledger_entries']) {
    const block = m001.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\s*\\(([\\s\\S]*?)\\);`, 'i'));
    assert.ok(block, `${table} must exist in 001`);
    assert.match(block[1], /user_id UUID NOT NULL REFERENCES public\.profiles\(id\) ON DELETE RESTRICT/i);
  }

  // Immutable audit & security tables must NOT have blocking FK references to profiles(id)
  const auditLogs = m001.match(/CREATE TABLE IF NOT EXISTS public\.admin_audit_logs\s*\(([\s\S]*?)\);/i);
  assert.ok(auditLogs);
  assert.doesNotMatch(auditLogs[1], /REFERENCES public\.profiles/i);

  const invMovements = m002.match(/CREATE TABLE IF NOT EXISTS public\.inventory_movements\s*\(([\s\S]*?)\);/i);
  assert.ok(invMovements);
  assert.doesNotMatch(invMovements[1], /REFERENCES public\.profiles/i);

  const secEvents = m005.match(/CREATE TABLE IF NOT EXISTS public\.auth_security_events\s*\(([\s\S]*?)\);/i);
  assert.ok(secEvents);
  assert.doesNotMatch(secEvents[1], /REFERENCES public\.profiles/i);
  assert.match(secEvents[1], /\bretention_expires_at\b/i);
  assert.match(secEvents[1], /\banonymized_at\b/i);
  assert.match(secEvents[1], /\banonymization_reason\b/i);

  // Security-event retention guard & anonymization procedure
  assert.match(m005, /CREATE TRIGGER trg_immutable_auth_security_events\s+BEFORE UPDATE OR DELETE ON public\.auth_security_events[\s\S]*?guard_auth_security_events_immutability/i);
  assert.match(m005, /IF TG_OP = 'DELETE' THEN/i);
  assert.match(m005, /CREATE OR REPLACE FUNCTION public\.anonymize_expired_auth_security_events/i);
  assert.match(m005, /CREATE OR REPLACE FUNCTION public\.purge_expired_ip_intelligence_cache/i);
  assert.match(m005, /REVOKE ALL ON FUNCTION public\.anonymize_expired_auth_security_events\(INTEGER\) FROM PUBLIC, anon, authenticated;/i);
});

test('M-1: enforces E.164 phone normalization, optional NULL storage, and partial unique index on non-null phones', async () => {
  const m001 = await readMigration('001_core_exchange_schema.sql');
  const m004 = await readMigration('004_auth_bootstrap_and_catalog.sql');

  assert.match(m001, /CREATE OR REPLACE FUNCTION public\.normalize_phone_e164/i);
  const profilesBlock = m001.match(/CREATE TABLE IF NOT EXISTS public\.profiles\s*\(([\s\S]*?)\);/i);
  assert.ok(profilesBlock);
  assert.doesNotMatch(profilesBlock[1], /\bphone TEXT NOT NULL\b/i);
  assert.match(profilesBlock[1], /CONSTRAINT chk_profiles_phone_e164 CHECK \(phone IS NULL OR phone ~ '\^\\\+\[1-9\]\[0-9\]\{6,14\}\$'\)/i);

  assert.match(
    m001,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_phone_normalized\s+ON public\.profiles \(phone\)\s+WHERE phone IS NOT NULL;/i
  );

  // Trigger in 004 must call normalize_phone_e164 and never coerce missing phone to ''
  assert.match(m004, /v_phone := public\.normalize_phone_e164\(NEW\.raw_user_meta_data->>'phone'\);/i);
  assert.doesNotMatch(m004, /COALESCE\(NULLIF\(TRIM\(NEW\.raw_user_meta_data->>'phone'\), ''\), ''\)/i);
});

test('migration 003 restricts sensitive columns on profiles, kyc_submissions, and deposit_addresses and enables RLS everywhere', async () => {
  const m001 = await readMigration('001_core_exchange_schema.sql');
  const m002 = await readMigration('002_company_inventory_treasury_pricing.sql');
  const m003 = await readMigration('003_rls_and_permissions.sql');
  const migrateTs = await fs.readFile(path.resolve(process.cwd(), 'server', 'migrate.ts'), 'utf8');

  const tableGrantMatch = m003.match(/GRANT SELECT ON TABLE([\s\S]*?)TO authenticated;/i);
  assert.ok(tableGrantMatch, 'GRANT SELECT ON TABLE block must exist in 003');
  const tableGrantList = tableGrantMatch[1];
  assert.doesNotMatch(tableGrantList, /\bpublic\.profiles\b/);
  assert.doesNotMatch(tableGrantList, /\bpublic\.kyc_submissions\b/);
  assert.doesNotMatch(tableGrantList, /\bpublic\.deposit_addresses\b/);

  assert.match(
    m003,
    /REVOKE SELECT ON TABLE[\s\S]*?public\.profiles[\s\S]*?public\.kyc_submissions[\s\S]*?public\.deposit_addresses[\s\S]*?FROM anon, authenticated;/i
  );

  const profilesGrant = m003.match(/GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.profiles TO authenticated;/i);
  assert.ok(profilesGrant);
  assert.doesNotMatch(profilesGrant[1], /\btotp_secret_encrypted\b/);

  const kycGrant = m003.match(/GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.kyc_submissions TO authenticated;/i);
  assert.ok(kycGrant);
  assert.doesNotMatch(kycGrant[1], /\bprovider_applicant_id\b/);
  assert.doesNotMatch(kycGrant[1], /\bdocument_number_hash\b/);

  const depositAddrGrant = m003.match(/GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.deposit_addresses TO authenticated;/i);
  assert.ok(depositAddrGrant);
  assert.doesNotMatch(depositAddrGrant[1], /\bcustody_vault_id\b/);

  const createdTables = [
    ...`${m001}\n${m002}`.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)/gi),
  ].map((m) => m[1]);
  assert.equal(createdTables.length, 26);

  for (const table of createdTables) {
    assert.match(
      m003,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, 'i'),
      `Missing ENABLE ROW LEVEL SECURITY for ${table}`
    );
  }

  assert.match(migrateTs, /ALTER TABLE public\.schema_migrations ENABLE ROW LEVEL SECURITY;/i);
  assert.match(m003, /ALTER TABLE public\.schema_migrations ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(m003, /GRANT\s+(?:ALL|INSERT|DELETE)\b/i);
});

test('Phase 1 (006): passes structural SQL validation, ordering after 005, and search_path pinning without altering 001-005', async () => {
  const m006 = await readMigration('006_security_and_rls_hardening.sql');
  assert.ok(m006.trim().length > 0, '006_security_and_rls_hardening.sql must not be empty');
  checkBalancedDelimiters(m006);

  const { listSqlMigrationFiles } = await import('./migrate');
  const files = await listSqlMigrationFiles();
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

  for (const fn of [
    'is_active_account',
    'guard_auth_security_events_immutability',
    'anonymize_expired_auth_security_events',
    'close_customer_account',
    'enforce_treasury_funding_approval_rules',
  ]) {
    assert.match(
      m006,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public`, 'i')
    );
  }
});

test('Phase 1 (006-A): anon catalog policies allow enabled assets/pairs without calling is_admin_user()', async () => {
  const m006 = await readMigration('006_security_and_rls_hardening.sql');

  assert.match(m006, /DROP POLICY IF EXISTS assets_public_read ON public\.assets;/i);
  assert.match(
    m006,
    /CREATE POLICY assets_anon_read ON public\.assets\s+FOR SELECT TO anon\s+USING \(is_enabled = TRUE\);/i
  );
  assert.match(
    m006,
    /CREATE POLICY assets_authenticated_read ON public\.assets\s+FOR SELECT TO authenticated\s+USING \(is_enabled = TRUE OR public\.is_admin_user\(\)\);/i
  );

  assert.match(m006, /DROP POLICY IF EXISTS pairs_public_read ON public\.trading_pairs;/i);
  assert.match(
    m006,
    /CREATE POLICY pairs_anon_read ON public\.trading_pairs\s+FOR SELECT TO anon\s+USING \(is_enabled = TRUE\);/i
  );
  assert.match(
    m006,
    /CREATE POLICY pairs_authenticated_read ON public\.trading_pairs\s+FOR SELECT TO authenticated\s+USING \(is_enabled = TRUE OR public\.is_admin_user\(\)\);/i
  );
});

test('Phase 1 (006-B): enforces active account status across customer-owned RLS policies while preserving admin role helpers', async () => {
  const m006 = await readMigration('006_security_and_rls_hardening.sql');

  assert.match(
    m006,
    /CREATE OR REPLACE FUNCTION public\.is_active_account\(\)[\s\S]*?p\.account_status = 'active'/i
  );
  assert.match(m006, /REVOKE ALL ON FUNCTION public\.is_active_account\(\) FROM PUBLIC, anon, authenticated;/i);
  assert.match(m006, /GRANT EXECUTE ON FUNCTION public\.is_active_account\(\) TO authenticated;/i);

  assert.match(
    m006,
    /CREATE POLICY profiles_select_own ON public\.profiles[\s\S]*?USING \(\(auth\.uid\(\) = id AND account_status = 'active'\) OR public\.is_admin_user\(\)\)/i
  );
  assert.match(
    m006,
    /CREATE POLICY user_roles_select_own ON public\.user_roles[\s\S]*?USING \(\(auth\.uid\(\) = user_id AND public\.is_active_account\(\)\) OR public\.is_super_admin\(\)\)/i
  );
  assert.match(
    m006,
    /CREATE POLICY kyc_select_own ON public\.kyc_submissions[\s\S]*?USING \(\(auth\.uid\(\) = user_id AND public\.is_active_account\(\)\) OR public\.can_read_kyc_records\(\)\)/i
  );

  for (const [policy, table] of [
    ['wallet_balances_select_own', 'wallet_balances'],
    ['deposit_addresses_select_own', 'deposit_addresses'],
    ['deposits_select_own', 'deposits'],
    ['withdrawals_select_own', 'withdrawals'],
    ['spot_orders_select_own', 'spot_orders'],
    ['trades_select_own', 'trades'],
    ['ledger_tx_select_own', 'ledger_transactions'],
    ['ledger_entries_select_own', 'ledger_entries'],
  ]) {
    assert.match(
      m006,
      new RegExp(
        `CREATE POLICY ${policy} ON public\\.${table}[\\s\\S]*?USING \\(\\(auth\\.uid\\(\\) = user_id AND public\\.is_active_account\\(\\)\\) OR public\\.can_read_financial_records\\(\\)\\)`,
        'i'
      )
    );
  }

  assert.match(
    m006,
    /CREATE POLICY notifications_select_own ON public\.notifications[\s\S]*?USING \(auth\.uid\(\) = user_id AND public\.is_active_account\(\)\)/i
  );
  assert.match(
    m006,
    /CREATE POLICY notifications_update_own ON public\.notifications[\s\S]*?USING \(auth\.uid\(\) = user_id AND public\.is_active_account\(\)\)\s+WITH CHECK \(auth\.uid\(\) = user_id AND public\.is_active_account\(\)\)/i
  );
});

test('Phase 1 (006-C/D/E): fixes security-event retention guard, account closure checks, and treasury decision_note immutability', async () => {
  const m006 = await readMigration('006_security_and_rls_hardening.sql');

  // 006-C: NULL-safe IS DISTINCT FROM + exception-safe retention op restore + REVOKE
  assert.match(
    m006,
    /IF current_setting\('exchange\.retention_op', true\) IS DISTINCT FROM 'anonymize_expired_security_events' THEN/i
  );
  assert.doesNotMatch(
    m006,
    /current_setting\('exchange\.retention_op', true\)\s*<>/i
  );
  assert.match(
    m006,
    /EXCEPTION\s+WHEN OTHERS THEN\s+PERFORM set_config\('exchange\.retention_op', COALESCE\(v_prev_retention_op, ''\), true\);\s+RAISE;/i
  );
  assert.match(
    m006,
    /REVOKE ALL ON FUNCTION public\.anonymize_expired_auth_security_events\(INTEGER\) FROM PUBLIC, anon, authenticated;/i
  );

  // 006-D: close_customer_account checks unresolved approval_requests and deactivates deposit_addresses
  assert.match(
    m006,
    /FROM public\.approval_requests ar\s+WHERE ar\.status IN \('PENDING_SECOND_APPROVAL', 'APPROVED'\)/i
  );
  assert.match(
    m006,
    /UPDATE public\.deposit_addresses\s+SET is_active = FALSE\s+WHERE user_id = p_user_id/i
  );

  // 006-E: enforce_treasury_funding_approval_rules freezes decision_note on APPROVED -> CONFIRMED
  assert.match(
    m006,
    /ELSIF OLD\.status = 'APPROVED' AND NEW\.status = 'CONFIRMED' THEN[\s\S]*?NEW\.decision_note IS DISTINCT FROM OLD\.decision_note[\s\S]*?NEW\.rejected_at IS NOT NULL/i
  );
});

test('Phase 1.1 (007): static SQL verification of M-3 account-closure serialization/triggers, L-1 timestamp hygiene, catalog parity, and search_path pinning (not executed against live PostgreSQL)', async () => {
  const m007 = await readMigration('007_account_closure_concurrency_and_approval_hardening.sql');
  assert.ok(m007.trim().length > 0, '007 must not be empty');
  checkBalancedDelimiters(m007);

  for (const fn of [
    'acquire_user_account_lock',
    'guard_closed_account_obligation_write',
    'guard_closed_account_approval_request_write',
    'close_customer_account',
    'enforce_approval_request_rules',
  ]) {
    assert.match(
      m007,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public`, 'i')
    );
    assert.match(
      m007,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`, 'i')
    );
  }

  // M-3: close_customer_account serializes via acquire_user_account_lock + FOR UPDATE on profiles
  assert.match(
    m007,
    /CREATE OR REPLACE FUNCTION public\.close_customer_account[\s\S]*?PERFORM public\.acquire_user_account_lock\(p_user_id\);[\s\S]*?FROM public\.profiles\s+WHERE id = p_user_id\s+FOR UPDATE;/i
  );

  // M-3: trigger guards enforce FOR KEY SHARE against profiles across all obligation tables
  for (const table of [
    'wallet_balances',
    'deposits',
    'withdrawals',
    'spot_orders',
    'deposit_addresses',
  ]) {
    assert.match(
      m007,
      new RegExp(
        `CREATE TRIGGER trg_guard_closed_account_${table}\\s+BEFORE INSERT OR UPDATE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.guard_closed_account_obligation_write\\(\\);`,
        'i'
      )
    );
  }
  assert.match(m007, /FROM public\.profiles p\s+WHERE p\.id = NEW\.user_id\s+FOR KEY SHARE;/i);
  assert.match(
    m007,
    /CREATE TRIGGER trg_guard_closed_account_approval_requests\s+BEFORE INSERT OR UPDATE ON public\.approval_requests\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_closed_account_approval_request_write\(\);/i
  );
  assert.match(m007, /ORDER BY p\.id ASC\s+FOR KEY SHARE OF p/i);

  // L-1: approval_requests timestamp hygiene across CHECK constraint and trigger
  assert.match(
    m007,
    /ADD CONSTRAINT chk_approval_requests_state_attribution CHECK[\s\S]*?status = 'EXECUTED'[\s\S]*?approved_at IS NOT NULL[\s\S]*?executed_at IS NOT NULL[\s\S]*?rejected_at IS NULL[\s\S]*?cancelled_at IS NULL/i
  );
  assert.match(
    m007,
    /NEW\.rejected_at IS NOT NULL[\s\S]*?NEW\.executed_at IS NOT NULL[\s\S]*?NEW\.cancelled_at IS NOT NULL[\s\S]*?NEW\.approved_at := COALESCE\(NEW\.approved_at, NOW\(\)\)/i
  );
  assert.match(
    m007,
    /ELSIF OLD\.status = 'APPROVED' AND NEW\.status = 'EXECUTED' THEN[\s\S]*?NEW\.approved_at IS DISTINCT FROM OLD\.approved_at[\s\S]*?NEW\.executed_at := COALESCE\(NEW\.executed_at, NOW\(\)\)/i
  );

  // Catalog parity for networks and market_prices
  assert.match(m007, /CREATE POLICY networks_anon_read ON public\.networks\s+FOR SELECT TO anon/i);
  assert.match(m007, /CREATE POLICY networks_authenticated_read ON public\.networks\s+FOR SELECT TO authenticated/i);
  assert.match(m007, /CREATE POLICY market_prices_anon_read ON public\.market_prices\s+FOR SELECT TO anon/i);
  assert.match(m007, /CREATE POLICY market_prices_authenticated_read ON public\.market_prices\s+FOR SELECT TO authenticated/i);
});

test('Phase 1.2 (008) [STATIC SQL]: passes structural validation, search_path pinning, and REVOKE hardening without modifying 001-007', async () => {
  const m008 = await readMigration('008_closed_account_integrity_hardening.sql');
  assert.ok(m008.trim().length > 0, '008_closed_account_integrity_hardening.sql must not be empty');
  checkBalancedDelimiters(m008);

  for (const fn of [
    'guard_closed_account_obligation_write',
    'enforce_approval_request_rules',
    'guard_closed_account_approval_request_write',
  ]) {
    assert.match(
      m008,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public`, 'i')
    );
    assert.match(
      m008,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated;`, 'i')
    );
  }
});

test('Phase 1.2 (008) [STATIC SQL] CD-1 & CD-2: removes unguarded deposit_addresses bypass, freezes user_id, and locks profile before closed-account deactivation checks', async () => {
  const m008 = await readMigration('008_closed_account_integrity_hardening.sql');
  const guardMatch = m008.match(
    /CREATE OR REPLACE FUNCTION public\.guard_closed_account_obligation_write\(\)[\s\S]*?\$\$;/i
  );
  assert.ok(guardMatch, 'guard_closed_account_obligation_write() must exist in 008');
  const fnSql = guardMatch[0];

  // CD-2: immutable ownership check on UPDATE
  assert.match(
    fnSql,
    /IF TG_OP = 'UPDATE' AND NEW\.user_id IS DISTINCT FROM OLD\.user_id THEN[\s\S]*?RAISE EXCEPTION/i
  );

  // CD-1: unguarded early-return bypass from 007 must NOT be present
  assert.doesNotMatch(
    fnSql,
    /IF TG_TABLE_NAME = 'deposit_addresses' AND TG_OP = 'UPDATE' AND NEW\.is_active = FALSE AND NEW\.user_id = OLD\.user_id THEN\s+RETURN NEW;\s+END IF;/i
  );

  // CD-1: profile FOR KEY SHARE lock must appear before deposit_addresses closed-account branch
  const lockIdx = fnSql.search(/FROM public\.profiles p\s+WHERE p\.id = NEW\.user_id\s+FOR KEY SHARE;/i);
  const closedBranchIdx = fnSql.search(/IF v_account_status = 'closed' THEN/i);
  assert.ok(lockIdx > 0, 'FOR KEY SHARE lock on profiles must exist');
  assert.ok(closedBranchIdx > lockIdx, 'FOR KEY SHARE lock must execute before closed-account status branch');

  // CD-1: closed-account deposit_addresses allows ONLY active -> inactive deactivation with all protected columns unchanged
  assert.match(
    fnSql,
    /ELSIF TG_TABLE_NAME = 'deposit_addresses' THEN[\s\S]*?IF TG_OP = 'UPDATE'[\s\S]*?OLD\.is_active = TRUE[\s\S]*?NEW\.is_active = FALSE[\s\S]*?NEW\.id IS NOT DISTINCT FROM OLD\.id[\s\S]*?NEW\.user_id IS NOT DISTINCT FROM OLD\.user_id[\s\S]*?NEW\.asset_symbol IS NOT DISTINCT FROM OLD\.asset_symbol[\s\S]*?NEW\.network_code IS NOT DISTINCT FROM OLD\.network_code[\s\S]*?NEW\.custody_vault_id IS NOT DISTINCT FROM OLD\.custody_vault_id[\s\S]*?NEW\.address IS NOT DISTINCT FROM OLD\.address[\s\S]*?NEW\.memo_or_tag IS NOT DISTINCT FROM OLD\.memo_or_tag[\s\S]*?NEW\.created_at IS NOT DISTINCT FROM OLD\.created_at/i
  );

  for (const table of [
    'wallet_balances',
    'deposits',
    'withdrawals',
    'spot_orders',
    'deposit_addresses',
  ]) {
    assert.match(
      m008,
      new RegExp(
        `CREATE TRIGGER trg_guard_closed_account_${table}\\s+BEFORE INSERT OR UPDATE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.guard_closed_account_obligation_write\\(\\);`,
        'i'
      )
    );
  }
});

test('Phase 1.2 (008) [STATIC SQL] CD-3: approval_requests triggers lock requester, acting admin, and targets in ascending UUID order before checking actor status', async () => {
  const m008 = await readMigration('008_closed_account_integrity_hardening.sql');

  const enforceMatch = m008.match(
    /CREATE OR REPLACE FUNCTION public\.enforce_approval_request_rules\(\)[\s\S]*?\$\$;/i
  );
  assert.ok(enforceMatch, 'enforce_approval_request_rules() must exist in 008');
  const enforceSql = enforceMatch[0];

  // Must lock profiles in ascending order on INSERT (before v_requester_is_admin) and UPDATE (before v_actor_is_admin)
  const lockMatches = [
    ...enforceSql.matchAll(/ORDER BY p\.id ASC\s+FOR KEY SHARE OF p/gi),
  ];
  assert.equal(lockMatches.length, 2, 'enforce_approval_request_rules() must lock profiles in ascending UUID order on both INSERT and UPDATE');

  const insertCheckIdx = enforceSql.search(/INTO v_requester_is_admin/i);
  const updateActorCheckIdx = enforceSql.search(/INTO v_actor_is_admin,\s*v_actor_is_super_admin/i);
  assert.ok((lockMatches[0].index ?? -1) < insertCheckIdx, 'INSERT profile lock must precede requester admin role check');
  assert.ok((lockMatches[1].index ?? -1) < updateActorCheckIdx, 'UPDATE profile lock (including v_actor_id) must precede actor admin role check');
  assert.match(enforceSql, /OR p\.id = v_actor_id/i);
  assert.match(enforceSql, /IF v_actor_status IS DISTINCT FROM 'active' THEN/i);
  assert.match(enforceSql, /IF v_requester_status IS DISTINCT FROM 'active' THEN/i);

  // Preserves L-1 timestamp hygiene & maker-checker rules
  assert.match(enforceSql, /NEW\.approved_at := COALESCE\(NEW\.approved_at, NOW\(\)\);/i);
  assert.match(enforceSql, /NEW\.rejected_at := COALESCE\(NEW\.rejected_at, NOW\(\)\);/i);
  assert.match(enforceSql, /NEW\.cancelled_at := COALESCE\(NEW\.cancelled_at, NOW\(\)\);/i);
  assert.match(enforceSql, /NEW\.executed_at := COALESCE\(NEW\.executed_at, NOW\(\)\);/i);
  assert.match(enforceSql, /NEW\.approved_at IS DISTINCT FROM OLD\.approved_at/i);

  const guardMatch = m008.match(
    /CREATE OR REPLACE FUNCTION public\.guard_closed_account_approval_request_write\(\)[\s\S]*?\$\$;/i
  );
  assert.ok(guardMatch, 'guard_closed_account_approval_request_write() must exist in 008');
  const guardSql = guardMatch[0];

  assert.match(guardSql, /WHEN 'APPROVED' THEN NEW\.approved_by/i);
  assert.match(guardSql, /WHEN 'REJECTED' THEN NEW\.rejected_by/i);
  assert.match(guardSql, /WHEN 'EXECUTED' THEN NEW\.executed_by/i);
  assert.match(guardSql, /WHEN 'CANCELLED' THEN NEW\.cancelled_by/i);
  assert.match(guardSql, /OR \(v_actor_id IS NOT NULL AND p\.id = v_actor_id\)/i);
  assert.match(guardSql, /ORDER BY p\.id ASC\s+FOR KEY SHARE OF p/i);
  assert.match(guardSql, /IF v_actor_id IS NOT NULL AND v_profile\.id = v_actor_id AND v_profile\.account_status <> 'active' THEN/i);

  // Alphabetical trigger firing: trg_enforce_approval_request_rules fires before trg_guard_closed_account_approval_requests
  assert.match(
    m008,
    /CREATE TRIGGER trg_enforce_approval_request_rules\s+BEFORE INSERT OR UPDATE ON public\.approval_requests\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_approval_request_rules\(\);/i
  );
  assert.match(
    m008,
    /CREATE TRIGGER trg_guard_closed_account_approval_requests\s+BEFORE INSERT OR UPDATE ON public\.approval_requests\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_closed_account_approval_request_write\(\);/i
  );
});

test('Phase 2.5 (009) [STATIC SQL]: validates manual purchase schema, duplicate tx_hash index, immutable order trigger, RLS, and search_path pinning without altering 001-008', async () => {
  const m009 = await readMigration('009_manual_crypto_purchases.sql');
  assert.ok(m009.trim().length > 0, '009_manual_crypto_purchases.sql must not be empty');
  checkBalancedDelimiters(m009);

  for (const table of [
    'receiving_addresses',
    'receiving_address_audit_logs',
    'manual_purchase_orders',
    'manual_purchase_order_events',
  ]) {
    assert.match(
      m009,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, 'i'),
      `Missing table ${table} in 009`
    );
    assert.match(
      m009,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, 'i'),
      `Missing ENABLE ROW LEVEL SECURITY for ${table}`
    );
  }

  assert.match(
    m009,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_purchase_orders_network_tx_hash\s+ON public\.manual_purchase_orders\s*\(receiving_network,\s*LOWER\(payment_tx_hash\)\)\s+WHERE payment_tx_hash IS NOT NULL AND status NOT IN \('REJECTED', 'CANCELLED'\);/i
  );

  assert.match(
    m009,
    /CREATE OR REPLACE FUNCTION public\.enforce_manual_purchase_order_rules\(\)[\s\S]*?SET search_path = public/i
  );
  assert.match(
    m009,
    /REVOKE ALL ON FUNCTION public\.enforce_manual_purchase_order_rules\(\) FROM PUBLIC, anon, authenticated;/i
  );
  assert.match(
    m009,
    /CREATE TRIGGER trg_enforce_manual_purchase_order_rules\s+BEFORE INSERT OR UPDATE ON public\.manual_purchase_orders/i
  );
  assert.match(
    m009,
    /CREATE TRIGGER trg_prevent_delete_manual_purchase_orders\s+BEFORE DELETE ON public\.manual_purchase_orders/i
  );
});


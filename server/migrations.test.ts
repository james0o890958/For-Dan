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

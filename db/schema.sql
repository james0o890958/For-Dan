-- PostgreSQL Production Schema for Real Cryptocurrency Exchange (Phase A Blueprint)
-- Enforces balance segregation (available + reserved), append-only ledger immutability,
-- verified blockchain deposit tracking, multi-stage withdrawal approvals, and audit logging.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Accounts & RBAC
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_user_id VARCHAR(20) NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_encrypted TEXT,
  account_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  kyc_status VARCHAR(20) NOT NULL DEFAULT 'not_submitted' CHECK (kyc_status IN ('not_submitted', 'pending', 'approved', 'rejected')),
  preferred_language VARCHAR(32) NOT NULL DEFAULT 'English',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL CHECK (role IN ('customer', 'super_admin', 'operations_admin', 'finance_admin', 'compliance_admin')),
  assigned_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role)
);

-- 2. KYC & Sanctions Screening
CREATE TABLE IF NOT EXISTS kyc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider_name VARCHAR(64) NOT NULL,
  provider_applicant_id TEXT,
  full_name TEXT NOT NULL,
  country VARCHAR(100) NOT NULL,
  document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('National ID', 'Passport', 'Driver License')),
  document_number_hash TEXT NOT NULL,
  sanctions_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (sanctions_status IN ('pending', 'clear', 'match')),
  liveness_passed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Assets, Networks & Trading Pairs
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(16) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals >= 0 AND decimals <= 18),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  badge_color VARCHAR(16) NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  contract_address TEXT,
  required_confirmations INTEGER NOT NULL CHECK (required_confirmations > 0),
  min_deposit NUMERIC(36, 18) NOT NULL CHECK (min_deposit >= 0),
  min_withdrawal NUMERIC(36, 18) NOT NULL CHECK (min_withdrawal > 0),
  network_fee NUMERIC(36, 18) NOT NULL CHECK (network_fee >= 0),
  platform_fee NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  address_regex TEXT NOT NULL,
  memo_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_deposit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_withdrawal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trading_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(32) NOT NULL UNIQUE,
  base_asset VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  quote_asset VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  fee_rate NUMERIC(10, 6) NOT NULL CHECK (fee_rate >= 0 AND fee_rate <= 0.05),
  min_order_usdt NUMERIC(36, 18) NOT NULL CHECK (min_order_usdt > 0),
  venue_symbol VARCHAR(32) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. Segregated Wallet Balances (Available + Reserved)
CREATE TABLE IF NOT EXISTS wallet_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  available NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_symbol)
);

-- 5. Custody Deposit Addresses & Verified Blockchain Deposits
CREATE TABLE IF NOT EXISTS deposit_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES networks(code),
  custody_vault_id TEXT NOT NULL,
  address TEXT NOT NULL,
  memo_or_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network_code, address, COALESCE(memo_or_tag, '')),
  UNIQUE (user_id, asset_symbol, network_code)
);

CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES networks(code),
  deposit_address TEXT NOT NULL,
  memo_or_tag TEXT,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  from_address TEXT,
  amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
  confirmations INTEGER NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  required_confirmations INTEGER NOT NULL CHECK (required_confirmations > 0),
  address_verified BOOLEAN NOT NULL DEFAULT FALSE,
  network_verified BOOLEAN NOT NULL DEFAULT FALSE,
  amount_verified BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_checked BOOLEAN NOT NULL DEFAULT FALSE,
  kyt_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (kyt_status IN ('pending', 'passed', 'flagged')),
  kyt_risk_score NUMERIC(5, 2),
  status VARCHAR(32) NOT NULL CHECK (status IN (
    'PENDING_DETECTION',
    'DETECTED',
    'AWAITING_CONFIRMATIONS',
    'PENDING_ADMIN_REVIEW',
    'APPROVED',
    'REJECTED',
    'CREDITED'
  )),
  admin_note TEXT,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  credited_tx_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network_code, tx_hash, log_index)
);

-- 6. Real Cryptocurrency Withdrawals & Dual-Admin Approvals
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES networks(code),
  destination_address TEXT NOT NULL,
  memo_or_tag TEXT,
  gross_amount NUMERIC(36, 18) NOT NULL CHECK (gross_amount > 0),
  network_fee NUMERIC(36, 18) NOT NULL CHECK (network_fee >= 0),
  platform_fee NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  net_amount NUMERIC(36, 18) NOT NULL CHECK (net_amount > 0),
  two_factor_verified BOOLEAN NOT NULL DEFAULT FALSE,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  kyt_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (kyt_status IN ('pending', 'passed', 'flagged')),
  required_approvals INTEGER NOT NULL DEFAULT 1 CHECK (required_approvals IN (1, 2)),
  custody_tx_id TEXT,
  tx_hash TEXT,
  confirmations INTEGER NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  required_confirmations INTEGER NOT NULL CHECK (required_confirmations > 0),
  status VARCHAR(32) NOT NULL CHECK (status IN (
    'REQUESTED',
    'RISK_REVIEW',
    'PENDING_ADMIN_APPROVAL',
    'APPROVED',
    'PROCESSING',
    'BROADCAST',
    'CONFIRMING',
    'COMPLETED',
    'REJECTED',
    'CANCELLED',
    'FAILED',
    'REFUNDED'
  )),
  failure_reason TEXT,
  rejection_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawal_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES withdrawals(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES profiles(id),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (withdrawal_id, admin_user_id)
);

-- 7. Spot Orders & External Venue Execution Records
CREATE TABLE IF NOT EXISTS spot_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  pair_symbol VARCHAR(32) NOT NULL REFERENCES trading_pairs(symbol),
  side VARCHAR(8) NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type VARCHAR(16) NOT NULL DEFAULT 'MARKET' CHECK (order_type IN ('MARKET')),
  requested_amount NUMERIC(36, 18) NOT NULL CHECK (requested_amount > 0),
  reserved_asset VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  reserved_amount NUMERIC(36, 18) NOT NULL CHECK (reserved_amount >= 0),
  filled_base_qty NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (filled_base_qty >= 0),
  filled_quote_amount NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (filled_quote_amount >= 0),
  fee_usdt NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (fee_usdt >= 0),
  venue_name TEXT,
  venue_order_id TEXT,
  status VARCHAR(24) NOT NULL CHECK (status IN ('SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED')),
  reject_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES spot_orders(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  pair_symbol VARCHAR(32) NOT NULL REFERENCES trading_pairs(symbol),
  side VARCHAR(8) NOT NULL CHECK (side IN ('buy', 'sell')),
  base_asset VARCHAR(16) NOT NULL,
  quote_asset VARCHAR(16) NOT NULL,
  executed_price NUMERIC(36, 18) NOT NULL CHECK (executed_price > 0),
  base_quantity NUMERIC(36, 18) NOT NULL CHECK (base_quantity > 0),
  quote_amount NUMERIC(36, 18) NOT NULL CHECK (quote_amount > 0),
  fee_usdt NUMERIC(36, 18) NOT NULL CHECK (fee_usdt >= 0),
  total_usdt NUMERIC(36, 18) NOT NULL CHECK (total_usdt > 0),
  venue_trade_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Immutable Double-Entry Ledger
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  type VARCHAR(32) NOT NULL CHECK (type IN (
    'deposit_credit',
    'withdrawal_reserve',
    'withdrawal_release',
    'withdrawal_settle',
    'withdrawal_refund',
    'spot_buy',
    'spot_sell',
    'trading_fee',
    'adjustment',
    'reversal'
  )),
  reference_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_account VARCHAR(64) NOT NULL DEFAULT 'customer_wallet',
  reason_code TEXT,
  reversal_of_tx_id UUID REFERENCES ledger_transactions(id),
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES assets(symbol),
  bucket VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (bucket IN ('available', 'reserved', 'platform_fee', 'omnibus')),
  delta_amount NUMERIC(36, 18) NOT NULL,
  balance_after NUMERIC(36, 18) NOT NULL CHECK (balance_after >= 0),
  entry_role VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Reconciliation & Audit Logging
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(32) NOT NULL CHECK (scope IN ('ledger_vs_balances', 'ledger_vs_custody', 'trades_vs_venue')),
  asset_symbol VARCHAR(16),
  expected_total NUMERIC(36, 18) NOT NULL,
  observed_total NUMERIC(36, 18) NOT NULL,
  discrepancy NUMERIC(36, 18) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('matched', 'mismatch', 'unconfigured')),
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES profiles(id),
  admin_label TEXT NOT NULL,
  action VARCHAR(64) NOT NULL,
  affected_user_id UUID REFERENCES profiles(id),
  affected_public_user_id VARCHAR(20),
  record_type VARCHAR(64) NOT NULL,
  record_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Append-Only Immutability Triggers for Ledger & Audit Logs
CREATE OR REPLACE FUNCTION prevent_immutable_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are append-only and immutable. Use a reversal or adjustment transaction instead.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_ledger_transactions ON ledger_transactions;
CREATE TRIGGER trg_immutable_ledger_transactions
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_immutable_ledger_entries ON ledger_entries;
CREATE TRIGGER trg_immutable_ledger_entries
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_immutable_audit_logs ON admin_audit_logs;
CREATE TRIGGER trg_immutable_audit_logs
  BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

-- 001_core_exchange_schema.sql
-- Version-controlled core PostgreSQL schema for Supabase integration.
-- Fixes:
--   1. Links public.profiles directly to Supabase auth.users(id) with no local password hashes.
--   2. Replaces invalid inline COALESCE(...) UNIQUE constraint on deposit_addresses with a functional unique index.
--   3. Uses native PostgreSQL gen_random_uuid() instead of requiring public.pgcrypto.
--   4. Standardizes admin role values and enforces append-only immutability triggers.

-- 0. Phone Normalization Helper (M-1)
CREATE OR REPLACE FUNCTION public.normalize_phone_e164(raw_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_cleaned TEXT;
BEGIN
  IF raw_phone IS NULL THEN
    RETURN NULL;
  END IF;

  v_cleaned := regexp_replace(BTRIM(raw_phone), '[\s().-]+', '', 'g');
  IF v_cleaned = '' THEN
    RETURN NULL;
  END IF;

  IF v_cleaned !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'Invalid phone number format (%). Use international E.164 format (e.g. +15550102030).', raw_phone
      USING ERRCODE = '22023';
  END IF;

  RETURN v_cleaned;
END;
$$;

-- 1. Accounts & Database-Backed RBAC
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_user_id VARCHAR(20) NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_encrypted TEXT,
  account_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'closed')),
  kyc_status VARCHAR(20) NOT NULL DEFAULT 'not_submitted' CHECK (kyc_status IN ('not_submitted', 'pending', 'approved', 'rejected')),
  preferred_language VARCHAR(32) NOT NULL DEFAULT 'English',
  closed_at TIMESTAMPTZ,
  anonymized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_profiles_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$')
);

-- Non-destructive compatibility guard if profiles was created from an earlier draft
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'password_hash'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN password_hash DROP NOT NULL';
  END IF;

  ALTER TABLE public.profiles ALTER COLUMN phone DROP NOT NULL;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_account_status_check CHECK (account_status IN ('active', 'suspended', 'closed'));

  -- Normalize pre-existing phone strings safely and clear unparseable legacy placeholders
  UPDATE public.profiles
  SET phone = CASE
    WHEN phone IS NULL OR BTRIM(phone) = '' THEN NULL
    WHEN regexp_replace(BTRIM(phone), '[\s().-]+', '', 'g') ~ '^\+[1-9][0-9]{6,14}$'
      THEN regexp_replace(BTRIM(phone), '[\s().-]+', '', 'g')
    ELSE NULL
  END
  WHERE phone IS NOT NULL
    AND (
      BTRIM(phone) = ''
      OR phone <> regexp_replace(BTRIM(phone), '[\s().-]+', '', 'g')
      OR regexp_replace(BTRIM(phone), '[\s().-]+', '', 'g') !~ '^\+[1-9][0-9]{6,14}$'
    );

  -- Preserve oldest account on any legacy phone collisions before applying partial unique index
  WITH ranked_phones AS (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC, id ASC) AS rn
    FROM public.profiles
    WHERE phone IS NOT NULL
  )
  UPDATE public.profiles p
  SET phone = NULL
  FROM ranked_phones rp
  WHERE p.id = rp.id
    AND rp.rn > 1;

  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS chk_profiles_phone_e164;
  ALTER TABLE public.profiles
    ADD CONSTRAINT chk_profiles_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_phone_normalized
  ON public.profiles (phone)
  WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL CHECK (role IN ('customer', 'super_admin', 'operations_admin', 'finance_admin', 'compliance_admin')),
  assigned_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role)
);

-- 2. KYC & Sanctions Screening
CREATE TABLE IF NOT EXISTS public.kyc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Assets, Networks & Trading Pairs
CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(16) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals >= 0 AND decimals <= 18),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  badge_color VARCHAR(16) NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
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

CREATE TABLE IF NOT EXISTS public.trading_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(32) NOT NULL UNIQUE,
  base_asset VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  quote_asset VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  fee_rate NUMERIC(10, 6) NOT NULL CHECK (fee_rate >= 0 AND fee_rate <= 0.05),
  min_order_usdt NUMERIC(36, 18) NOT NULL CHECK (min_order_usdt > 0),
  venue_symbol VARCHAR(32),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. Segregated Wallet Balances (Available + Reserved)
CREATE TABLE IF NOT EXISTS public.wallet_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  available NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_symbol)
);

-- 5. Custody Deposit Addresses & Blockchain Deposits
CREATE TABLE IF NOT EXISTS public.deposit_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES public.networks(code),
  custody_vault_id TEXT NOT NULL,
  address TEXT NOT NULL,
  memo_or_tag TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_symbol, network_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_addresses_network_addr_memo
  ON public.deposit_addresses (network_code, address, COALESCE(memo_or_tag, ''));

CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES public.networks(code),
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
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  credited_tx_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network_code, tx_hash, log_index)
);

-- 6. Withdrawals & Dual-Admin Approvals
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES public.networks(code),
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

CREATE TABLE IF NOT EXISTS public.withdrawal_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES public.withdrawals(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (withdrawal_id, admin_user_id)
);

-- 7. Spot Orders & Trades
CREATE TABLE IF NOT EXISTS public.spot_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pair_symbol VARCHAR(32) NOT NULL REFERENCES public.trading_pairs(symbol),
  side VARCHAR(8) NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type VARCHAR(16) NOT NULL DEFAULT 'MARKET' CHECK (order_type IN ('MARKET', 'LIMIT')),
  requested_amount NUMERIC(36, 18) NOT NULL CHECK (requested_amount > 0),
  reserved_asset VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  reserved_amount NUMERIC(36, 18) NOT NULL CHECK (reserved_amount >= 0),
  filled_base_qty NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (filled_base_qty >= 0),
  filled_quote_amount NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (filled_quote_amount >= 0),
  fee_usdt NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (fee_usdt >= 0),
  venue_name TEXT,
  venue_order_id TEXT,
  status VARCHAR(24) NOT NULL CHECK (status IN ('SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED')),
  reject_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.spot_orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pair_symbol VARCHAR(32) NOT NULL REFERENCES public.trading_pairs(symbol),
  side VARCHAR(8) NOT NULL CHECK (side IN ('buy', 'sell')),
  base_asset VARCHAR(16) NOT NULL,
  quote_asset VARCHAR(16) NOT NULL,
  executed_price NUMERIC(36, 18) NOT NULL CHECK (executed_price > 0),
  base_quantity NUMERIC(36, 18) NOT NULL CHECK (base_quantity > 0),
  quote_amount NUMERIC(36, 18) NOT NULL CHECK (quote_amount > 0),
  fee_usdt NUMERIC(36, 18) NOT NULL CHECK (fee_usdt >= 0),
  total_usdt NUMERIC(36, 18) NOT NULL CHECK (total_usdt > 0),
  venue_trade_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Immutable Double-Entry Ledger
CREATE TABLE IF NOT EXISTS public.ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
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
  reversal_of_tx_id UUID REFERENCES public.ledger_transactions(id),
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  bucket VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (bucket IN ('available', 'reserved', 'platform_fee', 'omnibus')),
  delta_amount NUMERIC(36, 18) NOT NULL,
  balance_after NUMERIC(36, 18) NOT NULL CHECK (balance_after >= 0),
  entry_role VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Notifications, Reconciliation & Audit Logging
CREATE TABLE IF NOT EXISTS public.notification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(32) NOT NULL CHECK (category IN ('Account', 'Deposit', 'Withdrawal', 'KYC', 'Market', 'Compliance', 'Notice')),
  recipient_type VARCHAR(32) NOT NULL CHECK (recipient_type IN ('everyone', 'selected_group', 'individual')),
  filter_summary TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.notification_campaigns(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(32) NOT NULL CHECK (category IN ('Account', 'Deposit', 'Withdrawal', 'KYC', 'Market', 'Compliance', 'Notice')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(48) NOT NULL,
  asset_symbol VARCHAR(16),
  expected_total NUMERIC(36, 18) NOT NULL,
  observed_total NUMERIC(36, 18) NOT NULL,
  discrepancy NUMERIC(36, 18) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('matched', 'mismatch', 'unconfigured')),
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  admin_label TEXT NOT NULL,
  action VARCHAR(64) NOT NULL,
  affected_user_id UUID,
  affected_public_user_id VARCHAR(20),
  record_type VARCHAR(64) NOT NULL,
  record_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compatibility guard: decouple historical actor/audit UUIDs from blocking profile deletions
DO $$
BEGIN
  ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_assigned_by_fkey;
  ALTER TABLE public.kyc_submissions DROP CONSTRAINT IF EXISTS kyc_submissions_reviewed_by_fkey;
  ALTER TABLE public.deposits DROP CONSTRAINT IF EXISTS deposits_reviewed_by_fkey;
  ALTER TABLE public.withdrawal_approvals DROP CONSTRAINT IF EXISTS withdrawal_approvals_admin_user_id_fkey;
  ALTER TABLE public.notification_campaigns DROP CONSTRAINT IF EXISTS notification_campaigns_created_by_fkey;
  ALTER TABLE public.admin_audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_admin_user_id_fkey;
  ALTER TABLE public.admin_audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_affected_user_id_fkey;
END $$;

-- 10. Append-Only Immutability Triggers
CREATE OR REPLACE FUNCTION public.prevent_immutable_record_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are append-only and immutable. Use a reversal or adjustment transaction instead.', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_ledger_transactions ON public.ledger_transactions;
CREATE TRIGGER trg_immutable_ledger_transactions
  BEFORE UPDATE OR DELETE ON public.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_immutable_ledger_entries ON public.ledger_entries;
CREATE TRIGGER trg_immutable_ledger_entries
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_immutable_audit_logs ON public.admin_audit_logs;
CREATE TRIGGER trg_immutable_audit_logs
  BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

-- 11. Safe Account Closure & Optional PII Anonymization (Preserves Financial & Ledger History)
CREATE OR REPLACE FUNCTION public.close_customer_account(
  p_user_id UUID,
  p_anonymize_pii BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_public_user_id VARCHAR(20);
BEGIN
  SELECT public_user_id
  INTO v_public_user_id
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account profile (%) does not exist.', p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wallet_balances
    WHERE user_id = p_user_id
      AND (available > 0 OR reserved > 0)
  ) THEN
    RAISE EXCEPTION 'Cannot close account (%): non-zero available or reserved wallet balances remain.', p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.spot_orders
    WHERE user_id = p_user_id
      AND status IN ('SUBMITTED', 'PARTIALLY_FILLED')
  ) THEN
    RAISE EXCEPTION 'Cannot close account (%): open spot orders remain.', p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.withdrawals
    WHERE user_id = p_user_id
      AND status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED', 'REFUNDED')
  ) THEN
    RAISE EXCEPTION 'Cannot close account (%): in-flight withdrawal requests remain.', p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.deposits
    WHERE user_id = p_user_id
      AND status NOT IN ('CREDITED', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'Cannot close account (%): unresolved deposit records remain.', p_user_id;
  END IF;

  UPDATE public.profiles
  SET
    account_status = 'closed',
    closed_at = COALESCE(closed_at, NOW()),
    full_name = CASE WHEN p_anonymize_pii THEN 'Closed Account' ELSE full_name END,
    email = CASE WHEN p_anonymize_pii THEN 'closed+' || v_public_user_id || '@anonymized.local' ELSE email END,
    phone = CASE WHEN p_anonymize_pii THEN NULL ELSE phone END,
    totp_enabled = FALSE,
    totp_secret_encrypted = NULL,
    anonymized_at = CASE WHEN p_anonymize_pii THEN COALESCE(anonymized_at, NOW()) ELSE anonymized_at END,
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

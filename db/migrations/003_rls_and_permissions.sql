-- 003_rls_and_permissions.sql
-- Locks down Supabase PostgREST public access and establishes explicit Row Level Security (RLS)
-- policies. All financial writes (balances, ledger, trades, withdrawals, deposits, treasury,
-- inventory, audit logs) must execute strictly through server-side PostgreSQL transactions.

-- 1. Revoke unsafe default permissions on public tables from Supabase client roles
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Grant read access only to tables with explicit customer/catalog SELECT policies.
-- Sensitive/internal columns (profiles.totp_secret_encrypted, kyc_submissions.provider_applicant_id,
-- kyc_submissions.document_number_hash, deposit_addresses.custody_vault_id) are excluded below.
GRANT SELECT ON TABLE
  public.user_roles,
  public.assets,
  public.networks,
  public.trading_pairs,
  public.market_prices,
  public.wallet_balances,
  public.deposits,
  public.withdrawals,
  public.spot_orders,
  public.trades,
  public.ledger_transactions,
  public.ledger_entries,
  public.notifications
TO authenticated;

REVOKE SELECT ON TABLE
  public.profiles,
  public.kyc_submissions,
  public.deposit_addresses
FROM anon, authenticated;

GRANT SELECT (
  id,
  public_user_id,
  email,
  full_name,
  phone,
  totp_enabled,
  account_status,
  kyc_status,
  preferred_language,
  created_at,
  updated_at
) ON TABLE public.profiles TO authenticated;

GRANT SELECT (
  id,
  user_id,
  provider_name,
  full_name,
  country,
  document_type,
  sanctions_status,
  liveness_passed,
  status,
  rejection_reason,
  reviewed_by,
  reviewed_at,
  submitted_at
) ON TABLE public.kyc_submissions TO authenticated;

GRANT SELECT (
  id,
  user_id,
  asset_symbol,
  network_code,
  address,
  memo_or_tag,
  is_active,
  created_at
) ON TABLE public.deposit_addresses TO authenticated;

GRANT SELECT ON TABLE
  public.assets,
  public.networks,
  public.trading_pairs,
  public.market_prices
TO anon;

GRANT UPDATE (is_read, read_at) ON TABLE public.notifications TO authenticated;

-- 2. Database-Backed Active Administrator & Role-Specific Helpers (Bound strictly to auth.uid())
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
DROP POLICY IF EXISTS kyc_select_own ON public.kyc_submissions;
DROP POLICY IF EXISTS wallet_balances_select_own ON public.wallet_balances;
DROP POLICY IF EXISTS deposit_addresses_select_own ON public.deposit_addresses;
DROP POLICY IF EXISTS deposits_select_own ON public.deposits;
DROP POLICY IF EXISTS withdrawals_select_own ON public.withdrawals;
DROP POLICY IF EXISTS spot_orders_select_own ON public.spot_orders;
DROP POLICY IF EXISTS trades_select_own ON public.trades;
DROP POLICY IF EXISTS ledger_tx_select_own ON public.ledger_transactions;
DROP POLICY IF EXISTS ledger_entries_select_own ON public.ledger_entries;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
DROP POLICY IF EXISTS assets_public_read ON public.assets;
DROP POLICY IF EXISTS networks_public_read ON public.networks;
DROP POLICY IF EXISTS pairs_public_read ON public.trading_pairs;
DROP POLICY IF EXISTS market_prices_public_read ON public.market_prices;

DO $$
BEGIN
  IF to_regclass('public.auth_security_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS auth_security_events_admin_read ON public.auth_security_events';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.is_admin_user(UUID);

CREATE OR REPLACE FUNCTION public.has_admin_role(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.user_id = auth.uid()
        AND p.account_status = 'active'
        AND ur.role = ANY(allowed_roles)
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_role(ARRAY['super_admin', 'operations_admin', 'finance_admin', 'compliance_admin']);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_role(ARRAY['super_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_read_kyc_records()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_role(ARRAY['super_admin', 'compliance_admin', 'operations_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_read_financial_records()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_role(ARRAY['super_admin', 'finance_admin', 'operations_admin', 'compliance_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_read_security_events()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_role(ARRAY['super_admin', 'compliance_admin', 'operations_admin']);
$$;

REVOKE ALL ON FUNCTION public.has_admin_role(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_kyc_records() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_financial_records() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_security_events() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_kyc_records() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_financial_records() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_security_events() TO authenticated;

-- Revoke direct execute privileges on internal trigger/maintenance functions from client roles
REVOKE ALL ON FUNCTION public.prevent_immutable_record_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_treasury_funding_approval_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_approval_request_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_customer_account(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- 3. Enable RLS on all exchange tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spot_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_funding_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated';
  END IF;
END $$;

-- 4. Explicit Least-Privilege Policies (Zero-argument, active-status, role-scoped)
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin_user());

CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin());

CREATE POLICY kyc_select_own ON public.kyc_submissions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_kyc_records());

CREATE POLICY wallet_balances_select_own ON public.wallet_balances
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY deposit_addresses_select_own ON public.deposit_addresses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY deposits_select_own ON public.deposits
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY withdrawals_select_own ON public.withdrawals
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY spot_orders_select_own ON public.spot_orders
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY trades_select_own ON public.trades
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY ledger_tx_select_own ON public.ledger_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY ledger_entries_select_own ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.can_read_financial_records());

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Public Catalog Read Policies (Enabled records only)
CREATE POLICY assets_public_read ON public.assets
  FOR SELECT TO anon, authenticated
  USING (is_enabled = TRUE OR public.is_admin_user());

CREATE POLICY networks_public_read ON public.networks
  FOR SELECT TO anon, authenticated
  USING (TRUE);

CREATE POLICY pairs_public_read ON public.trading_pairs
  FOR SELECT TO anon, authenticated
  USING (is_enabled = TRUE OR public.is_admin_user());

CREATE POLICY market_prices_public_read ON public.market_prices
  FOR SELECT TO anon, authenticated
  USING (TRUE);

-- 006_security_and_rls_hardening.sql
-- Phase 1 forward security & RLS hardening migration.
-- Migrations 001-005 remain unmodified; all fixes are applied idempotently forward here.

-- =============================================================================
-- 1. Public Asset & Trading-Pair Catalog RLS (Anon-Safe without Admin EXECUTE)
-- =============================================================================
-- Split anon vs authenticated catalog policies so anonymous requests never trigger
-- evaluation of public.is_admin_user() (whose EXECUTE is restricted to authenticated).

DROP POLICY IF EXISTS assets_public_read ON public.assets;
DROP POLICY IF EXISTS assets_anon_read ON public.assets;
DROP POLICY IF EXISTS assets_authenticated_read ON public.assets;

CREATE POLICY assets_anon_read ON public.assets
  FOR SELECT TO anon
  USING (is_enabled = TRUE);

CREATE POLICY assets_authenticated_read ON public.assets
  FOR SELECT TO authenticated
  USING (is_enabled = TRUE OR public.is_admin_user());

DROP POLICY IF EXISTS pairs_public_read ON public.trading_pairs;
DROP POLICY IF EXISTS pairs_anon_read ON public.trading_pairs;
DROP POLICY IF EXISTS pairs_authenticated_read ON public.trading_pairs;

CREATE POLICY pairs_anon_read ON public.trading_pairs
  FOR SELECT TO anon
  USING (is_enabled = TRUE);

CREATE POLICY pairs_authenticated_read ON public.trading_pairs
  FOR SELECT TO authenticated
  USING (is_enabled = TRUE OR public.is_admin_user());

-- =============================================================================
-- 2. Active-Account RLS Enforcement for Customer-Owned Records
-- =============================================================================
-- Prevents suspended or closed accounts from reading/updating protected customer
-- records via direct Supabase PostgREST requests while preserving role-scoped
-- active admin access.

CREATE OR REPLACE FUNCTION public.is_active_account()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_account() TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING ((auth.uid() = id AND account_status = 'active') OR public.is_admin_user());

DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.is_super_admin());

DROP POLICY IF EXISTS kyc_select_own ON public.kyc_submissions;
CREATE POLICY kyc_select_own ON public.kyc_submissions
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_kyc_records());

DROP POLICY IF EXISTS wallet_balances_select_own ON public.wallet_balances;
CREATE POLICY wallet_balances_select_own ON public.wallet_balances
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS deposit_addresses_select_own ON public.deposit_addresses;
CREATE POLICY deposit_addresses_select_own ON public.deposit_addresses
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS deposits_select_own ON public.deposits;
CREATE POLICY deposits_select_own ON public.deposits
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS withdrawals_select_own ON public.withdrawals;
CREATE POLICY withdrawals_select_own ON public.withdrawals
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS spot_orders_select_own ON public.spot_orders;
CREATE POLICY spot_orders_select_own ON public.spot_orders
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS trades_select_own ON public.trades;
CREATE POLICY trades_select_own ON public.trades
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS ledger_tx_select_own ON public.ledger_transactions;
CREATE POLICY ledger_tx_select_own ON public.ledger_transactions
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS ledger_entries_select_own ON public.ledger_entries;
CREATE POLICY ledger_entries_select_own ON public.ledger_entries
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id AND public.is_active_account()) OR public.can_read_financial_records());

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND public.is_active_account());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.is_active_account())
  WITH CHECK (auth.uid() = user_id AND public.is_active_account());

-- =============================================================================
-- 3. Security-Event Retention Guard & Exception-Safe Anonymization
-- =============================================================================
-- Fixes the NULL-unsafe "<>" GUC check from migration 005 using IS DISTINCT FROM
-- and makes anonymize_expired_auth_security_events() exception-safe.
-- Security note: A custom GUC (exchange.retention_op) only guards against
-- accidental/ad-hoc mutations by sessions that already hold table UPDATE
-- privileges; it is NOT an authorization boundary against privileged SQL roles
-- (such as postgres/table owner). Client roles (anon, authenticated) have zero
-- UPDATE/DELETE privileges on auth_security_events and zero EXECUTE privileges
-- on retention/anonymization functions.

CREATE OR REPLACE FUNCTION public.guard_auth_security_events_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Records in auth_security_events cannot be deleted; use retention anonymization for expired PII.';
  END IF;

  IF current_setting('exchange.retention_op', true) IS DISTINCT FROM 'anonymize_expired_security_events' THEN
    RAISE EXCEPTION 'Records in auth_security_events are immutable and cannot be modified outside retention anonymization.';
  END IF;

  IF OLD.anonymized_at IS NOT NULL OR OLD.retention_expires_at > NOW() THEN
    RAISE EXCEPTION 'Only un-anonymized, retention-expired auth_security_events rows may be anonymized.';
  END IF;

  IF NEW.anonymized_at IS NULL
     OR NULLIF(BTRIM(COALESCE(NEW.anonymization_reason, '')), '') IS NULL
     OR NEW.identifier_attempted IS NOT NULL
     OR NEW.ip_address IS NOT NULL
     OR NEW.region_state IS NOT NULL
     OR NEW.approximate_city IS NOT NULL
     OR NEW.user_agent_summary IS DISTINCT FROM 'REDACTED_RETENTION'
     OR NEW.ip_intel_error IS NOT NULL THEN
    RAISE EXCEPTION 'Retention anonymization must scrub all PII fields and record anonymized_at and anonymization_reason.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.ip_version IS DISTINCT FROM OLD.ip_version
     OR NEW.ip_source IS DISTINCT FROM OLD.ip_source
     OR NEW.is_geolocation_approximate IS DISTINCT FROM OLD.is_geolocation_approximate
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.country_name IS DISTINCT FROM OLD.country_name
     OR NEW.isp IS DISTINCT FROM OLD.isp
     OR NEW.asn IS DISTINCT FROM OLD.asn
     OR NEW.asn_organization IS DISTINCT FROM OLD.asn_organization
     OR NEW.device_type IS DISTINCT FROM OLD.device_type
     OR NEW.operating_system IS DISTINCT FROM OLD.operating_system
     OR NEW.browser IS DISTINCT FROM OLD.browser
     OR NEW.ip_intel_provider IS DISTINCT FROM OLD.ip_intel_provider
     OR NEW.ip_intel_status IS DISTINCT FROM OLD.ip_intel_status
     OR NEW.vpn_detection_status IS DISTINCT FROM OLD.vpn_detection_status
     OR NEW.proxy_detection_status IS DISTINCT FROM OLD.proxy_detection_status
     OR NEW.tor_detection_status IS DISTINCT FROM OLD.tor_detection_status
     OR NEW.is_vpn IS DISTINCT FROM OLD.is_vpn
     OR NEW.is_proxy IS DISTINCT FROM OLD.is_proxy
     OR NEW.is_residential_proxy IS DISTINCT FROM OLD.is_residential_proxy
     OR NEW.is_datacenter_proxy IS DISTINCT FROM OLD.is_datacenter_proxy
     OR NEW.is_tor IS DISTINCT FROM OLD.is_tor
     OR NEW.location_notice IS DISTINCT FROM OLD.location_notice
     OR NEW.retention_expires_at IS DISTINCT FROM OLD.retention_expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Retention anonymization cannot alter non-PII security telemetry or audit timestamps.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.anonymize_expired_auth_security_events(p_max_rows INTEGER DEFAULT 1000)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_max_rows, 1000), 10000));
  v_prev_retention_op TEXT := current_setting('exchange.retention_op', true);
BEGIN
  PERFORM set_config('exchange.retention_op', 'anonymize_expired_security_events', true);

  BEGIN
    WITH target_rows AS (
      SELECT id
      FROM public.auth_security_events
      WHERE anonymized_at IS NULL
        AND retention_expires_at <= NOW()
      ORDER BY retention_expires_at ASC
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.auth_security_events e
    SET
      identifier_attempted = NULL,
      ip_address = NULL,
      region_state = NULL,
      approximate_city = NULL,
      user_agent_summary = 'REDACTED_RETENTION',
      ip_intel_error = NULL,
      anonymized_at = NOW(),
      anonymization_reason = 'scheduled_90d_retention_scrub'
    FROM target_rows tr
    WHERE e.id = tr.id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('exchange.retention_op', COALESCE(v_prev_retention_op, ''), true);
      RAISE;
  END;

  PERFORM set_config('exchange.retention_op', COALESCE(v_prev_retention_op, ''), true);
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_auth_security_events_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anonymize_expired_auth_security_events(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_ip_intelligence_cache() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 4. Account Closure Hardening
-- =============================================================================
-- Blocks closure when unresolved approval_requests affect the user and
-- deactivates active deposit addresses while preserving historical records/FKs.

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

  IF EXISTS (
    SELECT 1
    FROM public.approval_requests ar
    WHERE ar.status IN ('PENDING_SECOND_APPROVAL', 'APPROVED')
      AND (
        ar.requested_by = p_user_id
        OR ar.target_id = p_user_id::TEXT
        OR ar.target_id = v_public_user_id
        OR ar.payload->>'userId' = p_user_id::TEXT
        OR ar.payload->>'user_id' = p_user_id::TEXT
        OR ar.payload->>'publicUserId' = v_public_user_id
        OR ar.payload->>'public_user_id' = v_public_user_id
        OR (
          ar.target_table = 'wallet_balances'
          AND ar.target_id IN (
            SELECT wb.id::TEXT
            FROM public.wallet_balances wb
            WHERE wb.user_id = p_user_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot close account (%): unresolved approval requests remain.', p_user_id;
  END IF;

  UPDATE public.deposit_addresses
  SET is_active = FALSE
  WHERE user_id = p_user_id
    AND is_active = TRUE;

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

REVOKE ALL ON FUNCTION public.close_customer_account(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 5. Treasury Funding Approval Integrity Hardening
-- =============================================================================
-- Freezes decision_note and rejection timestamps during APPROVED -> CONFIRMED
-- and validates null timestamp/actor invariants across transitions.

CREATE OR REPLACE FUNCTION public.enforce_treasury_funding_approval_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_is_admin BOOLEAN;
  v_actor_id UUID;
  v_actor_is_admin BOOLEAN;
  v_actor_is_super_admin BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_APPROVAL' THEN
      RAISE EXCEPTION 'New treasury funding request (%) must start in PENDING_APPROVAL status (received %).', NEW.id, NEW.status;
    END IF;

    IF NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.confirmed_by IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL
       OR NEW.decision_note IS NOT NULL THEN
      RAISE EXCEPTION 'New treasury funding request cannot pre-populate approval, rejection, or confirmation fields.';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.user_id = NEW.requested_by
        AND p.account_status = 'active'
        AND ur.role IN ('super_admin', 'operations_admin', 'finance_admin', 'compliance_admin')
    )
    INTO v_requester_is_admin;

    IF NOT v_requester_is_admin THEN
      RAISE EXCEPTION 'Treasury funding requester (%) must be an active authorized administrator.', NEW.requested_by;
    END IF;

    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE': Freeze immutable request parameters
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.treasury_wallet_id IS DISTINCT FROM OLD.treasury_wallet_id
     OR NEW.asset_symbol IS DISTINCT FROM OLD.asset_symbol
     OR NEW.network_code IS DISTINCT FROM OLD.network_code
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable treasury funding request fields cannot be modified after creation.';
  END IF;

  -- Terminal states cannot be modified or reversed
  IF OLD.status IN ('CONFIRMED', 'REJECTED') THEN
    RAISE EXCEPTION 'Treasury funding request in terminal status % cannot be modified.', OLD.status;
  END IF;

  -- Reject in-place decision tampering without a valid state transition
  IF NEW.status = OLD.status THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
       OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
       OR NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
      RAISE EXCEPTION 'Treasury funding decision fields cannot be modified without a valid status transition.';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- Enforce strictly monotonic state transitions
  IF OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED' THEN
    IF NEW.approved_by IS NULL
       OR NEW.confirmed_by IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL THEN
      RAISE EXCEPTION 'PENDING_APPROVAL -> APPROVED requires approved_by and null confirmed/rejected attribution.';
    END IF;
    v_actor_id := NEW.approved_by;
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
  ELSIF OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' THEN
    IF NEW.rejected_by IS NULL OR NULLIF(BTRIM(COALESCE(NEW.decision_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'PENDING_APPROVAL -> REJECTED requires rejected_by and a non-empty decision_note.';
    END IF;
    IF NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.confirmed_by IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Rejected treasury funding request cannot record approved or confirmed attribution.';
    END IF;
    v_actor_id := NEW.rejected_by;
    NEW.rejected_at := COALESCE(NEW.rejected_at, NOW());
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'CONFIRMED' THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.decision_note IS DISTINCT FROM OLD.decision_note
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL THEN
      RAISE EXCEPTION 'Original approval attribution and decision_note cannot be altered during confirmation.';
    END IF;
    IF NEW.confirmed_by IS NULL THEN
      RAISE EXCEPTION 'APPROVED -> CONFIRMED requires confirmed_by.';
    END IF;
    v_actor_id := NEW.confirmed_by;
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
  ELSE
    RAISE EXCEPTION 'Invalid treasury funding status transition: % -> %.', OLD.status, NEW.status;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.user_id = v_actor_id
        AND p.account_status = 'active'
        AND ur.role IN ('super_admin', 'operations_admin', 'finance_admin', 'compliance_admin')
    ),
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.user_id = v_actor_id
        AND p.account_status = 'active'
        AND ur.role = 'super_admin'
    )
  INTO v_actor_is_admin, v_actor_is_super_admin;

  IF NOT v_actor_is_admin THEN
    RAISE EXCEPTION 'Treasury funding actor (%) must be an active authorized administrator.', v_actor_id;
  END IF;

  IF v_actor_id = NEW.requested_by AND NOT v_actor_is_super_admin THEN
    RAISE EXCEPTION 'Maker-checker violation: non-Super Admin administrators cannot approve, confirm, or reject their own treasury funding requests.';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_treasury_funding_approval_rules() FROM PUBLIC, anon, authenticated;

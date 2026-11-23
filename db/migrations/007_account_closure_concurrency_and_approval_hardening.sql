-- 007_account_closure_concurrency_and_approval_hardening.sql
-- Phase 1.1 forward security & concurrency hardening migration.
-- Migrations 001-006 remain completely unmodified.
-- Addresses:
--   1. M-3: Account closure READ COMMITTED concurrency control via shared per-user
--      advisory locking + deadlock-free profiles FOR KEY SHARE write-guard triggers
--      across wallet_balances, deposits, withdrawals, spot_orders, deposit_addresses,
--      and approval_requests.
--   2. L-1: approval_requests timestamp hygiene in enforce_approval_request_rules()
--      and chk_approval_requests_state_attribution.
--   3. Informational catalog parity: align networks and market_prices public RLS
--      with enabled assets/trading_pairs while preserving admin visibility.

-- =============================================================================
-- 1. M-3: Shared Per-User Account Serialization Lock & Closure Guard Triggers
-- =============================================================================
-- Lock ordering contract (deadlock-free across coordinated and ad-hoc writers):
--   - close_customer_account(p_user_id) acquires:
--       (1) pg_advisory_xact_lock via acquire_user_account_lock(p_user_id)
--       (2) public.profiles row lock (FOR UPDATE)
--     It NEVER acquires row locks on wallet_balances, deposits, withdrawals,
--     spot_orders, or approval_requests during validation (read-only EXISTS).
--   - Coordinated Phase 2 financial writers SHOULD acquire
--       PERFORM public.acquire_user_account_lock(v_user_id)
--     at transaction start before reading/writing obligations.
--   - Any SQL writer (coordinated or uncoordinated) mutating wallet_balances,
--     deposits, withdrawals, spot_orders, deposit_addresses, or approval_requests
--     acquires FOR KEY SHARE on public.profiles via BEFORE INSERT OR UPDATE
--     triggers, blocking against close_customer_account()'s FOR UPDATE lock and
--     failing immediately if the committed account_status becomes 'closed'.

CREATE OR REPLACE FUNCTION public.acquire_user_account_lock(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  v_lock_key := ('x' || substr(md5('exchange_account_lock:' || p_user_id::TEXT), 1, 16))::bit(64)::BIGINT;
  PERFORM pg_advisory_xact_lock(v_lock_key);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_user_account_lock(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_closed_account_obligation_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_status VARCHAR(20);
BEGIN
  -- Allow close_customer_account() (or admin cleanup) to deactivate deposit addresses cleanly
  IF TG_TABLE_NAME = 'deposit_addresses' AND TG_OP = 'UPDATE' AND NEW.is_active = FALSE AND NEW.user_id = OLD.user_id THEN
    RETURN NEW;
  END IF;

  SELECT p.account_status
  INTO v_account_status
  FROM public.profiles p
  WHERE p.id = NEW.user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account profile (%) does not exist for % operation.', NEW.user_id, TG_TABLE_NAME;
  END IF;

  IF v_account_status = 'closed' THEN
    IF TG_TABLE_NAME = 'wallet_balances' THEN
      IF TG_OP = 'INSERT' AND NEW.available = 0 AND NEW.reserved = 0 THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Cannot create or modify wallet_balances for closed account (%).', NEW.user_id;
    ELSIF TG_TABLE_NAME = 'deposit_addresses' THEN
      IF NEW.is_active = TRUE THEN
        RAISE EXCEPTION 'Cannot activate deposit address for closed account (%).', NEW.user_id;
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Cannot create or modify % financial obligation for closed account (%).', TG_TABLE_NAME, NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_closed_account_obligation_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_closed_account_wallet_balances ON public.wallet_balances;
CREATE TRIGGER trg_guard_closed_account_wallet_balances
  BEFORE INSERT OR UPDATE ON public.wallet_balances
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_obligation_write();

DROP TRIGGER IF EXISTS trg_guard_closed_account_deposits ON public.deposits;
CREATE TRIGGER trg_guard_closed_account_deposits
  BEFORE INSERT OR UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_obligation_write();

DROP TRIGGER IF EXISTS trg_guard_closed_account_withdrawals ON public.withdrawals;
CREATE TRIGGER trg_guard_closed_account_withdrawals
  BEFORE INSERT OR UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_obligation_write();

DROP TRIGGER IF EXISTS trg_guard_closed_account_spot_orders ON public.spot_orders;
CREATE TRIGGER trg_guard_closed_account_spot_orders
  BEFORE INSERT OR UPDATE ON public.spot_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_obligation_write();

DROP TRIGGER IF EXISTS trg_guard_closed_account_deposit_addresses ON public.deposit_addresses;
CREATE TRIGGER trg_guard_closed_account_deposit_addresses
  BEFORE INSERT OR UPDATE ON public.deposit_addresses
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_obligation_write();

CREATE OR REPLACE FUNCTION public.guard_closed_account_approval_request_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  FOR v_profile IN
    SELECT p.id, p.account_status
    FROM public.profiles p
    WHERE p.id = NEW.requested_by
       OR (NEW.target_id IS NOT NULL AND p.id::TEXT = NEW.target_id)
       OR (NEW.target_id IS NOT NULL AND p.public_user_id = NEW.target_id)
       OR (NEW.payload ? 'userId' AND p.id::TEXT = NEW.payload->>'userId')
       OR (NEW.payload ? 'user_id' AND p.id::TEXT = NEW.payload->>'user_id')
       OR (NEW.payload ? 'publicUserId' AND p.public_user_id = NEW.payload->>'publicUserId')
       OR (NEW.payload ? 'public_user_id' AND p.public_user_id = NEW.payload->>'public_user_id')
       OR (
         NEW.target_table = 'wallet_balances'
         AND NEW.target_id IS NOT NULL
         AND p.id IN (
           SELECT wb.user_id
           FROM public.wallet_balances wb
           WHERE wb.id::TEXT = NEW.target_id
         )
       )
    ORDER BY p.id ASC
    FOR KEY SHARE OF p
  LOOP
    IF v_profile.account_status = 'closed'
       AND (TG_OP = 'INSERT' OR NEW.status IN ('PENDING_SECOND_APPROVAL', 'APPROVED', 'EXECUTED')) THEN
      RAISE EXCEPTION 'Cannot create or advance approval_requests (%) for closed account (%).', NEW.id, v_profile.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_closed_account_approval_request_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_closed_account_approval_requests ON public.approval_requests;
CREATE TRIGGER trg_guard_closed_account_approval_requests
  BEFORE INSERT OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_approval_request_write();

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
  -- Serialize all coordinated writers and concurrent closures for this user
  PERFORM public.acquire_user_account_lock(p_user_id);

  -- Lock the profile row FOR UPDATE so uncoordinated table writers hitting
  -- FOR KEY SHARE triggers must either finish before closure checks run or
  -- observe account_status = 'closed' and abort cleanly.
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
-- 2. L-1: approval_requests Timestamp Hygiene & State-Attribution Hardening
-- =============================================================================
-- Mirrors the 006 treasury_funding_records timestamp invariants across
-- approved_at, rejected_at, executed_at, and cancelled_at.

DO $$
BEGIN
  ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS chk_approval_requests_state_attribution;

  ALTER TABLE public.approval_requests
    ADD CONSTRAINT chk_approval_requests_state_attribution CHECK (
      (
        status = 'PENDING_SECOND_APPROVAL'
        AND approved_by IS NULL AND approved_at IS NULL
        AND rejected_by IS NULL AND rejected_at IS NULL
        AND executed_by IS NULL AND executed_at IS NULL
        AND cancelled_by IS NULL AND cancelled_at IS NULL
      )
      OR (
        status = 'APPROVED'
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL
        AND rejected_by IS NULL AND rejected_at IS NULL
        AND executed_by IS NULL AND executed_at IS NULL
        AND cancelled_by IS NULL AND cancelled_at IS NULL
      )
      OR (
        status = 'REJECTED'
        AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL
        AND approved_by IS NULL AND approved_at IS NULL
        AND executed_by IS NULL AND executed_at IS NULL
        AND cancelled_by IS NULL AND cancelled_at IS NULL
      )
      OR (
        status = 'EXECUTED'
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL
        AND executed_by IS NOT NULL AND executed_at IS NOT NULL
        AND rejected_by IS NULL AND rejected_at IS NULL
        AND cancelled_by IS NULL AND cancelled_at IS NULL
      )
      OR (
        status = 'CANCELLED'
        AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
        AND approved_by IS NULL AND approved_at IS NULL
        AND rejected_by IS NULL AND rejected_at IS NULL
        AND executed_by IS NULL AND executed_at IS NULL
      )
    );
END $$;

CREATE OR REPLACE FUNCTION public.enforce_approval_request_rules()
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
    IF NEW.status <> 'PENDING_SECOND_APPROVAL' THEN
      RAISE EXCEPTION 'New approval request (%) must start in PENDING_SECOND_APPROVAL status (received %).', NEW.request_type, NEW.status;
    END IF;

    IF NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL
       OR NEW.executed_by IS NOT NULL
       OR NEW.executed_at IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL
       OR NEW.decision_note IS NOT NULL THEN
      RAISE EXCEPTION 'New approval request cannot include pre-populated decision or execution fields.';
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
      RAISE EXCEPTION 'Approval request requester (%) must be an active authorized administrator.', NEW.requested_by;
    END IF;

    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE': Freeze immutable request parameters
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.request_type IS DISTINCT FROM OLD.request_type
     OR NEW.target_table IS DISTINCT FROM OLD.target_table
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable approval request fields (%) cannot be modified after creation.', OLD.id;
  END IF;

  -- Block any mutation out of terminal states
  IF OLD.status IN ('REJECTED', 'EXECUTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Approval request in terminal status % cannot be modified.', OLD.status;
  END IF;

  -- Block decision tampering when status does not change
  IF NEW.status = OLD.status THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by
       OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
       OR NEW.executed_by IS DISTINCT FROM OLD.executed_by
       OR NEW.executed_at IS DISTINCT FROM OLD.executed_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
      RAISE EXCEPTION 'Approval request decision attribution cannot be modified without a valid state transition.';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- Enforce strictly monotonic state transitions, actor attribution, and timestamp hygiene
  IF OLD.status = 'PENDING_SECOND_APPROVAL' AND NEW.status = 'APPROVED' THEN
    IF NEW.approved_by IS NULL
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL
       OR NEW.executed_by IS NOT NULL
       OR NEW.executed_at IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'PENDING_SECOND_APPROVAL -> APPROVED requires approved_by and null rejected/executed/cancelled attribution and timestamps.';
    END IF;
    v_actor_id := NEW.approved_by;
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
  ELSIF OLD.status = 'PENDING_SECOND_APPROVAL' AND NEW.status = 'REJECTED' THEN
    IF NEW.rejected_by IS NULL OR NULLIF(BTRIM(COALESCE(NEW.decision_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'PENDING_SECOND_APPROVAL -> REJECTED requires rejected_by and a non-empty decision_note.';
    END IF;
    IF NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.executed_by IS NOT NULL
       OR NEW.executed_at IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Rejected approval request cannot record approved, executed, or cancelled attribution or timestamps.';
    END IF;
    v_actor_id := NEW.rejected_by;
    NEW.rejected_at := COALESCE(NEW.rejected_at, NOW());
  ELSIF OLD.status = 'PENDING_SECOND_APPROVAL' AND NEW.status = 'CANCELLED' THEN
    IF NEW.cancelled_by IS NULL
       OR NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL
       OR NEW.executed_by IS NOT NULL
       OR NEW.executed_at IS NOT NULL THEN
      RAISE EXCEPTION 'PENDING_SECOND_APPROVAL -> CANCELLED requires cancelled_by and null decision/execution attribution and timestamps.';
    END IF;
    v_actor_id := NEW.cancelled_by;
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'EXECUTED' THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.decision_note IS DISTINCT FROM OLD.decision_note
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Original approval attribution, timestamps, and decision_note cannot be altered during execution.';
    END IF;
    IF NEW.executed_by IS NULL THEN
      RAISE EXCEPTION 'APPROVED -> EXECUTED requires executed_by.';
    END IF;
    v_actor_id := NEW.executed_by;
    NEW.executed_at := COALESCE(NEW.executed_at, NOW());
  ELSE
    RAISE EXCEPTION 'Invalid approval request status transition: % -> %.', OLD.status, NEW.status;
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
    RAISE EXCEPTION 'Approval request actor (%) must be an active authorized administrator.', v_actor_id;
  END IF;

  -- Cancellation of pending requests may be performed by the requester or an active Super Admin
  IF NEW.status = 'CANCELLED' THEN
    IF v_actor_id <> NEW.requested_by AND NOT v_actor_is_super_admin THEN
      RAISE EXCEPTION 'Only the requesting admin or an active Super Admin may cancel a pending approval request.';
    END IF;
  ELSIF v_actor_id = NEW.requested_by THEN
    IF NEW.request_type <> 'treasury_funding' OR NOT v_actor_is_super_admin THEN
      RAISE EXCEPTION 'Maker-checker violation: only a Super Admin may self-approve/decide treasury_funding requests.';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_approval_request_rules() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 3. Informational Parity: Public Networks & Market Prices Catalog Policies
-- =============================================================================
-- Aligns networks and market_prices visibility with enabled assets and
-- trading_pairs while preserving full visibility for active administrators and
-- keeping anon queries free of admin-function EXECUTE evaluation.

DROP POLICY IF EXISTS networks_public_read ON public.networks;
DROP POLICY IF EXISTS networks_anon_read ON public.networks;
DROP POLICY IF EXISTS networks_authenticated_read ON public.networks;

CREATE POLICY networks_anon_read ON public.networks
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.assets a
      WHERE a.symbol = networks.asset_symbol
        AND a.is_enabled = TRUE
    )
  );

CREATE POLICY networks_authenticated_read ON public.networks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.assets a
      WHERE a.symbol = networks.asset_symbol
        AND a.is_enabled = TRUE
    )
    OR public.is_admin_user()
  );

DROP POLICY IF EXISTS market_prices_public_read ON public.market_prices;
DROP POLICY IF EXISTS market_prices_anon_read ON public.market_prices;
DROP POLICY IF EXISTS market_prices_authenticated_read ON public.market_prices;

CREATE POLICY market_prices_anon_read ON public.market_prices
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.trading_pairs tp
      WHERE tp.symbol = market_prices.pair_symbol
        AND tp.is_enabled = TRUE
    )
  );

CREATE POLICY market_prices_authenticated_read ON public.market_prices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trading_pairs tp
      WHERE tp.symbol = market_prices.pair_symbol
        AND tp.is_enabled = TRUE
    )
    OR public.is_admin_user()
  );

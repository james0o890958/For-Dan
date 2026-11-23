-- 008_closed_account_integrity_hardening.sql
-- Phase 1.2 forward micro-hardening migration.
-- Migrations 001-007 remain completely unmodified.
-- Remediates three confirmed defects from the Phase 1.1 concurrency audit:
--   1. CD-1: Remove unguarded early-return bypass for deactivated deposit_addresses,
--      always lock owner profiles FOR KEY SHARE before allowing writes, block new
--      inactive address inserts and reactivations for closed accounts, and restrict
--      closed-account updates solely to active -> inactive deactivation with all
--      identifying/vault columns frozen.
--   2. CD-2: Enforce immutable ownership (NEW.user_id IS DISTINCT FROM OLD.user_id)
--      on UPDATE across wallet_balances, deposits, withdrawals, spot_orders, and
--      deposit_addresses.
--   3. CD-3: Eliminate the READ COMMITTED non-locking actor status race in
--      approval_requests triggers by acquiring FOR KEY SHARE locks across all
--      involved profiles (requested_by, transition actor, and target/payload users)
--      in deterministic ascending UUID order (ORDER BY p.id ASC) BEFORE validating
--      actor/requester active account_status in both enforce_approval_request_rules()
--      and guard_closed_account_approval_request_write().

-- =============================================================================
-- 1. CD-1 & CD-2: Hardened Closed-Account Financial Obligation & Address Guard
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_closed_account_obligation_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_status VARCHAR(20);
BEGIN
  -- CD-2: Financial record and deposit-address ownership cannot be reassigned.
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Ownership (user_id) of % record (%) cannot be reassigned after creation.', TG_TABLE_NAME, OLD.id;
  END IF;

  -- CD-1: Always acquire FOR KEY SHARE on the owner's profile row and validate
  -- committed account_status before permitting any INSERT or UPDATE.
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
      -- Narrowly permit ONLY deactivating an existing active address (TRUE -> FALSE)
      -- while keeping every identifying, network, address, and vault column immutable.
      IF TG_OP = 'UPDATE'
         AND OLD.is_active = TRUE
         AND NEW.is_active = FALSE
         AND NEW.id IS NOT DISTINCT FROM OLD.id
         AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
         AND NEW.asset_symbol IS NOT DISTINCT FROM OLD.asset_symbol
         AND NEW.network_code IS NOT DISTINCT FROM OLD.network_code
         AND NEW.custody_vault_id IS NOT DISTINCT FROM OLD.custody_vault_id
         AND NEW.address IS NOT DISTINCT FROM OLD.address
         AND NEW.memo_or_tag IS NOT DISTINCT FROM OLD.memo_or_tag
         AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Cannot create or modify deposit_addresses for closed account (%).', NEW.user_id;
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

-- =============================================================================
-- 2. CD-3: Lock-Protected Approval-Request Actor & Closed-Account Validation
-- =============================================================================
-- Alphabetical BEFORE trigger firing order on public.approval_requests:
--   1. trg_enforce_approval_request_rules
--   2. trg_guard_closed_account_approval_requests
-- Both triggers acquire FOR KEY SHARE locks across the identical union of involved
-- profiles (requested_by, active transition actor, and target/payload customer
-- accounts) in deterministic ascending UUID order (ORDER BY p.id ASC) before any
-- actor account_status or role validation is accepted.

CREATE OR REPLACE FUNCTION public.enforce_approval_request_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_requester_status VARCHAR(20);
  v_requester_is_admin BOOLEAN;
  v_actor_id UUID;
  v_actor_status VARCHAR(20);
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

    -- Lock all involved profiles in deterministic ascending UUID order before checking status.
    v_requester_status := NULL;
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
      IF v_profile.id = NEW.requested_by THEN
        v_requester_status := v_profile.account_status;
      END IF;
    END LOOP;

    IF v_requester_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Approval request requester (%) must be an active authorized administrator.', NEW.requested_by;
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

  -- Acquire FOR KEY SHARE on requester, acting admin, and all referenced target/payload profiles
  -- in deterministic ascending UUID order BEFORE validating actor account_status and admin role.
  v_actor_status := NULL;
  FOR v_profile IN
    SELECT p.id, p.account_status
    FROM public.profiles p
    WHERE p.id = NEW.requested_by
       OR p.id = v_actor_id
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
    IF v_profile.id = v_actor_id THEN
      v_actor_status := v_profile.account_status;
    END IF;
  END LOOP;

  IF v_actor_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Approval request actor (%) must be an active authorized administrator.', v_actor_id;
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

CREATE OR REPLACE FUNCTION public.guard_closed_account_approval_request_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_actor_id UUID;
BEGIN
  v_actor_id := CASE
    WHEN TG_OP = 'INSERT' THEN NEW.requested_by
    WHEN TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      CASE NEW.status
        WHEN 'APPROVED' THEN NEW.approved_by
        WHEN 'REJECTED' THEN NEW.rejected_by
        WHEN 'EXECUTED' THEN NEW.executed_by
        WHEN 'CANCELLED' THEN NEW.cancelled_by
        ELSE NULL
      END
    ELSE NULL
  END;

  FOR v_profile IN
    SELECT p.id, p.account_status
    FROM public.profiles p
    WHERE p.id = NEW.requested_by
       OR (v_actor_id IS NOT NULL AND p.id = v_actor_id)
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
    IF v_actor_id IS NOT NULL AND v_profile.id = v_actor_id AND v_profile.account_status <> 'active' THEN
      RAISE EXCEPTION 'Approval request actor (%) has non-active account status (%) and cannot perform % on approval_requests (%).',
        v_actor_id, v_profile.account_status, TG_OP, NEW.id;
    END IF;

    IF v_profile.account_status = 'closed'
       AND (TG_OP = 'INSERT' OR NEW.status IN ('PENDING_SECOND_APPROVAL', 'APPROVED', 'EXECUTED')) THEN
      RAISE EXCEPTION 'Cannot create or advance approval_requests (%) for closed account (%).', NEW.id, v_profile.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_closed_account_approval_request_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_approval_request_rules ON public.approval_requests;
CREATE TRIGGER trg_enforce_approval_request_rules
  BEFORE INSERT OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_request_rules();

DROP TRIGGER IF EXISTS trg_guard_closed_account_approval_requests ON public.approval_requests;
CREATE TRIGGER trg_guard_closed_account_approval_requests
  BEFORE INSERT OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_account_approval_request_write();

-- 002_company_inventory_treasury_pricing.sql
-- Prepares database structures for the company-owned inventory model,
-- treasury wallet tracking, spread/fee pricing controls, quote locking,
-- dual-admin maker-checker approvals, and multi-scope reconciliation.
-- Retains compatibility for future peer-to-peer order book execution.

-- 1. Company-Owned Inventory & Append-Only Movements
CREATE TABLE IF NOT EXISTS public.company_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_symbol VARCHAR(16) NOT NULL UNIQUE REFERENCES public.assets(symbol),
  available_amount NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (available_amount >= 0),
  reserved_amount NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
  committed_amount NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  min_threshold NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
  trading_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  low_inventory_alerted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.treasury_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES public.networks(code),
  wallet_label VARCHAR(64) NOT NULL,
  wallet_tier VARCHAR(16) NOT NULL CHECK (wallet_tier IN ('hot', 'warm', 'cold', 'settlement')),
  public_address TEXT NOT NULL,
  memo_or_tag TEXT,
  custody_provider_ref TEXT,
  last_observed_balance NUMERIC(36, 18),
  last_synced_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_wallets_network_addr_memo
  ON public.treasury_wallets (network_code, public_address, COALESCE(memo_or_tag, ''));

CREATE TABLE IF NOT EXISTS public.treasury_funding_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_wallet_id UUID NOT NULL REFERENCES public.treasury_wallets(id),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES public.networks(code),
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('fund_inventory', 'withdraw_to_cold', 'rebalance')),
  amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
  tx_hash TEXT,
  status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'REJECTED')),
  requested_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  confirmed_by UUID,
  confirmed_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  decision_note TEXT,
  note TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_treasury_funding_approver_present CHECK (
    status NOT IN ('APPROVED', 'CONFIRMED') OR approved_by IS NOT NULL
  ),
  CONSTRAINT chk_treasury_funding_state_attribution CHECK (
    (status = 'PENDING_APPROVAL' AND approved_by IS NULL AND confirmed_by IS NULL AND rejected_by IS NULL)
    OR (status = 'APPROVED' AND approved_by IS NOT NULL AND confirmed_by IS NULL AND rejected_by IS NULL)
    OR (status = 'CONFIRMED' AND approved_by IS NOT NULL AND confirmed_by IS NOT NULL AND rejected_by IS NULL)
    OR (status = 'REJECTED' AND rejected_by IS NOT NULL AND approved_by IS NULL AND confirmed_by IS NULL)
  )
);

DO $$
BEGIN
  ALTER TABLE public.treasury_funding_records
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_by UUID,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by UUID,
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decision_note TEXT;

  ALTER TABLE public.treasury_funding_records
    DROP CONSTRAINT IF EXISTS treasury_funding_records_requested_by_fkey,
    DROP CONSTRAINT IF EXISTS treasury_funding_records_approved_by_fkey,
    DROP CONSTRAINT IF EXISTS chk_treasury_funding_approver_present,
    DROP CONSTRAINT IF EXISTS chk_treasury_funding_state_attribution;

  ALTER TABLE public.treasury_funding_records
    ADD CONSTRAINT chk_treasury_funding_approver_present CHECK (
      status NOT IN ('APPROVED', 'CONFIRMED') OR approved_by IS NOT NULL
    ),
    ADD CONSTRAINT chk_treasury_funding_state_attribution CHECK (
      (status = 'PENDING_APPROVAL' AND approved_by IS NULL AND confirmed_by IS NULL AND rejected_by IS NULL)
      OR (status = 'APPROVED' AND approved_by IS NOT NULL AND confirmed_by IS NULL AND rejected_by IS NULL)
      OR (status = 'CONFIRMED' AND approved_by IS NOT NULL AND confirmed_by IS NOT NULL AND rejected_by IS NULL)
      OR (status = 'REJECTED' AND rejected_by IS NOT NULL AND approved_by IS NULL AND confirmed_by IS NULL)
    );
END $$;

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
      RAISE EXCEPTION 'New treasury funding requests must start in PENDING_APPROVAL status (received %).', NEW.status;
    END IF;

    IF NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.confirmed_by IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.rejected_by IS NOT NULL
       OR NEW.rejected_at IS NOT NULL
       OR NEW.decision_note IS NOT NULL THEN
      RAISE EXCEPTION 'New treasury funding requests cannot include pre-populated decision fields.';
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
    IF NEW.approved_by IS NULL OR NEW.confirmed_by IS NOT NULL OR NEW.rejected_by IS NOT NULL THEN
      RAISE EXCEPTION 'PENDING_APPROVAL -> APPROVED requires approved_by and null confirmed_by/rejected_by.';
    END IF;
    v_actor_id := NEW.approved_by;
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
  ELSIF OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'REJECTED' THEN
    IF NEW.rejected_by IS NULL OR NULLIF(BTRIM(COALESCE(NEW.decision_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'PENDING_APPROVAL -> REJECTED requires rejected_by and a non-empty decision_note.';
    END IF;
    IF NEW.approved_by IS NOT NULL OR NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION 'Rejected treasury funding request cannot record approved_by or confirmed_by.';
    END IF;
    v_actor_id := NEW.rejected_by;
    NEW.rejected_at := COALESCE(NEW.rejected_at, NOW());
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'CONFIRMED' THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.rejected_by IS NOT NULL THEN
      RAISE EXCEPTION 'Original approval attribution cannot be altered during confirmation.';
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

DROP TRIGGER IF EXISTS trg_enforce_treasury_funding_approval_rules ON public.treasury_funding_records;
CREATE TRIGGER trg_enforce_treasury_funding_approval_rules
  BEFORE INSERT OR UPDATE ON public.treasury_funding_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_treasury_funding_approval_rules();

DROP TRIGGER IF EXISTS trg_prevent_delete_treasury_funding_records ON public.treasury_funding_records;
CREATE TRIGGER trg_prevent_delete_treasury_funding_records
  BEFORE DELETE ON public.treasury_funding_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  movement_type VARCHAR(32) NOT NULL CHECK (movement_type IN (
    'funding_credit',
    'trade_reserve',
    'trade_release',
    'trade_debit',
    'trade_acquire',
    'reconciliation_adjustment',
    'reversal'
  )),
  bucket VARCHAR(16) NOT NULL CHECK (bucket IN ('available', 'reserved', 'committed')),
  delta_amount NUMERIC(36, 18) NOT NULL,
  balance_after NUMERIC(36, 18) NOT NULL CHECK (balance_after >= 0),
  trade_id UUID REFERENCES public.trades(id),
  treasury_wallet_id UUID REFERENCES public.treasury_wallets(id),
  funding_record_id UUID REFERENCES public.treasury_funding_records(id),
  blockchain_tx_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_created_by_fkey;
END $$;

DROP TRIGGER IF EXISTS trg_immutable_inventory_movements ON public.inventory_movements;
CREATE TRIGGER trg_immutable_inventory_movements
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

-- 2. Pricing Controls, Live Market Prices & Locked Execution Quotes
ALTER TABLE public.trading_pairs
  ADD COLUMN IF NOT EXISTS buy_spread_bps INTEGER NOT NULL DEFAULT 50 CHECK (buy_spread_bps >= 0 AND buy_spread_bps <= 2000),
  ADD COLUMN IF NOT EXISTS sell_spread_bps INTEGER NOT NULL DEFAULT 50 CHECK (sell_spread_bps >= 0 AND sell_spread_bps <= 2000),
  ADD COLUMN IF NOT EXISTS price_precision INTEGER NOT NULL DEFAULT 2 CHECK (price_precision >= 0 AND price_precision <= 12),
  ADD COLUMN IF NOT EXISTS quantity_precision INTEGER NOT NULL DEFAULT 8 CHECK (quantity_precision >= 0 AND quantity_precision <= 18),
  ADD COLUMN IF NOT EXISTS max_order_usdt NUMERIC(36, 18) NOT NULL DEFAULT 250000 CHECK (max_order_usdt > 0),
  ADD COLUMN IF NOT EXISTS max_slippage_bps INTEGER NOT NULL DEFAULT 150 CHECK (max_slippage_bps >= 0 AND max_slippage_bps <= 2000),
  ADD COLUMN IF NOT EXISTS max_price_age_seconds INTEGER NOT NULL DEFAULT 30 CHECK (max_price_age_seconds > 0),
  ADD COLUMN IF NOT EXISTS quote_ttl_seconds INTEGER NOT NULL DEFAULT 15 CHECK (quote_ttl_seconds > 0),
  ADD COLUMN IF NOT EXISTS buy_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sell_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.market_prices (
  pair_symbol VARCHAR(32) PRIMARY KEY REFERENCES public.trading_pairs(symbol) ON DELETE CASCADE,
  price NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (price >= 0),
  change_24h_pct NUMERIC(10, 4) NOT NULL DEFAULT 0,
  high_24h NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (high_24h >= 0),
  low_24h NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (low_24h >= 0),
  volume_24h NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (volume_24h >= 0),
  source_name VARCHAR(64) NOT NULL DEFAULT 'unconfigured',
  data_status VARCHAR(16) NOT NULL DEFAULT 'unavailable' CHECK (data_status IN ('live', 'delayed', 'unavailable')),
  provider_timestamp TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.price_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pair_symbol VARCHAR(32) NOT NULL REFERENCES public.trading_pairs(symbol),
  side VARCHAR(8) NOT NULL CHECK (side IN ('buy', 'sell')),
  raw_market_price NUMERIC(36, 18) NOT NULL CHECK (raw_market_price > 0),
  customer_execution_price NUMERIC(36, 18) NOT NULL CHECK (customer_execution_price > 0),
  spread_bps INTEGER NOT NULL CHECK (spread_bps >= 0),
  fee_rate NUMERIC(10, 6) NOT NULL CHECK (fee_rate >= 0),
  source_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Spot Orders & Trades Extensions for Company Inventory + Order Book Readiness
ALTER TABLE public.spot_orders
  ADD COLUMN IF NOT EXISTS execution_model VARCHAR(24) NOT NULL DEFAULT 'COMPANY_INVENTORY'
    CHECK (execution_model IN ('COMPANY_INVENTORY', 'ORDER_BOOK')),
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES public.price_quotes(id),
  ADD COLUMN IF NOT EXISTS raw_market_price NUMERIC(36, 18),
  ADD COLUMN IF NOT EXISTS spread_bps INTEGER,
  ADD COLUMN IF NOT EXISTS spread_usdt NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (spread_usdt >= 0);

ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS execution_model VARCHAR(24) NOT NULL DEFAULT 'COMPANY_INVENTORY'
    CHECK (execution_model IN ('COMPANY_INVENTORY', 'ORDER_BOOK')),
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES public.price_quotes(id),
  ADD COLUMN IF NOT EXISTS raw_market_price NUMERIC(36, 18),
  ADD COLUMN IF NOT EXISTS spread_bps INTEGER NOT NULL DEFAULT 0 CHECK (spread_bps >= 0),
  ADD COLUMN IF NOT EXISTS spread_usdt NUMERIC(36, 18) NOT NULL DEFAULT 0 CHECK (spread_usdt >= 0);

-- 4. Dual-Admin Maker-Checker Approval Queue
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type VARCHAR(40) NOT NULL CHECK (request_type IN (
    'manual_balance_adjustment',
    'treasury_funding',
    'inventory_adjustment',
    'pricing_override'
  )),
  target_table VARCHAR(64) NOT NULL,
  target_id TEXT,
  payload JSONB NOT NULL,
  reason_code TEXT NOT NULL,
  summary TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_SECOND_APPROVAL' CHECK (status IN (
    'PENDING_SECOND_APPROVAL',
    'APPROVED',
    'REJECTED',
    'EXECUTED',
    'CANCELLED'
  )),
  requested_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_by UUID,
  rejected_at TIMESTAMPTZ,
  executed_by UUID,
  executed_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  decision_note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_approval_requests_self_approval CHECK (
    approved_by IS NULL OR approved_by <> requested_by OR request_type = 'treasury_funding'
  ),
  CONSTRAINT chk_approval_requests_state_attribution CHECK (
    (status = 'PENDING_SECOND_APPROVAL' AND approved_by IS NULL AND rejected_by IS NULL AND executed_by IS NULL AND cancelled_by IS NULL)
    OR (status = 'APPROVED' AND approved_by IS NOT NULL AND rejected_by IS NULL AND executed_by IS NULL AND cancelled_by IS NULL)
    OR (status = 'REJECTED' AND rejected_by IS NOT NULL AND approved_by IS NULL AND executed_by IS NULL AND cancelled_by IS NULL)
    OR (status = 'EXECUTED' AND approved_by IS NOT NULL AND executed_by IS NOT NULL AND rejected_by IS NULL AND cancelled_by IS NULL)
    OR (status = 'CANCELLED' AND cancelled_by IS NOT NULL AND approved_by IS NULL AND rejected_by IS NULL AND executed_by IS NULL)
  )
);

DO $$
BEGIN
  ALTER TABLE public.approval_requests
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by UUID,
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS executed_by UUID,
    ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

  ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_requested_by_fkey,
    DROP CONSTRAINT IF EXISTS approval_requests_approved_by_fkey,
    DROP CONSTRAINT IF EXISTS chk_approval_requests_self_approval,
    DROP CONSTRAINT IF EXISTS chk_approval_requests_state_attribution;

  ALTER TABLE public.approval_requests
    ADD CONSTRAINT chk_approval_requests_self_approval CHECK (
      approved_by IS NULL OR approved_by <> requested_by OR request_type = 'treasury_funding'
    ),
    ADD CONSTRAINT chk_approval_requests_state_attribution CHECK (
      (status = 'PENDING_SECOND_APPROVAL' AND approved_by IS NULL AND rejected_by IS NULL AND executed_by IS NULL AND cancelled_by IS NULL)
      OR (status = 'APPROVED' AND approved_by IS NOT NULL AND rejected_by IS NULL AND executed_by IS NULL AND cancelled_by IS NULL)
      OR (status = 'REJECTED' AND rejected_by IS NOT NULL AND approved_by IS NULL AND executed_by IS NULL AND cancelled_by IS NULL)
      OR (status = 'EXECUTED' AND approved_by IS NOT NULL AND executed_by IS NOT NULL AND rejected_by IS NULL AND cancelled_by IS NULL)
      OR (status = 'CANCELLED' AND cancelled_by IS NOT NULL AND approved_by IS NULL AND rejected_by IS NULL AND executed_by IS NULL)
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

  -- Enforce strictly monotonic state transitions & attribution
  IF OLD.status = 'PENDING_SECOND_APPROVAL' AND NEW.status = 'APPROVED' THEN
    IF NEW.approved_by IS NULL OR NEW.rejected_by IS NOT NULL OR NEW.executed_by IS NOT NULL OR NEW.cancelled_by IS NOT NULL THEN
      RAISE EXCEPTION 'PENDING_SECOND_APPROVAL -> APPROVED requires approved_by and null rejected_by/executed_by/cancelled_by.';
    END IF;
    v_actor_id := NEW.approved_by;
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());
  ELSIF OLD.status = 'PENDING_SECOND_APPROVAL' AND NEW.status = 'REJECTED' THEN
    IF NEW.rejected_by IS NULL OR NULLIF(BTRIM(COALESCE(NEW.decision_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'PENDING_SECOND_APPROVAL -> REJECTED requires rejected_by and a non-empty decision_note.';
    END IF;
    IF NEW.approved_by IS NOT NULL OR NEW.executed_by IS NOT NULL OR NEW.cancelled_by IS NOT NULL THEN
      RAISE EXCEPTION 'Rejected approval request cannot record approved_by, executed_by, or cancelled_by.';
    END IF;
    v_actor_id := NEW.rejected_by;
    NEW.rejected_at := COALESCE(NEW.rejected_at, NOW());
  ELSIF OLD.status = 'PENDING_SECOND_APPROVAL' AND NEW.status = 'CANCELLED' THEN
    IF NEW.cancelled_by IS NULL OR NEW.approved_by IS NOT NULL OR NEW.rejected_by IS NOT NULL OR NEW.executed_by IS NOT NULL THEN
      RAISE EXCEPTION 'PENDING_SECOND_APPROVAL -> CANCELLED requires cancelled_by and null decision/execution fields.';
    END IF;
    v_actor_id := NEW.cancelled_by;
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'EXECUTED' THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.decision_note IS DISTINCT FROM OLD.decision_note
       OR NEW.rejected_by IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL THEN
      RAISE EXCEPTION 'Original approval attribution cannot be altered during execution.';
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

DROP TRIGGER IF EXISTS trg_enforce_approval_request_rules ON public.approval_requests;
CREATE TRIGGER trg_enforce_approval_request_rules
  BEFORE INSERT OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_request_rules();

DROP TRIGGER IF EXISTS trg_prevent_delete_approval_requests ON public.approval_requests;
CREATE TRIGGER trg_prevent_delete_approval_requests
  BEFORE DELETE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

-- 5. Expanded Reconciliation Scope Support
DO $$
BEGIN
  ALTER TABLE public.reconciliation_runs
    DROP CONSTRAINT IF EXISTS reconciliation_runs_scope_check;
  ALTER TABLE public.reconciliation_runs
    ADD CONSTRAINT reconciliation_runs_scope_check CHECK (scope IN (
      'customer_balances_vs_ledger',
      'company_inventory_vs_movements',
      'treasury_observed_vs_inventory',
      'deposits_withdrawals_vs_ledger',
      'ledger_vs_balances',
      'ledger_vs_custody',
      'trades_vs_venue'
    ));
END $$;

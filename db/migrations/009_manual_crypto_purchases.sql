-- 009_manual_crypto_purchases.sql
-- Phase 2.5 Manual Crypto Purchase & Admin Order Fulfilment Schema
-- Additive forward migration; historical migrations 001-008 remain unmodified.

-- 1. Extend notification category check constraints to include 'Trade' lifecycle notifications
ALTER TABLE public.notification_campaigns
  DROP CONSTRAINT IF EXISTS notification_campaigns_category_check;
ALTER TABLE public.notification_campaigns
  ADD CONSTRAINT notification_campaigns_category_check
  CHECK (category IN ('Account', 'Deposit', 'Withdrawal', 'KYC', 'Market', 'Trade', 'Compliance', 'Notice'));

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('Account', 'Deposit', 'Withdrawal', 'KYC', 'Market', 'Trade', 'Compliance', 'Notice'));

-- 2. Admin-Managed Cryptocurrency Receiving Addresses for Manual Purchase Fulfilment
CREATE TABLE IF NOT EXISTS public.receiving_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_symbol VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  network_code VARCHAR(32) NOT NULL REFERENCES public.networks(code),
  address TEXT NOT NULL,
  memo_or_tag TEXT,
  label TEXT NOT NULL DEFAULT 'Primary Purchase Receiving Address',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receiving_addresses_network_addr_memo
  ON public.receiving_addresses (network_code, LOWER(address), COALESCE(memo_or_tag, ''));

CREATE INDEX IF NOT EXISTS idx_receiving_addresses_active_lookup
  ON public.receiving_addresses (asset_symbol, network_code, is_active);

CREATE TABLE IF NOT EXISTS public.receiving_address_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_address_id UUID NOT NULL REFERENCES public.receiving_addresses(id) ON DELETE RESTRICT,
  action VARCHAR(24) NOT NULL CHECK (action IN ('created', 'updated', 'activated', 'disabled')),
  actor_user_id UUID NOT NULL,
  actor_label TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Manual Crypto Purchase Orders & Immutable Review Events
CREATE TABLE IF NOT EXISTS public.manual_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref VARCHAR(40) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pair_symbol VARCHAR(32) NOT NULL REFERENCES public.trading_pairs(symbol),
  base_asset VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  quote_asset VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  side VARCHAR(8) NOT NULL DEFAULT 'buy' CHECK (side = 'buy'),
  order_type VARCHAR(16) NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
  requested_quote_amount NUMERIC(36, 18) NOT NULL CHECK (requested_quote_amount > 0),
  limit_price NUMERIC(36, 18) CHECK (limit_price IS NULL OR limit_price > 0),
  reference_price NUMERIC(36, 18) NOT NULL CHECK (reference_price > 0),
  fee_rate NUMERIC(10, 6) NOT NULL CHECK (fee_rate >= 0 AND fee_rate <= 0.05),
  estimated_fee_usdt NUMERIC(36, 18) NOT NULL CHECK (estimated_fee_usdt >= 0),
  estimated_crypto_amount NUMERIC(36, 18) NOT NULL CHECK (estimated_crypto_amount > 0),
  total_payment_amount NUMERIC(36, 18) NOT NULL CHECK (total_payment_amount > 0),
  payment_asset VARCHAR(16) NOT NULL REFERENCES public.assets(symbol),
  receiving_network VARCHAR(32) NOT NULL REFERENCES public.networks(code),
  receiving_address_id UUID NOT NULL REFERENCES public.receiving_addresses(id) ON DELETE RESTRICT,
  receiving_address TEXT NOT NULL,
  receiving_memo_or_tag TEXT,
  payment_tx_hash TEXT,
  actual_amount_sent NUMERIC(36, 18) CHECK (actual_amount_sent IS NULL OR actual_amount_sent > 0),
  payment_note TEXT,
  payment_submitted_at TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN (
    'PENDING_PAYMENT',
    'PAYMENT_SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'COMPLETED',
    'CANCELLED'
  )),
  tx_hash_checked BOOLEAN NOT NULL DEFAULT FALSE,
  address_matched BOOLEAN NOT NULL DEFAULT FALSE,
  network_matched BOOLEAN NOT NULL DEFAULT FALSE,
  amount_verified BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_clear BOOLEAN NOT NULL DEFAULT FALSE,
  final_crypto_amount NUMERIC(36, 18) CHECK (final_crypto_amount IS NULL OR final_crypto_amount > 0),
  final_fee_usdt NUMERIC(36, 18) CHECK (final_fee_usdt IS NULL OR final_fee_usdt >= 0),
  admin_remark TEXT,
  rejection_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  fulfilled_by UUID,
  fulfilled_at TIMESTAMPTZ,
  credited_tx_id UUID REFERENCES public.ledger_transactions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mpo_rejection_reason CHECK (
    status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND LENGTH(TRIM(rejection_reason)) > 0)
  ),
  CONSTRAINT chk_mpo_completed_settlement CHECK (
    status <> 'COMPLETED' OR (
      fulfilled_by IS NOT NULL
      AND fulfilled_at IS NOT NULL
      AND credited_tx_id IS NOT NULL
      AND final_crypto_amount IS NOT NULL
      AND final_crypto_amount > 0
      AND payment_tx_hash IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_purchase_orders_network_tx_hash
  ON public.manual_purchase_orders (receiving_network, LOWER(payment_tx_hash))
  WHERE payment_tx_hash IS NOT NULL AND status NOT IN ('REJECTED', 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_manual_purchase_orders_user_created
  ON public.manual_purchase_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_purchase_orders_status_created
  ON public.manual_purchase_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.manual_purchase_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.manual_purchase_orders(id) ON DELETE RESTRICT,
  from_status VARCHAR(24),
  to_status VARCHAR(24) NOT NULL,
  actor_user_id UUID NOT NULL,
  actor_label TEXT NOT NULL,
  actor_role VARCHAR(32) NOT NULL,
  remark TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Immutability, Ownership, Closed-Account & State-Transition Trigger Guards
CREATE OR REPLACE FUNCTION public.enforce_manual_purchase_order_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_status VARCHAR(20);
  v_kyc_status VARCHAR(20);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_PAYMENT' THEN
      RAISE EXCEPTION 'New manual purchase order must start in PENDING_PAYMENT (received %).', NEW.status;
    END IF;
    IF NEW.payment_tx_hash IS NOT NULL
       OR NEW.payment_submitted_at IS NOT NULL
       OR NEW.reviewed_by IS NOT NULL
       OR NEW.fulfilled_by IS NOT NULL
       OR NEW.credited_tx_id IS NOT NULL THEN
      RAISE EXCEPTION 'New manual purchase order cannot include pre-populated payment or settlement fields.';
    END IF;

    SELECT p.account_status, p.kyc_status
    INTO v_account_status, v_kyc_status
    FROM public.profiles p
    WHERE p.id = NEW.user_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer profile (%) does not exist.', NEW.user_id;
    END IF;
    IF v_account_status <> 'active' THEN
      RAISE EXCEPTION 'Cannot create manual purchase order for % account (%).', v_account_status, NEW.user_id;
    END IF;
    IF v_kyc_status <> 'approved' THEN
      RAISE EXCEPTION 'Approved KYC is required before creating manual purchase order (%).', NEW.user_id;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE guards
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.order_ref IS DISTINCT FROM OLD.order_ref
     OR NEW.pair_symbol IS DISTINCT FROM OLD.pair_symbol
     OR NEW.base_asset IS DISTINCT FROM OLD.base_asset
     OR NEW.quote_asset IS DISTINCT FROM OLD.quote_asset
     OR NEW.side IS DISTINCT FROM OLD.side
     OR NEW.order_type IS DISTINCT FROM OLD.order_type
     OR NEW.requested_quote_amount IS DISTINCT FROM OLD.requested_quote_amount
     OR NEW.limit_price IS DISTINCT FROM OLD.limit_price
     OR NEW.reference_price IS DISTINCT FROM OLD.reference_price
     OR NEW.fee_rate IS DISTINCT FROM OLD.fee_rate
     OR NEW.estimated_fee_usdt IS DISTINCT FROM OLD.estimated_fee_usdt
     OR NEW.estimated_crypto_amount IS DISTINCT FROM OLD.estimated_crypto_amount
     OR NEW.total_payment_amount IS DISTINCT FROM OLD.total_payment_amount
     OR NEW.payment_asset IS DISTINCT FROM OLD.payment_asset
     OR NEW.receiving_network IS DISTINCT FROM OLD.receiving_network
     OR NEW.receiving_address_id IS DISTINCT FROM OLD.receiving_address_id
     OR NEW.receiving_address IS DISTINCT FROM OLD.receiving_address
     OR NEW.receiving_memo_or_tag IS DISTINCT FROM OLD.receiving_memo_or_tag
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable manual purchase order fields (%) cannot be modified after creation.', OLD.id;
  END IF;

  IF OLD.payment_submitted_at IS NOT NULL THEN
    IF NEW.payment_tx_hash IS DISTINCT FROM OLD.payment_tx_hash
       OR NEW.actual_amount_sent IS DISTINCT FROM OLD.actual_amount_sent
       OR NEW.payment_note IS DISTINCT FROM OLD.payment_note
       OR NEW.payment_submitted_at IS DISTINCT FROM OLD.payment_submitted_at THEN
      RAISE EXCEPTION 'Submitted payment details for order (%) are immutable once submitted.', OLD.id;
    END IF;
  END IF;

  IF OLD.status IN ('COMPLETED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Terminal manual purchase order (%) in status % cannot be modified.', OLD.id, OLD.status;
  END IF;

  IF NEW.status = OLD.status THEN
    IF NEW.credited_tx_id IS DISTINCT FROM OLD.credited_tx_id
       OR NEW.fulfilled_by IS DISTINCT FROM OLD.fulfilled_by
       OR NEW.fulfilled_at IS DISTINCT FROM OLD.fulfilled_at
       OR NEW.final_crypto_amount IS DISTINCT FROM OLD.final_crypto_amount
       OR NEW.final_fee_usdt IS DISTINCT FROM OLD.final_fee_usdt
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
       OR (OLD.status = 'APPROVED' AND (
         NEW.tx_hash_checked IS DISTINCT FROM OLD.tx_hash_checked
         OR NEW.address_matched IS DISTINCT FROM OLD.address_matched
         OR NEW.network_matched IS DISTINCT FROM OLD.network_matched
         OR NEW.amount_verified IS DISTINCT FROM OLD.amount_verified
         OR NEW.duplicate_clear IS DISTINCT FROM OLD.duplicate_clear
         OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
         OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       )) THEN
      RAISE EXCEPTION 'Protected review or settlement fields on order (%) cannot be modified without a valid status transition.', OLD.id;
    END IF;
  ELSE
    IF NOT (
      (OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('PAYMENT_SUBMITTED', 'CANCELLED', 'REJECTED'))
      OR (OLD.status = 'PAYMENT_SUBMITTED' AND NEW.status IN ('UNDER_REVIEW', 'REJECTED'))
      OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('APPROVED', 'REJECTED'))
      OR (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'REJECTED'))
    ) THEN
      RAISE EXCEPTION 'Invalid manual purchase status transition: % -> %.', OLD.status, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'PAYMENT_SUBMITTED' THEN
    IF NEW.payment_tx_hash IS NULL OR LENGTH(TRIM(NEW.payment_tx_hash)) < 10 THEN
      RAISE EXCEPTION 'Valid payment_tx_hash is required to mark order PAYMENT_SUBMITTED.';
    END IF;
    IF NEW.actual_amount_sent IS NULL OR NEW.actual_amount_sent <= 0 THEN
      RAISE EXCEPTION 'Positive actual_amount_sent is required to mark order PAYMENT_SUBMITTED.';
    END IF;
    NEW.payment_submitted_at := COALESCE(NEW.payment_submitted_at, NOW());
  END IF;

  IF NEW.status = 'APPROVED' THEN
    IF NOT (
      NEW.tx_hash_checked AND NEW.address_matched AND NEW.network_matched AND NEW.amount_verified AND NEW.duplicate_clear
    ) THEN
      RAISE EXCEPTION 'All verification checklist checks must be true before approving order (%).', OLD.id;
    END IF;
  END IF;

  IF NEW.status <> 'COMPLETED' AND (NEW.credited_tx_id IS NOT NULL OR NEW.fulfilled_by IS NOT NULL OR NEW.fulfilled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Settlement columns (credited_tx_id, fulfilled_by, fulfilled_at) may only be set on COMPLETED orders.';
  END IF;

  IF NEW.status IN ('PAYMENT_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'COMPLETED') THEN
    SELECT p.account_status
    INTO v_account_status
    FROM public.profiles p
    WHERE p.id = NEW.user_id
    FOR KEY SHARE;

    IF v_account_status <> 'active' THEN
      RAISE EXCEPTION 'Cannot advance or fulfil purchase order (%) for % account.', OLD.id, v_account_status;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_manual_purchase_order_rules() FROM PUBLIC, anon, authenticated;

-- Extend close_customer_account() so accounts with open/in-flight manual purchase orders cannot be closed
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
  PERFORM public.acquire_user_account_lock(p_user_id);

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
    FROM public.manual_purchase_orders
    WHERE user_id = p_user_id
      AND status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'Cannot close account (%): unresolved manual purchase orders remain.', p_user_id;
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

DROP TRIGGER IF EXISTS trg_enforce_manual_purchase_order_rules ON public.manual_purchase_orders;
CREATE TRIGGER trg_enforce_manual_purchase_order_rules
  BEFORE INSERT OR UPDATE ON public.manual_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_purchase_order_rules();

DROP TRIGGER IF EXISTS trg_prevent_delete_manual_purchase_orders ON public.manual_purchase_orders;
CREATE TRIGGER trg_prevent_delete_manual_purchase_orders
  BEFORE DELETE ON public.manual_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_prevent_delete_receiving_addresses ON public.receiving_addresses;
CREATE TRIGGER trg_prevent_delete_receiving_addresses
  BEFORE DELETE ON public.receiving_addresses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_immutable_manual_purchase_order_events ON public.manual_purchase_order_events;
CREATE TRIGGER trg_immutable_manual_purchase_order_events
  BEFORE UPDATE OR DELETE ON public.manual_purchase_order_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

DROP TRIGGER IF EXISTS trg_immutable_receiving_address_audit_logs ON public.receiving_address_audit_logs;
CREATE TRIGGER trg_immutable_receiving_address_audit_logs
  BEFORE UPDATE OR DELETE ON public.receiving_address_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_record_mutation();

-- 5. Row-Level Security & Least-Privilege Grants
REVOKE ALL ON TABLE
  public.receiving_addresses,
  public.receiving_address_audit_logs,
  public.manual_purchase_orders,
  public.manual_purchase_order_events
FROM anon, authenticated;

GRANT SELECT (
  id,
  asset_symbol,
  network_code,
  address,
  memo_or_tag,
  label,
  is_active,
  created_at,
  updated_at
) ON TABLE public.receiving_addresses TO authenticated;

GRANT SELECT ON TABLE
  public.manual_purchase_orders,
  public.manual_purchase_order_events
TO authenticated;

ALTER TABLE public.receiving_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_address_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_purchase_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receiving_addresses_read_active_or_admin ON public.receiving_addresses;
CREATE POLICY receiving_addresses_read_active_or_admin ON public.receiving_addresses
  FOR SELECT TO authenticated
  USING (
    (is_active = TRUE AND public.is_active_account())
    OR public.can_read_financial_records()
  );

DROP POLICY IF EXISTS manual_purchase_orders_select_own ON public.manual_purchase_orders;
CREATE POLICY manual_purchase_orders_select_own ON public.manual_purchase_orders
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = user_id AND public.is_active_account())
    OR public.can_read_financial_records()
  );

DROP POLICY IF EXISTS manual_purchase_order_events_select_own ON public.manual_purchase_order_events;
CREATE POLICY manual_purchase_order_events_select_own ON public.manual_purchase_order_events
  FOR SELECT TO authenticated
  USING (
    public.can_read_financial_records()
    OR EXISTS (
      SELECT 1
      FROM public.manual_purchase_orders o
      WHERE o.id = order_id
        AND o.user_id = auth.uid()
        AND public.is_active_account()
    )
  );

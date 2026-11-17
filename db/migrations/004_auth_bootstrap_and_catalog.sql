-- 004_auth_bootstrap_and_catalog.sql
-- 1. Bootstraps profile + customer role + zeroed wallet balances when a Supabase Auth user is created.
-- 2. Seeds supported catalog assets, networks, trading pairs, and zeroed company_inventory rows idempotently.
--    No mock customer balances or fabricated transactions are ever created.

CREATE OR REPLACE FUNCTION public.generate_public_user_id()
RETURNS VARCHAR(20)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate VARCHAR(20);
BEGIN
  LOOP
    candidate := (FLOOR(100000000 + RANDOM() * 899999999))::BIGINT::TEXT;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE public_user_id = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_public_id VARCHAR(20);
  v_full_name TEXT;
  v_phone TEXT;
  v_lang TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_public_id := public.generate_public_user_id();
  v_full_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), split_part(COALESCE(NEW.email, 'customer'), '@', 1));
  v_phone := public.normalize_phone_e164(NEW.raw_user_meta_data->>'phone');
  v_lang := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'preferred_language'), ''), 'English');

  INSERT INTO public.profiles (
    id,
    public_user_id,
    email,
    full_name,
    phone,
    totp_enabled,
    account_status,
    kyc_status,
    preferred_language
  )
  VALUES (
    NEW.id,
    v_public_id,
    COALESCE(NEW.email, ''),
    v_full_name,
    v_phone,
    FALSE,
    'active',
    'not_submitted',
    v_lang
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (NEW.id, 'customer', NULL)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.wallet_balances (user_id, asset_symbol, available, reserved)
  SELECT NEW.id, a.symbol, 0, 0
  FROM public.assets a
  WHERE a.is_enabled = TRUE
  ON CONFLICT (user_id, asset_symbol) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

REVOKE ALL ON FUNCTION public.generate_public_user_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- Idempotent Supported Assets Catalog
INSERT INTO public.assets (symbol, name, decimals, is_enabled, sort_order, badge_color, description)
VALUES
  ('USDT', 'Tether USD', 6, TRUE, 1, '#10C478', 'USD-pegged stablecoin settlement asset.'),
  ('BTC', 'Bitcoin', 8, TRUE, 2, '#F7931A', 'Decentralized digital asset on Bitcoin network.'),
  ('ETH', 'Ethereum', 8, TRUE, 3, '#627EEA', 'Smart contract platform native asset.'),
  ('XRP', 'XRP', 6, TRUE, 4, '#23292F', 'XRP Ledger settlement asset.'),
  ('LTC', 'Litecoin', 8, TRUE, 5, '#345D9D', 'Peer-to-peer Scrypt proof-of-work network.'),
  ('BCH', 'Bitcoin Cash', 8, TRUE, 6, '#0AC18E', 'UTXO electronic cash ledger.'),
  ('TRX', 'TRON', 6, TRUE, 7, '#EF0027', 'High-throughput DPoS smart contract chain.'),
  ('SOL', 'Solana', 8, TRUE, 8, '#14F195', 'High-performance PoH blockchain.')
ON CONFLICT (symbol) DO NOTHING;

-- Idempotent Supported Networks Catalog
INSERT INTO public.networks (
  code, name, asset_symbol, required_confirmations, min_deposit, min_withdrawal,
  network_fee, platform_fee, address_regex, memo_required, is_deposit_enabled, is_withdrawal_enabled
)
VALUES
  ('TRC-20', 'TRON (TRC-20)', 'USDT', 20, 10, 20, 1, 0, '^T[1-9A-HJ-NP-Za-km-z]{33}$', FALSE, TRUE, TRUE),
  ('ERC-20', 'Ethereum (ERC-20)', 'USDT', 12, 25, 50, 4.5, 0, '^0x[a-fA-F0-9]{40}$', FALSE, TRUE, TRUE),
  ('BTC', 'Bitcoin Network', 'BTC', 3, 0.0005, 0.001, 0.00015, 0, '^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$', FALSE, TRUE, TRUE),
  ('ETH', 'Ethereum Mainnet', 'ETH', 12, 0.01, 0.02, 0.002, 0, '^0x[a-fA-F0-9]{40}$', FALSE, TRUE, TRUE),
  ('XRP', 'XRP Ledger', 'XRP', 1, 10, 20, 0.25, 0, '^r[1-9A-HJ-NP-Za-km-z]{24,34}$', TRUE, TRUE, TRUE),
  ('LTC', 'Litecoin Network', 'LTC', 6, 0.05, 0.05, 0.001, 0, '^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,39}$', FALSE, TRUE, TRUE),
  ('BCH', 'Bitcoin Cash', 'BCH', 6, 0.01, 0.02, 0.001, 0, '^(bitcoincash:)?[qp][a-z0-9]{41}$', FALSE, TRUE, TRUE),
  ('TRX', 'TRON Mainnet', 'TRX', 20, 10, 20, 1, 0, '^T[1-9A-HJ-NP-Za-km-z]{33}$', FALSE, TRUE, TRUE),
  ('SOL', 'Solana Mainnet', 'SOL', 32, 0.1, 0.2, 0.01, 0, '^[1-9A-HJ-NP-Za-km-z]{32,44}$', FALSE, TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Idempotent Supported Trading Pairs & Initial Zeroed Company Inventory
INSERT INTO public.trading_pairs (
  symbol, base_asset, quote_asset, fee_rate, min_order_usdt, venue_symbol, is_enabled,
  buy_spread_bps, sell_spread_bps, price_precision, quantity_precision, max_order_usdt
)
VALUES
  ('BTC/USDT', 'BTC', 'USDT', 0.001, 10, 'BTCUSDT', TRUE, 35, 35, 2, 8, 250000),
  ('ETH/USDT', 'ETH', 'USDT', 0.001, 10, 'ETHUSDT', TRUE, 40, 40, 2, 8, 250000),
  ('XRP/USDT', 'XRP', 'USDT', 0.001, 10, 'XRPUSDT', TRUE, 50, 50, 5, 6, 150000),
  ('LTC/USDT', 'LTC', 'USDT', 0.001, 10, 'LTCUSDT', TRUE, 50, 50, 2, 8, 150000),
  ('BCH/USDT', 'BCH', 'USDT', 0.001, 10, 'BCHUSDT', TRUE, 50, 50, 2, 8, 150000),
  ('TRX/USDT', 'TRX', 'USDT', 0.001, 10, 'TRXUSDT', TRUE, 50, 50, 6, 6, 150000),
  ('SOL/USDT', 'SOL', 'USDT', 0.001, 10, 'SOLUSDT', TRUE, 45, 45, 3, 8, 200000)
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO public.company_inventory (asset_symbol, available_amount, reserved_amount, committed_amount, min_threshold, trading_enabled)
SELECT symbol, 0, 0, 0, 0, TRUE
FROM public.assets
ON CONFLICT (asset_symbol) DO NOTHING;

INSERT INTO public.market_prices (pair_symbol, price, data_status, source_name)
SELECT symbol, 0, 'unavailable', 'unconfigured'
FROM public.trading_pairs
ON CONFLICT (pair_symbol) DO NOTHING;

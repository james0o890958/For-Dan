import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  ChangeBadge,
  ConfirmDialog,
  EmptyState,
  MarketFeedLabel,
} from '../../components/ui/CommonPrimitives';
import { PriceChart } from '../../components/ui/PriceChart';
import { useAppState } from '../../context/AppStateContext';
import type { TradeSide } from '../../types/domain';
import {
  calculateSpotBuyPreview,
  calculateSpotSellPreview,
  formatCryptoPrice,
  formatQty,
  formatUsdt,
  roundAmount,
} from '../../utils/tradingMath';

export const TradingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialPair = searchParams.get('pair') || 'BTC/USDT';
  const initialSide: TradeSide = searchParams.get('side') === 'sell' ? 'sell' : 'buy';

  const {
    currentProfile,
    tradingPairs,
    assets,
    marketPrices,
    marketSettings,
    currentUserBalances,
    currentUserOrders,
    currentUserTrades,
    submitSpotOrder,
  } = useAppState();

  const enabledPairs = useMemo(
    () =>
      tradingPairs.filter((p) => {
        const baseAsset = assets.find((a) => a.symbol === p.baseAsset);
        const quoteAsset = assets.find((a) => a.symbol === p.quoteAsset);
        return p.isEnabled && baseAsset?.isEnabled && quoteAsset?.isEnabled;
      }),
    [tradingPairs, assets]
  );

  const [selectedPairSymbol, setSelectedPairSymbol] = useState<string>(initialPair);
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amountInput, setAmountInput] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const activePair =
    enabledPairs.find((p) => p.symbol === selectedPairSymbol) ?? enabledPairs[0] ?? null;
  const activeMarket = activePair
    ? marketPrices.find((m) => m.symbol === activePair.symbol)
    : undefined;

  const usdtBalanceRow = currentUserBalances.find((b) => b.assetSymbol === 'USDT');
  const usdtBalance = usdtBalanceRow?.available ?? 0;
  const usdtReserved = usdtBalanceRow?.reserved ?? 0;
  const baseBalanceRow = activePair
    ? currentUserBalances.find((b) => b.assetSymbol === activePair.baseAsset)
    : undefined;
  const baseBalance = baseBalanceRow?.available ?? 0;
  const baseReserved = baseBalanceRow?.reserved ?? 0;

  const parsedAmount = Number(amountInput);

  const preview = useMemo(() => {
    if (!activePair || !activeMarket || !currentProfile) return null;
    const baseAsset = assets.find((a) => a.symbol === activePair.baseAsset);
    if (side === 'buy') {
      return calculateSpotBuyPreview({
        usdtAmount: parsedAmount,
        executionPrice: activeMarket.price,
        feeRate: activePair.feeRate,
        availableUsdt: usdtBalance,
        minOrderUsdt: activePair.minOrderUsdt,
        dataStatus: marketSettings.providerStatus,
        kycStatus: currentProfile.kycStatus,
        accountStatus: currentProfile.accountStatus,
        pairEnabled: activePair.isEnabled,
        assetEnabled: Boolean(baseAsset?.isEnabled),
      });
    }
    return calculateSpotSellPreview({
      baseQuantity: parsedAmount,
      executionPrice: activeMarket.price,
      feeRate: activePair.feeRate,
      availableBase: baseBalance,
      minOrderUsdt: activePair.minOrderUsdt,
      dataStatus: marketSettings.providerStatus,
      kycStatus: currentProfile.kycStatus,
      accountStatus: currentProfile.accountStatus,
      pairEnabled: activePair.isEnabled,
      assetEnabled: Boolean(baseAsset?.isEnabled),
    });
  }, [
    activePair,
    activeMarket,
    currentProfile,
    assets,
    side,
    parsedAmount,
    usdtBalance,
    baseBalance,
    marketSettings.providerStatus,
  ]);

  if (!currentProfile) {
    return (
      <CustomerLayout title="Trading">
        <EmptyState
          title="Sign in to trade"
          description="Spot trading requires an authenticated account with approved KYC verification and funded available balance."
          action={
            <Link
              to="/login"
              className="inline-flex px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Sign in
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  if (!activePair || !activeMarket) {
    return (
      <CustomerLayout title="Trading">
        <EmptyState
          title="No active trading pairs"
          description="All trading pairs are currently disabled by an administrator."
        />
      </CustomerLayout>
    );
  }

  const applyPct = (pct: number) => {
    if (side === 'buy') {
      setAmountInput(String(roundAmount(usdtBalance * pct, 2)));
    } else {
      setAmountInput(String(roundAmount(baseBalance * pct, 6)));
    }
  };

  const handleConfirmOrder = async () => {
    setSubmitting(true);
    const res = await submitSpotOrder({
      pairSymbol: activePair.symbol,
      side,
      amountInput: parsedAmount,
    });
    setSubmitting(false);
    setConfirmOpen(false);
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setAmountInput('');
    }
  };

  const unavailable = activeMarket.price <= 0 || marketSettings.providerStatus === 'unavailable';

  return (
    <CustomerLayout title="Trading">
      <div className="space-y-5">
        {/* Top Pair Bar */}
        <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label htmlFor="pair-select" className="sr-only">
                Select trading pair
              </label>
              <select
                id="pair-select"
                value={activePair.symbol}
                onChange={(e) => {
                  setSelectedPairSymbol(e.target.value);
                  setFeedback(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#E8EAEE] dark:bg-[#242528] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#004AE2]"
              >
                {enabledPairs.map((p) => (
                  <option key={p.symbol} value={p.symbol}>
                    {p.symbol}
                  </option>
                ))}
              </select>
            </div>

            <div className="font-mono-num">
              <p className="text-lg font-bold">
                {unavailable ? 'Feed Offline' : `${formatCryptoPrice(activeMarket.price)} USDT`}
              </p>
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                Liquidity Venue: {activePair.venueSymbol}
              </p>
            </div>

            <ChangeBadge changePct={activeMarket.change24hPct} unavailable={unavailable} />
          </div>

          <MarketFeedLabel status={marketSettings.providerStatus} />
        </div>

        {/* Main Split: Chart + Orders + Spot Order Form */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 space-y-5">
            <PriceChart
              symbol={activePair.symbol}
              candles={activeMarket.candles}
              currentPrice={activeMarket.price}
              changePct={activeMarket.change24hPct}
            />

            {/* Open & Recent Orders */}
            <section className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
              <h2 className="text-sm font-semibold">Spot Orders</h2>
              {currentUserOrders.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  No spot orders submitted yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                        <th className="py-2 pr-3 font-medium">Pair</th>
                        <th className="py-2 pr-3 font-medium">Side</th>
                        <th className="py-2 pr-3 font-medium text-right">Requested</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 font-medium">Venue Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                      {currentUserOrders.slice(0, 6).map((o) => (
                        <tr key={o.id}>
                          <td className="py-2.5 pr-3 font-sans font-semibold">{o.pairSymbol}</td>
                          <td
                            className={`py-2.5 pr-3 font-sans font-semibold uppercase ${
                              o.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                            }`}
                          >
                            {o.side}
                          </td>
                          <td className="py-2.5 pr-3 text-right">{formatQty(o.requestedAmount)}</td>
                          <td className="py-2.5 pr-3 font-sans font-semibold">{o.status}</td>
                          <td className="py-2.5 font-sans text-[#686D76] dark:text-[#7E828A]">
                            {o.rejectReason || o.venueOrderId || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Settled Trades */}
            <section className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
              <h2 className="text-sm font-semibold">Settled Trades</h2>
              {currentUserTrades.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  No settled spot trades recorded yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                        <th className="py-2 pr-3 font-medium">Pair</th>
                        <th className="py-2 pr-3 font-medium">Side</th>
                        <th className="py-2 pr-3 font-medium text-right">Price</th>
                        <th className="py-2 pr-3 font-medium text-right">Qty</th>
                        <th className="py-2 font-medium text-right">Total (USDT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                      {currentUserTrades.slice(0, 6).map((t) => (
                        <tr key={t.id}>
                          <td className="py-2.5 pr-3 font-sans font-semibold">{t.pairSymbol}</td>
                          <td
                            className={`py-2.5 pr-3 font-sans font-semibold uppercase ${
                              t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                            }`}
                          >
                            {t.side}
                          </td>
                          <td className="py-2.5 pr-3 text-right">{formatCryptoPrice(t.executedPrice)}</td>
                          <td className="py-2.5 pr-3 text-right">{formatQty(t.baseQuantity)}</td>
                          <td className="py-2.5 text-right">{formatUsdt(t.totalUsdt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Order Panel */}
          <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
            <div className="grid grid-cols-2 p-1 rounded-full bg-[#E8EAEE] dark:bg-[#242528]">
              <button
                type="button"
                onClick={() => {
                  setSide('buy');
                  setAmountInput('');
                  setFeedback(null);
                }}
                className={`py-2.5 rounded-full text-sm font-semibold transition-colors ${
                  side === 'buy'
                    ? 'bg-[#10C478] text-white'
                    : 'text-[#686D76] dark:text-[#9CA0A8]'
                }`}
              >
                Buy {activePair.baseAsset}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSide('sell');
                  setAmountInput('');
                  setFeedback(null);
                }}
                className={`py-2.5 rounded-full text-sm font-semibold transition-colors ${
                  side === 'sell'
                    ? 'bg-[#F0525E] text-white'
                    : 'text-[#686D76] dark:text-[#9CA0A8]'
                }`}
              >
                Sell {activePair.baseAsset}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-[#686D76] dark:text-[#7E828A]">
              <span>Order Type</span>
              <span className="font-semibold text-[#111214] dark:text-[#F4F5F7]">Market Order</span>
            </div>

            <div className="space-y-1 text-xs text-[#686D76] dark:text-[#7E828A]">
              <div className="flex items-center justify-between">
                <span>Available Balance</span>
                <span className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
                  {side === 'buy'
                    ? `${formatUsdt(usdtBalance)} USDT`
                    : `${formatQty(baseBalance)} ${activePair.baseAsset}`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Reserved Balance</span>
                <span className="font-mono-num">
                  {side === 'buy'
                    ? `${formatUsdt(usdtReserved)} USDT`
                    : `${formatQty(baseReserved)} ${activePair.baseAsset}`}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="spot-amount" className="block text-xs font-medium mb-1.5">
                {side === 'buy'
                  ? 'Amount (USDT)'
                  : `Quantity (${activePair.baseAsset})`}
              </label>
              <div className="relative flex items-center">
                <input
                  id="spot-amount"
                  type="number"
                  step="any"
                  min="0"
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    if (feedback) setFeedback(null);
                  }}
                  placeholder="0.00"
                  className="w-full h-12 pl-4 pr-16 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm focus:outline-none focus:border-[#004AE2]"
                />
                <span className="absolute right-4 text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                  {side === 'buy' ? 'USDT' : activePair.baseAsset}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[0.25, 0.5, 0.75, 1].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => applyPct(pct)}
                  className="py-1.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-xs font-mono-num font-medium hover:opacity-90"
                >
                  {pct * 100}%
                </button>
              ))}
            </div>

            {/* Estimated Summary */}
            <dl className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Market Price</dt>
                <dd className="font-mono-num font-semibold">
                  {unavailable ? 'Offline' : `${formatCryptoPrice(activeMarket.price)} USDT`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76] dark:text-[#7E828A]">
                  Fee ({(activePair.feeRate * 100).toFixed(2)}%)
                </dt>
                <dd className="font-mono-num font-semibold">
                  {preview?.valid ? `${formatUsdt(preview.feeUsdt)} USDT` : '0.00 USDT'}
                </dd>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-[#E2E4E9] dark:border-[#22242A]">
                <dt className="font-semibold">
                  {side === 'buy' ? `Estimated ${activePair.baseAsset}` : 'Estimated Receive'}
                </dt>
                <dd className="font-mono-num font-bold text-sm">
                  {preview?.valid
                    ? side === 'buy'
                      ? `${formatQty(preview.baseQuantity)} ${activePair.baseAsset}`
                      : `${formatUsdt(preview.netUsdt)} USDT`
                    : '—'}
                </dd>
              </div>
            </dl>

            {preview &&
              !preview.valid &&
              preview.error &&
              (amountInput.trim() !== '' ||
                currentProfile.kycStatus !== 'approved' ||
                currentProfile.accountStatus === 'suspended' ||
                unavailable) && (
                <p role="alert" className="text-xs font-medium text-[#F0525E]">
                  {preview.error}
                </p>
              )}

            {feedback && (
              <p
                role="status"
                className={`text-xs font-medium ${
                  feedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'
                }`}
              >
                {feedback.text}
              </p>
            )}

            <button
              type="button"
              disabled={!preview?.valid || submitting}
              onClick={() => setConfirmOpen(true)}
              className={`w-full h-12 rounded-full text-sm font-semibold text-white transition-opacity disabled:opacity-45 disabled:cursor-not-allowed ${
                side === 'buy' ? 'bg-[#10C478]' : 'bg-[#F0525E]'
              }`}
            >
              {side === 'buy'
                ? `Market Buy ${activePair.baseAsset}`
                : `Market Sell ${activePair.baseAsset}`}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Confirm Market ${side === 'buy' ? 'Buy' : 'Sell'}`}
        description="Spot market orders route through the configured liquidity venue and settle into your available asset ledger."
        details={
          preview
            ? [
                { label: 'Trading Pair', value: activePair.symbol },
                { label: 'Order Side', value: side === 'buy' ? 'Market Buy' : 'Market Sell' },
                { label: 'Reference Price', value: `${formatCryptoPrice(preview.executionPrice)} USDT` },
                {
                  label: 'Quantity',
                  value: `${formatQty(preview.baseQuantity)} ${activePair.baseAsset}`,
                },
                { label: 'Fee', value: `${formatUsdt(preview.feeUsdt)} USDT` },
                {
                  label: side === 'buy' ? 'Total Spent' : 'Net Receive',
                  value: `${formatUsdt(preview.netUsdt)} USDT`,
                },
              ]
            : []
        }
        confirmLabel={submitting ? 'Submitting...' : 'Confirm Market Order'}
        onConfirm={handleConfirmOrder}
        onCancel={() => setConfirmOpen(false)}
      />
    </CustomerLayout>
  );
};

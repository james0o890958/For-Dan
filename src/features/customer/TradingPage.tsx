import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { MarketPairHeader } from '../../components/trading/MarketPairHeader';
import { OrderEntryPanel } from '../../components/trading/OrderEntryPanel';
import { OrderPreviewModal } from '../../components/trading/OrderPreviewModal';
import { EmptyState } from '../../components/ui/CommonPrimitives';
import { OrderBook } from '../../components/ui/OrderBook';
import { PriceChart } from '../../components/ui/PriceChart';
import { TradeHistoryPanel } from '../../components/ui/TradeHistoryPanel';
import { useAppState } from '../../context/AppStateContext';
import type { TradeSide } from '../../types/domain';
import { SANDBOX_REFERENCE_MARKETS } from '../../utils/overviewModel';
import {
  computeAllocationShortcut,
  evaluateTradingOrder,
  formatEditablePrice,
  syncQuantityFromTotal,
  syncTotalFromQuantity,
  type OrderEntryType,
} from '../../utils/tradingWorkspace';

interface TradeRouteState {
  selectedPair?: string;
  side?: TradeSide;
}

export const TradingPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const routeState = (location.state as TradeRouteState | null) ?? null;

  const queryPair = searchParams.get('pair');
  const querySide = searchParams.get('side');
  const initialPair = (queryPair || routeState?.selectedPair || 'BTC/USDT').toUpperCase();
  const initialSide: TradeSide =
    querySide === 'sell' || (!querySide && routeState?.side === 'sell') ? 'sell' : 'buy';

  const {
    currentProfile,
    tradingPairs,
    assets,
    marketPrices,
    marketSettings,
    marketLoading,
    marketFeedIsCached,
    marketFeedError,
    refreshMarketTickers,
    watchlist,
    toggleWatchlist,
    isWatchlisted,
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
  const [orderType, setOrderType] = useState<OrderEntryType>('limit');
  const [stopPriceInput, setStopPriceInput] = useState<string>('');
  const [priceInput, setPriceInput] = useState<string>('');
  const [quantityInput, setQuantityInput] = useState<string>('');
  const [totalInput, setTotalInput] = useState<string>('');
  const [lastEditedField, setLastEditedField] = useState<'quantity' | 'total'>('quantity');
  const [bookPriceApplied, setBookPriceApplied] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const priceSourceRef = useRef<'none' | 'reference' | 'live' | 'user'>('none');
  const prevPairRef = useRef<string>(initialPair);

  useEffect(() => {
    const targetPair = searchParams.get('pair') || routeState?.selectedPair;
    if (targetPair) {
      setSelectedPairSymbol(targetPair.toUpperCase());
    }
    const targetSide = searchParams.get('side') || routeState?.side;
    if (targetSide === 'buy' || targetSide === 'sell') {
      setSide(targetSide);
    }
  }, [searchParams, routeState]);

  const activePair =
    enabledPairs.find((p) => p.symbol === selectedPairSymbol) ?? enabledPairs[0] ?? null;
  const activeMarket = activePair
    ? marketPrices.find((m) => m.symbol === activePair.symbol)
    : undefined;

  const refQuote = activePair ? SANDBOX_REFERENCE_MARKETS[activePair.symbol] : undefined;
  const hasLiveMarketQuote = Boolean(activeMarket && activeMarket.price > 0);
  const effectiveMarketPrice = hasLiveMarketQuote
    ? activeMarket!.price
    : (refQuote?.price ?? 0);

  // Reset form fields cleanly when pair changes; prefill/upgrade limit price when live quote arrives
  useEffect(() => {
    if (!activePair) return;
    if (prevPairRef.current !== activePair.symbol) {
      prevPairRef.current = activePair.symbol;
      priceSourceRef.current = hasLiveMarketQuote
        ? 'live'
        : effectiveMarketPrice > 0
          ? 'reference'
          : 'none';
      setBookPriceApplied(null);
      setStopPriceInput('');
      setQuantityInput('');
      setTotalInput('');
      setFeedback(null);
      setPriceInput(effectiveMarketPrice > 0 ? formatEditablePrice(effectiveMarketPrice) : '');
      return;
    }

    if (hasLiveMarketQuote && (priceSourceRef.current === 'none' || priceSourceRef.current === 'reference')) {
      priceSourceRef.current = 'live';
      setPriceInput(formatEditablePrice(activeMarket!.price));
    } else if (priceSourceRef.current === 'none' && effectiveMarketPrice > 0 && priceInput === '') {
      priceSourceRef.current = 'reference';
      setPriceInput(formatEditablePrice(effectiveMarketPrice));
    }
  }, [activePair, activeMarket, hasLiveMarketQuote, effectiveMarketPrice, priceInput]);

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

  const baseAssetMeta = assets.find((a) => a.symbol === activePair.baseAsset);
  const quoteAssetMeta = assets.find((a) => a.symbol === activePair.quoteAsset);

  const usdtBalanceRow = currentUserBalances.find((b) => b.assetSymbol === 'USDT');
  const usdtBalance = usdtBalanceRow?.available ?? 0;
  const usdtReserved = usdtBalanceRow?.reserved ?? 0;
  const baseBalanceRow = currentUserBalances.find((b) => b.assetSymbol === activePair.baseAsset);
  const baseBalance = baseBalanceRow?.available ?? 0;
  const baseReserved = baseBalanceRow?.reserved ?? 0;

  const evaluation = evaluateTradingOrder({
    side,
    orderType,
    stopPriceInput,
    priceInput,
    quantityInput,
    totalInput,
    lastEditedField,
    marketPrice: activeMarket.price,
    referencePrice: refQuote?.price ?? 0,
    feeRate: activePair.feeRate,
    minOrderUsdt: activePair.minOrderUsdt,
    availableUsdt: usdtBalance,
    availableBase: baseBalance,
    dataStatus: marketSettings.providerStatus,
    isAuthenticated: Boolean(currentProfile),
    accountStatus: currentProfile?.accountStatus ?? 'active',
    kycStatus: currentProfile?.kycStatus ?? 'not_submitted',
    pairEnabled: activePair.isEnabled,
    assetEnabled: Boolean(baseAssetMeta?.isEnabled && quoteAssetMeta?.isEnabled),
    baseAsset: activePair.baseAsset,
  });

  const handleSelectPair = (nextPair: string) => {
    setSelectedPairSymbol(nextPair);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('pair', nextPair);
        return next;
      },
      { replace: true }
    );
  };

  const handleChangeSide = (nextSide: TradeSide) => {
    setSide(nextSide);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('side', nextSide);
        return next;
      },
      { replace: true }
    );
    setFeedback(null);
  };

  const syncWithPrice = (nextUnitPrice: number, fieldPreference = lastEditedField) => {
    if (nextUnitPrice <= 0) return;
    if (fieldPreference === 'quantity' && quantityInput.trim() !== '') {
      const qty = Number(quantityInput);
      const synced = syncTotalFromQuantity({ quantity: qty, unitPrice: nextUnitPrice });
      setTotalInput(synced.totalStr);
    } else if (fieldPreference === 'total' && totalInput.trim() !== '') {
      const total = Number(totalInput);
      const synced = syncQuantityFromTotal({ totalUsdt: total, unitPrice: nextUnitPrice });
      setQuantityInput(synced.quantityStr);
    }
  };

  const handleChangeOrderType = (nextType: OrderEntryType) => {
    setOrderType(nextType);
    setFeedback(null);
    if (nextType === 'market') {
      syncWithPrice(effectiveMarketPrice);
    } else {
      const currentParsed = Number(priceInput);
      const priceToUse =
        Number.isFinite(currentParsed) && currentParsed > 0
          ? currentParsed
          : effectiveMarketPrice;
      if ((!Number.isFinite(currentParsed) || currentParsed <= 0) && effectiveMarketPrice > 0) {
        priceSourceRef.current = hasLiveMarketQuote ? 'live' : 'reference';
        setPriceInput(formatEditablePrice(effectiveMarketPrice));
      }
      syncWithPrice(priceToUse);
    }
  };

  const handleChangePrice = (raw: string) => {
    priceSourceRef.current = 'user';
    setBookPriceApplied(null);
    setPriceInput(raw);
    if (feedback) setFeedback(null);
    const parsedPrice = Number(raw);
    if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
      syncWithPrice(parsedPrice);
    }
  };

  const handleFillMarketPrice = () => {
    if (effectiveMarketPrice <= 0) return;
    priceSourceRef.current = hasLiveMarketQuote ? 'live' : 'reference';
    setBookPriceApplied(null);
    setPriceInput(formatEditablePrice(effectiveMarketPrice));
    syncWithPrice(effectiveMarketPrice);
  };

  const handleResetBookPrice = () => {
    setBookPriceApplied(null);
    if (effectiveMarketPrice > 0) {
      priceSourceRef.current = hasLiveMarketQuote ? 'live' : 'reference';
      setPriceInput(formatEditablePrice(effectiveMarketPrice));
      syncWithPrice(effectiveMarketPrice);
    }
  };

  const handleSelectOrderBookPrice = (price: number, suggestedSide: TradeSide) => {
    priceSourceRef.current = 'user';
    setBookPriceApplied(price);
    if (orderType === 'market') {
      setOrderType('limit');
    }
    setSide(suggestedSide);
    setPriceInput(formatEditablePrice(price));
    syncWithPrice(price);
    setFeedback(null);
  };

  const handleChangeQuantity = (raw: string) => {
    setLastEditedField('quantity');
    setQuantityInput(raw);
    if (feedback) setFeedback(null);
    if (raw.trim() === '') {
      setTotalInput('');
      return;
    }
    const qty = Number(raw);
    const unitPrice =
      orderType === 'market'
        ? effectiveMarketPrice
        : Number(priceInput) > 0
          ? Number(priceInput)
          : effectiveMarketPrice;
    const synced = syncTotalFromQuantity({ quantity: qty, unitPrice });
    setTotalInput(synced.totalStr);
  };

  const handleChangeTotal = (raw: string) => {
    setLastEditedField('total');
    setTotalInput(raw);
    if (feedback) setFeedback(null);
    if (raw.trim() === '') {
      setQuantityInput('');
      return;
    }
    const totalUsdt = Number(raw);
    const unitPrice =
      orderType === 'market'
        ? effectiveMarketPrice
        : Number(priceInput) > 0
          ? Number(priceInput)
          : effectiveMarketPrice;
    const synced = syncQuantityFromTotal({ totalUsdt, unitPrice });
    setQuantityInput(synced.quantityStr);
  };

  const handleApplyPercentage = (pct: number) => {
    const unitPrice = evaluation.effectivePrice > 0 ? evaluation.effectivePrice : effectiveMarketPrice;
    const res = computeAllocationShortcut({
      side,
      pct,
      effectivePrice: unitPrice,
      availableUsdt: usdtBalance,
      availableBase: baseBalance,
    });
    if (!res.hasBalance) return;
    setLastEditedField(side === 'buy' ? 'total' : 'quantity');
    setQuantityInput(res.quantityStr);
    setTotalInput(res.totalStr);
    setFeedback(null);
  };

  const handleConfirmOrder = async () => {
    if (!evaluation.canSubmitOrder) return;
    setSubmitting(true);
    const res = await submitSpotOrder({
      pairSymbol: activePair.symbol,
      side,
      amountInput: evaluation.submitAmountInput,
      orderType: orderType === 'limit' ? 'LIMIT' : 'MARKET',
      limitPrice: orderType === 'limit' ? evaluation.effectivePrice : undefined,
    });
    setSubmitting(false);
    setPreviewOpen(false);
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setQuantityInput('');
      setTotalInput('');
    }
  };

  return (
    <CustomerLayout title="Trading">
      <div className="space-y-4">
        <MarketPairHeader
          activePair={activePair}
          activeMarket={activeMarket}
          baseAssetMeta={baseAssetMeta}
          quoteAssetMeta={quoteAssetMeta}
          pairs={tradingPairs}
          marketPrices={marketPrices}
          assets={assets}
          watchlist={watchlist}
          isWatchlisted={isWatchlisted(activePair.symbol)}
          providerStatus={marketSettings.providerStatus}
          marketLoading={marketLoading}
          marketFeedIsCached={marketFeedIsCached}
          marketFeedError={marketFeedError}
          onSelectPair={handleSelectPair}
          onToggleWatchlist={toggleWatchlist}
          onRefreshMarket={() => void refreshMarketTickers()}
        />

        {/* Core Terminal Grid: Chart + Order Book + Order Entry */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 items-start">
          <div className="md:col-span-2 lg:col-span-6">
            <PriceChart
              symbol={activePair.symbol}
              candles={activeMarket.candles}
              currentPrice={activeMarket.price}
              changePct={activeMarket.change24hPct}
              allowIllustrativeFallback={true}
              fallbackReferencePrice={refQuote?.price ?? 0}
              fallbackChangePct={refQuote?.change24hPct ?? 0}
            />
          </div>

          <div className="md:col-span-1 lg:col-span-3">
            <OrderBook
              symbol={activePair.symbol}
              currentPrice={activeMarket.price}
              onSelectPrice={handleSelectOrderBookPrice}
            />
          </div>

          <div className="md:col-span-1 lg:col-span-3">
            <OrderEntryPanel
              activePair={activePair}
              side={side}
              orderType={orderType}
              stopPriceInput={stopPriceInput}
              priceInput={priceInput}
              quantityInput={quantityInput}
              totalInput={totalInput}
              bookPriceApplied={bookPriceApplied}
              effectiveMarketPrice={effectiveMarketPrice}
              usingReferenceFallback={evaluation.usingReferenceFallback}
              isAuthenticated={Boolean(currentProfile)}
              availableUsdt={usdtBalance}
              reservedUsdt={usdtReserved}
              availableBase={baseBalance}
              reservedBase={baseReserved}
              evaluation={evaluation}
              submitting={submitting}
              feedback={feedback}
              onChangeSide={handleChangeSide}
              onChangeOrderType={handleChangeOrderType}
              onChangeStopPrice={(val) => {
                setStopPriceInput(val);
                if (feedback) setFeedback(null);
              }}
              onChangePrice={handleChangePrice}
              onFillMarketPrice={handleFillMarketPrice}
              onResetBookPrice={handleResetBookPrice}
              onChangeQuantity={handleChangeQuantity}
              onChangeTotal={handleChangeTotal}
              onApplyPercentage={handleApplyPercentage}
              onOpenPreview={() => setPreviewOpen(true)}
            />
          </div>
        </div>

        {/* Bottom Workspace: Recent Market Trades + Open Orders + Order History + Trade History */}
        <TradeHistoryPanel
          symbol={activePair.symbol}
          showAccountTabs={true}
          userTrades={currentUserTrades}
          userOrders={currentUserOrders}
          isAuthenticated={Boolean(currentProfile)}
          onSelectPrice={handleSelectOrderBookPrice}
        />
      </div>

      <OrderPreviewModal
        open={previewOpen}
        pair={activePair}
        evaluation={evaluation}
        submitting={submitting}
        onConfirm={() => void handleConfirmOrder()}
        onClose={() => setPreviewOpen(false)}
      />
    </CustomerLayout>
  );
};

import React from 'react';
import { Link } from 'react-router-dom';
import type { TradingPair, TradeSide } from '../../types/domain';
import { formatMarketPriceDisplay } from '../../utils/overviewModel';
import { formatQty, formatUsdt } from '../../utils/tradingMath';
import type { OrderEntryType, TradingOrderEvaluation } from '../../utils/tradingWorkspace';

interface OrderEntryPanelProps {
  activePair: TradingPair;
  side: TradeSide;
  orderType: OrderEntryType;
  stopPriceInput: string;
  priceInput: string;
  quantityInput: string;
  totalInput: string;
  bookPriceApplied: number | null;
  effectiveMarketPrice: number;
  usingReferenceFallback: boolean;
  isAuthenticated: boolean;
  availableUsdt: number;
  reservedUsdt: number;
  availableBase: number;
  reservedBase: number;
  evaluation: TradingOrderEvaluation;
  submitting: boolean;
  feedback: { ok: boolean; text: string } | null;
  onChangeSide: (side: TradeSide) => void;
  onChangeOrderType: (orderType: OrderEntryType) => void;
  onChangeStopPrice: (value: string) => void;
  onChangePrice: (value: string) => void;
  onFillMarketPrice: () => void;
  onResetBookPrice: () => void;
  onChangeQuantity: (value: string) => void;
  onChangeTotal: (value: string) => void;
  onApplyPercentage: (pct: number) => void;
  onOpenPreview: () => void;
}

const ORDER_TYPES: Array<{ id: OrderEntryType; label: string }> = [
  { id: 'limit', label: 'Limit' },
  { id: 'market', label: 'Market' },
  { id: 'stop_limit', label: 'Stop-Limit' },
];

export const OrderEntryPanel: React.FC<OrderEntryPanelProps> = ({
  activePair,
  side,
  orderType,
  stopPriceInput,
  priceInput,
  quantityInput,
  totalInput,
  bookPriceApplied,
  effectiveMarketPrice,
  usingReferenceFallback,
  isAuthenticated,
  availableUsdt,
  reservedUsdt,
  availableBase,
  reservedBase,
  evaluation,
  submitting,
  feedback,
  onChangeSide,
  onChangeOrderType,
  onChangeStopPrice,
  onChangePrice,
  onFillMarketPrice,
  onResetBookPrice,
  onChangeQuantity,
  onChangeTotal,
  onApplyPercentage,
  onOpenPreview,
}) => {
  const activeSideBalance = side === 'buy' ? availableUsdt : availableBase;
  const activeSideReserved = side === 'buy' ? reservedUsdt : reservedBase;
  const allocationDisabled = !isAuthenticated || activeSideBalance <= 0 || evaluation.effectivePrice <= 0;

  const orderTypeLabel =
    orderType === 'limit' ? 'Limit' : orderType === 'market' ? 'Market' : 'Stop-Limit';
  const sideActionLabel = side === 'buy' ? 'Buy' : 'Sell';

  return (
    <section
      data-testid="order-entry-panel"
      aria-label="Spot Order Entry"
      className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3.5"
    >
      {/* Buy / Sell Toggle */}
      <div
        className="grid grid-cols-2 p-1 rounded-lg bg-[#E8EAEE] dark:bg-[#242528]"
        role="group"
        aria-label="Order side"
      >
        <button
          type="button"
          onClick={() => onChangeSide('buy')}
          aria-pressed={side === 'buy'}
          className={`py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
            side === 'buy'
              ? 'bg-[#10C478] text-white'
              : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
          }`}
        >
          Buy {activePair.baseAsset}
        </button>
        <button
          type="button"
          onClick={() => onChangeSide('sell')}
          aria-pressed={side === 'sell'}
          className={`py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
            side === 'sell'
              ? 'bg-[#F0525E] text-white'
              : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
          }`}
        >
          Sell {activePair.baseAsset}
        </button>
      </div>

      {/* Order Type Tabs */}
      <div
        className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]"
        role="tablist"
        aria-label="Order type"
      >
        {ORDER_TYPES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={orderType === tab.id}
            onClick={() => onChangeOrderType(tab.id)}
            className={`py-1.5 px-2 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
              orderType === tab.id
                ? 'bg-white dark:bg-[#1E2026] text-[#111214] dark:text-white shadow-xs'
                : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Stop-Limit Honest Sandbox Disclosure */}
      {orderType === 'stop_limit' && (
        <div
          data-testid="stop-limit-sandbox-notice"
          className="rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D97706]/40 px-3 py-2 text-[11px] text-[#4B5059] dark:text-[#9CA0A8]"
        >
          <span className="font-semibold text-[#D97706]">Preview Only</span> · Conditional stop-trigger matching is inactive in sandbox. Use Limit or Market to preview submission checks.
        </div>
      )}

      {/* Order Book Price Applied Note */}
      {bookPriceApplied !== null && orderType !== 'market' && (
        <div
          data-testid="selected-book-price-note"
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] text-[11px]"
        >
          <span className="text-[#4B5059] dark:text-[#9CA0A8]">
            Order book price applied:{' '}
            <strong className="font-mono-num text-[#111214] dark:text-[#F4F5F7]">
              {formatMarketPriceDisplay(bookPriceApplied)} USDT
            </strong>
          </span>
          <button
            type="button"
            onClick={onResetBookPrice}
            aria-label="Reset book reference price"
            className="text-[#004AE2] dark:text-[#60A5FA] font-semibold hover:underline shrink-0"
          >
            Reset
          </button>
        </div>
      )}

      {/* Available & Reserved Balances */}
      <div className="space-y-1 text-xs text-[#686D76] dark:text-[#7E828A]">
        <div className="flex items-center justify-between gap-2">
          <span>Available</span>
          <span className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {isAuthenticated
              ? side === 'buy'
                ? `${formatUsdt(availableUsdt)} USDT`
                : `${formatQty(availableBase)} ${activePair.baseAsset}`
              : '0.00 (Sandbox Guest)'}
          </span>
        </div>
        {isAuthenticated && (
          <div className="flex items-center justify-between gap-2">
            <span>Reserved</span>
            <span className="font-mono-num">
              {side === 'buy'
                ? `${formatUsdt(reservedUsdt)} USDT`
                : `${formatQty(reservedBase)} ${activePair.baseAsset}`}
            </span>
          </div>
        )}
      </div>

      {/* Stop Price Input (Stop-Limit Only) */}
      {orderType === 'stop_limit' && (
        <div>
          <label htmlFor="order-stop-price" className="block text-xs font-medium mb-1">
            Stop Trigger Price
          </label>
          <div className="relative flex items-center">
            <input
              id="order-stop-price"
              type="number"
              step="any"
              min="0"
              value={stopPriceInput}
              onChange={(e) => onChangeStopPrice(e.target.value)}
              placeholder="0.00"
              className="w-full h-10 pl-3 pr-14 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm focus:outline-none focus:border-[#004AE2]"
            />
            <span className="absolute right-3 text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
              USDT
            </span>
          </div>
        </div>
      )}

      {/* Limit Price or Market Reference Price */}
      {orderType === 'market' ? (
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium">Market Price</span>
            <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
              {usingReferenceFallback ? 'Reference quote' : 'Best venue quote'}
            </span>
          </div>
          <div
            data-testid="market-order-price-display"
            className="h-10 px-3 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] flex items-center justify-between text-xs font-mono-num"
          >
            <span className="text-[#111214] dark:text-[#F4F5F7] font-semibold">
              {effectiveMarketPrice > 0
                ? `${formatMarketPriceDisplay(effectiveMarketPrice)}`
                : 'Feed Offline'}
            </span>
            <span className="text-[#686D76] dark:text-[#7E828A] font-sans font-semibold">USDT</span>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="order-limit-price" className="text-xs font-medium">
              Limit Price
            </label>
            <button
              type="button"
              onClick={onFillMarketPrice}
              disabled={effectiveMarketPrice <= 0}
              className="text-[11px] font-semibold text-[#004AE2] dark:text-[#60A5FA] hover:underline disabled:opacity-45"
            >
              Use Last
            </button>
          </div>
          <div className="relative flex items-center">
            <input
              id="order-limit-price"
              type="number"
              step="any"
              min="0"
              value={priceInput}
              onChange={(e) => onChangePrice(e.target.value)}
              placeholder="0.00"
              className="w-full h-10 pl-3 pr-14 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm focus:outline-none focus:border-[#004AE2]"
            />
            <span className="absolute right-3 text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
              USDT
            </span>
          </div>
        </div>
      )}

      {/* Base Quantity Input */}
      <div>
        <label htmlFor="order-quantity" className="block text-xs font-medium mb-1">
          Quantity ({activePair.baseAsset})
        </label>
        <div className="relative flex items-center">
          <input
            id="order-quantity"
            type="number"
            step="any"
            min="0"
            value={quantityInput}
            onChange={(e) => onChangeQuantity(e.target.value)}
            placeholder="0.0000"
            className="w-full h-10 pl-3 pr-16 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm focus:outline-none focus:border-[#004AE2]"
          />
          <span className="absolute right-3 text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
            {activePair.baseAsset}
          </span>
        </div>
      </div>

      {/* Quote Total Input */}
      <div>
        <label htmlFor="order-total" className="block text-xs font-medium mb-1">
          Total ({activePair.quoteAsset})
        </label>
        <div className="relative flex items-center">
          <input
            id="order-total"
            type="number"
            step="any"
            min="0"
            value={totalInput}
            onChange={(e) => onChangeTotal(e.target.value)}
            placeholder="0.00"
            className="w-full h-10 pl-3 pr-14 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm focus:outline-none focus:border-[#004AE2]"
          />
          <span className="absolute right-3 text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
            {activePair.quoteAsset}
          </span>
        </div>
      </div>

      {/* Allocation Percentage Shortcuts */}
      <div>
        <div className="grid grid-cols-4 gap-1.5">
          {[0.25, 0.5, 0.75, 1].map((pct) => (
            <button
              key={pct}
              type="button"
              disabled={allocationDisabled}
              onClick={() => onApplyPercentage(pct)}
              title={
                allocationDisabled
                  ? 'Available balance required for allocation shortcuts'
                  : `Allocate ${pct * 100}% of available ${side === 'buy' ? 'USDT' : activePair.baseAsset}`
              }
              className="py-1.5 rounded-md bg-[#E8EAEE] dark:bg-[#242528] text-xs font-mono-num font-medium text-[#111214] dark:text-[#F4F5F7] hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {pct * 100}%
            </button>
          ))}
        </div>
        {allocationDisabled && (
          <p className="mt-1 text-[11px] text-[#686D76] dark:text-[#7E828A]">
            {isAuthenticated
              ? `Zero available ${side === 'buy' ? 'USDT' : activePair.baseAsset} balance (${formatUsdt(activeSideReserved)} reserved).`
              : 'Sign in with a funded balance to enable % allocation shortcuts.'}
          </p>
        )}
      </div>

      {/* Summary Metrics */}
      <dl className="rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-[#686D76] dark:text-[#7E828A]">
            {usingReferenceFallback && orderType === 'market' ? 'Reference Price' : 'Order Price'}
          </dt>
          <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {evaluation.effectivePrice > 0
              ? `${formatMarketPriceDisplay(evaluation.effectivePrice)} USDT`
              : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[#686D76] dark:text-[#7E828A]">
            Est. Fee ({(activePair.feeRate * 100).toFixed(2)}%)
          </dt>
          <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {evaluation.mathValid ? `${formatUsdt(evaluation.feeUsdt)} USDT` : '0.00 USDT'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[#686D76] dark:text-[#7E828A]">
            {side === 'buy' ? `Est. Receive (${activePair.baseAsset})` : 'Est. Net Total'}
          </dt>
          <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {evaluation.mathValid
              ? side === 'buy'
                ? `${formatQty(evaluation.netReceiveBase)} ${activePair.baseAsset}`
                : `${formatUsdt(evaluation.netUsdt)} USDT`
              : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-2 pt-1.5 border-t border-[#E2E4E9] dark:border-[#22242A]">
          <dt className="text-[#686D76] dark:text-[#7E828A]">Est. Balance After</dt>
          <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {evaluation.balancePreview.afterAssetText}
          </dd>
        </div>
      </dl>

      {/* Inline Validation Message */}
      {evaluation.primaryValidationError && (
        <p role="alert" data-testid="order-validation-alert" className="text-xs font-medium text-[#F0525E]">
          {evaluation.primaryValidationError}
        </p>
      )}

      {/* Submission Result Feedback */}
      {feedback && (
        <p
          role="status"
          data-testid="order-submission-feedback"
          className={`text-xs font-medium ${feedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}
        >
          {feedback.text}
        </p>
      )}

      {/* Primary Preview CTA */}
      <button
        type="button"
        data-testid="review-order-button"
        disabled={!evaluation.canOpenPreview || submitting}
        onClick={onOpenPreview}
        className={`w-full h-11 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-45 disabled:cursor-not-allowed ${
          side === 'buy' ? 'bg-[#10C478]' : 'bg-[#F0525E]'
        }`}
      >
        Preview {orderTypeLabel} {sideActionLabel} ({activePair.baseAsset})
      </button>

      {!isAuthenticated && (
        <div className="pt-1 text-center">
          <Link
            to="/login"
            className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA] hover:underline"
          >
            Sign in with verified KYC account to submit orders
          </Link>
        </div>
      )}
    </section>
  );
};

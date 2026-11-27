import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ReceivingAddress, TradingPair } from '../../types/domain';
import {
  MANUAL_PURCHASE_INTERNAL_LEDGER_DISCLOSURE,
  type ManualPurchaseQuote,
} from '../../utils/manualPurchaseEngine';
import { formatMarketPriceDisplay } from '../../utils/overviewModel';
import { formatQty, formatUsdt } from '../../utils/tradingMath';
import type { TradingOrderEvaluation } from '../../utils/tradingWorkspace';

interface OrderPreviewModalProps {
  open: boolean;
  pair: TradingPair;
  evaluation: TradingOrderEvaluation;
  manualPurchaseQuote?: ManualPurchaseQuote;
  selectedReceivingAddress?: ReceivingAddress;
  submitting: boolean;
  onConfirm: () => void;
  onConfirmManualPurchase?: () => void;
  onClose: () => void;
}

export const OrderPreviewModal: React.FC<OrderPreviewModalProps> = ({
  open,
  pair,
  evaluation,
  manualPurchaseQuote,
  selectedReceivingAddress,
  submitting,
  onConfirm,
  onConfirmManualPurchase,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sideLabel = evaluation.side === 'buy' ? `Buy ${pair.baseAsset}` : `Sell ${pair.baseAsset}`;
  const orderTypeLabel =
    evaluation.orderType === 'limit'
      ? 'Limit Order'
      : evaluation.orderType === 'market'
        ? 'Market Order'
        : 'Stop-Limit (Preview Only)';

  const isManualBuyMode =
    evaluation.side === 'buy' &&
    evaluation.orderType !== 'stop_limit' &&
    Boolean(onConfirmManualPurchase);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-preview-title"
      data-testid="order-preview-modal"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#24252C] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="order-preview-title"
              className="text-base font-semibold text-[#111214] dark:text-[#F4F5F7]"
            >
              {isManualBuyMode
                ? `Manual Crypto Purchase Preview · ${pair.symbol}`
                : `Spot Order Preview · ${pair.symbol}`}
            </h2>
            <p className="mt-0.5 text-xs text-[#686D76] dark:text-[#9CA0A8]">
              {isManualBuyMode
                ? 'Review recalculated payment total, estimated crypto received, fee, and payment network before generating payment instructions.'
                : 'Review calculated order sizing, fees, and sandbox execution restrictions before proceeding.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order preview"
            className="p-1.5 rounded-lg text-[#686D76] hover:text-[#111214] dark:hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary Details */}
        <dl className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">Trading Pair</dt>
            <dd className="font-semibold text-[#111214] dark:text-[#F4F5F7]">{pair.symbol}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">Order Side</dt>
            <dd
              className={`font-semibold ${
                evaluation.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
              }`}
            >
              {sideLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">Order Type</dt>
            <dd className="font-semibold text-[#111214] dark:text-[#F4F5F7]">{orderTypeLabel}</dd>
          </div>
          {isManualBuyMode && selectedReceivingAddress && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#686D76] dark:text-[#7E828A]">Payment Network</dt>
              <dd className="font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                {selectedReceivingAddress.assetSymbol} ({selectedReceivingAddress.networkCode})
              </dd>
            </div>
          )}
          {evaluation.orderType === 'stop_limit' && evaluation.stopPrice !== null && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#686D76] dark:text-[#7E828A]">Stop Trigger Price</dt>
              <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
                {formatMarketPriceDisplay(evaluation.stopPrice)} USDT
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">
              {evaluation.orderType === 'market' ? 'Reference Price' : 'Limit Price'}
            </dt>
            <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
              {formatMarketPriceDisplay(
                isManualBuyMode && manualPurchaseQuote?.valid
                  ? manualPurchaseQuote.effectivePrice
                  : evaluation.effectivePrice
              )}{' '}
              USDT
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">
              {isManualBuyMode ? 'Total Payment Amount' : 'Estimated Gross Total'}
            </dt>
            <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
              {formatUsdt(
                isManualBuyMode && manualPurchaseQuote?.valid
                  ? manualPurchaseQuote.totalPaymentAmount
                  : evaluation.quoteGrossUsdt
              )}{' '}
              USDT
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">
              Estimated Fee ({(pair.feeRate * 100).toFixed(2)}%)
            </dt>
            <dd className="font-mono-num font-semibold text-[#111214] dark:text-[#F4F5F7]">
              {formatUsdt(
                isManualBuyMode && manualPurchaseQuote?.valid
                  ? manualPurchaseQuote.estimatedFeeUsdt
                  : evaluation.feeUsdt
              )}{' '}
              USDT
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686D76] dark:text-[#7E828A]">
              {evaluation.side === 'buy' ? 'Est. Crypto Received' : 'Est. Net Proceeds'}
            </dt>
            <dd className="font-mono-num font-semibold text-[#10C478]">
              {evaluation.side === 'buy'
                ? `${formatQty(
                    isManualBuyMode && manualPurchaseQuote?.valid
                      ? manualPurchaseQuote.estimatedCryptoAmount
                      : evaluation.netReceiveBase
                  )} ${pair.baseAsset}`
                : `${formatUsdt(evaluation.netUsdt)} USDT`}
            </dd>
          </div>
        </dl>

        {/* Blocking Restrictions */}
        {isManualBuyMode ? (
          manualPurchaseQuote && !manualPurchaseQuote.valid && manualPurchaseQuote.error && (
            <div
              data-testid="preview-blocking-errors"
              className="rounded-xl bg-[#FEF2F2] dark:bg-[#2A1416] border border-[#F0525E]/35 p-3.5 space-y-1 text-xs text-[#B91C1C] dark:text-[#FCA5A5]"
            >
              <p className="font-semibold">Purchase Request Blocked</p>
              <p>{manualPurchaseQuote.error}</p>
            </div>
          )
        ) : (
          evaluation.blockingErrors.length > 0 && (
            <div
              data-testid="preview-blocking-errors"
              className="rounded-xl bg-[#FEF2F2] dark:bg-[#2A1416] border border-[#F0525E]/35 p-3.5 space-y-1 text-xs text-[#B91C1C] dark:text-[#FCA5A5]"
            >
              <p className="font-semibold">Submission Blocked</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {evaluation.blockingErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )
        )}

        {/* Disclosures */}
        <div
          data-testid="preview-sandbox-warnings"
          className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 space-y-1.5 text-xs text-[#4B5059] dark:text-[#9CA0A8]"
        >
          <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {isManualBuyMode ? 'Manual Settlement & Ledger Disclosure' : 'Sandbox Notice & Limitations'}
          </p>
          {isManualBuyMode ? (
            <p>{MANUAL_PURCHASE_INTERNAL_LEDGER_DISCLOSURE}</p>
          ) : (
            <ul className="list-disc pl-4 space-y-1">
              {evaluation.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium bg-[#E8EAEE] dark:bg-[#242528] text-[#111214] dark:text-[#F4F5F7] hover:opacity-90 whitespace-nowrap"
          >
            Close Preview
          </button>
          {isManualBuyMode ? (
            <button
              type="button"
              data-testid="confirm-manual-purchase-button"
              disabled={!manualPurchaseQuote?.valid || submitting}
              onClick={onConfirmManualPurchase}
              className="px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white bg-[#10C478] whitespace-nowrap transition-opacity disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating Order...' : 'Create Order & View Payment Address'}
            </button>
          ) : (
            <button
              type="button"
              data-testid="confirm-order-submit-button"
              disabled={!evaluation.canSubmitOrder || submitting}
              onClick={onConfirm}
              className={`px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white whitespace-nowrap transition-opacity disabled:opacity-45 disabled:cursor-not-allowed ${
                evaluation.side === 'buy' ? 'bg-[#10C478]' : 'bg-[#F0525E]'
              }`}
            >
              {submitting
                ? 'Submitting...'
                : evaluation.canSubmitOrder
                  ? `Confirm ${evaluation.orderType === 'limit' ? 'Limit' : 'Market'} ${evaluation.side === 'buy' ? 'Buy' : 'Sell'}`
                  : 'Submission Unavailable'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

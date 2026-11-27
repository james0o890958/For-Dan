import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, X } from 'lucide-react';
import type { ManualPurchaseOrder } from '../../types/domain';
import { formatMarketPriceDisplay } from '../../utils/overviewModel';
import { formatQty, formatUsdt } from '../../utils/tradingMath';
import { ManualPurchaseStatusLabel } from '../ui/CommonPrimitives';

interface ManualPurchasePaymentModalProps {
  open: boolean;
  order: ManualPurchaseOrder | null;
  onSubmitPayment: (input: {
    orderId: string;
    paymentTxHash: string;
    actualAmountSent: number;
    paymentNote?: string;
  }) => | { ok: boolean; message: string; order?: ManualPurchaseOrder }
        | Promise<{ ok: boolean; message: string; order?: ManualPurchaseOrder }>;
  onCancelOrder: (orderId: string) => | { ok: boolean; message: string }
                                     | Promise<{ ok: boolean; message: string }>;
  onClose: () => void;
}

export const ManualPurchasePaymentModal: React.FC<ManualPurchasePaymentModalProps> = ({
  open,
  order,
  onSubmitPayment,
  onCancelOrder,
  onClose,
}) => {
  const [txHash, setTxHash] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [copiedField, setCopiedField] = useState<'address' | 'memo' | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || !order) return;
    setTxHash(order.paymentTxHash ?? '');
    setActualAmount(
      order.actualAmountSent !== null
        ? String(order.actualAmountSent)
        : String(order.totalPaymentAmount)
    );
    setPaymentNote(order.paymentNote ?? '');
    setFeedback(null);
    setCopiedField(null);
  }, [open, order]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !order) return null;

  const handleCopy = async (text: string, field: 'address' | 'memo') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setCopiedField(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await onSubmitPayment({
      orderId: order.id,
      paymentTxHash: txHash,
      actualAmountSent: Number(actualAmount),
      paymentNote,
    });
    setFeedback({ ok: res.ok, text: res.message });
  };

  const handleCancel = async () => {
    const res = await onCancelOrder(order.id);
    setFeedback({ ok: res.ok, text: res.message });
  };

  const isPendingPayment = order.status === 'PENDING_PAYMENT';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mpo-modal-title"
      data-testid="manual-purchase-payment-modal"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#24252C] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2
                id="mpo-modal-title"
                className="text-base font-semibold text-[#111214] dark:text-[#F4F5F7]"
              >
                Manual Purchase · {order.pairSymbol}
              </h2>
              <ManualPurchaseStatusLabel status={order.status} />
            </div>
            <p className="mt-0.5 text-xs font-mono-num text-[#686D76] dark:text-[#7E828A]">
              Order Ref {order.orderRef} · {order.orderType} BUY · Created{' '}
              {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close purchase order modal"
            className="p-1.5 rounded-lg text-[#686D76] hover:text-[#111214] dark:hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Order Amounts & Pricing Summary */}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 text-xs">
          <div>
            <dt className="text-[#686D76] dark:text-[#7E828A]">Total Payment</dt>
            <dd className="font-mono-num font-bold mt-0.5 text-[#111214] dark:text-[#F4F5F7]">
              {formatUsdt(order.totalPaymentAmount)} {order.paymentAsset}
            </dd>
          </div>
          <div>
            <dt className="text-[#686D76] dark:text-[#7E828A]">
              {order.finalCryptoAmount ? 'Credited Crypto' : 'Est. Receive'}
            </dt>
            <dd className="font-mono-num font-bold mt-0.5 text-[#10C478]">
              {formatQty(order.finalCryptoAmount ?? order.estimatedCryptoAmount)} {order.baseAsset}
            </dd>
          </div>
          <div>
            <dt className="text-[#686D76] dark:text-[#7E828A]">
              {order.orderType === 'LIMIT' ? 'Limit Price' : 'Reference Price'}
            </dt>
            <dd className="font-mono-num font-semibold mt-0.5">
              {formatMarketPriceDisplay(order.limitPrice ?? order.referencePrice)} USDT
            </dd>
          </div>
          <div>
            <dt className="text-[#686D76] dark:text-[#7E828A]">Fee ({(order.feeRate * 100).toFixed(2)}%)</dt>
            <dd className="font-mono-num font-semibold mt-0.5">
              {formatUsdt(order.finalFeeUsdt ?? order.estimatedFeeUsdt)} USDT
            </dd>
          </div>
        </dl>

        {/* Admin-Provided Receiving Address Instructions */}
        <div className="rounded-xl border border-[#E2E4E9] dark:border-[#22242A] bg-[#F9FAFB] dark:bg-[#101216] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
              Payment Receiving Instructions
            </span>
            <span className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]">
              {order.paymentAsset} · {order.receivingNetwork}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-[#686D76] dark:text-[#7E828A] block mb-1">
                Receiving Cryptocurrency Address
              </span>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] px-3 py-2">
                <span className="font-mono-num break-all text-[#111214] dark:text-[#F4F5F7]">
                  {order.receivingAddress}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopy(order.receivingAddress, 'address')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#E8EAEE] dark:bg-[#242528] text-[11px] font-semibold shrink-0"
                >
                  {copiedField === 'address' ? (
                    <>
                      <Check className="w-3 h-3 text-[#10C478]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            {order.receivingMemoOrTag && (
              <div>
                <span className="text-[#686D76] dark:text-[#7E828A] block mb-1">
                  Destination Tag / Memo (Required)
                </span>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] px-3 py-2">
                  <span className="font-mono-num font-semibold">{order.receivingMemoOrTag}</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(order.receivingMemoOrTag!, 'memo')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#E8EAEE] dark:bg-[#242528] text-[11px] font-semibold shrink-0"
                  >
                    {copiedField === 'memo' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg bg-[#FFFBEB] dark:bg-[#221A0E] border border-[#D97706]/35 p-3 space-y-1 text-[11px] text-[#92400E] dark:text-[#FCD34D]">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Network &amp; Irreversibility Warnings</span>
            </div>
            <p>
              Send <strong>only {order.paymentAsset}</strong> via the{' '}
              <strong>{order.receivingNetwork}</strong> network. Transfers sent on an unsupported
              network or without a required memo/tag may be permanently lost.
            </p>
            <p>
              Cryptocurrency transfers are irreversible. Submitting a transaction reference is not
              proof of settlement—an administrator will independently verify receipt before crediting
              your internal wallet ledger.
            </p>
          </div>
        </div>

        {/* Customer Payment Submission Form or Read-Only Verification Status */}
        {isPendingPayment ? (
          <form onSubmit={handleSubmit} className="space-y-3 border-t border-[#E2E4E9] dark:border-[#22242A] pt-4">
            <h3 className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
              Submit Payment Transaction Reference
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="mpo-tx-hash" className="block text-xs font-medium mb-1">
                  Transaction Hash / Reference
                </label>
                <input
                  id="mpo-tx-hash"
                  data-testid="mpo-tx-hash-input"
                  type="text"
                  required
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="Enter on-chain transaction hash (min 10 chars)"
                  className="w-full h-10 px-3 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs focus:outline-none focus:border-[#004AE2]"
                />
              </div>
              <div>
                <label htmlFor="mpo-actual-amount" className="block text-xs font-medium mb-1">
                  Actual Amount Sent ({order.paymentAsset})
                </label>
                <input
                  id="mpo-actual-amount"
                  data-testid="mpo-actual-amount-input"
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={actualAmount}
                  onChange={(e) => setActualAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs focus:outline-none focus:border-[#004AE2]"
                />
              </div>
              <div>
                <label htmlFor="mpo-payment-note" className="block text-xs font-medium mb-1">
                  Payment Note (Optional)
                </label>
                <input
                  id="mpo-payment-note"
                  type="text"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  placeholder="Sending wallet / transfer note"
                  className="w-full h-10 px-3 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs focus:outline-none focus:border-[#004AE2]"
                />
              </div>
            </div>

            {feedback && (
              <p
                role="status"
                className={`text-xs font-medium ${feedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}
              >
                {feedback.text}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 h-10 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium text-[#F0525E] hover:opacity-90"
              >
                Cancel Order
              </button>
              <button
                type="submit"
                data-testid="mpo-submit-payment-button"
                className="px-5 h-10 rounded-lg bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
              >
                Submit Payment Reference
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 border-t border-[#E2E4E9] dark:border-[#22242A] pt-4 text-xs">
            <h3 className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
              Submitted Payment &amp; Verification Record
            </h3>
            <dl className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3.5 space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Payment Tx Hash</dt>
                <dd className="font-mono-num break-all text-right">
                  {order.paymentTxHash || 'Not submitted'}
                </dd>
              </div>
              {order.actualAmountSent !== null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[#686D76] dark:text-[#7E828A]">Actual Amount Sent</dt>
                  <dd className="font-mono-num font-semibold">
                    {formatUsdt(order.actualAmountSent)} {order.paymentAsset}
                  </dd>
                </div>
              )}
              {order.paymentNote && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[#686D76] dark:text-[#7E828A]">Customer Note</dt>
                  <dd className="text-right">{order.paymentNote}</dd>
                </div>
              )}
              {order.adminRemark && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[#686D76] dark:text-[#7E828A]">Admin Remark</dt>
                  <dd className="text-right font-medium">{order.adminRemark}</dd>
                </div>
              )}
              {order.rejectionReason && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[#F0525E]">Rejection Reason</dt>
                  <dd className="text-right font-semibold text-[#F0525E]">{order.rejectionReason}</dd>
                </div>
              )}
              {order.creditedTxId && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[#686D76] dark:text-[#7E828A]">Ledger Tx ID</dt>
                  <dd className="font-mono-num font-semibold text-[#10C478]">{order.creditedTxId}</dd>
                </div>
              )}
            </dl>

            {order.reviewHistory.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[11px] font-semibold text-[#686D76] dark:text-[#7E828A]">
                  Lifecycle Timeline
                </h4>
                <div className="rounded-xl border border-[#E2E4E9] dark:border-[#22242A] divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {order.reviewHistory.map((evt) => (
                    <div key={evt.id} className="px-3 py-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[11px]">
                          {evt.toStatus} · <span className="font-normal text-[#686D76]">{evt.actorLabel}</span>
                        </p>
                        <p className="text-[11px] text-[#686D76] dark:text-[#9CA0A8]">{evt.remark}</p>
                      </div>
                      <span className="font-mono-num text-[10px] text-[#686D76] shrink-0">
                        {new Date(evt.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

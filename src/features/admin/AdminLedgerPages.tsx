import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import {
  EmptyState,
  ManualPurchaseStatusLabel,
  SearchInput,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';
import type {
  LedgerTransaction,
  LedgerTransactionType,
  ManualPurchaseOrderStatus,
  ManualPurchaseVerificationChecklist,
  Trade,
} from '../../types/domain';
import {
  hasDuplicatePaymentTxHash,
  isTerminalManualPurchaseStatus,
  MANUAL_PURCHASE_ADMIN_FULFIL_ROLES,
  MANUAL_PURCHASE_INTERNAL_LEDGER_DISCLOSURE,
} from '../../utils/manualPurchaseEngine';
import { formatMarketPriceDisplay } from '../../utils/overviewModel';
import { formatCryptoPrice, formatQty, formatUsdt } from '../../utils/tradingMath';

const MANUAL_STATUS_OPTIONS: Array<{ value: 'ALL' | ManualPurchaseOrderStatus; label: string }> = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'PENDING_PAYMENT', label: 'Pending Payment' },
  { value: 'PAYMENT_SUBMITTED', label: 'Payment Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'APPROVED', label: 'Approved (Ready)' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const AdminTradesPage: React.FC = () => {
  const {
    spotOrders,
    trades,
    tradingPairs,
    profiles,
    manualPurchaseOrders,
    deposits,
    currentRole,
    reviewManualPurchaseOrder,
    fulfilManualPurchaseOrder,
  } = useAppState();
  const [tab, setTab] = useState<'purchase_orders' | 'orders' | 'trades'>('purchase_orders');
  const [search, setSearch] = useState('');
  const [pairFilter, setPairFilter] = useState<string>('all');
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<'ALL' | ManualPurchaseOrderStatus>('ALL');
  const [purchaseNetworkFilter, setPurchaseNetworkFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string | null>(null);

  const [checklistDraft, setChecklistDraft] = useState<ManualPurchaseVerificationChecklist>({
    txHashChecked: false,
    addressMatched: false,
    networkMatched: false,
    amountVerified: false,
    duplicateClear: false,
  });
  const [adminRemarkInput, setAdminRemarkInput] = useState('');
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [finalCryptoInput, setFinalCryptoInput] = useState('');
  const [finalFeeInput, setFinalFeeInput] = useState('');
  const [reviewFeedback, setReviewFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const purchaseNetworks = useMemo(() => {
    const set = new Set(manualPurchaseOrders.map((o) => o.receivingNetwork));
    return Array.from(set).sort();
  }, [manualPurchaseOrders]);

  const pendingActionCount = useMemo(
    () =>
      manualPurchaseOrders.filter(
        (o) =>
          o.status === 'PAYMENT_SUBMITTED' ||
          o.status === 'UNDER_REVIEW' ||
          o.status === 'APPROVED'
      ).length,
    [manualPurchaseOrders]
  );

  const filteredManualOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00Z`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999Z`).getTime() : null;

    return manualPurchaseOrders.filter((o) => {
      if (pairFilter !== 'all' && o.pairSymbol !== pairFilter) return false;
      if (sideFilter === 'sell') return false;
      if (purchaseStatusFilter !== 'ALL' && o.status !== purchaseStatusFilter) return false;
      if (purchaseNetworkFilter !== 'all' && o.receivingNetwork !== purchaseNetworkFilter) return false;
      const createdMs = new Date(o.createdAt).getTime();
      if (fromMs !== null && Number.isFinite(createdMs) && createdMs < fromMs) return false;
      if (toMs !== null && Number.isFinite(createdMs) && createdMs > toMs) return false;

      if (!q) return true;
      const customer = profileMap.get(o.userId);
      return (
        o.orderRef.toLowerCase().includes(q) ||
        (o.paymentTxHash?.toLowerCase().includes(q) ?? false) ||
        o.receivingAddress.toLowerCase().includes(q) ||
        (customer?.fullName.toLowerCase().includes(q) ?? false) ||
        (customer?.email.toLowerCase().includes(q) ?? false) ||
        (customer?.publicUserId.toLowerCase().includes(q) ?? false)
      );
    });
  }, [
    manualPurchaseOrders,
    pairFilter,
    sideFilter,
    purchaseStatusFilter,
    purchaseNetworkFilter,
    dateFrom,
    dateTo,
    search,
    profileMap,
  ]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return spotOrders.filter((o) => {
      if (pairFilter !== 'all' && o.pairSymbol !== pairFilter) return false;
      if (sideFilter !== 'all' && o.side !== sideFilter) return false;
      if (!q) return true;
      const customer = profileMap.get(o.userId);
      return (
        (customer?.fullName.toLowerCase().includes(q) ?? false) ||
        (customer?.email.toLowerCase().includes(q) ?? false) ||
        (customer?.publicUserId.toLowerCase().includes(q) ?? false)
      );
    });
  }, [spotOrders, pairFilter, sideFilter, search, profileMap]);

  const filteredTrades = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trades.filter((t) => {
      if (pairFilter !== 'all' && t.pairSymbol !== pairFilter) return false;
      if (sideFilter !== 'all' && t.side !== sideFilter) return false;
      if (!q) return true;
      const customer = profileMap.get(t.userId);
      return (
        (customer?.fullName.toLowerCase().includes(q) ?? false) ||
        (customer?.email.toLowerCase().includes(q) ?? false) ||
        (customer?.publicUserId.toLowerCase().includes(q) ?? false)
      );
    });
  }, [trades, pairFilter, sideFilter, search, profileMap]);

  const selectedPurchaseOrder = selectedPurchaseOrderId
    ? manualPurchaseOrders.find((o) => o.id === selectedPurchaseOrderId) ?? null
    : null;

  const openPurchaseReviewModal = (orderId: string) => {
    const order = manualPurchaseOrders.find((o) => o.id === orderId);
    if (!order) return;
    setSelectedPurchaseOrderId(order.id);
    setChecklistDraft({ ...order.verificationChecklist });
    setAdminRemarkInput(order.adminRemark ?? '');
    setRejectionReasonInput(order.rejectionReason ?? '');
    setFinalCryptoInput(String(order.finalCryptoAmount ?? order.estimatedCryptoAmount));
    setFinalFeeInput(String(order.finalFeeUsdt ?? order.estimatedFeeUsdt));
    setReviewFeedback(null);
  };

  const canFulfilRole = MANUAL_PURCHASE_ADMIN_FULFIL_ROLES.has(currentRole);

  const selectedOrderDuplicateTx = selectedPurchaseOrder?.paymentTxHash
    ? hasDuplicatePaymentTxHash({
        txHash: selectedPurchaseOrder.paymentTxHash,
        networkCode: selectedPurchaseOrder.receivingNetwork,
        excludeOrderId: selectedPurchaseOrder.id,
        existingOrders: manualPurchaseOrders,
        existingDeposits: deposits,
      })
    : false;

  return (
    <AdminLayout title="Orders & Manual Purchase Fulfilment">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('purchase_orders')}
              data-testid="admin-tab-purchase-orders"
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'purchase_orders'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Manual Purchase Orders ({manualPurchaseOrders.length}
              {pendingActionCount > 0 ? ` · ${pendingActionCount} Active` : ''})
            </button>
            <button
              type="button"
              onClick={() => setTab('orders')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'orders'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Spot Orders ({filteredOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('trades')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'trades'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Settled Trades ({filteredTrades.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search order ref, tx hash, customer, or ID"
              ariaLabel="Search orders by reference, tx hash, or customer"
              className="w-full sm:w-72"
            />
            <select
              aria-label="Filter by pair"
              value={pairFilter}
              onChange={(e) => setPairFilter(e.target.value)}
              className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
            >
              <option value="all">All Pairs</option>
              {tradingPairs.map((p) => (
                <option key={p.id} value={p.symbol}>
                  {p.symbol}
                </option>
              ))}
            </select>

            {tab === 'purchase_orders' ? (
              <>
                <select
                  aria-label="Filter by purchase status"
                  value={purchaseStatusFilter}
                  onChange={(e) =>
                    setPurchaseStatusFilter(e.target.value as 'ALL' | ManualPurchaseOrderStatus)
                  }
                  className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
                >
                  {MANUAL_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by payment network"
                  value={purchaseNetworkFilter}
                  onChange={(e) => setPurchaseNetworkFilter(e.target.value)}
                  className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
                >
                  <option value="all">All Networks</option>
                  {purchaseNetworks.map((net) => (
                    <option key={net} value={net}>
                      {net}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  aria-label="Filter start date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-mono-num"
                />
                <input
                  type="date"
                  aria-label="Filter end date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-mono-num"
                />
              </>
            ) : (
              <select
                aria-label="Filter by side"
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value as 'all' | 'buy' | 'sell')}
                className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
              >
                <option value="all">All Sides</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            )}
          </div>
        </div>

        {tab === 'purchase_orders' ? (
          filteredManualOrders.length === 0 ? (
            <EmptyState
              title="No manual purchase orders match"
              description="Customer BUY crypto requests awaiting payment proof, verification, or internal wallet fulfilment appear here."
            />
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm" data-testid="admin-manual-orders-table">
                  <thead>
                    <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                      <th className="py-3 px-4 font-medium">Order Ref</th>
                      <th className="py-3 px-4 font-medium">Customer</th>
                      <th className="py-3 px-4 font-medium">Pair / Type</th>
                      <th className="py-3 px-4 font-medium text-right">Payment</th>
                      <th className="py-3 px-4 font-medium text-right">Crypto Amount</th>
                      <th className="py-3 px-4 font-medium">Network &amp; Tx Hash</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                    {filteredManualOrders.map((o) => {
                      const customer = profileMap.get(o.userId);
                      return (
                        <tr key={o.id}>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <p className="font-mono-num font-semibold">{o.orderRef}</p>
                            <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                              {new Date(o.createdAt).toLocaleString()}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold">{customer?.fullName ?? 'Customer'}</p>
                            <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                              {customer?.email} · ID {customer?.publicUserId}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold">{o.pairSymbol}</p>
                            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                              {o.orderType} BUY ·{' '}
                              {formatMarketPriceDisplay(o.limitPrice ?? o.referencePrice)} USDT
                            </p>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-num">
                            <p className="font-semibold">
                              {formatUsdt(o.totalPaymentAmount)} {o.paymentAsset}
                            </p>
                            {o.actualAmountSent !== null && (
                              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                                Sent: {formatUsdt(o.actualAmountSent)}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-num font-semibold">
                            {formatQty(o.finalCryptoAmount ?? o.estimatedCryptoAmount)} {o.baseAsset}
                          </td>
                          <td className="py-3 px-4 max-w-[200px]">
                            <p className="text-xs font-medium">{o.receivingNetwork}</p>
                            <p className="font-mono-num text-[11px] truncate text-[#686D76] dark:text-[#7E828A]">
                              {o.paymentTxHash || 'Awaiting tx reference'}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <ManualPurchaseStatusLabel status={o.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => openPurchaseReviewModal(o.id)}
                              className="px-3 py-1.5 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                            >
                              {isTerminalManualPurchaseStatus(o.status) ? 'Inspect' : 'Review / Fulfil'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : tab === 'orders' ? (
          filteredOrders.length === 0 ? (
            <EmptyState
              title="No spot orders recorded"
              description="Customer orders routed to the liquidity venue appear here with full rejection and fill status."
            />
          ) : (
            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                      <th className="py-3 px-4 font-medium">Customer</th>
                      <th className="py-3 px-4 font-medium">Pair</th>
                      <th className="py-3 px-4 font-medium">Side</th>
                      <th className="py-3 px-4 font-medium text-right">Requested</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium">Venue / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                    {filteredOrders.map((o) => {
                      const customer = profileMap.get(o.userId);
                      return (
                        <tr key={o.id}>
                          <td className="py-3 px-4">
                            <p className="font-semibold">{customer?.fullName}</p>
                            <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                              ID {customer?.publicUserId}
                            </p>
                          </td>
                          <td className="py-3 px-4 font-semibold">{o.pairSymbol}</td>
                          <td
                            className={`py-3 px-4 font-semibold uppercase ${
                              o.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                            }`}
                          >
                            {o.side}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-num">
                            {formatQty(o.requestedAmount)}
                          </td>
                          <td className="py-3 px-4 font-semibold">{o.status}</td>
                          <td className="py-3 px-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                            {o.rejectReason || o.venueOrderId || o.venueName || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : filteredTrades.length === 0 ? (
          <EmptyState
            title="No settled trades"
            description="Executed liquidity venue fills appear here."
          />
        ) : (
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-3 px-4 font-medium">Customer</th>
                    <th className="py-3 px-4 font-medium">Pair</th>
                    <th className="py-3 px-4 font-medium">Side</th>
                    <th className="py-3 px-4 font-medium text-right">Price</th>
                    <th className="py-3 px-4 font-medium text-right">Quantity</th>
                    <th className="py-3 px-4 font-medium text-right">Fee (USDT)</th>
                    <th className="py-3 px-4 font-medium text-right">Total (USDT)</th>
                    <th className="py-3 px-4 font-medium text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {filteredTrades.map((t) => {
                    const customer = profileMap.get(t.userId);
                    return (
                      <tr key={t.id}>
                        <td className="py-3 px-4">
                          <p className="font-semibold">{customer?.fullName}</p>
                          <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                            ID {customer?.publicUserId}
                          </p>
                        </td>
                        <td className="py-3 px-4 font-semibold">{t.pairSymbol}</td>
                        <td
                          className={`py-3 px-4 font-semibold uppercase ${
                            t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                          }`}
                        >
                          {t.side}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          {formatCryptoPrice(t.executedPrice)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          {formatQty(t.baseQuantity)} {t.baseAsset}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          {formatUsdt(t.feeUsdt)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num font-semibold">
                          {formatUsdt(t.totalUsdt)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedTrade(t)}
                            className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Admin Manual Purchase Verification & Fulfilment Modal */}
      {selectedPurchaseOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-mpo-title"
          data-testid="admin-manual-order-modal"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 id="admin-mpo-title" className="text-base font-semibold">
                    Manual Purchase Review · {selectedPurchaseOrder.orderRef}
                  </h2>
                  <ManualPurchaseStatusLabel status={selectedPurchaseOrder.status} />
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A] mt-0.5">
                  Customer: {profileMap.get(selectedPurchaseOrder.userId)?.fullName ?? 'Unknown'} (
                  {profileMap.get(selectedPurchaseOrder.userId)?.email}) · ID{' '}
                  <span className="font-mono-num">
                    {profileMap.get(selectedPurchaseOrder.userId)?.publicUserId}
                  </span>{' '}
                  · v<span className="font-mono-num">{selectedPurchaseOrder.version}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPurchaseOrderId(null)}
                aria-label="Close purchase review modal"
                className="p-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3.5">
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Pair / Type</dt>
                <dd className="font-semibold mt-0.5">
                  {selectedPurchaseOrder.pairSymbol} · {selectedPurchaseOrder.orderType}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Requested Payment</dt>
                <dd className="font-mono-num font-bold mt-0.5">
                  {formatUsdt(selectedPurchaseOrder.totalPaymentAmount)}{' '}
                  {selectedPurchaseOrder.paymentAsset}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Est. Crypto</dt>
                <dd className="font-mono-num font-bold mt-0.5 text-[#10C478]">
                  {formatQty(selectedPurchaseOrder.estimatedCryptoAmount)}{' '}
                  {selectedPurchaseOrder.baseAsset}
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Price ({selectedPurchaseOrder.orderType})</dt>
                <dd className="font-mono-num font-semibold mt-0.5">
                  {formatMarketPriceDisplay(
                    selectedPurchaseOrder.limitPrice ?? selectedPurchaseOrder.referencePrice
                  )}{' '}
                  USDT
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[#686D76] dark:text-[#7E828A]">
                  Snapshotted Receiving Address ({selectedPurchaseOrder.receivingNetwork})
                </dt>
                <dd className="font-mono-num break-all mt-0.5">
                  {selectedPurchaseOrder.receivingAddress}
                  {selectedPurchaseOrder.receivingMemoOrTag
                    ? ` · Memo: ${selectedPurchaseOrder.receivingMemoOrTag}`
                    : ''}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Customer Payment Tx Hash</dt>
                <dd className="font-mono-num break-all mt-0.5">
                  {selectedPurchaseOrder.paymentTxHash || 'Not submitted yet'}
                </dd>
              </div>
              {selectedPurchaseOrder.actualAmountSent !== null && (
                <div>
                  <dt className="text-[#686D76] dark:text-[#7E828A]">Actual Sent</dt>
                  <dd className="font-mono-num font-semibold mt-0.5">
                    {formatUsdt(selectedPurchaseOrder.actualAmountSent)}{' '}
                    {selectedPurchaseOrder.paymentAsset}
                  </dd>
                </div>
              )}
              {selectedPurchaseOrder.paymentNote && (
                <div className="col-span-3">
                  <dt className="text-[#686D76] dark:text-[#7E828A]">Customer Note</dt>
                  <dd className="mt-0.5">{selectedPurchaseOrder.paymentNote}</dd>
                </div>
              )}
            </dl>

            {selectedOrderDuplicateTx && (
              <p className="rounded-xl bg-[#FEF2F2] dark:bg-[#2A1416] border border-[#F0525E]/40 p-3 text-xs font-semibold text-[#F0525E]">
                Duplicate Alert: This transaction hash already appears on another active order or credited deposit on {selectedPurchaseOrder.receivingNetwork}. Approval is blocked.
              </p>
            )}

            {/* 5-Item Verification Checklist */}
            {(selectedPurchaseOrder.status === 'PAYMENT_SUBMITTED' ||
              selectedPurchaseOrder.status === 'UNDER_REVIEW' ||
              selectedPurchaseOrder.status === 'APPROVED' ||
              selectedPurchaseOrder.status === 'COMPLETED') && (
              <div className="rounded-xl border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-2.5 text-xs">
                <p className="font-semibold">Admin Payment Verification Checklist</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      ['txHashChecked', 'Transaction hash verified on explorer'],
                      ['addressMatched', 'Destination matches assigned receiving address'],
                      ['networkMatched', 'Transfer network matches instruction'],
                      ['amountVerified', 'Received amount confirmed'],
                      ['duplicateClear', 'Confirmed non-duplicate payment reference'],
                    ] as const
                  ).map(([key, label]) => {
                    const editable =
                      selectedPurchaseOrder.status === 'PAYMENT_SUBMITTED' ||
                      selectedPurchaseOrder.status === 'UNDER_REVIEW';
                    return (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={checklistDraft[key]}
                          onChange={(e) =>
                            setChecklistDraft((prev) => ({ ...prev, [key]: e.target.checked }))
                          }
                          className="w-4 h-4 accent-[#004AE2]"
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Fulfilment Final Quantities & Notes */}
            {!isTerminalManualPurchaseStatus(selectedPurchaseOrder.status) && (
              <div className="space-y-3 text-xs">
                {selectedPurchaseOrder.status === 'APPROVED' && (
                  <>
                    <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3 text-[11px] text-[#4B5059] dark:text-[#9CA0A8]">
                      {MANUAL_PURCHASE_INTERNAL_LEDGER_DISCLOSURE}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="mpo-final-crypto" className="block font-medium mb-1">
                          Final Crypto to Credit ({selectedPurchaseOrder.baseAsset})
                        </label>
                        <input
                          id="mpo-final-crypto"
                          type="number"
                          step="any"
                          min="0"
                          value={finalCryptoInput}
                          onChange={(e) => setFinalCryptoInput(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num"
                        />
                      </div>
                      <div>
                        <label htmlFor="mpo-final-fee" className="block font-medium mb-1">
                          Final Fee (USDT)
                        </label>
                        <input
                          id="mpo-final-fee"
                          type="number"
                          step="any"
                          min="0"
                          value={finalFeeInput}
                          onChange={(e) => setFinalFeeInput(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="mpo-admin-remark" className="block font-medium mb-1">
                      Verification / Admin Remark
                    </label>
                    <input
                      id="mpo-admin-remark"
                      type="text"
                      value={adminRemarkInput}
                      onChange={(e) => setAdminRemarkInput(e.target.value)}
                      placeholder="Block confirmation, explorer note, or remark"
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32]"
                    />
                  </div>
                  <div>
                    <label htmlFor="mpo-reject-reason" className="block font-medium mb-1">
                      Rejection Reason (Mandatory if Rejecting)
                    </label>
                    <input
                      id="mpo-reject-reason"
                      type="text"
                      value={rejectionReasonInput}
                      onChange={(e) => setRejectionReasonInput(e.target.value)}
                      placeholder="Required to reject order"
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32]"
                    />
                  </div>
                </div>
              </div>
            )}

            {reviewFeedback && (
              <p
                role="status"
                className={`text-xs font-medium ${reviewFeedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}
              >
                {reviewFeedback.text}
              </p>
            )}

            {/* Lifecycle Action Buttons */}
            {!isTerminalManualPurchaseStatus(selectedPurchaseOrder.status) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E2E4E9] dark:border-[#22242A]">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await reviewManualPurchaseOrder({
                      orderId: selectedPurchaseOrder.id,
                      targetStatus: 'REJECTED',
                      adminRemark: adminRemarkInput,
                      rejectionReason: rejectionReasonInput,
                      expectedVersion: selectedPurchaseOrder.version,
                    });
                    setReviewFeedback({ ok: res.ok, text: res.message });
                  }}
                  className="px-4 h-10 rounded-full bg-[#F0525E] text-white text-xs font-semibold hover:opacity-95"
                >
                  Reject Order
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedPurchaseOrder.status === 'PAYMENT_SUBMITTED' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await reviewManualPurchaseOrder({
                          orderId: selectedPurchaseOrder.id,
                          targetStatus: 'UNDER_REVIEW',
                          checklist: checklistDraft,
                          adminRemark: adminRemarkInput,
                          expectedVersion: selectedPurchaseOrder.version,
                        });
                        setReviewFeedback({ ok: res.ok, text: res.message });
                      }}
                      className="px-4 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                    >
                      Move to Under Review
                    </button>
                  )}

                  {selectedPurchaseOrder.status === 'UNDER_REVIEW' && (
                    <button
                      type="button"
                      disabled={selectedOrderDuplicateTx}
                      onClick={async () => {
                        const res = await reviewManualPurchaseOrder({
                          orderId: selectedPurchaseOrder.id,
                          targetStatus: 'APPROVED',
                          checklist: checklistDraft,
                          adminRemark: adminRemarkInput,
                          expectedVersion: selectedPurchaseOrder.version,
                        });
                        setReviewFeedback({ ok: res.ok, text: res.message });
                      }}
                      className="px-4 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0] disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      Approve Payment (Ready to Fulfil)
                    </button>
                  )}

                  {selectedPurchaseOrder.status === 'APPROVED' && (
                    <button
                      type="button"
                      disabled={!canFulfilRole}
                      title={
                        canFulfilRole
                          ? 'Atomically credit customer internal wallet ledger'
                          : 'Requires super_admin or finance_admin role'
                      }
                      onClick={async () => {
                        const res = await fulfilManualPurchaseOrder({
                          orderId: selectedPurchaseOrder.id,
                          finalCryptoAmount: Number(finalCryptoInput),
                          finalFeeUsdt: Number(finalFeeInput),
                          adminRemark: adminRemarkInput,
                          expectedVersion: selectedPurchaseOrder.version,
                        });
                        setReviewFeedback({ ok: res.ok, text: res.message });
                      }}
                      className="px-5 h-10 rounded-full bg-[#10C478] text-white text-xs font-semibold hover:opacity-95 disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      Fulfil &amp; Credit Customer Wallet
                    </button>
                  )}
                </div>
              </div>
            )}

            {selectedPurchaseOrder.status === 'APPROVED' && !canFulfilRole && (
              <p className="text-xs text-[#D97706]">
                Wallet ledger credit permission is restricted to Super Admin or Finance Admin roles.
              </p>
            )}

            {selectedPurchaseOrder.creditedTxId && (
              <div className="rounded-xl bg-[#ECFDF5] dark:bg-[#0F241B] border border-[#10C478]/35 p-3 text-xs">
                Settled via internal ledger transaction{' '}
                <strong className="font-mono-num">{selectedPurchaseOrder.creditedTxId}</strong> on{' '}
                {selectedPurchaseOrder.fulfilledAt
                  ? new Date(selectedPurchaseOrder.fulfilledAt).toLocaleString()
                  : 'record'}
                .
              </div>
            )}

            {/* Audit History */}
            {selectedPurchaseOrder.reviewHistory.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                  Audit &amp; Review History
                </h3>
                <div className="rounded-xl border border-[#E2E4E9] dark:border-[#22242A] divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {selectedPurchaseOrder.reviewHistory.map((evt) => (
                    <div key={evt.id} className="px-3 py-2 flex items-start justify-between gap-3 text-xs">
                      <div>
                        <p className="font-semibold">
                          {evt.fromStatus ? `${evt.fromStatus} -> ${evt.toStatus}` : evt.toStatus} ·{' '}
                          <span className="font-normal text-[#686D76]">{evt.actorLabel}</span>
                        </p>
                        <p className="text-[#686D76] dark:text-[#9CA0A8]">{evt.remark}</p>
                      </div>
                      <span className="font-mono-num text-[11px] text-[#686D76] shrink-0">
                        {new Date(evt.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Venue Execution Details</h2>
              <button
                type="button"
                onClick={() => setSelectedTrade(null)}
                aria-label="Close execution modal"
                className="p-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="space-y-2 text-xs rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-4">
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Trade ID</dt>
                <dd className="font-mono-num">{selectedTrade.id}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Venue Trade ID</dt>
                <dd className="font-mono-num">{selectedTrade.venueTradeId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Pair</dt>
                <dd className="font-semibold">{selectedTrade.pairSymbol}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Side</dt>
                <dd className="uppercase font-semibold">{selectedTrade.side}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Executed Price</dt>
                <dd className="font-mono-num">{formatCryptoPrice(selectedTrade.executedPrice)} USDT</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Base Quantity</dt>
                <dd className="font-mono-num">
                  {formatQty(selectedTrade.baseQuantity)} {selectedTrade.baseAsset}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Fee</dt>
                <dd className="font-mono-num">{formatUsdt(selectedTrade.feeUsdt)} USDT</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Total USDT</dt>
                <dd className="font-mono-num font-bold">{formatUsdt(selectedTrade.totalUsdt)} USDT</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#686D76]">Executed At</dt>
                <dd className="font-mono-num">{new Date(selectedTrade.createdAt).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

export const AdminTransactionsPage: React.FC = () => {
  const { ledgerTransactions, ledgerEntries, profiles } = useAppState();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | LedgerTransactionType>('all');
  const [selectedTx, setSelectedTx] = useState<LedgerTransaction | null>(null);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledgerTransactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (!q) return true;
      const c = profileMap.get(tx.userId);
      return (
        (c?.fullName.toLowerCase().includes(q) ?? false) ||
        (c?.email.toLowerCase().includes(q) ?? false) ||
        (c?.publicUserId.toLowerCase().includes(q) ?? false) ||
        tx.summary.toLowerCase().includes(q)
      );
    });
  }, [ledgerTransactions, typeFilter, search, profileMap]);

  const entriesForSelected = useMemo(() => {
    if (!selectedTx) return [];
    return ledgerEntries.filter((e) => e.transactionId === selectedTx.id);
  }, [selectedTx, ledgerEntries]);

  return (
    <AdminLayout title="Immutable Transaction Ledger">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search customer or summary"
            ariaLabel="Search ledger transactions"
            className="w-full sm:w-80"
          />
          <select
            aria-label="Filter by transaction type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | LedgerTransactionType)}
            className="h-10 px-3 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
          >
            <option value="all">All Types</option>
            <option value="deposit_credit">Deposit Credits</option>
            <option value="withdrawal_reserve">Withdrawal Reserves</option>
            <option value="withdrawal_release">Withdrawal Releases</option>
            <option value="withdrawal_settle">Withdrawal Settlements</option>
            <option value="withdrawal_refund">Withdrawal Refunds</option>
            <option value="spot_buy">Spot Buys</option>
            <option value="spot_sell">Spot Sells</option>
            <option value="trading_fee">Trading Fees</option>
            <option value="adjustment">Ledger Adjustments</option>
            <option value="reversal">Ledger Reversals</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No ledger transactions"
            description="Immutable balance changes from verified deposits, withdrawals, trades, and adjustments appear here."
          />
        ) : (
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-3 px-4 font-medium">Customer</th>
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium">Summary</th>
                    <th className="py-3 px-4 font-medium">Date</th>
                    <th className="py-3 px-4 font-medium text-right">Ledger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {filtered.map((tx) => {
                    const customer = profileMap.get(tx.userId);
                    return (
                      <tr key={tx.id}>
                        <td className="py-3 px-4">
                          <p className="font-semibold">{customer?.fullName}</p>
                          <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                            ID {customer?.publicUserId}
                          </p>
                        </td>
                        <td className="py-3 px-4 uppercase text-xs font-semibold">
                          {exchangeService.getLedgerTypeLabel(tx.type)}
                        </td>
                        <td className="py-3 px-4 text-xs">{tx.summary}</td>
                        <td className="py-3 px-4 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A]">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedTx(tx)}
                            className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]"
                          >
                            Inspect Entries
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {selectedTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Ledger Entries</h2>
                <p className="text-xs font-mono-num text-[#686D76]">{selectedTx.idempotencyKey}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                aria-label="Close ledger modal"
                className="p-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] rounded-xl border border-[#E2E4E9] dark:border-[#22242A]">
              {entriesForSelected.map((e) => (
                <div key={e.id} className="p-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-semibold">
                      {e.assetSymbol}{' '}
                      <span className="text-[11px] font-normal text-[#686D76] dark:text-[#7E828A]">
                        ({e.bucket})
                      </span>
                    </p>
                    <p className="text-[#686D76] dark:text-[#7E828A]">{e.entryRole}</p>
                  </div>
                  <div className="text-right font-mono-num">
                    <p
                      className={`font-semibold ${
                        e.deltaAmount >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'
                      }`}
                    >
                      {e.deltaAmount >= 0 ? '+' : ''}
                      {formatQty(e.deltaAmount)} {e.assetSymbol}
                    </p>
                    <p className="text-[#686D76] dark:text-[#7E828A]">
                      Balance after: {formatQty(e.balanceAfter)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

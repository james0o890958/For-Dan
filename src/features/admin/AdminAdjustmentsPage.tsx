import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { ConfirmDialog } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';
import { formatQty, formatUsdt, roundAmount } from '../../utils/tradingMath';
import { isTerminalManualPurchaseStatus } from '../../utils/manualPurchaseEngine';

export const AdminAdjustmentsPage: React.FC = () => {
  const {
    customerProfiles,
    assets,
    walletBalances,
    ledgerTransactions,
    ledgerEntries,
    deposits,
    manualPurchaseOrders,
    auditLogs,
    reconciliationRuns,
    createLedgerAdjustment,
    runBalanceReconciliation,
  } = useAppState();

  const [publicUserId, setPublicUserId] = useState(customerProfiles[0]?.publicUserId ?? '');
  const [assetSymbol, setAssetSymbol] = useState('USDT');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [sourceAccount, setSourceAccount] = useState('treasury_settlement_ops');
  const [reasonCode, setReasonCode] = useState('RECONCILIATION_CORRECTION');
  const [reversalOfTxId, setReversalOfTxId] = useState('');
  const [summaryNote, setSummaryNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const matchedCustomer = useMemo(
    () => customerProfiles.find((c) => c.publicUserId === publicUserId.trim()) ?? null,
    [customerProfiles, publicUserId]
  );

  const assetReconciliationSummary = useMemo(() => {
    return assets.map((asset) => {
      const assetWalletSum = walletBalances
        .filter((b) => b.assetSymbol === asset.symbol)
        .reduce((sum, b) => sum + b.available + b.reserved, 0);

      const assetLedgerSum = ledgerEntries
        .filter((e) => e.assetSymbol === asset.symbol)
        .reduce((sum, e) => sum + e.deltaAmount, 0);

      const discrepancy = roundAmount(assetWalletSum - assetLedgerSum, 8);
      return {
        symbol: asset.symbol,
        name: asset.name,
        walletSum: assetWalletSum,
        ledgerSum: assetLedgerSum,
        discrepancy,
        matched: Math.abs(discrepancy) < 0.00000001,
      };
    });
  }, [assets, walletBalances, ledgerEntries]);

  const operationalVisibility = useMemo(() => {
    const pendingDeposits = deposits.filter(
      (d) =>
        d.status === 'PENDING_ADMIN_REVIEW' ||
        d.status === 'AWAITING_CONFIRMATIONS' ||
        d.status === 'DETECTED'
    ).length;
    const pendingPurchases = manualPurchaseOrders.filter(
      (o) => !isTerminalManualPurchaseStatus(o.status)
    ).length;
    const recentAuditsCount = auditLogs.length;
    return {
      pendingDeposits,
      pendingPurchases,
      recentAuditsCount,
    };
  }, [deposits, manualPurchaseOrders, auditLogs]);

  const recentAdjustments = useMemo(() => {
    const profileMap = new Map(customerProfiles.map((p) => [p.id, p]));
    return ledgerTransactions
      .filter((t) => t.type === 'adjustment' || t.type === 'reversal')
      .map((t) => {
        const entry = ledgerEntries.find((e) => e.transactionId === t.id);
        const customer = profileMap.get(t.userId);
        return {
          ...t,
          assetSymbol: entry?.assetSymbol ?? '—',
          deltaAmount: entry?.deltaAmount ?? 0,
          customerName: customer?.fullName ?? 'Customer',
          customerPublicId: customer?.publicUserId ?? '—',
        };
      });
  }, [ledgerTransactions, ledgerEntries, customerProfiles]);

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedCustomer) {
      setFeedback({ ok: false, text: 'Enter a valid Customer Public User ID.' });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setFeedback({ ok: false, text: 'Adjustment amount must be positive.' });
      return;
    }
    if (!sourceAccount.trim() || !reasonCode.trim() || !summaryNote.trim()) {
      setFeedback({
        ok: false,
        text: 'Source account, reason code, and audit summary note are required.',
      });
      return;
    }
    setFeedback(null);
    setConfirmOpen(true);
  };

  const handleConfirmAdjustment = () => {
    const res = createLedgerAdjustment({
      publicUserId,
      assetSymbol,
      direction,
      amount: Number(amount),
      sourceAccount,
      reasonCode,
      reversalOfTxId: reversalOfTxId.trim() || undefined,
      summaryNote,
    });
    setConfirmOpen(false);
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setAmount('');
      setReversalOfTxId('');
      setSummaryNote('');
    }
  };

  return (
    <AdminLayout title="Ledger Adjustments &amp; Reconciliation">
      <div className="space-y-6">
        {/* Operational Visibility Metrics Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Pending Deposit Queue</p>
            <p className="mt-1 text-xl font-bold font-mono-num text-[#004AE2] dark:text-[#60A5FA]">
              {operationalVisibility.pendingDeposits}
            </p>
            <p className="mt-0.5 text-[11px] text-[#686D76]">Awaiting admin verification &amp; fulfilment</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Active Manual Purchase Orders</p>
            <p className="mt-1 text-xl font-bold font-mono-num text-[#D97706]">
              {operationalVisibility.pendingPurchases}
            </p>
            <p className="mt-0.5 text-[11px] text-[#686D76]">Pending payment proof or settlement review</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Audit Traceability Logs</p>
            <p className="mt-1 text-xl font-bold font-mono-num text-[#10C478]">
              {operationalVisibility.recentAuditsCount}
            </p>
            <p className="mt-0.5 text-[11px] text-[#686D76]">Immutable administrative records tracked</p>
          </div>
        </div>

        {/* Read-Only Financial Reconciliation Report */}
        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Financial Reconciliation &amp; Audit Report</h2>
                <span className="px-2 py-0.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-[10px] font-semibold text-[#686D76] uppercase">
                  Read-Only Report
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[#686D76] dark:text-[#7E828A]">
                Authoritative cross-check comparing total wallet balances (available + reserved) against append-only ledger entry sums. This report is strictly read-only and never automatically adjusts balances.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const res = runBalanceReconciliation();
                setFeedback({ ok: res.ok, text: res.message });
              }}
              className="px-4 py-2 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
            >
              Run Balance Check
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="admin-reconciliation-table">
              <thead>
                <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                  <th className="py-2.5 px-3.5 font-medium">Asset</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Total Wallet Sum</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Total Ledger Sum</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Discrepancy</th>
                  <th className="py-2.5 px-3.5 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {assetReconciliationSummary.map((item) => (
                  <tr key={item.symbol}>
                    <td className="py-2.5 px-3.5 font-semibold">
                      {item.symbol} <span className="text-[#686D76] font-normal">({item.name})</span>
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num font-semibold">
                      {formatQty(item.walletSum)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num font-semibold">
                      {formatQty(item.ledgerSum)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num">
                      <span className={item.discrepancy !== 0 ? 'text-[#F0525E] font-bold' : ''}>
                        {formatQty(item.discrepancy)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          item.matched
                            ? 'bg-[#10C478]/15 text-[#10C478]'
                            : 'bg-[#F0525E]/15 text-[#F0525E]'
                        }`}
                      >
                        {item.matched ? 'MATCHED' : 'MISMATCH'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent Reconciliation Audit Log Runs */}
          {reconciliationRuns.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#E2E4E9] dark:border-[#22242A]">
              <p className="text-xs font-semibold text-[#686D76]">Recent Reconciliation Execution Logs</p>
              <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] rounded-xl border border-[#E2E4E9] dark:border-[#22242A]">
                {reconciliationRuns.slice(0, 3).map((r) => (
                  <div key={r.id} className="p-3 text-xs flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold uppercase">{r.scope.replace(/_/g, ' ')}</p>
                      <p className="text-[#686D76] dark:text-[#7E828A]">{r.details}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`font-semibold uppercase text-[11px] ${
                          r.status === 'matched' ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {r.status}
                      </span>
                      <p className="font-mono-num text-[11px] text-[#686D76]">
                        {new Date(r.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Immutable Ledger Adjustment Form */}
          <form
            onSubmit={handleRequestSubmit}
            className="lg:col-span-6 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <div>
              <h2 className="text-base font-semibold">Audited Ledger Adjustment / Reversal</h2>
              <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A]">
                All balance corrections are append-only ledger entries linked to a source account, reason code, and optional reference transaction ID. Existing entries are never mutated or deleted.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="adj-uid" className="block text-xs font-medium mb-1.5">
                  Customer Public User ID
                </label>
                <input
                  id="adj-uid"
                  type="text"
                  value={publicUserId}
                  onChange={(e) => setPublicUserId(e.target.value)}
                  placeholder="10-digit Public User ID"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                />
                {matchedCustomer && (
                  <p className="mt-1 text-xs text-[#10C478]">
                    {matchedCustomer.fullName} ({matchedCustomer.email})
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="adj-asset" className="block text-xs font-medium mb-1.5">
                  Asset
                </label>
                <select
                  id="adj-asset"
                  value={assetSymbol}
                  onChange={(e) => setAssetSymbol(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.symbol}>
                      {a.symbol}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="adj-dir" className="block text-xs font-medium mb-1.5">
                  Direction
                </label>
                <select
                  id="adj-dir"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                >
                  <option value="credit">Credit Available (+)</option>
                  <option value="debit">Debit Available (-)</option>
                </select>
              </div>

              <div>
                <label htmlFor="adj-amount" className="block text-xs font-medium mb-1.5">
                  Amount ({assetSymbol})
                </label>
                <input
                  id="adj-amount"
                  type="number"
                  min="0.00000001"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="adj-source" className="block text-xs font-medium mb-1.5">
                  Source / Offset Account
                </label>
                <input
                  id="adj-source"
                  type="text"
                  value={sourceAccount}
                  onChange={(e) => setSourceAccount(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                />
              </div>
              <div>
                <label htmlFor="adj-reason-code" className="block text-xs font-medium mb-1.5">
                  Reason Code
                </label>
                <select
                  id="adj-reason-code"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                >
                  <option value="RECONCILIATION_CORRECTION">RECONCILIATION_CORRECTION</option>
                  <option value="SETTLEMENT_REVERSAL">SETTLEMENT_REVERSAL</option>
                  <option value="FEE_REBATE">FEE_REBATE</option>
                  <option value="COMPLIANCE_HOLD_OFFSET">COMPLIANCE_HOLD_OFFSET</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="adj-rev-tx" className="block text-xs font-medium mb-1.5">
                Optional Reference Ledger Tx ID (for Reversals)
              </label>
              <input
                id="adj-rev-tx"
                type="text"
                value={reversalOfTxId}
                onChange={(e) => setReversalOfTxId(e.target.value)}
                placeholder="e.g. ltx-..."
                className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
              />
            </div>

            <div>
              <label htmlFor="adj-note" className="block text-xs font-medium mb-1.5">
                Audit Justification Note
              </label>
              <input
                id="adj-note"
                type="text"
                value={summaryNote}
                onChange={(e) => setSummaryNote(e.target.value)}
                placeholder="State documented operational reconciliation justification"
                className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>

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
              type="submit"
              className="w-full sm:w-auto px-6 h-11 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0]"
            >
              Review &amp; Post Adjustment
            </button>
          </form>

          {/* Right Column: Recent Adjustments */}
          <div className="lg:col-span-6 space-y-5">
            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E4E9] dark:border-[#22242A]">
                <h2 className="text-sm font-semibold">Recent Adjustments &amp; Reversals</h2>
              </div>
              {recentAdjustments.length === 0 ? (
                <p className="p-5 text-xs text-[#686D76] dark:text-[#7E828A]">
                  No manual adjustments or reversals posted.
                </p>
              ) : (
                <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {recentAdjustments.slice(0, 8).map((c) => (
                    <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {c.customerName}{' '}
                          <span className="font-mono-num text-[#686D76] dark:text-[#7E828A]">
                            ({c.customerPublicId})
                          </span>
                        </p>
                        <p className="text-[#686D76] dark:text-[#7E828A] truncate">{c.summary}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`font-mono-num font-bold ${
                            c.deltaAmount >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'
                          }`}
                        >
                          {c.deltaAmount >= 0 ? '+' : ''}
                          {formatQty(c.deltaAmount)} {c.assetSymbol}
                        </p>
                        <p className="text-[11px] uppercase text-[#686D76] dark:text-[#7E828A]">
                          {exchangeService.getLedgerTypeLabel(c.type)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Immutable Ledger Adjustment"
        description="Verify the Public User ID, asset, source account, and reason code before appending this adjustment to the ledger."
        details={[
          { label: 'Customer', value: matchedCustomer?.fullName ?? '—' },
          { label: 'Public User ID', value: publicUserId },
          { label: 'Direction', value: direction.toUpperCase() },
          { label: 'Amount', value: `${amount} ${assetSymbol}` },
          { label: 'Source Account', value: sourceAccount },
          { label: 'Reason Code', value: reasonCode },
        ]}
        confirmLabel="Post Ledger Entry"
        confirmTone={direction === 'debit' ? 'danger' : 'primary'}
        onConfirm={handleConfirmAdjustment}
        onCancel={() => setConfirmOpen(false)}
      />
    </AdminLayout>
  );
};

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { EmptyState } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import type { LedgerTransaction, LedgerTransactionType } from '../../types/domain';
import { formatQty } from '../../utils/tradingMath';

const TYPE_LABELS: Record<'all' | LedgerTransactionType, string> = {
  all: 'All',
  deposit_credit: 'Deposit Credits',
  withdrawal_reserve: 'Withdrawal Reserve',
  withdrawal_release: 'Withdrawal Release',
  withdrawal_settle: 'Withdrawal Settle',
  withdrawal_refund: 'Withdrawal Refund',
  spot_buy: 'Buy Trades',
  spot_sell: 'Sell Trades',
  trading_fee: 'Trading Fees',
  adjustment: 'Adjustments',
  reversal: 'Reversals',
};

export const TransactionsPage: React.FC = () => {
  const { currentProfile, currentUserTransactions, ledgerEntries } = useAppState();
  const [filter, setFilter] = useState<'all' | LedgerTransactionType>('all');
  const [selectedTx, setSelectedTx] = useState<LedgerTransaction | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return currentUserTransactions;
    return currentUserTransactions.filter((t) => t.type === filter);
  }, [currentUserTransactions, filter]);

  const selectedEntries = useMemo(() => {
    if (!selectedTx) return [];
    return ledgerEntries.filter((e) => e.transactionId === selectedTx.id);
  }, [selectedTx, ledgerEntries]);

  if (!currentProfile) {
    return (
      <CustomerLayout title="Transactions">
        <EmptyState
          title="Sign in to view transactions"
          description="Inspect verified deposit credits, withdrawal reservations, spot trades, and immutable ledger entries."
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

  return (
    <CustomerLayout title="Transactions">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(TYPE_LABELS) as ('all' | LedgerTransactionType)[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filter === key
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#4B5059] dark:text-[#9CA0A8] hover:opacity-90'
              }`}
            >
              {TYPE_LABELS[key]}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No matching transactions"
            description="Transactions will appear here once verified deposits, withdrawals, or spot trades are posted to your account ledger."
          />
        ) : (
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium">Summary</th>
                    <th className="py-3 px-4 font-medium">Reference</th>
                    <th className="py-3 px-4 font-medium">Timestamp</th>
                    <th className="py-3 px-4 font-medium text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {filtered.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20]">
                      <td className="py-3.5 px-4 font-semibold whitespace-nowrap">
                        {TYPE_LABELS[tx.type]}
                      </td>
                      <td className="py-3.5 px-4">{tx.summary}</td>
                      <td className="py-3.5 px-4 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A]">
                        {tx.referenceId}
                      </td>
                      <td className="py-3.5 px-4 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedTx(tx)}
                          className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA] hover:underline whitespace-nowrap"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
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
          aria-labelledby="tx-detail-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="tx-detail-title" className="text-base font-semibold">
                  Transaction Ledger Details
                </h2>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A] font-mono-num mt-0.5">
                  {selectedTx.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                aria-label="Close transaction details"
                className="p-1.5 rounded-lg text-[#686D76]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3.5 space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Type</dt>
                <dd className="font-semibold">{TYPE_LABELS[selectedTx.type]}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Source Account</dt>
                <dd className="font-mono-num">{selectedTx.sourceAccount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Summary</dt>
                <dd className="text-right">{selectedTx.summary}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#686D76] dark:text-[#7E828A]">Idempotency Key</dt>
                <dd className="font-mono-num">{selectedTx.idempotencyKey}</dd>
              </div>
            </dl>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                Ledger Entries
              </h3>
              <div className="rounded-xl border border-[#E2E4E9] dark:border-[#22242A] divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {selectedEntries.map((entry) => (
                  <div key={entry.id} className="p-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold">
                        {entry.assetSymbol}{' '}
                        <span className="text-[11px] font-normal text-[#686D76] dark:text-[#7E828A]">
                          ({entry.bucket})
                        </span>
                      </p>
                      <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                        {entry.entryRole}
                      </p>
                    </div>
                    <div className="text-right font-mono-num">
                      <p
                        className={`font-semibold ${
                          entry.deltaAmount >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {entry.deltaAmount >= 0 ? '+' : ''}
                        {formatQty(entry.deltaAmount)} {entry.assetSymbol}
                      </p>
                      <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                        After: {formatQty(entry.balanceAfter)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
};

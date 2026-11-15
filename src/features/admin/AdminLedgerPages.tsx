import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { EmptyState, SearchInput } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';
import type { LedgerTransaction, LedgerTransactionType, Trade } from '../../types/domain';
import { formatCryptoPrice, formatQty, formatUsdt } from '../../utils/tradingMath';

export const AdminTradesPage: React.FC = () => {
  const { spotOrders, trades, tradingPairs, profiles } = useAppState();
  const [tab, setTab] = useState<'orders' | 'trades'>('orders');
  const [search, setSearch] = useState('');
  const [pairFilter, setPairFilter] = useState<string>('all');
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

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

  return (
    <AdminLayout title="Orders & Venue Executions">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
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

          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search customer name, email, or User ID"
              ariaLabel="Search orders and trades by customer"
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
          </div>
        </div>

        {tab === 'orders' ? (
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

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';
import { formatCryptoPrice, formatQty, formatUsdt } from '../../utils/tradingMath';

export const AdminDashboardPage: React.FC = () => {
  const {
    customerProfiles,
    kycSubmissions,
    deposits,
    withdrawals,
    walletBalances,
    ledgerTransactions,
    trades,
    auditLogs,
    profiles,
    providerHealth,
    reconciliationRuns,
  } = useAppState();

  const metrics = useMemo(() => {
    const totalCustomers = customerProfiles.length;
    const activeCustomers = customerProfiles.filter((c) => c.accountStatus === 'active').length;
    const pendingKyc = kycSubmissions.filter((k) => k.status === 'pending').length;
    const pendingDeposits = deposits.filter(
      (d) =>
        d.status === 'PENDING_ADMIN_REVIEW' ||
        d.status === 'AWAITING_CONFIRMATIONS' ||
        d.status === 'DETECTED'
    ).length;
    const pendingWithdrawals = withdrawals.filter(
      (w) =>
        w.status === 'PENDING_ADMIN_APPROVAL' ||
        w.status === 'RISK_REVIEW' ||
        w.status === 'APPROVED' ||
        w.status === 'PROCESSING'
    ).length;

    const totalCustomerUsdtLiabilities = walletBalances
      .filter((b) => b.assetSymbol === 'USDT')
      .reduce((sum, b) => sum + b.available + b.reserved, 0);

    const latestRecon = reconciliationRuns[0];

    return {
      totalCustomers,
      activeCustomers,
      pendingKyc,
      pendingDeposits,
      pendingWithdrawals,
      totalCustomerUsdtLiabilities,
      reconStatus: latestRecon ? latestRecon.status : 'matched',
    };
  }, [
    customerProfiles,
    kycSubmissions,
    deposits,
    withdrawals,
    walletBalances,
    reconciliationRuns,
  ]);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  return (
    <AdminLayout title="Admin Dashboard">
      <div className="space-y-6">
        {/* KPI Grid */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Customers', value: String(metrics.totalCustomers), to: '/admin/customers' },
            { label: 'Active Accounts', value: String(metrics.activeCustomers), to: '/admin/customers' },
            { label: 'Pending KYC', value: String(metrics.pendingKyc), to: '/admin/kyc' },
            { label: 'Deposits In Queue', value: String(metrics.pendingDeposits), to: '/admin/deposits' },
            { label: 'Withdrawals Pending', value: String(metrics.pendingWithdrawals), to: '/admin/withdrawals' },
            {
              label: 'USDT Liabilities',
              value: formatUsdt(metrics.totalCustomerUsdtLiabilities),
              to: '/admin/adjustments',
            },
          ].map((kpi) => (
            <Link
              key={kpi.label}
              to={kpi.to}
              className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 hover:border-[#004AE2]/60 transition-colors"
            >
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">{kpi.label}</p>
              <p className="mt-1.5 text-lg font-bold font-mono-num">{kpi.value}</p>
            </Link>
          ))}
        </section>

        {/* External Provider Health & Reconciliation Readiness */}
        <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Infrastructure & External Provider Health</h2>
              <p className="text-xs text-[#686D76] dark:text-[#7E828A] mt-0.5">
                Live external integrations remain unconfigured in Phase A architecture until custody, liquidity, market data, and KYC providers are wired.
              </p>
            </div>
            <Link
              to="/admin/adjustments"
              className="px-3.5 py-1.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold capitalize"
            >
              Reconciliation: {metrics.reconStatus}
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {providerHealth.map((p) => (
              <div
                key={p.id}
                className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase text-[#686D76] dark:text-[#7E828A]">
                    {p.requiredPhase}
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      p.status === 'connected' ? 'text-[#10C478]' : 'text-[#D97706]'
                    }`}
                  >
                    {p.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs font-bold">{p.name}</p>
                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] leading-snug">
                  {p.details}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Three Recent Activity Feeds */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Recent Trades */}
          <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recent Spot Trades</h2>
              <Link to="/admin/trades" className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA]">
                View all
              </Link>
            </div>
            {trades.length === 0 ? (
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                No executed venue trades yet.
              </p>
            ) : (
              <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {trades.slice(0, 5).map((t) => {
                  const customer = profileMap.get(t.userId);
                  return (
                    <div key={t.id} className="py-2.5 flex items-center justify-between text-xs gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          <span className={t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'}>
                            {t.side.toUpperCase()}
                          </span>{' '}
                          {t.pairSymbol}
                        </p>
                        <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                          {customer?.publicUserId} · {formatQty(t.baseQuantity)} {t.baseAsset}
                        </p>
                      </div>
                      <div className="text-right font-mono-num shrink-0">
                        <p className="font-semibold">{formatUsdt(t.totalUsdt)} USDT</p>
                        <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                          @{formatCryptoPrice(t.executedPrice)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent Transactions */}
          <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recent Ledger Transactions</h2>
              <Link to="/admin/transactions" className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA]">
                View all
              </Link>
            </div>
            {ledgerTransactions.length === 0 ? (
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                No ledger transactions posted yet.
              </p>
            ) : (
              <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {ledgerTransactions.slice(0, 5).map((tx) => {
                  const customer = profileMap.get(tx.userId);
                  return (
                    <div key={tx.id} className="py-2.5 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold uppercase text-[11px] text-[#004AE2] dark:text-[#60A5FA]">
                          {exchangeService.getLedgerTypeLabel(tx.type)}
                        </span>
                        <span className="font-mono-num text-[11px] text-[#686D76] dark:text-[#7E828A]">
                          ID {customer?.publicUserId}
                        </span>
                      </div>
                      <p className="truncate">{tx.summary}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent Admin Activity */}
          <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recent Admin Audit Logs</h2>
              <Link to="/admin/audit-logs" className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA]">
                Audit logs
              </Link>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                No administrative actions recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {auditLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="py-2.5 text-xs space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{log.action}</span>
                      <span className="font-mono-num text-[11px] text-[#686D76] dark:text-[#7E828A]">
                        {new Date(log.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[#686D76] dark:text-[#7E828A] line-clamp-2">{log.details}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
};

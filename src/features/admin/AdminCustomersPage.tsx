import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import {
  AccountStatusLabel,
  ConfirmDialog,
  EmptyState,
  KycStatusLabel,
  SearchInput,
  WithdrawalStatusLabel,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import type { Profile } from '../../types/domain';
import { formatQty, formatUsdt } from '../../utils/tradingMath';

export const AdminCustomersPage: React.FC = () => {
  const {
    customerProfiles,
    walletBalances,
    ledgerTransactions,
    withdrawals,
    trades,
    toggleCustomerAccountStatus,
  } = useAppState();

  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Profile | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Profile | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customerProfiles;
    return customerProfiles.filter(
      (c) =>
        c.publicUserId.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.fullName.toLowerCase().includes(q)
    );
  }, [customerProfiles, search]);

  const activeCustomer = useMemo(
    () =>
      selectedCustomer
        ? customerProfiles.find((c) => c.id === selectedCustomer.id) ?? null
        : filtered[0] ?? null,
    [selectedCustomer, customerProfiles, filtered]
  );

  const customerBalances = useMemo(
    () => (activeCustomer ? walletBalances.filter((b) => b.userId === activeCustomer.id) : []),
    [activeCustomer, walletBalances]
  );

  const customerTx = useMemo(
    () => (activeCustomer ? ledgerTransactions.filter((t) => t.userId === activeCustomer.id) : []),
    [activeCustomer, ledgerTransactions]
  );

  const customerWithdrawals = useMemo(
    () => (activeCustomer ? withdrawals.filter((w) => w.userId === activeCustomer.id) : []),
    [activeCustomer, withdrawals]
  );

  const customerTrades = useMemo(
    () => (activeCustomer ? trades.filter((t) => t.userId === activeCustomer.id) : []),
    [activeCustomer, trades]
  );

  const handleConfirmToggle = () => {
    if (!confirmTarget) return;
    const nextStatus = confirmTarget.accountStatus === 'active' ? 'suspended' : 'active';
    const res = toggleCustomerAccountStatus(
      confirmTarget.id,
      nextStatus,
      nextStatus === 'suspended' ? 'Suspended by administrator' : 'Reactivated by administrator'
    );
    setStatusMessage(res.message);
    setConfirmTarget(null);
  };

  return (
    <AdminLayout title="Customer Management">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by User ID, email, or name"
            ariaLabel="Search customers"
            className="sm:w-96"
          />
          {statusMessage && (
            <p role="status" className="text-xs font-medium text-[#10C478]">
              {statusMessage}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Customer List */}
          <div className="lg:col-span-6 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState
                title="No registered customers"
                description="Customers appear here after creating an account via /register."
              />
            ) : (
              <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {filtered.map((c) => {
                  const isSelected = activeCustomer?.id === c.id;
                  const usdtRow = walletBalances.find(
                    (b) => b.userId === c.id && b.assetSymbol === 'USDT'
                  );
                  const totalUsdt = (usdtRow?.available ?? 0) + (usdtRow?.reserved ?? 0);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCustomer(c)}
                      className={`w-full text-left px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] transition-colors ${
                        isSelected ? 'bg-[#F4F5F7] dark:bg-[#1A1B20]' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{c.fullName}</p>
                        <p className="text-xs text-[#686D76] dark:text-[#7E828A] truncate">
                          {c.email} · <span className="font-mono-num">ID {c.publicUserId}</span>
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className="text-xs font-mono-num font-semibold">
                          {formatUsdt(totalUsdt)} USDT
                        </p>
                        <div className="flex items-center justify-end gap-2">
                          <KycStatusLabel status={c.kycStatus} />
                          <span aria-hidden="true">·</span>
                          <AccountStatusLabel status={c.accountStatus} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Customer Detail Inspector */}
          <div className="lg:col-span-6">
            {activeCustomer ? (
              <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold">{activeCustomer.fullName}</h2>
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      {activeCustomer.email} · {activeCustomer.phone}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono-num">ID: {activeCustomer.publicUserId}</span>
                      <span aria-hidden="true">·</span>
                      <KycStatusLabel status={activeCustomer.kycStatus} />
                      <span aria-hidden="true">·</span>
                      <AccountStatusLabel status={activeCustomer.accountStatus} />
                      <span aria-hidden="true">·</span>
                      <span>2FA: {activeCustomer.twoFactorEnabled ? 'On' : 'Off'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmTarget(activeCustomer)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold text-white whitespace-nowrap ${
                      activeCustomer.accountStatus === 'active'
                        ? 'bg-[#F0525E] hover:bg-[#dc3f4b]'
                        : 'bg-[#10C478] hover:bg-[#0ea966]'
                    }`}
                  >
                    {activeCustomer.accountStatus === 'active'
                      ? 'Suspend Account'
                      : 'Reactivate Account'}
                  </button>
                </div>

                {/* Segregated Wallet Balances */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                    Segregated Asset Balances (Available / Reserved)
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {customerBalances.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]"
                      >
                        <p className="text-[11px] font-semibold">{b.assetSymbol}</p>
                        <p className="text-xs font-mono-num mt-0.5">
                          Avail: <strong>{formatQty(b.available)}</strong>
                        </p>
                        <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                          Resv: {formatQty(b.reserved)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Customer Withdrawals */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                    Withdrawal History ({customerWithdrawals.length})
                  </h3>
                  {customerWithdrawals.length === 0 ? (
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      No withdrawal requests recorded.
                    </p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] rounded-xl border border-[#E2E4E9] dark:border-[#22242A]">
                      {customerWithdrawals.map((w) => (
                        <div key={w.id} className="p-2.5 text-xs flex justify-between gap-3">
                          <span className="font-mono-num">
                            {formatQty(w.grossAmount)} {w.assetSymbol} ({w.networkCode})
                          </span>
                          <WithdrawalStatusLabel status={w.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer Transaction History */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                    Ledger Transaction History ({customerTx.length})
                  </h3>
                  {customerTx.length === 0 ? (
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      No ledger transactions recorded.
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] rounded-xl border border-[#E2E4E9] dark:border-[#22242A]">
                      {customerTx.map((tx) => (
                        <div key={tx.id} className="p-2.5 text-xs flex justify-between gap-3">
                          <span className="truncate">{tx.summary}</span>
                          <span className="font-mono-num text-[11px] text-[#686D76] shrink-0">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Customer Trading History */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#686D76] dark:text-[#7E828A]">
                    Trading History ({customerTrades.length})
                  </h3>
                  {customerTrades.length === 0 ? (
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      No settled spot trades executed.
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] rounded-xl border border-[#E2E4E9] dark:border-[#22242A]">
                      {customerTrades.map((t) => (
                        <div key={t.id} className="p-2.5 text-xs flex justify-between gap-3">
                          <span>
                            <strong
                              className={t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'}
                            >
                              {t.side.toUpperCase()}
                            </strong>{' '}
                            {formatQty(t.baseQuantity)} {t.baseAsset}
                          </span>
                          <span className="font-mono-num">
                            {formatUsdt(t.totalUsdt)} USDT
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title="Select a customer"
                description="Choose a customer from the list to inspect available/reserved balances, KYC, withdrawals, transactions, and trading history."
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.accountStatus === 'active'
            ? 'Suspend Customer Account'
            : 'Reactivate Customer Account'
        }
        description={
          confirmTarget?.accountStatus === 'active'
            ? 'Suspended customers cannot request deposit addresses, submit withdrawals, or execute spot trades.'
            : 'Reactivating this account restores operational permissions (subject to KYC and 2FA requirements).'
        }
        details={
          confirmTarget
            ? [
                { label: 'Customer', value: confirmTarget.fullName },
                { label: 'Public User ID', value: confirmTarget.publicUserId },
                {
                  label: 'New Status',
                  value: confirmTarget.accountStatus === 'active' ? 'Suspended' : 'Active',
                },
              ]
            : []
        }
        confirmLabel={
          confirmTarget?.accountStatus === 'active' ? 'Suspend Account' : 'Reactivate Account'
        }
        confirmTone={confirmTarget?.accountStatus === 'active' ? 'danger' : 'primary'}
        onConfirm={handleConfirmToggle}
        onCancel={() => setConfirmTarget(null)}
      />
    </AdminLayout>
  );
};

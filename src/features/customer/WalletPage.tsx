import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Eye,
  EyeOff,
  FileText,
  History,
  ReceiptText,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  ChangeBadge,
  CoinAvatar,
  DepositStatusLabel,
  EmptyState,
  SearchInput,
  WithdrawalStatusLabel,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { filterAndSortWalletAssets } from '../../utils/walletWorkspace';
import { formatCryptoPrice, formatQty, formatUsdt } from '../../utils/tradingMath';

export const WalletPage: React.FC<{
  mode?: 'wallets' | 'deposit' | 'withdraw';
}> = ({ mode = 'wallets' }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab =
    mode === 'withdraw'
      ? 'withdraw'
      : mode === 'deposit'
        ? 'deposit'
        : searchParams.get('tab') === 'withdraw'
          ? 'withdraw'
          : searchParams.get('tab') === 'deposit'
            ? 'deposit'
            : 'wallets';

  const pageTitle =
    mode === 'deposit' ? 'Deposit' : mode === 'withdraw' ? 'Withdraw' : 'Wallets';

  const {
    currentProfile,
    currentUserBalances,
    currentUserDepositAddresses,
    currentUserDeposits,
    currentUserWithdrawals,
    networks,
    marketPrices,
    assets,
    hideBalances,
    toggleHideBalances,
    requestDepositAddress,
    submitDeposit,
  } = useAppState();

  const [activeTab, setActiveTab] = useState<'wallets' | 'deposit' | 'withdraw'>(initialTab);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');
  const [hideZeroBalances, setHideZeroBalances] = useState(false);
  const [sortField, setSortField] = useState<'symbol' | 'value' | 'change'>('value');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [depositMethod, setDepositMethod] = useState<'crypto' | 'bank' | 'ach' | 'card' | 'wire'>('crypto');
  const [unavailableModalMethod, setUnavailableModalMethod] = useState<string | null>(null);
  const [depAmountInput, setDepAmountInput] = useState('');
  const [depTxHashInput, setDepTxHashInput] = useState('');
  const [depSubmitFeedback, setDepSubmitFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (mode === 'withdraw') {
      setActiveTab('withdraw');
    } else if (mode === 'deposit') {
      setActiveTab('deposit');
    } else {
      const tabParam = searchParams.get('tab');
      if (tabParam === 'withdraw' || tabParam === 'deposit' || tabParam === 'wallets') {
        setActiveTab(tabParam);
      }
    }
  }, [mode, searchParams]);

  const switchTab = (tab: 'wallets' | 'deposit' | 'withdraw') => {
    setActiveTab(tab);
    setSearchParams(tab === 'wallets' ? {} : { tab });
  };

  // Deposit state
  const depositAssets = useMemo(() => {
    const syms = Array.from(new Set(networks.map((n) => n.assetSymbol)));
    return syms.length > 0 ? syms : ['USDT', 'BTC', 'ETH', 'SOL'];
  }, [networks]);

  const urlAsset = searchParams.get('asset')?.toUpperCase();
  const initialDepAsset = urlAsset && depositAssets.includes(urlAsset) ? urlAsset : (depositAssets[0] ?? 'USDT');

  const [depAsset, setDepAsset] = useState<string>(initialDepAsset);
  const depNetworks = useMemo(
    () => networks.filter((n) => n.assetSymbol === depAsset),
    [networks, depAsset]
  );
  const [depNetworkCode, setDepNetworkCode] = useState<string>(
    depNetworks[0]?.code ?? 'TRC-20'
  );
  useEffect(() => {
    if (!depNetworks.some((n) => n.code === depNetworkCode)) {
      setDepNetworkCode(depNetworks[0]?.code ?? '');
    }
  }, [depNetworks, depNetworkCode]);

  const [depLoading, setDepLoading] = useState(false);
  const [depFeedback, setDepFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const walletRows = useMemo(
    () =>
      filterAndSortWalletAssets({
        balances: currentUserBalances,
        assets,
        marketPrices,
        searchQuery: assetSearchQuery,
        hideZeroBalances,
        sortField,
        sortDirection,
      }),
    [currentUserBalances, assets, marketPrices, assetSearchQuery, hideZeroBalances, sortField, sortDirection]
  );

  const totalUsdtValuation = useMemo(
    () => walletRows.reduce((sum, r) => sum + r.valueUsdt, 0),
    [walletRows]
  );
  const totalAvailableUsdt = useMemo(
    () =>
      currentUserBalances.reduce((sum, b) => {
        const isUsdt = b.assetSymbol === 'USDT';
        const mkt = marketPrices.find((m) => m.symbol === `${b.assetSymbol}/USDT`);
        const px = isUsdt ? 1 : mkt?.price ?? 0;
        return sum + b.available * px;
      }, 0),
    [currentUserBalances, marketPrices]
  );
  const totalReservedUsdt = useMemo(
    () =>
      currentUserBalances.reduce((sum, b) => {
        const isUsdt = b.assetSymbol === 'USDT';
        const mkt = marketPrices.find((m) => m.symbol === `${b.assetSymbol}/USDT`);
        const px = isUsdt ? 1 : mkt?.price ?? 0;
        return sum + b.reserved * px;
      }, 0),
    [currentUserBalances, marketPrices]
  );

  const activeDepNetwork =
    depNetworks.find((n) => n.code === depNetworkCode) ?? depNetworks[0];
  const assignedDepositAddress = currentUserDepositAddresses.find(
    (d) => d.assetSymbol === depAsset && d.networkCode === depNetworkCode
  );

  if (!currentProfile) {
    return (
      <CustomerLayout
        title={pageTitle}
        subtitle="Sandbox environment · Authenticate to inspect custody vaults and segregated account balances"
      >
        <EmptyState
          title={`Sign in to access ${pageTitle}`}
          description="Live custody deposit addresses and wallet management require an authenticated account and approved KYC. No real blockchain operations execute in sandbox preview."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/login"
                className="inline-flex px-5 py-2.5 rounded-lg bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0]"
              >
                Sign in
              </Link>
              <Link
                to="/overview"
                className="inline-flex px-5 py-2.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-sm font-medium"
              >
                Back to Overview
              </Link>
            </div>
          }
        />
      </CustomerLayout>
    );
  }

  const handleRequestDepositAddress = async () => {
    setDepLoading(true);
    setDepFeedback(null);
    const res = await requestDepositAddress({
      assetSymbol: depAsset,
      networkCode: depNetworkCode,
    });
    setDepLoading(false);
    setDepFeedback({ ok: res.ok, text: res.message });
  };

  const handleSubmitDepositForm = (e: React.FormEvent) => {
    e.preventDefault();
    setDepSubmitFeedback(null);
    const res = submitDeposit({
      assetSymbol: depAsset,
      networkCode: depNetworkCode,
      amount: Number(depAmountInput),
      txHash: depTxHashInput,
    });
    setDepSubmitFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setDepAmountInput('');
      setDepTxHashInput('');
    }
  };

  return (
    <CustomerLayout title={pageTitle}>
      <div className="space-y-6">
        {/* Top Valuation Banner & Mode Tabs */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-7 rounded-2xl bg-[#004AE2] text-white p-6 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-sm text-blue-100 font-medium">Total Wallet Valuation</span>
              <button
                type="button"
                onClick={toggleHideBalances}
                aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
                className="p-1.5 rounded-full hover:bg-white/15 transition-colors"
              >
                {hideBalances ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="mt-3 text-3xl sm:text-4xl font-bold font-mono-num">
              {hideBalances ? '•••••• USDT' : `${formatUsdt(totalUsdtValuation)} USDT`}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-blue-100/90 font-mono-num">
              <span>
                Available: {hideBalances ? '••••' : formatUsdt(totalAvailableUsdt)} USDT
              </span>
              <span>
                Reserved: {hideBalances ? '••••' : formatUsdt(totalReservedUsdt)} USDT
              </span>
              <span>
                Assets: {walletRows.filter((r) => r.hasBalance).length} held ({walletRows.length} total)
              </span>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => switchTab('wallets')}
              className={`flex-1 h-14 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors border ${
                activeTab === 'wallets'
                  ? 'bg-white dark:bg-[#1C1E24] border-[#004AE2] text-[#004AE2] dark:text-[#60A5FA]'
                  : 'bg-white dark:bg-[#141518] border-[#E2E4E9] dark:border-[#22242A] text-[#111214] dark:text-white'
              }`}
            >
              <ReceiptText className="w-4 h-4" />
              <span>Asset Wallets</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('deposit')}
              className={`flex-1 h-14 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors border ${
                activeTab === 'deposit'
                  ? 'bg-white dark:bg-[#1C1E24] border-[#004AE2] text-[#004AE2] dark:text-[#60A5FA]'
                  : 'bg-white dark:bg-[#141518] border-[#E2E4E9] dark:border-[#22242A] text-[#111214] dark:text-white'
              }`}
            >
              <ArrowDownToLine className="w-4 h-4" />
              <span>Deposit</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('withdraw')}
              className={`flex-1 h-14 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors border ${
                activeTab === 'withdraw'
                  ? 'bg-white dark:bg-[#1C1E24] border-[#004AE2] text-[#004AE2] dark:text-[#60A5FA]'
                  : 'bg-white dark:bg-[#141518] border-[#E2E4E9] dark:border-[#22242A] text-[#111214] dark:text-white'
              }`}
            >
              <ArrowUpFromLine className="w-4 h-4" />
              <span>Withdraw</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Asset Wallets Overview */}
        {activeTab === 'wallets' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="w-full sm:w-80">
                  <SearchInput
                    value={assetSearchQuery}
                    onChange={setAssetSearchQuery}
                    placeholder="Search asset symbol or name..."
                    ariaLabel="Search assets"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hideZeroBalances}
                      onChange={(e) => setHideZeroBalances(e.target.checked)}
                      className="rounded border-[#D4D7DF] dark:border-[#2B2C32] text-[#004AE2] focus:ring-[#004AE2]"
                    />
                    <span>Hide zero balances</span>
                  </label>

                  <select
                    value={`${sortField}-${sortDirection}`}
                    onChange={(e) => {
                      const [f, d] = e.target.value.split('-') as [
                        'symbol' | 'value' | 'change',
                        'asc' | 'desc'
                      ];
                      setSortField(f);
                      setSortDirection(d);
                    }}
                    className="px-3 py-2 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold focus:outline-none"
                    aria-label="Sort assets"
                  >
                    <option value="value-desc">Highest Valuation</option>
                    <option value="value-asc">Lowest Valuation</option>
                    <option value="symbol-asc">Symbol (A-Z)</option>
                    <option value="change-desc">Top 24H Gainers</option>
                  </select>
                </div>
              </div>

              {/* Asset Table / Cards */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-[#E2E4E9] dark:border-[#22242A] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                      <th className="py-3 px-3 font-medium">Asset</th>
                      <th className="py-3 px-3 font-medium text-right">Available</th>
                      <th className="py-3 px-3 font-medium text-right">Reserved</th>
                      <th className="py-3 px-3 font-medium text-right">Total Balance</th>
                      <th className="py-3 px-3 font-medium text-right">Est. Value (USDT)</th>
                      <th className="py-3 px-3 font-medium text-right">24H Change</th>
                      <th className="py-3 px-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                    {walletRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-xs text-[#686D76] dark:text-[#7E828A]">
                          No assets match your search filter.
                        </td>
                      </tr>
                    ) : (
                      walletRows.map((r) => {
                        const pairSymbol = `${r.symbol}/USDT`;
                        return (
                          <tr key={r.symbol} className="hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] transition-colors">
                            <td className="py-3.5 px-3">
                              <Link
                                to={`/wallets/${encodeURIComponent(r.symbol)}`}
                                className="flex items-center gap-3 group"
                              >
                                <CoinAvatar symbol={r.symbol} color={r.badgeColor} size="sm" />
                                <div>
                                  <p className="font-semibold group-hover:text-[#004AE2] dark:group-hover:text-[#60A5FA]">
                                    {r.symbol}
                                  </p>
                                  <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                                    {r.name}
                                  </p>
                                </div>
                              </Link>
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-num font-semibold">
                              {hideBalances ? '••••' : formatQty(r.available)}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-num text-[#686D76] dark:text-[#7E828A]">
                              {hideBalances ? '••••' : formatQty(r.reserved)}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-num font-semibold">
                              {hideBalances ? '••••' : formatQty(r.total)}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-num font-semibold">
                              {hideBalances ? '••••' : `${formatUsdt(r.valueUsdt)}`}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-num">
                              {r.symbol === 'USDT' ? (
                                <span className="text-[#686D76] dark:text-[#7E828A]">0.00%</span>
                              ) : (
                                <ChangeBadge
                                  changePct={r.change24hPct}
                                  variant="text"
                                  unavailable={r.isReferencePrice && r.priceUsdt <= 0}
                                />
                              )}
                            </td>
                            <td className="py-3.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <Link
                                  to={`/deposit?asset=${encodeURIComponent(r.symbol)}`}
                                  className="px-2.5 py-1 rounded bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold hover:opacity-90"
                                >
                                  Deposit
                                </Link>
                                <Link
                                  to={`/withdraw?asset=${encodeURIComponent(r.symbol)}`}
                                  className="px-2.5 py-1 rounded bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold hover:opacity-90"
                                >
                                  Withdraw
                                </Link>
                                {r.symbol !== 'USDT' && (
                                  <Link
                                    to={`/trade?pair=${encodeURIComponent(pairSymbol)}`}
                                    className="px-2.5 py-1 rounded bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                                  >
                                    Trade
                                  </Link>
                                )}
                                <Link
                                  to={`/wallets/${encodeURIComponent(r.symbol)}`}
                                  className="px-2.5 py-1 rounded bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold hover:opacity-90"
                                >
                                  Details
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Record Navigation */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Deposit History</p>
                  <p className="text-lg font-bold font-mono-num mt-1">{currentUserDeposits.length}</p>
                </div>
                <button
                  type="button"
                  onClick={() => switchTab('deposit')}
                  className="px-3 py-2 rounded-xl bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold"
                >
                  View Deposits
                </button>
              </div>
              <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Withdrawal Requests</p>
                  <p className="text-lg font-bold font-mono-num mt-1">{currentUserWithdrawals.length}</p>
                </div>
                <button
                  type="button"
                  onClick={() => switchTab('withdraw')}
                  className="px-3 py-2 rounded-xl bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold"
                >
                  View Withdrawals
                </button>
              </div>
              <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Immutable Ledger</p>
                  <p className="text-lg font-bold font-mono-num mt-1">Audited</p>
                </div>
                <Link
                  to="/transactions"
                  className="px-3 py-2 rounded-xl bg-[#E8EAEE] dark:bg-[#242528] text-xs font-semibold"
                >
                  Audit Trail
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Deposit Experience */}
        {activeTab === 'deposit' && (
          <div className="space-y-6">
            {/* Deposit Method Selection Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => setDepositMethod('crypto')}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  depositMethod === 'crypto'
                    ? 'bg-[#004AE2]/10 border-[#004AE2] text-[#004AE2] dark:text-[#60A5FA]'
                    : 'bg-white dark:bg-[#141518] border-[#E2E4E9] dark:border-[#22242A] text-[#111214] dark:text-white hover:border-[#004AE2]/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">Crypto</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#10C478]/15 text-[#10C478] text-[10px] font-semibold">
                    Enabled
                  </span>
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Deposit cryptocurrency to an address assigned to your account.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setUnavailableModalMethod('bank')}
                className="p-4 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] text-left hover:border-[#D97706]/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold group-hover:text-[#D97706]">Bank Transfer</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#D97706]/15 text-[#D97706] text-[10px] font-semibold">
                    Unavailable
                  </span>
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Deposit using a supported bank payment method.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setUnavailableModalMethod('ach')}
                className="p-4 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] text-left hover:border-[#D97706]/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold group-hover:text-[#D97706]">ACH</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#D97706]/15 text-[#D97706] text-[10px] font-semibold">
                    Unavailable
                  </span>
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Deposit through ACH bank transfer.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setUnavailableModalMethod('card')}
                className="p-4 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] text-left hover:border-[#D97706]/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold group-hover:text-[#D97706]">Debit Card</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#D97706]/15 text-[#D97706] text-[10px] font-semibold">
                    Unavailable
                  </span>
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Deposit using a debit card.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setUnavailableModalMethod('wire')}
                className="p-4 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] text-left hover:border-[#D97706]/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold group-hover:text-[#D97706]">Wire Transfer</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#D97706]/15 text-[#D97706] text-[10px] font-semibold">
                    Unavailable
                  </span>
                </div>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Deposit through a bank wire.
                </p>
              </button>
            </div>

            {/* Unavailable Method Modal / Dialog */}
            {unavailableModalMethod && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <ShieldAlert className="w-5 h-5 text-[#D97706]" />
                      <h3 className="text-base font-bold">
                        {unavailableModalMethod === 'bank' && 'Bank Transfer Notice'}
                        {unavailableModalMethod === 'ach' && 'ACH Deposit Notice'}
                        {unavailableModalMethod === 'card' && 'Debit Card Notice'}
                        {unavailableModalMethod === 'wire' && 'Wire Transfer Notice'}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUnavailableModalMethod(null)}
                      className="p-1 rounded-lg text-[#686D76] hover:bg-[#E8EAEE] dark:hover:bg-[#242528]"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-[#686D76] dark:text-[#9CA0A8] leading-relaxed">
                    {unavailableModalMethod === 'bank' &&
                      'Bank transfer deposits are temporarily unavailable. We’re working to restore this service as soon as possible. Please try again later.'}
                    {unavailableModalMethod === 'ach' &&
                      'ACH deposits are currently unavailable due to temporary service maintenance. Please try again later.'}
                    {unavailableModalMethod === 'card' &&
                      'Debit card deposits are temporarily unavailable while we update our payment processing service. We apologize for the inconvenience.'}
                    {unavailableModalMethod === 'wire' &&
                      'Wire transfer deposits are temporarily unavailable. This deposit option will be restored once processing services are available again.'}
                  </p>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setUnavailableModalMethod(null)}
                      className="px-5 py-2 rounded-xl bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                    >
                      Got it
                    </button>
                  </div>
                </div>
              </div>
            )}

            <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Cryptocurrency Deposit</h2>
                <span className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Sandbox Custody Vault Provisioning
                </span>
              </div>

              {currentProfile.kycStatus !== 'approved' && (
                <div className="p-4 rounded-xl bg-[#D97706]/10 border border-[#D97706]/40 text-xs flex items-center justify-between gap-2">
                  <span>Approved KYC verification is required before generating deposit addresses.</span>
                  <Link to="/kyc" className="font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                    Complete KYC
                  </Link>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dep-asset" className="block text-xs font-medium mb-1.5">
                    Asset
                  </label>
                  <select
                    id="dep-asset"
                    value={depAsset}
                    onChange={(e) => {
                      setDepAsset(e.target.value);
                      setDepFeedback(null);
                    }}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                  >
                    {depositAssets.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="dep-network" className="block text-xs font-medium mb-1.5">
                    Network
                  </label>
                  <select
                    id="dep-network"
                    value={depNetworkCode}
                    onChange={(e) => {
                      setDepNetworkCode(e.target.value);
                      setDepFeedback(null);
                    }}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                  >
                    {depNetworks.map((n) => (
                      <option key={n.id} value={n.code}>
                        {n.code} — {n.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activeDepNetwork && (
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 text-xs">
                  <div>
                    <dt className="text-[#686D76] dark:text-[#7E828A]">Required Confirmations</dt>
                    <dd className="font-mono-num font-semibold mt-0.5">
                      {activeDepNetwork.requiredConfirmations} blocks
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#686D76] dark:text-[#7E828A]">Minimum Deposit</dt>
                    <dd className="font-mono-num font-semibold mt-0.5">
                      {activeDepNetwork.minDeposit} {activeDepNetwork.assetSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#686D76] dark:text-[#7E828A]">Destination Tag / Memo</dt>
                    <dd className="font-semibold mt-0.5">
                      {activeDepNetwork.memoRequired ? 'Mandatory' : 'Not Required'}
                    </dd>
                  </div>
                </dl>
              )}

              {assignedDepositAddress ? (
                <div className="space-y-4">
                  <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-2 text-xs">
                    <p className="text-[#686D76] dark:text-[#7E828A]">
                      Assigned {depAsset} ({depNetworkCode}) Custody Deposit Address
                    </p>
                    <p className="font-mono-num text-sm font-semibold break-all text-[#111214] dark:text-white">
                      {assignedDepositAddress.address}
                    </p>
                    {assignedDepositAddress.memoOrTag && (
                      <p className="font-mono-num">
                        Destination Tag: <strong>{assignedDepositAddress.memoOrTag}</strong>
                      </p>
                    )}
                  </div>

                  {/* Customer Deposit Submission Form */}
                  <form onSubmit={handleSubmitDepositForm} className="space-y-3 pt-2">
                    <h3 className="text-sm font-semibold">Submit Deposit Transaction Reference</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="dep-amt" className="block text-xs font-medium mb-1">
                          Amount ({depAsset})
                        </label>
                        <input
                          id="dep-amt"
                          type="number"
                          step="any"
                          min={activeDepNetwork?.minDeposit ?? 1}
                          value={depAmountInput}
                          onChange={(e) => setDepAmountInput(e.target.value)}
                          placeholder="e.g. 100"
                          required
                          className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="dep-tx" className="block text-xs font-medium mb-1">
                          Transaction Hash (TxID)
                        </label>
                        <input
                          id="dep-tx"
                          type="text"
                          value={depTxHashInput}
                          onChange={(e) => setDepTxHashInput(e.target.value)}
                          placeholder="0x..."
                          required
                          className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="px-5 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                    >
                      Submit Deposit for Verification
                    </button>
                    {depSubmitFeedback && (
                      <p
                        role="status"
                        className={`text-xs font-medium ${
                          depSubmitFeedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {depSubmitFeedback.text}
                      </p>
                    )}
                  </form>
                </div>
              ) : (
                <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-3">
                  <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                    Deposit addresses are provisioned per customer directly from the custody vault provider. No actual mainnet address issuance or blockchain monitoring occurs in this sandbox preview.
                  </p>
                  <button
                    type="button"
                    disabled={
                      depLoading ||
                      currentProfile.kycStatus !== 'approved' ||
                      currentProfile.accountStatus === 'suspended' ||
                      !activeDepNetwork?.isDepositEnabled
                    }
                    onClick={handleRequestDepositAddress}
                    className="px-6 h-11 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0] disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {depLoading ? 'Requesting...' : 'Assign Custody Deposit Address'}
                  </button>
                </div>
              )}

              {depFeedback && (
                <p
                  role="status"
                  className={`text-xs font-medium ${
                    depFeedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'
                  }`}
                >
                  {depFeedback.text}
                </p>
              )}
            </section>

            {/* Deposit History */}
            <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-3">
              <h2 className="text-base font-semibold">Deposit Verification History</h2>
              {currentUserDeposits.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  No blockchain deposits detected for this account yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                        <th className="py-2 pr-3 font-medium">Asset / Network</th>
                        <th className="py-2 pr-3 font-medium">Tx Hash</th>
                        <th className="py-2 pr-3 font-medium text-right">Amount</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                      {currentUserDeposits.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                            {d.assetSymbol} ({d.networkCode})
                          </td>
                          <td className="py-2.5 pr-3 font-mono-num truncate max-w-[160px]">
                            {d.txHash}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono-num font-semibold">
                            {formatQty(d.amount)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <DepositStatusLabel status={d.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Tab 3: Withdrawal Experience (Strictly Non-Operational) */}
        {activeTab === 'withdraw' && (
          <div className="space-y-6">
            <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Cryptocurrency Withdrawal</h2>
                <span className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Rate-Limited Sandbox Service
                </span>
              </div>

              {/* Required non-operational withdrawal notice */}
              <div
                role="alert"
                className="p-4 rounded-xl bg-[#FEF3C7]/40 dark:bg-[#D97706]/15 border border-[#D97706]/40 flex items-start gap-3"
              >
                <ShieldAlert className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                    Withdrawal not available at the moment try again later or contact support if this persists.
                  </p>
                  <p className="text-[#686D76] dark:text-[#7E828A]">
                    Live outgoing blockchain settlements and automatic custody debits are temporarily disabled during Phase 2.3 sandbox maintenance. No asset movements or ledger debits execute.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-70 pointer-events-none">
                <div>
                  <label className="block text-xs font-medium mb-1.5">Asset</label>
                  <input
                    type="text"
                    disabled
                    value="USDT"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">Network</label>
                  <input
                    type="text"
                    disabled
                    value="TRC-20 — Tron Network"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  alert('Withdrawal not available at the moment try again later or contact support if this persists.');
                }}
                className="w-full sm:w-auto px-6 h-11 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
              >
                Request Withdrawal
              </button>
            </section>

            {/* Withdrawal History */}
            <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-3">
              <h2 className="text-base font-semibold">Withdrawal History</h2>
              {currentUserWithdrawals.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  No withdrawal requests submitted.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                        <th className="py-2 pr-3 font-medium">Asset / Network</th>
                        <th className="py-2 pr-3 font-medium">Destination</th>
                        <th className="py-2 pr-3 font-medium text-right">Net Amount</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                      {currentUserWithdrawals.map((w) => (
                        <tr key={w.id}>
                          <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                            {w.assetSymbol} ({w.networkCode})
                          </td>
                          <td className="py-2.5 pr-3 font-mono-num truncate max-w-[160px]">
                            {w.destinationAddress}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono-num font-semibold">
                            {formatQty(w.netAmount)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <WithdrawalStatusLabel status={w.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </CustomerLayout>
  );
};

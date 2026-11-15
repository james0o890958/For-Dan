import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Bell,
  ChevronRight,
  Eye,
  EyeOff,
  UserCheck,
} from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  AccountStatusLabel,
  ChangeBadge,
  CoinAvatar,
  EmptyState,
  KycStatusLabel,
  MarketFeedLabel,
  SearchInput,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { exchangeService } from '../../services/platformService';
import {
  calculatePortfolioSummary,
  formatCryptoPrice,
  formatQty,
  formatUsdt,
} from '../../utils/tradingMath';

export const DashboardPage: React.FC = () => {
  const {
    currentProfile,
    currentUserBalances,
    currentUserTransactions,
    currentUserTrades,
    currentUserNotifications,
    marketPrices,
    marketSettings,
    assets,
    hideBalances,
    toggleHideBalances,
  } = useAppState();

  const [marketTab, setMarketTab] = useState<'all' | 'gainers'>('all');
  const [search, setSearch] = useState('');

  const summary = useMemo(
    () => calculatePortfolioSummary(currentUserBalances, marketPrices, assets),
    [currentUserBalances, marketPrices, assets]
  );

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.symbol, a])), [assets]);

  const featuredPrices = marketPrices.slice(0, 3);

  const filteredMarkets = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = marketPrices.filter((m) => m.symbol.toLowerCase().includes(q));
    if (marketTab === 'gainers') {
      list = [...list].sort((a, b) => b.change24hPct - a.change24hPct);
    }
    return list;
  }, [marketPrices, search, marketTab]);

  if (!currentProfile) {
    return (
      <CustomerLayout title="Dashboard">
        <EmptyState
          title="Sign in to view your dashboard"
          description="Sign in to your account or register a new account starting with 0.00 available and 0.00 reserved balances."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/login"
                className="inline-flex px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="inline-flex px-5 py-2.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-sm font-semibold"
              >
                Create New Account
              </Link>
            </div>
          }
        />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout title="Dashboard">
      <div className="space-y-6">
        {/* Search & Status strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search keywords"
            ariaLabel="Search markets"
            className="sm:w-80"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#686D76] dark:text-[#7E828A]">
            <span className="font-mono-num">ID: {currentProfile.publicUserId}</span>
            <span aria-hidden="true">·</span>
            <span>
              KYC: <KycStatusLabel status={currentProfile.kycStatus} />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Account: <AccountStatusLabel status={currentProfile.accountStatus} />
            </span>
          </div>
        </div>

        {/* Hero Banner + Balance Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-5 rounded-2xl bg-[#004AE2] text-white p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-sm text-blue-100">Total asset valuation</span>
              <button
                type="button"
                onClick={toggleHideBalances}
                aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
                className="p-1.5 rounded-full hover:bg-white/15"
              >
                {hideBalances ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <div className="my-4">
              <p className="text-3xl font-bold font-mono-num tracking-tight">
                {hideBalances ? '•••••• USDT' : `${formatUsdt(summary.totalUsdt)} USDT`}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-100/90 font-mono-num">
                <span>
                  Available: {hideBalances ? '••••' : `${formatUsdt(summary.availableUsdt)} USDT`}
                </span>
                <span>
                  Reserved: {hideBalances ? '••••' : `${formatUsdt(summary.reservedUsdt)} USDT`}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Link
                to="/wallet"
                className="py-2.5 rounded-full bg-white text-[#004AE2] text-xs font-semibold text-center hover:bg-blue-50"
              >
                Deposit / Withdraw
              </Link>
              <Link
                to="/trade"
                className="py-2.5 rounded-full bg-white/15 text-white text-xs font-semibold text-center hover:bg-white/25"
              >
                Spot Trade
              </Link>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-gradient-to-br from-[#06183A] via-[#0B2A6B] to-[#081020] border border-[#22242A] text-white p-5 flex flex-col justify-between">
            <div>
              <p className="text-xs text-blue-200/90">Spot Exchange Operations</p>
              <h2 className="mt-1.5 text-xl sm:text-2xl font-semibold tracking-tight text-balance">
                Custody-verified deposits, spot order routing, and dual-controlled withdrawals
              </h2>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2 pt-2">
              <Link to="/wallet" className="flex flex-col items-center gap-1.5 group">
                <span className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                  <ArrowDownToLine className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-blue-100">Deposit</span>
              </Link>
              <Link to="/wallet?tab=withdraw" className="flex flex-col items-center gap-1.5 group">
                <span className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                  <ArrowUpFromLine className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-blue-100">Withdraw</span>
              </Link>
              <Link to="/trade" className="flex flex-col items-center gap-1.5 group">
                <span className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                  <ArrowLeftRight className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-blue-100">Trade</span>
              </Link>
              <Link to="/kyc" className="flex flex-col items-center gap-1.5 group">
                <span className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                  <UserCheck className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-medium text-blue-100">KYC</span>
              </Link>
            </div>
          </div>
        </div>

        {/* KYC Warning Banner if not approved */}
        {currentProfile.kycStatus !== 'approved' && (
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#D97706]/50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                KYC verification is {currentProfile.kycStatus.replace('_', ' ')}
              </p>
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                You can inspect markets now. Custody deposit addresses, spot order execution, and withdrawals require approved KYC verification.
              </p>
            </div>
            <Link
              to="/kyc"
              className="px-4 py-2 rounded-full bg-[#004AE2] text-white text-xs font-semibold whitespace-nowrap"
            >
              {currentProfile.kycStatus === 'rejected' ? 'Resubmit KYC' : 'Complete KYC'}
            </Link>
          </div>
        )}

        {/* Featured 3 Asset Cards */}
        <section aria-label="Featured markets" className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {featuredPrices.map((mp) => {
            const base = mp.symbol.split('/')[0];
            const asset = assetMap.get(base);
            const unavailable = mp.price <= 0;
            return (
              <Link
                key={mp.symbol}
                to={`/markets/${encodeURIComponent(mp.symbol)}`}
                className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex items-center justify-between gap-3 hover:border-[#004AE2]/60 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <CoinAvatar symbol={base} color={asset?.badgeColor} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{base}</p>
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A] truncate">
                      {asset?.name ?? base}
                    </p>
                  </div>
                </div>
                <div className="text-right min-w-0">
                  <p className="font-mono-num text-sm font-semibold">
                    {unavailable ? 'Feed Offline' : formatCryptoPrice(mp.price)}
                  </p>
                  <p className="font-mono-num text-[11px] text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                    24H {unavailable ? '—' : mp.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <ChangeBadge changePct={mp.change24hPct} variant="text" unavailable={unavailable} />
              </Link>
            );
          })}
        </section>

        {/* Market Overview & Holdings Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Markets Table */}
          <section className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={() => setMarketTab('all')}
                  className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${
                    marketTab === 'all'
                      ? 'border-[#004AE2] text-[#111214] dark:text-white'
                      : 'border-transparent text-[#686D76] dark:text-[#7E828A]'
                  }`}
                >
                  Markets
                </button>
                <button
                  type="button"
                  onClick={() => setMarketTab('gainers')}
                  className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${
                    marketTab === 'gainers'
                      ? 'border-[#004AE2] text-[#111214] dark:text-white'
                      : 'border-transparent text-[#686D76] dark:text-[#7E828A]'
                  }`}
                >
                  Top Movers
                </button>
              </div>
              <MarketFeedLabel status={marketSettings.providerStatus} />
            </div>

            <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="grid grid-cols-12 px-4 py-2.5 bg-[#E8EAEE] dark:bg-[#262629] text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
                <div className="col-span-5">Name</div>
                <div className="col-span-4">MarketPrice</div>
                <div className="col-span-3 text-right">Change</div>
              </div>
              <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {filteredMarkets.map((mp) => {
                  const base = mp.symbol.split('/')[0];
                  const unavailable = mp.price <= 0;
                  return (
                    <Link
                      key={mp.symbol}
                      to={`/markets/${encodeURIComponent(mp.symbol)}`}
                      className="grid grid-cols-12 items-center px-4 py-3 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] transition-colors"
                    >
                      <div className="col-span-5">
                        <span className="font-semibold text-sm">{base}</span>
                        <span className="text-xs text-[#686D76] dark:text-[#7E828A]">/USDT</span>
                      </div>
                      <div className="col-span-4 min-w-0">
                        <p className="font-mono-num text-sm font-semibold">
                          {unavailable ? 'Feed Offline' : formatCryptoPrice(mp.price)}
                        </p>
                        <p className="font-mono-num text-[11px] text-[#686D76] dark:text-[#7E828A] whitespace-nowrap truncate">
                          24H {unavailable ? '—' : mp.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="col-span-3 flex justify-end">
                        <ChangeBadge changePct={mp.change24hPct} unavailable={unavailable} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Right Column: Holdings + Activity + Notifications */}
          <div className="lg:col-span-5 space-y-5">
            {/* Asset Holdings */}
            <section className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Asset Holdings</h2>
                <Link
                  to="/portfolio"
                  className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA] inline-flex items-center gap-0.5"
                >
                  <span>Details</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              {summary.holdings.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">No asset balances yet.</p>
              ) : (
                <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {summary.holdings.slice(0, 4).map((h) => (
                    <div key={h.symbol} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <CoinAvatar symbol={h.symbol} color={h.badgeColor} size="sm" />
                        <div>
                          <p className="text-xs font-semibold">{h.symbol}</p>
                          <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] font-mono-num">
                            Resv: {hideBalances ? '••' : formatQty(h.reserved)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right font-mono-num">
                        <p className="text-xs font-semibold">
                          {hideBalances ? '••••' : formatQty(h.available)}
                        </p>
                        <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                          {hideBalances ? '••••' : `${formatUsdt(h.valueUsdt)} USDT`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Recent Ledger Activity */}
            <section className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Recent Ledger Activity</h2>
                <Link to="/transactions" className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA]">
                  View ledger
                </Link>
              </div>
              {currentUserTransactions.length === 0 && currentUserTrades.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  No transactions or settled trades recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {currentUserTransactions.slice(0, 4).map((tx) => (
                    <div key={tx.id} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{tx.summary}</p>
                        <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                          {new Date(tx.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold uppercase text-[#686D76] dark:text-[#9CA0A8] shrink-0">
                        {exchangeService.getLedgerTypeLabel(tx.type)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Recent Notifications */}
            <section className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#004AE2]" aria-hidden="true" />
                  <span>Notifications</span>
                </h2>
                <Link to="/notifications" className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA]">
                  Inbox
                </Link>
              </div>
              {currentUserNotifications.length === 0 ? (
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">No notifications yet.</p>
              ) : (
                <div className="space-y-2">
                  {currentUserNotifications.slice(0, 2).map((n) => (
                    <Link
                      key={n.id}
                      to="/notifications"
                      className="block p-3 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold truncate">{n.title}</p>
                        <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                          {n.isRead ? 'Read' : 'Unread'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A] line-clamp-2">
                        {n.message}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};

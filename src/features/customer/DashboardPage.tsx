import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  ChevronRight,
  Eye,
  EyeOff,
  Star,
  Wallet,
} from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { MiniSparkline } from '../../components/overview/MiniSparkline';
import { PortfolioEquityChart } from '../../components/overview/PortfolioEquityChart';
import {
  AccountStatusLabel,
  CoinAvatar,
  KycStatusLabel,
  MarketFeedLabel,
  SearchInput,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import {
  buildPortfolioOverviewModel,
  buildRecentActivityRows,
  formatMarketPriceDisplay,
  formatQuantityDisplay,
  resolveMarketOverviewRows,
  timeframeSummaryText,
  type ActivityFilter,
  type MarketOverviewFilter,
  type OverviewDataMode,
  type PortfolioChartTimeframe,
} from '../../utils/overviewModel';
import { formatUsdt } from '../../utils/tradingMath';

const PORTFOLIO_TIMEFRAMES: PortfolioChartTimeframe[] = ['24H', '7D', '30D', '90D', 'ALL'];

const ACTIVITY_TABS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'deposit', label: 'Deposits' },
  { key: 'withdrawal', label: 'Withdrawals' },
  { key: 'trade', label: 'Trades' },
];

export const DashboardPage: React.FC = () => {
  const {
    currentProfile,
    currentUserBalances,
    currentUserDeposits,
    currentUserWithdrawals,
    currentUserTrades,
    currentUserTransactions,
    marketPrices,
    marketSettings,
    marketFeedIsCached,
    tradingPairs,
    assets,
    watchlist,
    toggleWatchlist,
    hideBalances,
    toggleHideBalances,
  } = useAppState();

  const [timeframe, setTimeframe] = useState<PortfolioChartTimeframe>('7D');
  const [preferredDataMode, setPreferredDataMode] = useState<OverviewDataMode | undefined>(undefined);
  const [marketFilter, setMarketFilter] = useState<MarketOverviewFilter>('popular');
  const [marketSearch, setMarketSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');

  const portfolio = useMemo(
    () =>
      buildPortfolioOverviewModel({
        userBalances: currentUserBalances,
        marketPrices,
        assets,
        preferredMode: currentProfile ? preferredDataMode : 'sandbox',
        timeframe,
      }),
    [currentUserBalances, marketPrices, assets, currentProfile, preferredDataMode, timeframe]
  );

  const marketRows = useMemo(
    () =>
      resolveMarketOverviewRows({
        marketPrices,
        assets,
        tradingPairs,
        watchlistSymbols: watchlist,
        filterTab: marketFilter,
        searchQuery: marketSearch,
        feedIsCached: marketFeedIsCached,
      }),
    [marketPrices, assets, tradingPairs, watchlist, marketFilter, marketSearch, marketFeedIsCached]
  );

  const usingReferenceFeed = useMemo(
    () => marketRows.some((r) => r.isReferenceQuote),
    [marketRows]
  );

  const activity = useMemo(
    () =>
      buildRecentActivityRows({
        deposits: currentUserDeposits,
        withdrawals: currentUserWithdrawals,
        trades: currentUserTrades,
        ledgerTransactions: currentUserTransactions,
        filter: activityFilter,
        useSandboxSampleWhenEmpty: portfolio.dataMode === 'sandbox',
      }),
    [
      currentUserDeposits,
      currentUserWithdrawals,
      currentUserTrades,
      currentUserTransactions,
      activityFilter,
      portfolio.dataMode,
    ]
  );

  const topAllocations = portfolio.allocations.slice(0, 5);
  const isPositivePerf = portfolio.periodDeltaUsdt >= 0;

  return (
    <CustomerLayout
      title="Overview"
      subtitle={
        currentProfile
          ? `Account ${currentProfile.publicUserId} · ${portfolio.usingSimulatedBalances ? 'Sandbox Simulated Holdings' : 'Live Account Ledger'}`
          : 'Sandbox Exchange Overview · Simulated portfolio and reference activity'
      }
      actions={
        currentProfile ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#686D76] dark:text-[#7E828A]">
            <span>
              KYC: <KycStatusLabel status={currentProfile.kycStatus} />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Status: <AccountStatusLabel status={currentProfile.accountStatus} />
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="px-3.5 py-1.5 rounded-lg bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0] whitespace-nowrap shrink-0"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="px-3.5 py-1.5 rounded-lg bg-[#E8EAEE] dark:bg-[#1C1E24] text-xs font-medium hover:opacity-90 whitespace-nowrap shrink-0"
            >
              Create Account
            </Link>
          </div>
        )
      }
    >
      <div className="space-y-6">
        {/* Sandbox / Environment Transparency Banner */}
        <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#4B5059] dark:text-[#9CA0A8]">
            <span className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
              {portfolio.usingSimulatedBalances ? 'Sandbox Simulation Active' : 'Live Ledger View'}
            </span>
            {' · '}
            <span>
              {portfolio.usingSimulatedBalances
                ? 'Displayed portfolio balances and sample records simulate exchange activity with virtual test funds and do not represent real-money assets or mainnet transactions.'
                : 'Showing your account ledger balances (0.00 starting funds until custody deposits settle).'}
            </span>
          </div>

          {currentProfile && (
            <div
              role="group"
              aria-label="Portfolio data source"
              className="inline-flex items-center p-0.5 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] shrink-0"
            >
              <button
                type="button"
                onClick={() => setPreferredDataMode('sandbox')}
                aria-pressed={portfolio.dataMode === 'sandbox'}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  portfolio.dataMode === 'sandbox'
                    ? 'bg-[#004AE2] text-white'
                    : 'text-[#686D76] dark:text-[#9CA0A8]'
                }`}
              >
                Sandbox Preview
              </button>
              <button
                type="button"
                onClick={() => setPreferredDataMode('live')}
                aria-pressed={portfolio.dataMode === 'live'}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  portfolio.dataMode === 'live'
                    ? 'bg-[#004AE2] text-white'
                    : 'text-[#686D76] dark:text-[#9CA0A8]'
                }`}
              >
                Account Ledger
              </button>
            </div>
          )}
        </div>

        {/* KYC Notice when logged in and unverified */}
        {currentProfile && currentProfile.kycStatus !== 'approved' && (
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#D97706]/40 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs sm:text-sm font-semibold">
                Identity Verification ({currentProfile.kycStatus.replace('_', ' ')})
              </p>
              <p className="mt-0.5 text-xs text-[#686D76] dark:text-[#7E828A]">
                Explore markets and sandbox analytics anytime. Live custody deposits, spot execution, and withdrawals require approved KYC.
              </p>
            </div>
            <Link
              to="/kyc"
              className="px-3.5 py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0] whitespace-nowrap shrink-0"
            >
              {currentProfile.kycStatus === 'rejected' ? 'Resubmit KYC' : 'Complete KYC'}
            </Link>
          </div>
        )}

        {/* Section 1: Portfolio Overview + Quick Actions & Allocation */}
        <section aria-label="Portfolio overview" className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left 8 cols: KPI Strip + Equity Chart */}
          <div className="lg:col-span-8 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-col justify-between gap-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-[#686D76] dark:text-[#7E828A]">
                    Total Portfolio Value
                  </span>
                  <button
                    type="button"
                    onClick={toggleHideBalances}
                    aria-label={hideBalances ? 'Show portfolio balances' : 'Hide portfolio balances'}
                    className="p-1 rounded-md text-[#686D76] dark:text-[#7E828A] hover:text-[#111214] dark:hover:text-white hover:bg-[#F4F5F7] dark:hover:bg-[#1E2026]"
                  >
                    {hideBalances ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
                  <p className="text-3xl sm:text-4xl font-bold font-mono-num tracking-tight">
                    {hideBalances ? '•••••• USDT' : `${formatUsdt(portfolio.totalValueUsdt)} USDT`}
                  </p>
                  <span
                    className={`font-mono-num text-xs sm:text-sm font-semibold ${
                      portfolio.totalValueUsdt === 0
                        ? 'text-[#686D76] dark:text-[#7E828A]'
                        : isPositivePerf
                          ? 'text-[#10C478]'
                          : 'text-[#F0525E]'
                    }`}
                  >
                    {hideBalances
                      ? '••••'
                      : `${isPositivePerf && portfolio.periodDeltaUsdt > 0 ? '+' : ''}${formatUsdt(
                          portfolio.periodDeltaUsdt
                        )} USDT (${isPositivePerf && portfolio.periodDeltaPct > 0 ? '+' : ''}${portfolio.periodDeltaPct.toFixed(
                          2
                        )}%)`}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                  {timeframeSummaryText(timeframe)} ·{' '}
                  {portfolio.usingSimulatedBalances ? 'Simulated valuation' : 'Verified ledger valuation'}
                </p>
              </div>

              {/* Timeframe Switcher */}
              <div
                role="group"
                aria-label="Portfolio performance timeframe"
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] self-start"
              >
                {PORTFOLIO_TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    aria-pressed={timeframe === tf}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      timeframe === tf
                        ? 'bg-[#004AE2] text-white'
                        : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Available vs Locked Sub-KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-y border-[#E2E4E9] dark:border-[#1E2026] py-3.5">
              <div>
                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Available Balance</p>
                <p className="mt-0.5 text-base sm:text-lg font-semibold font-mono-num">
                  {hideBalances ? '••••••' : `${formatUsdt(portfolio.availableBalanceUsdt)} USDT`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Locked / Reserved</p>
                <p className="mt-0.5 text-base sm:text-lg font-semibold font-mono-num">
                  {hideBalances ? '••••••' : `${formatUsdt(portfolio.lockedBalanceUsdt)} USDT`}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Tracked Assets</p>
                <p className="mt-0.5 text-base sm:text-lg font-semibold font-mono-num">
                  {portfolio.allocations.filter((a) => a.totalQty > 0).length}
                </p>
              </div>
            </div>

            {/* Portfolio Chart */}
            <div>
              <PortfolioEquityChart
                points={portfolio.chartPoints}
                hideBalances={hideBalances}
                isPositiveTrend={isPositivePerf}
              />
            </div>
          </div>

          {/* Right 4 cols: Quick Actions + Asset Allocation */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            {/* Quick Actions */}
            <section
              aria-label="Quick actions"
              className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Quick Actions</h2>
                <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                  Sandbox Ready
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <Link
                  to="/deposit"
                  className="group rounded-xl bg-[#004AE2] text-white p-3.5 hover:bg-[#003ec0] transition-colors flex flex-col justify-between gap-2"
                >
                  <div className="flex items-center justify-between">
                    <ArrowDownToLine className="w-4 h-4" aria-hidden="true" />
                    <ArrowUpRight className="w-3.5 h-3.5 opacity-75 group-hover:opacity-100" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Deposit</p>
                    <p className="text-[11px] text-blue-100/90">Fund & networks</p>
                  </div>
                </Link>

                <Link
                  to="/withdraw"
                  className="group rounded-xl bg-[#F4F5F7] dark:bg-[#1B1D22] border border-[#E2E4E9] dark:border-[#262830] p-3.5 hover:border-[#004AE2]/60 transition-colors flex flex-col justify-between gap-2"
                >
                  <div className="flex items-center justify-between">
                    <ArrowUpFromLine className="w-4 h-4 text-[#004AE2] dark:text-[#60A5FA]" aria-hidden="true" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#686D76]" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Withdraw</p>
                    <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Transfer out</p>
                  </div>
                </Link>

                <Link
                  to="/trade"
                  className="group rounded-xl bg-[#F4F5F7] dark:bg-[#1B1D22] border border-[#E2E4E9] dark:border-[#262830] p-3.5 hover:border-[#004AE2]/60 transition-colors flex flex-col justify-between gap-2"
                >
                  <div className="flex items-center justify-between">
                    <ArrowLeftRight className="w-4 h-4 text-[#10C478]" aria-hidden="true" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#686D76]" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Trade</p>
                    <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Spot market</p>
                  </div>
                </Link>

                <Link
                  to="/wallets"
                  className="group rounded-xl bg-[#F4F5F7] dark:bg-[#1B1D22] border border-[#E2E4E9] dark:border-[#262830] p-3.5 hover:border-[#004AE2]/60 transition-colors flex flex-col justify-between gap-2"
                >
                  <div className="flex items-center justify-between">
                    <Wallet className="w-4 h-4 text-[#686D76] dark:text-[#9CA0A8]" aria-hidden="true" />
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#686D76]" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">View Wallets</p>
                    <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Custody balances</p>
                  </div>
                </Link>
              </div>
            </section>

            {/* Asset Allocation */}
            <section
              aria-label="Asset allocation"
              className="flex-1 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-col justify-between gap-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Asset Allocation</h2>
                <Link
                  to="/wallets"
                  className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA] inline-flex items-center gap-0.5 hover:underline"
                >
                  <span>All wallets</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>

              {portfolio.totalValueUsdt > 0 ? (
                <>
                  <div
                    aria-label="Asset proportion bar"
                    className="h-2.5 w-full rounded-full overflow-hidden flex bg-[#E8EAEE] dark:bg-[#242528]"
                  >
                    {topAllocations.map((item) => (
                      <div
                        key={item.symbol}
                        style={{
                          width: `${Math.max(item.allocationPct, 1)}%`,
                          backgroundColor: item.badgeColor,
                        }}
                        title={`${item.symbol} ${item.allocationPct.toFixed(1)}%`}
                      />
                    ))}
                  </div>

                  <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                    {topAllocations.map((item) => (
                      <div
                        key={item.symbol}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CoinAvatar symbol={item.symbol} color={item.badgeColor} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{item.symbol}</p>
                            <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A] truncate">
                              {hideBalances ? '••••' : formatQuantityDisplay(item.totalQty)} {item.symbol}
                            </p>
                          </div>
                        </div>

                        <div className="text-right font-mono-num shrink-0">
                          <p className="text-xs font-semibold">
                            {hideBalances ? '••••' : `${formatUsdt(item.valueUsdt)} USDT`}
                          </p>
                          <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                            {item.allocationPct.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-6 text-xs text-[#686D76] dark:text-[#7E828A]">
                  Live account balances are currently 0.00 USDT. Switch to Sandbox Preview above or initiate a verified deposit when enabled.
                </div>
              )}
            </section>
          </div>
        </section>

        {/* Section 2: Market Overview */}
        <section
          aria-label="Market overview"
          className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[#E2E4E9] dark:border-[#22242A] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="text-base font-semibold">Market Overview</h2>
              <div
                role="tablist"
                aria-label="Market view filter"
                className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]"
              >
                {(
                  [
                    { key: 'popular', label: 'Popular' },
                    { key: 'watchlist', label: `Watchlist (${watchlist.length})` },
                    { key: 'gainers', label: 'Top Movers' },
                    { key: 'all', label: 'All' },
                  ] as Array<{ key: MarketOverviewFilter; label: string }>
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={marketFilter === tab.key}
                    onClick={() => setMarketFilter(tab.key)}
                    className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      marketFilter === tab.key
                        ? 'bg-[#004AE2] text-white'
                        : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3">
              <div className="flex items-center gap-2 text-xs">
                <MarketFeedLabel status={marketSettings.providerStatus} />
                {usingReferenceFeed && (
                  <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                    · Sandbox Reference Quotes
                  </span>
                )}
              </div>
              <SearchInput
                value={marketSearch}
                onChange={setMarketSearch}
                placeholder="Filter markets..."
                ariaLabel="Filter overview markets"
                className="w-full sm:w-56"
              />
            </div>
          </div>

          {marketRows.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-[#686D76] dark:text-[#7E828A]">
              {marketFilter === 'watchlist'
                ? 'Your watchlist is empty. Select the star next to any pair to pin it here.'
                : 'No markets match your current filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#F4F5F7] dark:bg-[#191B20] text-left text-[11px] uppercase tracking-wider text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                    <th className="py-2.5 pl-2.5 sm:pl-4 pr-0.5 sm:pr-2 w-8 sm:w-9 font-medium">
                      <span className="sr-only">Watchlist</span>
                    </th>
                    <th className="py-2.5 px-1.5 sm:px-3 font-medium">Pair</th>
                    <th className="py-2.5 px-1.5 sm:px-3 font-medium text-right">Last Price</th>
                    <th className="py-2.5 px-1.5 sm:px-3 font-medium text-right">24h</th>
                    <th className="py-2.5 px-3 font-medium text-right hidden md:table-cell">
                      24h Volume
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right hidden sm:table-cell">
                      Trend
                    </th>
                    <th className="py-2.5 pl-1.5 sm:pl-3 pr-3 sm:pr-5 font-medium text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                  {marketRows.map((row) => {
                    const isPositive = row.change24hPct >= 0;
                    return (
                      <tr
                        key={row.symbol}
                        className="hover:bg-[#F4F5F7]/70 dark:hover:bg-[#1A1C21] transition-colors"
                      >
                        <td className="py-3 pl-2.5 sm:pl-4 pr-0.5 sm:pr-2">
                          <button
                            type="button"
                            onClick={() => toggleWatchlist(row.symbol)}
                            aria-label={
                              row.isWatchlisted
                                ? `Remove ${row.symbol} from watchlist`
                                : `Add ${row.symbol} to watchlist`
                            }
                            aria-pressed={row.isWatchlisted}
                            className="p-1 sm:p-1.5 rounded-md hover:bg-[#E8EAEE] dark:hover:bg-[#24262E] text-[#686D76] dark:text-[#7E828A]"
                          >
                            <Star
                              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                                row.isWatchlisted
                                  ? 'fill-[#F59E0B] text-[#F59E0B]'
                                  : 'text-[#686D76] dark:text-[#6E7178]'
                              }`}
                            />
                          </button>
                        </td>

                        <td className="py-3 px-1.5 sm:px-3">
                          <Link
                            to={`/markets/${encodeURIComponent(row.symbol)}`}
                            className="flex items-center gap-2 sm:gap-2.5 min-w-0 group"
                          >
                            <CoinAvatar symbol={row.baseAsset} color={row.badgeColor} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold text-xs sm:text-sm text-[#111214] dark:text-white group-hover:text-[#004AE2] dark:group-hover:text-[#60A5FA] whitespace-nowrap">
                                {row.baseAsset}
                                <span className="text-[11px] sm:text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                                  /{row.quoteAsset}
                                </span>
                              </p>
                              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate hidden sm:block">
                                {row.name}
                                {row.isReferenceQuote ? ' · Ref' : ''}
                              </p>
                            </div>
                          </Link>
                        </td>

                        <td className="py-3 px-1.5 sm:px-3 text-right font-mono-num font-semibold whitespace-nowrap">
                          {row.price > 0 ? formatMarketPriceDisplay(row.price) : 'Offline'}
                        </td>

                        <td
                          className={`py-3 px-1.5 sm:px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                            isPositive ? 'text-[#10C478]' : 'text-[#F0525E]'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          {row.change24hPct.toFixed(2)}%
                        </td>

                        <td className="py-3 px-3 text-right font-mono-num text-xs text-[#686D76] dark:text-[#9CA0A8] hidden md:table-cell whitespace-nowrap">
                          {row.volume24h > 0
                            ? row.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })
                            : '—'}
                        </td>

                        <td className="py-3 px-3 hidden sm:table-cell">
                          <div className="flex justify-end">
                            <MiniSparkline values={row.sparkline} positive={isPositive} />
                          </div>
                        </td>

                        <td className="py-3 pl-1.5 sm:pl-3 pr-3 sm:pr-5 text-right whitespace-nowrap">
                          <Link
                            to={`/trade?pair=${encodeURIComponent(row.symbol)}`}
                            className="inline-flex items-center px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#F4F5F7] dark:bg-[#22242A] hover:bg-[#004AE2] hover:text-white text-xs font-semibold transition-colors"
                          >
                            Trade
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section 3: Recent Activity */}
        <section
          aria-label="Recent activity"
          className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[#E2E4E9] dark:border-[#22242A] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">Recent Activity</h2>
              {activity.isSandboxSample && (
                <span className="text-[11px] font-medium text-[#686D76] dark:text-[#9CA0A8] border border-[#D4D7DF] dark:border-[#2A2C34] rounded px-2 py-0.5">
                  Sandbox Sample Activity
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
              <div
                role="group"
                aria-label="Activity filter"
                className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]"
              >
                {ACTIVITY_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActivityFilter(tab.key)}
                    aria-pressed={activityFilter === tab.key}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      activityFilter === tab.key
                        ? 'bg-[#004AE2] text-white'
                        : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <Link
                to="/transactions"
                className="text-xs font-medium text-[#004AE2] dark:text-[#60A5FA] hover:underline whitespace-nowrap"
              >
                Full ledger
              </Link>
            </div>
          </div>

          {activity.rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-[#686D76] dark:text-[#7E828A]">
              No matching activity recorded for your account yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-[#F4F5F7] dark:bg-[#191B20] text-left text-[11px] uppercase tracking-wider text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                    <th className="py-2.5 pl-4 sm:pl-5 pr-2 sm:pr-3 font-medium">Type</th>
                    <th className="py-2.5 px-2 sm:px-3 font-medium hidden sm:table-cell">Details</th>
                    <th className="py-2.5 px-3 font-medium hidden md:table-cell">Timestamp</th>
                    <th className="py-2.5 pl-2 pr-4 sm:px-3 font-medium text-right">
                      <span className="sm:hidden">Amount / Status</span>
                      <span className="hidden sm:inline">Amount</span>
                    </th>
                    <th className="py-2.5 px-3 font-medium hidden sm:table-cell">
                      Status
                    </th>
                    <th className="py-2.5 pl-3 pr-5 font-medium text-right hidden lg:table-cell">
                      Reference
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                  {activity.rows.map((row) => {
                    const statusColor =
                      row.statusTone === 'positive'
                        ? 'text-[#10C478]'
                        : row.statusTone === 'pending'
                          ? 'text-[#D97706]'
                          : row.statusTone === 'negative'
                            ? 'text-[#F0525E]'
                            : 'text-[#686D76] dark:text-[#9CA0A8]';
                    const amountColor = row.amountDisplay.startsWith('+')
                      ? 'text-[#10C478]'
                      : row.amountDisplay.startsWith('-')
                        ? 'text-[#111214] dark:text-[#F4F5F7]'
                        : 'text-[#686D76] dark:text-[#9CA0A8]';

                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-[#F4F5F7]/70 dark:hover:bg-[#1A1C21] transition-colors"
                      >
                        <td className="py-3 pl-4 sm:pl-5 pr-2 sm:pr-3">
                          <p className="font-semibold whitespace-nowrap">{row.typeLabel}</p>
                          <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] sm:hidden truncate max-w-[165px]">
                            {row.description}
                          </p>
                        </td>
                        <td className="py-3 px-2 sm:px-3 text-xs text-[#4B5059] dark:text-[#C5C8D0] hidden sm:table-cell min-w-[200px]">
                          {row.description}
                        </td>
                        <td className="py-3 px-3 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap hidden md:table-cell">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 pl-2 pr-4 sm:px-3 text-right whitespace-nowrap">
                          <p className={`font-mono-num font-semibold ${amountColor}`}>
                            {hideBalances ? '••••' : row.amountDisplay}
                          </p>
                          <p className={`text-[11px] font-semibold sm:hidden ${statusColor}`}>
                            {row.status}
                          </p>
                        </td>
                        <td
                          className={`py-3 px-3 text-xs font-semibold whitespace-nowrap hidden sm:table-cell ${statusColor}`}
                        >
                          {row.status}
                        </td>
                        <td className="py-3 pl-3 pr-5 text-right font-mono-num text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap hidden lg:table-cell">
                          {row.referenceId}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </CustomerLayout>
  );
};

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  RefreshCw,
  Star,
} from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { MiniSparkline } from '../../components/overview/MiniSparkline';
import {
  CoinAvatar,
  EmptyState,
  MarketFeedLabel,
  SearchInput,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import {
  buildMarketDiscoveryHighlights,
  formatCompactVolume,
  quoteSourceLabelText,
  resolveMarketsCatalogRows,
  type MarketCategoryFilter,
  type MarketSortField,
  type SortDirection,
} from '../../utils/marketsModel';
import { formatMarketPriceDisplay } from '../../utils/overviewModel';

const CATEGORY_TABS: Array<{ key: MarketCategoryFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'popular', label: 'Popular' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'gainers', label: 'Top Gainers' },
  { key: 'losers', label: 'Top Losers' },
];

type SortSelectOption =
  | 'default:desc'
  | 'price:desc'
  | 'price:asc'
  | 'change24h:desc'
  | 'change24h:asc'
  | 'volume24h:desc'
  | 'volume24h:asc';

export const MarketsPage: React.FC = () => {
  const {
    marketPrices,
    tradingPairs,
    assets,
    marketSettings,
    marketLoading,
    marketFeedIsCached,
    marketFeedError,
    refreshMarketTickers,
    watchlist,
    toggleWatchlist,
  } = useAppState();

  const [categoryFilter, setCategoryFilter] = useState<MarketCategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<MarketSortField>('default');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const catalogBaseRows = useMemo(
    () =>
      resolveMarketsCatalogRows({
        marketPrices,
        assets,
        tradingPairs,
        watchlistSymbols: watchlist,
        categoryFilter: 'all',
        feedIsCached: marketFeedIsCached,
      }),
    [marketPrices, assets, tradingPairs, watchlist, marketFeedIsCached]
  );

  const highlights = useMemo(
    () => buildMarketDiscoveryHighlights(catalogBaseRows),
    [catalogBaseRows]
  );

  const filteredRows = useMemo(
    () =>
      resolveMarketsCatalogRows({
        marketPrices,
        assets,
        tradingPairs,
        watchlistSymbols: watchlist,
        categoryFilter,
        searchQuery: search,
        sortField,
        sortDirection,
        feedIsCached: marketFeedIsCached,
      }),
    [
      marketPrices,
      assets,
      tradingPairs,
      watchlist,
      categoryFilter,
      search,
      sortField,
      sortDirection,
      marketFeedIsCached,
    ]
  );

  const usingReferenceFeed = highlights.referenceCount > 0;
  const usingOnlyLiveOrCached = highlights.liveCount > 0 || highlights.cachedCount > 0;
  const isInitialLoading = marketLoading && !usingOnlyLiveOrCached;

  const handleHeaderSort = (field: Exclude<MarketSortField, 'default'>) => {
    if (sortField === field) {
      if (sortDirection === 'desc') {
        setSortDirection('asc');
      } else {
        setSortField('default');
        setSortDirection('desc');
      }
      return;
    }
    setSortField(field);
    setSortDirection('desc');
  };

  const handleSelectSort = (rawValue: string) => {
    const [field, dir] = rawValue.split(':') as [MarketSortField, SortDirection];
    setSortField(field);
    setSortDirection(dir);
  };

  const currentSortOption: SortSelectOption = `${sortField}:${sortDirection}` as SortSelectOption;

  const resetFilters = () => {
    setCategoryFilter('all');
    setSearch('');
    setSortField('default');
    setSortDirection('desc');
  };

  const renderSortIcon = (field: Exclude<MarketSortField, 'default'>) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-55" aria-hidden="true" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#004AE2] dark:text-[#60A5FA]" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#004AE2] dark:text-[#60A5FA]" aria-hidden="true" />
    );
  };

  return (
    <CustomerLayout
      title="Markets"
      subtitle="Live spot pairs, market movers, and persistent watchlist discovery"
      actions={
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs">
            <MarketFeedLabel status={marketSettings.providerStatus} />
            {marketFeedIsCached && marketSettings.providerStatus === 'live' && (
              <span className="hidden sm:inline text-[11px] text-[#686D76] dark:text-[#7E828A]">
                · Cached Snapshot
              </span>
            )}
            {usingReferenceFeed && (
              <span className="hidden sm:inline text-[11px] text-[#D97706]">
                · Sandbox Reference Quotes
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void refreshMarketTickers()}
            aria-label="Refresh market feed"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E8EAEE] dark:bg-[#1B1D22] text-xs font-medium text-[#111214] dark:text-[#F4F5F7] hover:opacity-90 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${marketLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Market Data Source / Offline Notice */}
        {(marketSettings.providerStatus === 'unavailable' || marketFeedError || usingReferenceFeed) && (
          <div
            role="status"
            className="rounded-xl bg-white dark:bg-[#141518] border border-[#D97706]/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="text-[#4B5059] dark:text-[#9CA0A8]">
              <span className="font-semibold text-[#D97706]">
                {usingOnlyLiveOrCached
                  ? 'Market Feed Cached'
                  : 'Market Feed Offline · Sandbox Reference Quotes'}
              </span>
              {' · '}
              <span>
                {marketFeedError
                  ? `${marketFeedError} Displaying sandbox reference quotes cleanly marked Ref; real spot execution remains gated.`
                  : 'Showing reference quotes where live venue ticks are unavailable.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void refreshMarketTickers()}
              className="px-3 py-1.5 rounded-lg bg-[#004AE2] text-white text-[11px] font-semibold whitespace-nowrap shrink-0 hover:bg-[#003ec0]"
            >
              Retry Feed
            </button>
          </div>
        )}

        {/* Discovery Highlights Strip */}
        <section
          aria-label="Market highlights"
          className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3.5"
        >
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-3 sm:p-4 space-y-1 sm:space-y-1.5">
            <p className="text-[11px] sm:text-xs text-[#686D76] dark:text-[#7E828A]">Spot Market Coverage</p>
            <p className="text-base sm:text-lg font-bold font-mono-num">{highlights.totalPairs} Spot Pairs</p>
            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
              {highlights.liveCount > 0
                ? `${highlights.liveCount} live stream`
                : highlights.cachedCount > 0
                  ? `${highlights.cachedCount} cached feed`
                  : `${highlights.referenceCount} sandbox reference`}
              {' · '}
              {watchlist.length} watchlisted
            </p>
          </div>

          {highlights.topGainer && (
            <Link
              to={`/markets/${encodeURIComponent(highlights.topGainer.symbol)}`}
              className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-3 sm:p-4 space-y-1 sm:space-y-1.5 hover:border-[#004AE2]/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[11px] sm:text-xs text-[#686D76] dark:text-[#7E828A] truncate">Top 24h Gainer</p>
                <span className="font-mono-num text-[11px] sm:text-xs font-semibold text-[#10C478] shrink-0">
                  {highlights.topGainer.change24hPct >= 0 ? '+' : ''}
                  {highlights.topGainer.change24hPct.toFixed(2)}%
                </span>
              </div>
              <p className="text-sm sm:text-base font-bold">
                {highlights.topGainer.baseAsset}
                <span className="text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                  /{highlights.topGainer.quoteAsset}
                </span>
              </p>
              <p className="text-[11px] sm:text-xs font-mono-num text-[#4B5059] dark:text-[#9CA0A8] truncate">
                {formatMarketPriceDisplay(highlights.topGainer.price)} USDT
                {highlights.topGainer.isReferenceQuote ? ' · Ref' : ''}
              </p>
            </Link>
          )}

          {highlights.topLoser && (
            <Link
              to={`/markets/${encodeURIComponent(highlights.topLoser.symbol)}`}
              className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-3 sm:p-4 space-y-1 sm:space-y-1.5 hover:border-[#004AE2]/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[11px] sm:text-xs text-[#686D76] dark:text-[#7E828A] truncate">
                  {highlights.topLoser.change24hPct < 0 ? 'Top 24h Loser' : 'Lowest 24h Move'}
                </p>
                <span
                  className={`font-mono-num text-[11px] sm:text-xs font-semibold shrink-0 ${
                    highlights.topLoser.change24hPct >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'
                  }`}
                >
                  {highlights.topLoser.change24hPct >= 0 ? '+' : ''}
                  {highlights.topLoser.change24hPct.toFixed(2)}%
                </span>
              </div>
              <p className="text-sm sm:text-base font-bold">
                {highlights.topLoser.baseAsset}
                <span className="text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                  /{highlights.topLoser.quoteAsset}
                </span>
              </p>
              <p className="text-[11px] sm:text-xs font-mono-num text-[#4B5059] dark:text-[#9CA0A8] truncate">
                {formatMarketPriceDisplay(highlights.topLoser.price)} USDT
                {highlights.topLoser.isReferenceQuote ? ' · Ref' : ''}
              </p>
            </Link>
          )}

          {highlights.highestVolume && (
            <Link
              to={`/markets/${encodeURIComponent(highlights.highestVolume.symbol)}`}
              className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-3 sm:p-4 space-y-1 sm:space-y-1.5 hover:border-[#004AE2]/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[11px] sm:text-xs text-[#686D76] dark:text-[#7E828A] truncate">24h Vol Leader</p>
                <span className="font-mono-num text-[10px] sm:text-[11px] text-[#686D76] dark:text-[#9CA0A8] shrink-0">
                  USDT Vol
                </span>
              </div>
              <p className="text-sm sm:text-base font-bold">
                {highlights.highestVolume.baseAsset}
                <span className="text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                  /{highlights.highestVolume.quoteAsset}
                </span>
              </p>
              <p className="text-[11px] sm:text-xs font-mono-num text-[#4B5059] dark:text-[#9CA0A8] truncate">
                ${formatCompactVolume(highlights.highestVolume.quoteVolume24h)} ·{' '}
                {formatCompactVolume(highlights.highestVolume.volume24h)} {highlights.highestVolume.baseAsset}
              </p>
            </Link>
          )}
        </section>

        {/* Main Markets Container */}
        <section
          aria-label="Spot markets directory"
          className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden"
        >
          {/* Unified Filter, Search & Sort Toolbar */}
          <div className="px-4 sm:px-5 py-4 border-b border-[#E2E4E9] dark:border-[#22242A] space-y-3">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Market categories"
                className="flex flex-wrap sm:inline-flex items-center gap-1 p-1 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]"
              >
                {CATEGORY_TABS.map((tab) => {
                  const active = categoryFilter === tab.key;
                  const label =
                    tab.key === 'watchlist' ? `Watchlist (${watchlist.length})` : tab.label;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setCategoryFilter(tab.key)}
                      className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                        active
                          ? 'bg-[#004AE2] text-white'
                          : 'text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search asset name or symbol (e.g. BTC, Solana)..."
                  ariaLabel="Search markets by name or symbol"
                  className="w-full sm:w-72"
                />
                <div className="flex items-center gap-2">
                  <label htmlFor="markets-sort-select" className="sr-only">
                    Sort markets
                  </label>
                  <select
                    id="markets-sort-select"
                    value={currentSortOption}
                    onChange={(e) => handleSelectSort(e.target.value)}
                    aria-label="Sort markets"
                    className="w-full sm:w-auto px-3 py-2 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#24262E] text-xs font-medium text-[#111214] dark:text-[#F4F5F7] focus:outline-none focus:border-[#004AE2] min-h-[38px]"
                  >
                    <option value="default:desc">Sort: Featured</option>
                    <option value="price:desc">Price: High to Low</option>
                    <option value="price:asc">Price: Low to High</option>
                    <option value="change24h:desc">24h Change: Highest</option>
                    <option value="change24h:asc">24h Change: Lowest</option>
                    <option value="volume24h:desc">24h Volume: Highest</option>
                    <option value="volume24h:asc">24h Volume: Lowest</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#686D76] dark:text-[#7E828A]">
              <span>
                Showing <strong className="text-[#111214] dark:text-[#F4F5F7]">{filteredRows.length}</strong>{' '}
                of {highlights.totalPairs} supported spot markets
              </span>
              <span>
                Source:{' '}
                <strong className="text-[#111214] dark:text-[#F4F5F7]">
                  {usingOnlyLiveOrCached
                    ? marketFeedIsCached
                      ? 'Cached Exchange Feed'
                      : 'Live Exchange Feed'
                    : 'Sandbox Reference Quotes'}
                </strong>
                {' · '}Synced {new Date(marketSettings.lastSyncedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>

          {/* Loading Skeleton */}
          {isInitialLoading ? (
            <div data-testid="markets-loading-skeleton" className="divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
              {[0, 1, 2, 3, 4].map((idx) => (
                <div key={idx} className="px-5 py-4 flex items-center justify-between gap-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#E8EAEE] dark:bg-[#22242A]" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-24 rounded bg-[#E8EAEE] dark:bg-[#22242A]" />
                      <div className="h-2.5 w-16 rounded bg-[#F4F5F7] dark:bg-[#1B1D22]" />
                    </div>
                  </div>
                  <div className="h-4 w-24 rounded bg-[#E8EAEE] dark:bg-[#22242A]" />
                  <div className="h-4 w-16 rounded bg-[#E8EAEE] dark:bg-[#22242A]" />
                </div>
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={
                  categoryFilter === 'watchlist' && !search.trim()
                    ? 'Your watchlist is empty'
                    : 'No markets match your filters'
                }
                description={
                  categoryFilter === 'watchlist' && !search.trim()
                    ? 'Select the star next to any asset to pin pairs across Markets and Overview.'
                    : 'Try clearing your search query or switching back to All supported markets.'
                }
                action={
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-4 py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                  >
                    Reset Filters
                  </button>
                }
              />
            </div>
          ) : (
            <>
              {/* Desktop Data Table (md+) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F4F5F7] dark:bg-[#191B20] text-left text-[11px] uppercase tracking-wider text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                      <th className="py-3 pl-5 pr-2 w-10 font-medium">
                        <span className="sr-only">Watchlist</span>
                      </th>
                      <th className="py-3 px-3 font-medium">Pair</th>
                      <th className="py-3 px-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('price')}
                          aria-label="Sort by Last Price"
                          className="inline-flex items-center justify-end gap-1 hover:text-[#111214] dark:hover:text-white transition-colors"
                        >
                          <span>Last Price</span>
                          {renderSortIcon('price')}
                        </button>
                      </th>
                      <th className="py-3 px-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('change24h')}
                          aria-label="Sort by 24h Change"
                          className="inline-flex items-center justify-end gap-1 hover:text-[#111214] dark:hover:text-white transition-colors"
                        >
                          <span>24h Change</span>
                          {renderSortIcon('change24h')}
                        </button>
                      </th>
                      <th className="py-3 px-3 font-medium text-right hidden lg:table-cell">
                        24h High / Low
                      </th>
                      <th className="py-3 px-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('volume24h')}
                          aria-label="Sort by 24h Volume"
                          className="inline-flex items-center justify-end gap-1 hover:text-[#111214] dark:hover:text-white transition-colors"
                        >
                          <span>24h Volume</span>
                          {renderSortIcon('volume24h')}
                        </button>
                      </th>
                      <th className="py-3 px-3 font-medium text-right">Trend</th>
                      <th className="py-3 pl-3 pr-5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                    {filteredRows.map((row) => {
                      const isPositive = row.change24hPct >= 0;
                      const isOffline = row.quoteSource === 'unavailable';
                      return (
                        <tr
                          key={row.symbol}
                          className="hover:bg-[#F4F5F7]/70 dark:hover:bg-[#1A1C21] transition-colors"
                        >
                          <td className="py-3.5 pl-5 pr-2">
                            <button
                              type="button"
                              onClick={() => toggleWatchlist(row.symbol)}
                              aria-label={
                                row.isWatchlisted
                                  ? `Remove ${row.symbol} from watchlist`
                                  : `Add ${row.symbol} to watchlist`
                              }
                              aria-pressed={row.isWatchlisted}
                              className="p-1.5 rounded-md hover:bg-[#E8EAEE] dark:hover:bg-[#24262E] text-[#686D76] dark:text-[#7E828A]"
                            >
                              <Star
                                className={`w-4 h-4 ${
                                  row.isWatchlisted
                                    ? 'fill-[#F59E0B] text-[#F59E0B]'
                                    : 'text-[#686D76] dark:text-[#6E7178]'
                                }`}
                              />
                            </button>
                          </td>

                          <td className="py-3.5 px-3">
                            <Link
                              to={`/markets/${encodeURIComponent(row.symbol)}`}
                              className="flex items-center gap-3 min-w-0 group"
                            >
                              <CoinAvatar symbol={row.baseAsset} color={row.badgeColor} size="sm" />
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-[#111214] dark:text-white group-hover:text-[#004AE2] dark:group-hover:text-[#60A5FA] whitespace-nowrap">
                                  {row.baseAsset}
                                  <span className="text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                                    /{row.quoteAsset}
                                  </span>
                                </p>
                                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                                  {row.name}
                                  {row.quoteSource !== 'live' && (
                                    <span> · {quoteSourceLabelText(row.quoteSource)}</span>
                                  )}
                                </p>
                              </div>
                            </Link>
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono-num whitespace-nowrap">
                            <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                              {isOffline ? 'Offline' : formatMarketPriceDisplay(row.price)}
                            </p>
                            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                              USDT
                            </p>
                          </td>

                          <td
                            className={`py-3.5 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                              isOffline
                                ? 'text-[#686D76] dark:text-[#7E828A]'
                                : isPositive
                                  ? 'text-[#10C478]'
                                  : 'text-[#F0525E]'
                            }`}
                          >
                            {isOffline ? '—' : `${isPositive ? '+' : ''}${row.change24hPct.toFixed(2)}%`}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono-num text-xs hidden lg:table-cell whitespace-nowrap">
                            {isOffline ? (
                              <span className="text-[#686D76] dark:text-[#7E828A]">—</span>
                            ) : (
                              <div className="space-y-0.5">
                                <p className="text-[#111214] dark:text-[#E5E7EB]">
                                  H {formatMarketPriceDisplay(row.high24h)}
                                </p>
                                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                                  L {formatMarketPriceDisplay(row.low24h)}
                                </p>
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-right font-mono-num text-xs whitespace-nowrap">
                            {isOffline ? (
                              <span className="text-[#686D76] dark:text-[#7E828A]">—</span>
                            ) : (
                              <div className="space-y-0.5">
                                <p className="font-medium text-[#111214] dark:text-[#E5E7EB]">
                                  ${formatCompactVolume(row.quoteVolume24h)}
                                </p>
                                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                                  {formatCompactVolume(row.volume24h)} {row.baseAsset}
                                </p>
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="flex justify-end">
                              <MiniSparkline values={row.sparkline} positive={isPositive} />
                            </div>
                          </td>

                          <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <Link
                                to={`/markets/${encodeURIComponent(row.symbol)}`}
                                className="px-2.5 py-1.5 rounded-lg border border-[#D4D7DF] dark:border-[#2A2C34] text-xs font-medium text-[#4B5059] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white transition-colors"
                              >
                                Details
                              </Link>
                              <Link
                                to={`/trade?pair=${encodeURIComponent(row.symbol)}`}
                                state={{ selectedPair: row.symbol, fromMarkets: true }}
                                className="px-3 py-1.5 rounded-lg bg-[#004AE2] hover:bg-[#003ec0] text-white text-xs font-semibold transition-colors"
                              >
                                Trade
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile-First Market Card List (< md) */}
              <div className="md:hidden divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                {filteredRows.map((row) => {
                  const isPositive = row.change24hPct >= 0;
                  const isOffline = row.quoteSource === 'unavailable';
                  return (
                    <article
                      key={row.symbol}
                      className="p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleWatchlist(row.symbol)}
                            aria-label={
                              row.isWatchlisted
                                ? `Remove ${row.symbol} from watchlist`
                                : `Add ${row.symbol} to watchlist`
                            }
                            aria-pressed={row.isWatchlisted}
                            className="p-2 -ml-1 rounded-lg hover:bg-[#F4F5F7] dark:hover:bg-[#1E2026] min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                row.isWatchlisted
                                  ? 'fill-[#F59E0B] text-[#F59E0B]'
                                  : 'text-[#686D76] dark:text-[#6E7178]'
                              }`}
                            />
                          </button>

                          <Link
                            to={`/markets/${encodeURIComponent(row.symbol)}`}
                            className="flex items-center gap-2.5 min-w-0"
                          >
                            <CoinAvatar symbol={row.baseAsset} color={row.badgeColor} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-[#111214] dark:text-white truncate">
                                {row.baseAsset}
                                <span className="text-xs font-normal text-[#686D76] dark:text-[#7E828A]">
                                  /{row.quoteAsset}
                                </span>
                              </p>
                              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                                {row.name}
                                {row.isReferenceQuote ? ' · Ref' : ''}
                              </p>
                            </div>
                          </Link>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <MiniSparkline values={row.sparkline} positive={isPositive} />
                          <div className="text-right font-mono-num">
                            <p className="text-sm font-bold text-[#111214] dark:text-[#F4F5F7]">
                              {isOffline ? 'Offline' : formatMarketPriceDisplay(row.price)}
                            </p>
                            <p
                              className={`text-xs font-semibold ${
                                isOffline
                                  ? 'text-[#686D76]'
                                  : isPositive
                                    ? 'text-[#10C478]'
                                    : 'text-[#F0525E]'
                              }`}
                            >
                              {isOffline ? '—' : `${isPositive ? '+' : ''}${row.change24hPct.toFixed(2)}%`}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E2E4E9]/70 dark:border-[#1E2026] text-[11px] font-mono-num">
                        <div>
                          <p className="font-sans text-[#686D76] dark:text-[#7E828A]">24h High</p>
                          <p className="font-semibold text-[#111214] dark:text-[#E5E7EB]">
                            {isOffline ? '—' : formatMarketPriceDisplay(row.high24h)}
                          </p>
                        </div>
                        <div>
                          <p className="font-sans text-[#686D76] dark:text-[#7E828A]">24h Low</p>
                          <p className="font-semibold text-[#111214] dark:text-[#E5E7EB]">
                            {isOffline ? '—' : formatMarketPriceDisplay(row.low24h)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-sans text-[#686D76] dark:text-[#7E828A]">24h Vol</p>
                          <p className="font-semibold text-[#111214] dark:text-[#E5E7EB]">
                            {isOffline ? '—' : `$${formatCompactVolume(row.quoteVolume24h)}`}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <Link
                          to={`/markets/${encodeURIComponent(row.symbol)}`}
                          className="min-h-[42px] rounded-lg border border-[#D4D7DF] dark:border-[#2A2C34] flex items-center justify-center text-xs font-semibold text-[#111214] dark:text-[#F4F5F7] hover:bg-[#F4F5F7] dark:hover:bg-[#1E2026] transition-colors"
                        >
                          View Details
                        </Link>
                        <Link
                          to={`/trade?pair=${encodeURIComponent(row.symbol)}`}
                          state={{ selectedPair: row.symbol, fromMarkets: true }}
                          className="min-h-[42px] rounded-lg bg-[#004AE2] hover:bg-[#003ec0] flex items-center justify-center text-xs font-semibold text-white transition-colors"
                        >
                          Trade {row.baseAsset}
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </CustomerLayout>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Info, RefreshCw, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Asset, MarketDataStatus, MarketPrice, TradingPair } from '../../types/domain';
import { formatCompactVolume, quoteSourceLabelText } from '../../utils/marketsModel';
import {
  formatMarketPriceDisplay,
  SANDBOX_REFERENCE_MARKETS,
  type MarketQuoteSource,
} from '../../utils/overviewModel';
import { formatUsdt, roundAmount } from '../../utils/tradingMath';
import { buildPairSelectorOptions } from '../../utils/tradingWorkspace';
import { ChangeBadge, CoinAvatar, SearchInput } from '../ui/CommonPrimitives';

interface MarketPairHeaderProps {
  activePair: TradingPair;
  activeMarket: MarketPrice;
  baseAssetMeta?: Asset;
  quoteAssetMeta?: Asset;
  pairs: TradingPair[];
  marketPrices: MarketPrice[];
  assets: Asset[];
  watchlist: string[];
  isWatchlisted: boolean;
  providerStatus: MarketDataStatus;
  marketLoading: boolean;
  marketFeedIsCached: boolean;
  marketFeedError: string | null;
  onSelectPair: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onRefreshMarket: () => void;
}

export const MarketPairHeader: React.FC<MarketPairHeaderProps> = ({
  activePair,
  activeMarket,
  baseAssetMeta,
  quoteAssetMeta,
  pairs,
  marketPrices,
  assets,
  watchlist,
  isWatchlisted,
  providerStatus,
  marketLoading,
  marketFeedIsCached,
  marketFeedError,
  onSelectPair,
  onToggleWatchlist,
  onRefreshMarket,
}) => {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [pairQuery, setPairQuery] = useState('');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectorOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [selectorOpen]);

  const pairOptions = useMemo(
    () =>
      buildPairSelectorOptions({
        pairs,
        marketPrices,
        assets,
        watchlist,
        query: pairQuery,
        watchlistOnly,
      }),
    [pairs, marketPrices, assets, watchlist, pairQuery, watchlistOnly]
  );

  const refQuote = SANDBOX_REFERENCE_MARKETS[activePair.symbol];
  const hasLivePrice = providerStatus !== 'unavailable' && activeMarket.price > 0;
  const quoteSource: MarketQuoteSource = hasLivePrice
    ? marketFeedIsCached || providerStatus === 'delayed' || activeMarket.dataStatus === 'delayed'
      ? 'cached'
      : 'live'
    : refQuote
      ? 'reference'
      : 'unavailable';

  const displayPrice = hasLivePrice ? activeMarket.price : (refQuote?.price ?? 0);
  const displayChangePct = hasLivePrice ? activeMarket.change24hPct : (refQuote?.change24hPct ?? 0);
  const displayHigh = hasLivePrice ? activeMarket.high24h : (refQuote?.high24h ?? 0);
  const displayLow = hasLivePrice ? activeMarket.low24h : (refQuote?.low24h ?? 0);
  const displayBaseVol = hasLivePrice ? activeMarket.volume24h : (refQuote?.volume24h ?? 0);
  const displayQuoteVol = roundAmount(displayBaseVol * displayPrice, 2);
  const metricsUnavailable = displayPrice <= 0;

  return (
    <section
      data-testid="market-pair-header"
      aria-label={`${activePair.symbol} Market Summary`}
      className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3"
    >
      <div className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3.5 sm:gap-5 min-w-0">
          {/* Pair Selector Popover + Star Watchlist */}
          <div className="flex items-center gap-2 min-w-0" ref={popoverRef}>
            <div className="relative">
              <button
                type="button"
                data-testid="pair-switcher-trigger"
                aria-haspopup="listbox"
                aria-expanded={selectorOpen}
                aria-label={`Switch trading pair (${activePair.symbol})`}
                onClick={() => setSelectorOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#24262E] hover:border-[#004AE2] transition-colors text-left"
              >
                <CoinAvatar
                  symbol={activePair.baseAsset}
                  color={baseAssetMeta?.badgeColor ?? '#004AE2'}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-[#111214] dark:text-[#F4F5F7] whitespace-nowrap">
                      {activePair.symbol}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#686D76] dark:text-[#9CA0A8] transition-transform ${
                        selectorOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate max-w-[125px]">
                    {baseAssetMeta?.name ?? activePair.baseAsset} / {quoteAssetMeta?.name ?? activePair.quoteAsset}
                  </p>
                </div>
              </button>

              {selectorOpen && (
                <div
                  data-testid="pair-switcher-popover"
                  role="dialog"
                  aria-label="Select trading market"
                  className="absolute left-0 top-full mt-2 z-40 w-[min(92vw,360px)] rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#24262E] shadow-xl p-3 space-y-2.5"
                >
                  <SearchInput
                    value={pairQuery}
                    onChange={setPairQuery}
                    placeholder="Search pair or asset (e.g. BTC, Solana)"
                    ariaLabel="Search trading pairs"
                  />

                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-1 p-0.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528]"
                      role="group"
                      aria-label="Pair switcher filter"
                    >
                      <button
                        type="button"
                        onClick={() => setWatchlistOnly(false)}
                        aria-pressed={!watchlistOnly}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap ${
                          !watchlistOnly
                            ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                            : 'text-[#686D76] dark:text-[#9CA0A8]'
                        }`}
                      >
                        All Pairs
                      </button>
                      <button
                        type="button"
                        onClick={() => setWatchlistOnly(true)}
                        aria-pressed={watchlistOnly}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap ${
                          watchlistOnly
                            ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                            : 'text-[#686D76] dark:text-[#9CA0A8]'
                        }`}
                      >
                        Watchlist ({watchlist.length})
                      </button>
                    </div>
                    <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                      {pairOptions.length} pairs
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                    {pairOptions.length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#686D76] dark:text-[#7E828A]">
                        No markets match your filter.
                      </p>
                    ) : (
                      pairOptions.map((opt) => {
                        const selected = opt.pair.symbol === activePair.symbol;
                        return (
                          <button
                            key={opt.pair.symbol}
                            type="button"
                            onClick={() => {
                              onSelectPair(opt.pair.symbol);
                              setSelectorOpen(false);
                              setPairQuery('');
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-2 text-left hover:bg-[#F4F5F7] dark:hover:bg-[#1B1D22] transition-colors ${
                              selected ? 'bg-[#F4F5F7] dark:bg-[#1B1D22]' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <CoinAvatar
                                symbol={opt.pair.baseAsset}
                                color={opt.badgeColor}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                                    {opt.pair.symbol}
                                  </span>
                                  {opt.isWatchlisted && (
                                    <Star
                                      className="w-3 h-3 text-[#D97706] fill-[#D97706]"
                                      aria-hidden="true"
                                    />
                                  )}
                                  {opt.isReference && (
                                    <span className="text-[10px] text-[#D97706]">Ref</span>
                                  )}
                                </div>
                                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] truncate">
                                  {opt.baseName}
                                </p>
                              </div>
                            </div>
                            <div className="text-right font-mono-num shrink-0">
                              <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                                {opt.price > 0 ? formatMarketPriceDisplay(opt.price) : '—'}
                              </p>
                              <ChangeBadge
                                changePct={opt.change24hPct}
                                variant="text"
                                unavailable={opt.price <= 0}
                              />
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              data-testid="pair-watchlist-toggle"
              aria-pressed={isWatchlisted}
              aria-label={
                isWatchlisted
                  ? `Remove ${activePair.symbol} from watchlist`
                  : `Add ${activePair.symbol} to watchlist`
              }
              onClick={() => onToggleWatchlist(activePair.symbol)}
              className={`p-2 rounded-lg border transition-colors shrink-0 ${
                isWatchlisted
                  ? 'bg-[#FEF3C7]/40 dark:bg-[#D97706]/15 border-[#D97706]/40 text-[#D97706]'
                  : 'bg-[#F4F5F7] dark:bg-[#0B0C0E] border-[#E2E4E9] dark:border-[#24262E] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              <Star className={`w-4 h-4 ${isWatchlisted ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Last / Reference Price */}
          <div className="font-mono-num shrink-0">
            <p className="text-base sm:text-lg font-bold text-[#111214] dark:text-[#F4F5F7] whitespace-nowrap">
              {metricsUnavailable ? 'Feed Offline' : `${formatMarketPriceDisplay(displayPrice)} USDT`}
            </p>
            <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
              {quoteSource === 'reference'
                ? 'Reference Quote · Feed Offline'
                : quoteSource === 'cached'
                  ? 'Cached Last Price'
                  : quoteSource === 'live'
                    ? 'Last Market Price'
                    : 'No Feed Available'}
            </p>
          </div>

          <ChangeBadge changePct={displayChangePct} unavailable={metricsUnavailable} />

          {/* Desktop 24H Stats */}
          <div className="hidden md:flex items-center gap-4 text-xs font-mono-num">
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">24H High</p>
              <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                {metricsUnavailable ? '—' : formatMarketPriceDisplay(displayHigh)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">24H Low</p>
              <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                {metricsUnavailable ? '—' : formatMarketPriceDisplay(displayLow)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                24H Vol ({activePair.baseAsset})
              </p>
              <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                {metricsUnavailable ? '—' : formatCompactVolume(displayBaseVol)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                24H Vol (USDT)
              </p>
              <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                {metricsUnavailable ? '—' : `$${formatCompactVolume(displayQuoteVol)}`}
              </p>
            </div>
          </div>
        </div>

        {/* Feed Status & Refresh Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="text-right">
            <p
              data-testid="market-header-feed-status"
              className={`text-xs font-semibold whitespace-nowrap ${
                quoteSource === 'live'
                  ? 'text-[#10C478]'
                  : quoteSource === 'cached' || quoteSource === 'reference'
                    ? 'text-[#D97706]'
                    : 'text-[#F0525E]'
              }`}
            >
              {quoteSourceLabelText(quoteSource)}
            </p>
            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
              {quoteSource === 'reference'
                ? marketFeedError || 'Execution disabled while offline'
                : `${activePair.venueSymbol} · Public Quote`}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshMarket}
            disabled={marketLoading}
            aria-label="Refresh market quote"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium text-[#111214] dark:text-[#F4F5F7] hover:opacity-90 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${marketLoading ? 'animate-spin' : ''}`} />
            <span>{quoteSource === 'reference' || quoteSource === 'unavailable' ? 'Retry' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Mobile 24H Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2.5 border-t border-[#E2E4E9] dark:border-[#22242A] md:hidden text-xs font-mono-num">
        <div>
          <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">24H High</p>
          <p className="font-semibold">
            {metricsUnavailable ? '—' : formatMarketPriceDisplay(displayHigh)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">24H Low</p>
          <p className="font-semibold">
            {metricsUnavailable ? '—' : formatMarketPriceDisplay(displayLow)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">
            24H Vol ({activePair.baseAsset})
          </p>
          <p className="font-semibold">
            {metricsUnavailable ? '—' : formatCompactVolume(displayBaseVol)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">24H Vol (USDT)</p>
          <p className="font-semibold">
            {metricsUnavailable ? '—' : `$${formatCompactVolume(displayQuoteVol)}`}
          </p>
        </div>
      </div>

      {/* Unboxed Metadata Line (Zero-Pill Rule) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E2E4E9] dark:border-[#22242A] text-[11px] text-[#686D76] dark:text-[#7E828A]">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Base: <strong className="text-[#111214] dark:text-[#F4F5F7]">{baseAssetMeta?.name ?? activePair.baseAsset}</strong> ({activePair.baseAsset})
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Quote: <strong className="text-[#111214] dark:text-[#F4F5F7]">{quoteAssetMeta?.name ?? activePair.quoteAsset}</strong> ({activePair.quoteAsset})
          </span>
          <span aria-hidden="true">·</span>
          <span>Spot Fee {(activePair.feeRate * 100).toFixed(2)}%</span>
          <span aria-hidden="true">·</span>
          <span>Min Order {formatUsdt(activePair.minOrderUsdt)} USDT</span>
        </div>
        <Link
          to={`/markets/${encodeURIComponent(activePair.symbol)}`}
          className="inline-flex items-center gap-1 text-[#004AE2] dark:text-[#60A5FA] font-medium hover:underline whitespace-nowrap shrink-0"
        >
          <Info className="w-3 h-3" aria-hidden="true" />
          <span>Asset Details</span>
        </Link>
      </div>
    </section>
  );
};

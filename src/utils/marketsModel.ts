import type { Asset, CandlePoint, MarketPrice, MarketTimeframe, TradingPair } from '../types/domain';
import {
  resolveMarketOverviewRows,
  type MarketOverviewRow,
  type MarketQuoteSource,
} from './overviewModel';
import { roundAmount } from './tradingMath';

export type MarketCategoryFilter = 'all' | 'popular' | 'watchlist' | 'gainers' | 'losers';
export type MarketSortField = 'default' | 'price' | 'change24h' | 'volume24h';
export type SortDirection = 'asc' | 'desc';

export interface MarketDiscoveryHighlights {
  totalPairs: number;
  liveCount: number;
  cachedCount: number;
  referenceCount: number;
  topGainer: MarketOverviewRow | null;
  topLoser: MarketOverviewRow | null;
  highestVolume: MarketOverviewRow | null;
}

export function resolveMarketsCatalogRows(params: {
  marketPrices: MarketPrice[];
  assets: Asset[];
  tradingPairs: TradingPair[];
  watchlistSymbols: string[];
  categoryFilter: MarketCategoryFilter;
  searchQuery?: string;
  sortField?: MarketSortField;
  sortDirection?: SortDirection;
  feedIsCached?: boolean;
}): MarketOverviewRow[] {
  const {
    marketPrices,
    assets,
    tradingPairs,
    watchlistSymbols,
    categoryFilter,
    searchQuery = '',
    sortField = 'default',
    sortDirection = 'desc',
    feedIsCached = false,
  } = params;

  const baseFilter =
    categoryFilter === 'popular'
      ? 'popular'
      : categoryFilter === 'watchlist'
        ? 'watchlist'
        : 'all';

  let rows = resolveMarketOverviewRows({
    marketPrices,
    assets,
    tradingPairs,
    watchlistSymbols,
    filterTab: baseFilter,
    searchQuery,
    feedIsCached,
  });

  if (categoryFilter === 'gainers') {
    const positiveRows = rows.filter((r) => r.change24hPct >= 0);
    rows = (positiveRows.length > 0 ? positiveRows : [...rows]).sort(
      (a, b) => b.change24hPct - a.change24hPct
    );
  } else if (categoryFilter === 'losers') {
    const negativeRows = rows.filter((r) => r.change24hPct < 0);
    rows = (negativeRows.length > 0 ? negativeRows : [...rows]).sort(
      (a, b) => a.change24hPct - b.change24hPct
    );
  }

  if (sortField !== 'default') {
    const factor = sortDirection === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortField === 'price') return (a.price - b.price) * factor;
      if (sortField === 'change24h') return (a.change24hPct - b.change24hPct) * factor;
      return (a.quoteVolume24h - b.quoteVolume24h) * factor;
    });
  }

  return rows;
}

export function buildMarketDiscoveryHighlights(
  rows: MarketOverviewRow[]
): MarketDiscoveryHighlights {
  const pricedRows = rows.filter((r) => r.price > 0);
  const sortedByChangeDesc = [...pricedRows].sort((a, b) => b.change24hPct - a.change24hPct);
  const sortedByChangeAsc = [...pricedRows].sort((a, b) => a.change24hPct - b.change24hPct);
  const sortedByVol = [...pricedRows].sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

  return {
    totalPairs: rows.length,
    liveCount: rows.filter((r) => r.quoteSource === 'live').length,
    cachedCount: rows.filter((r) => r.quoteSource === 'cached').length,
    referenceCount: rows.filter((r) => r.quoteSource === 'reference').length,
    topGainer: sortedByChangeDesc[0] ?? null,
    topLoser: sortedByChangeAsc[0] ?? null,
    highestVolume: sortedByVol[0] ?? null,
  };
}

export function formatCompactVolume(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function quoteSourceLabelText(source: MarketQuoteSource): string {
  switch (source) {
    case 'live':
      return 'Live Exchange Feed';
    case 'cached':
      return 'Cached Market Data';
    case 'reference':
      return 'Sandbox Reference Quote';
    default:
      return 'Feed Offline';
  }
}

export function buildIllustrativeCandles(params: {
  symbol: string;
  referencePrice: number;
  change24hPct: number;
  timeframe: MarketTimeframe;
  nowMs?: number;
}): CandlePoint[] {
  const {
    symbol,
    referencePrice,
    change24hPct,
    timeframe,
    nowMs = Date.UTC(2026, 10, 23, 12, 0, 0),
  } = params;

  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return [];

  const stepMap: Record<MarketTimeframe, { count: number; stepMs: number; amplitudeScale: number }> = {
    '15M': { count: 24, stepMs: 15 * 60 * 1000, amplitudeScale: 0.45 },
    '1H': { count: 24, stepMs: 60 * 60 * 1000, amplitudeScale: 1 },
    '4H': { count: 24, stepMs: 4 * 60 * 60 * 1000, amplitudeScale: 1.8 },
    '1D': { count: 24, stepMs: 24 * 60 * 60 * 1000, amplitudeScale: 2.9 },
    '1W': { count: 20, stepMs: 7 * 24 * 60 * 60 * 1000, amplitudeScale: 4.5 },
  };
  const cfg = stepMap[timeframe];

  // Deterministic seed based on symbol so curve stays consistent across renders
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 31 + symbol.charCodeAt(i)) % 997;
  }

  const effectivePct = (Math.abs(change24hPct) > 0.1 ? change24hPct : 2.2) * cfg.amplitudeScale;
  const clampedPct = Math.max(-38, Math.min(60, effectivePct));
  const startPrice = referencePrice / (1 + clampedPct / 100);
  const candles: CandlePoint[] = [];

  let prevClose = startPrice;
  for (let i = 0; i < cfg.count; i++) {
    const progress = (i + 1) / cfg.count;
    const ts = nowMs - (cfg.count - 1 - i) * cfg.stepMs;
    const wave =
      Math.sin((i + seed) * 0.85) * 0.0055 * cfg.amplitudeScale +
      Math.cos((i * 1.35 + seed) * 0.5) * 0.003 * cfg.amplitudeScale;

    const target = startPrice + (referencePrice - startPrice) * progress;
    const close =
      i === cfg.count - 1 ? referencePrice : roundAmount(target * (1 + wave), 6);
    const open = i === 0 ? roundAmount(startPrice, 6) : prevClose;
    const bodyMax = Math.max(open, close);
    const bodyMin = Math.min(open, close);
    const wickSpread = Math.max(referencePrice * 0.0022 * cfg.amplitudeScale, (bodyMax - bodyMin) * 0.38);
    const high = roundAmount(bodyMax + wickSpread * (0.4 + ((i + seed) % 5) * 0.12), 6);
    const low = roundAmount(Math.max(0.000001, bodyMin - wickSpread * (0.35 + ((i * 2 + seed) % 5) * 0.1)), 6);

    const d = new Date(ts);
    const timeLabel =
      timeframe === '1D' || timeframe === '1W'
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        : timeframe === '4H'
          ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ${String(d.getUTCHours()).padStart(2, '0')}:00`
          : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

    candles.push({
      timestamp: ts,
      timeLabel,
      open,
      high,
      low,
      close,
      volume: roundAmount(120 + ((i * 37 + seed) % 85) * 14.5, 2),
    });
    prevClose = close;
  }

  return candles;
}

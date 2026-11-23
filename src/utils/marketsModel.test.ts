import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ASSETS, INITIAL_MARKET_PRICES, INITIAL_TRADING_PAIRS } from '../data/exchangeSeed';
import {
  buildIllustrativeCandles,
  buildMarketDiscoveryHighlights,
  formatCompactVolume,
  quoteSourceLabelText,
  resolveMarketsCatalogRows,
} from './marketsModel';
import {
  DEFAULT_WATCHLIST_SYMBOLS,
  parseStoredWatchlist,
  toggleWatchlistSymbol,
} from './overviewModel';

test('resolveMarketsCatalogRows supports search, category filtering (gainers/losers/watchlist), and sorting', () => {
  const prices = INITIAL_MARKET_PRICES.map((mp) => {
    if (mp.symbol === 'BTC/USDT') {
      return { ...mp, price: 95000, change24hPct: 4.5, volume24h: 12000, dataStatus: 'live' as const };
    }
    if (mp.symbol === 'ETH/USDT') {
      return { ...mp, price: 3200, change24hPct: -2.4, volume24h: 85000, dataStatus: 'live' as const };
    }
    if (mp.symbol === 'SOL/USDT') {
      return { ...mp, price: 185, change24hPct: 8.1, volume24h: 4000000, dataStatus: 'live' as const };
    }
    return mp;
  });

  // 1. Search by asset name or symbol
  const searchSol = resolveMarketsCatalogRows({
    marketPrices: prices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: ['BTC/USDT', 'SOL/USDT'],
    categoryFilter: 'all',
    searchQuery: 'Solana',
  });
  assert.equal(searchSol.length, 1);
  assert.equal(searchSol[0].symbol, 'SOL/USDT');
  assert.equal(searchSol[0].quoteSource, 'live');

  // 2. Fallback rows honestly marked 'reference'
  const allRows = resolveMarketsCatalogRows({
    marketPrices: prices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: ['BTC/USDT', 'ETH/USDT'],
    categoryFilter: 'all',
    feedIsCached: true,
  });
  const btc = allRows.find((r) => r.symbol === 'BTC/USDT');
  const xrp = allRows.find((r) => r.symbol === 'XRP/USDT');
  assert.equal(btc?.quoteSource, 'cached');
  assert.equal(xrp?.quoteSource, 'reference');
  assert.equal(xrp?.isReferenceQuote, true);

  // 3. Top Gainers & Top Losers ordering
  const gainers = resolveMarketsCatalogRows({
    marketPrices: prices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: DEFAULT_WATCHLIST_SYMBOLS,
    categoryFilter: 'gainers',
  });
  assert.equal(gainers[0].symbol, 'SOL/USDT');
  assert.ok(gainers.every((r) => r.change24hPct >= 0));

  const losers = resolveMarketsCatalogRows({
    marketPrices: prices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: DEFAULT_WATCHLIST_SYMBOLS,
    categoryFilter: 'losers',
  });
  assert.equal(losers[0].symbol, 'ETH/USDT');
  assert.ok(losers.every((r) => r.change24hPct < 0));

  // 4. Sorting by price asc / desc & volume24h desc
  const byPriceDesc = resolveMarketsCatalogRows({
    marketPrices: prices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: DEFAULT_WATCHLIST_SYMBOLS,
    categoryFilter: 'all',
    sortField: 'price',
    sortDirection: 'desc',
  });
  assert.equal(byPriceDesc[0].symbol, 'BTC/USDT');
  assert.equal(byPriceDesc[byPriceDesc.length - 1].symbol, 'TRX/USDT');

  const byVolDesc = resolveMarketsCatalogRows({
    marketPrices: prices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: DEFAULT_WATCHLIST_SYMBOLS,
    categoryFilter: 'all',
    sortField: 'volume24h',
    sortDirection: 'desc',
  });
  assert.equal(byVolDesc[0].symbol, 'BTC/USDT'); // 95000 * 12000 = 1.14B USDT quote volume
});

test('buildMarketDiscoveryHighlights computes top movers and quote source tallies', () => {
  const rows = resolveMarketsCatalogRows({
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: DEFAULT_WATCHLIST_SYMBOLS,
    categoryFilter: 'all',
  });
  const summary = buildMarketDiscoveryHighlights(rows);
  assert.equal(summary.totalPairs, INITIAL_TRADING_PAIRS.length);
  assert.equal(summary.liveCount, 0);
  assert.equal(summary.referenceCount, INITIAL_TRADING_PAIRS.length);
  assert.equal(summary.topGainer?.symbol, 'SOL/USDT');
  assert.equal(summary.topLoser?.symbol, 'XRP/USDT');
  assert.equal(summary.highestVolume?.symbol, 'BTC/USDT');
});

test('watchlist helpers parse stored JSON safely and toggle symbols idempotently', () => {
  assert.deepEqual(parseStoredWatchlist(null), DEFAULT_WATCHLIST_SYMBOLS);
  assert.deepEqual(parseStoredWatchlist('not-json'), DEFAULT_WATCHLIST_SYMBOLS);
  assert.deepEqual(parseStoredWatchlist('["xrp/usdt","BTC/USDT","btc/usdt"]'), [
    'XRP/USDT',
    'BTC/USDT',
  ]);

  const added = toggleWatchlistSymbol(['BTC/USDT'], 'eth/usdt');
  assert.deepEqual(added, ['BTC/USDT', 'ETH/USDT']);
  const removed = toggleWatchlistSymbol(added, 'BTC/USDT');
  assert.deepEqual(removed, ['ETH/USDT']);
});

test('formatCompactVolume, quoteSourceLabelText, and buildIllustrativeCandles produce valid formatted outputs', () => {
  assert.equal(formatCompactVolume(0), '—');
  assert.equal(formatCompactVolume(842.5), '842.5');
  assert.equal(formatCompactVolume(28_412), '28.41K');
  assert.equal(formatCompactVolume(148_200_000), '148.20M');
  assert.equal(formatCompactVolume(2_350_000_000), '2.35B');

  assert.equal(quoteSourceLabelText('live'), 'Live Exchange Feed');
  assert.equal(quoteSourceLabelText('cached'), 'Cached Market Data');
  assert.equal(quoteSourceLabelText('reference'), 'Sandbox Reference Quote');
  assert.equal(quoteSourceLabelText('unavailable'), 'Feed Offline');

  const candles = buildIllustrativeCandles({
    symbol: 'ETH/USDT',
    referencePrice: 3418.2,
    change24hPct: 3.62,
    timeframe: '1H',
  });
  assert.equal(candles.length, 24);
  assert.equal(candles[candles.length - 1].close, 3418.2);
  assert.ok(candles.every((c) => c.high >= Math.max(c.open, c.close)));
  assert.ok(candles.every((c) => c.low <= Math.min(c.open, c.close)));
});

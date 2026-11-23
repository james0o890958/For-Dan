import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ASSETS, INITIAL_MARKET_PRICES, INITIAL_TRADING_PAIRS } from '../data/exchangeSeed';
import {
  buildGlobalSearchMatches,
  buildPortfolioOverviewModel,
  buildRecentActivityRows,
  formatMarketPriceDisplay,
  formatQuantityDisplay,
  generatePortfolioSeries,
  resolveMarketOverviewRows,
  SANDBOX_BALANCES,
} from './overviewModel';

test('buildPortfolioOverviewModel defaults to sandbox simulation when user has zero live balances', () => {
  const model = buildPortfolioOverviewModel({
    userBalances: [],
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
    timeframe: '7D',
  });

  assert.equal(model.dataMode, 'sandbox');
  assert.equal(model.usingSimulatedBalances, true);
  assert.equal(model.hasLiveBalances, false);
  assert.ok(model.totalValueUsdt > 40000);
  assert.equal(
    Math.round((model.availableBalanceUsdt + model.lockedBalanceUsdt) * 100),
    Math.round(model.totalValueUsdt * 100)
  );
  assert.equal(model.allocations.length, SANDBOX_BALANCES.length);
  assert.equal(model.chartPoints.length, 14);
});

test('buildPortfolioOverviewModel uses real ledger balances when present and mode is live', () => {
  const livePrices = INITIAL_MARKET_PRICES.map((m) =>
    m.symbol === 'BTC/USDT' ? { ...m, price: 100000, change24hPct: 4.5, dataStatus: 'live' as const } : m
  );

  const model = buildPortfolioOverviewModel({
    userBalances: [
      { id: 'b1', userId: 'u1', assetSymbol: 'USDT', available: 2500, reserved: 500, updatedAt: '2026-11-23T00:00:00Z' },
      { id: 'b2', userId: 'u1', assetSymbol: 'BTC', available: 0.5, reserved: 0, updatedAt: '2026-11-23T00:00:00Z' },
    ],
    marketPrices: livePrices,
    assets: INITIAL_ASSETS,
    preferredMode: 'live',
    timeframe: '24H',
  });

  assert.equal(model.dataMode, 'live');
  assert.equal(model.usingSimulatedBalances, false);
  assert.equal(model.hasLiveBalances, true);
  assert.equal(model.totalValueUsdt, 53000);
  assert.equal(model.availableBalanceUsdt, 52500);
  assert.equal(model.lockedBalanceUsdt, 500);
});

test('buildPortfolioOverviewModel renders zero chart cleanly when live mode is forced on empty account', () => {
  const model = buildPortfolioOverviewModel({
    userBalances: [],
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
    preferredMode: 'live',
    timeframe: '30D',
  });

  assert.equal(model.dataMode, 'live');
  assert.equal(model.totalValueUsdt, 0);
  assert.equal(model.periodDeltaUsdt, 0);
  assert.equal(model.periodDeltaPct, 0);
  assert.ok(model.chartPoints.every((p) => p.valueUsdt === 0));
});

test('generatePortfolioSeries ends at exact current total valuation', () => {
  const series = generatePortfolioSeries(48250.75, '90D', 3.1);
  assert.equal(series.length, 18);
  assert.equal(series[series.length - 1]?.valueUsdt, 48250.75);
});

test('resolveMarketOverviewRows marks reference quotes honestly when feed is offline and filters watchlist', () => {
  const watchlistRows = resolveMarketOverviewRows({
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: ['BTC/USDT', 'SOL/USDT'],
    filterTab: 'watchlist',
  });

  assert.equal(watchlistRows.length, 2);
  assert.deepEqual(
    watchlistRows.map((r) => r.symbol),
    ['BTC/USDT', 'SOL/USDT']
  );
  assert.ok(watchlistRows.every((r) => r.isReferenceQuote === true && r.price > 0));

  const livePrices = INITIAL_MARKET_PRICES.map((m) =>
    m.symbol === 'BTC/USDT' ? { ...m, price: 95000, change24hPct: 1.5, dataStatus: 'live' as const } : m
  );
  const ethSearchRows = resolveMarketOverviewRows({
    marketPrices: livePrices,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: ['BTC/USDT'],
    filterTab: 'all',
    searchQuery: 'Bitcoin',
  });

  assert.equal(ethSearchRows.length, 2);
  const btcRow = ethSearchRows.find((r) => r.symbol === 'BTC/USDT');
  assert.ok(btcRow);
  assert.equal(btcRow.isReferenceQuote, false);
  assert.equal(btcRow.price, 95000);
});

test('buildRecentActivityRows returns clearly flagged sandbox sample data when live records are empty', () => {
  const emptyResult = buildRecentActivityRows({
    deposits: [],
    withdrawals: [],
    trades: [],
    ledgerTransactions: [],
    filter: 'all',
  });
  assert.equal(emptyResult.isSandboxSample, true);
  assert.ok(emptyResult.rows.length >= 4);
  assert.ok(emptyResult.rows.every((r) => r.isSandboxSample));

  const depositFilter = buildRecentActivityRows({
    deposits: [],
    withdrawals: [],
    trades: [],
    ledgerTransactions: [],
    filter: 'deposit',
  });
  assert.ok(depositFilter.rows.every((r) => r.category === 'deposit'));
});

test('buildGlobalSearchMatches finds markets and workspace routes', () => {
  const btcMatches = buildGlobalSearchMatches({
    query: 'sol',
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
  });
  assert.ok(btcMatches.some((m) => m.group === 'Markets' && m.label === 'SOL/USDT'));

  const depositMatches = buildGlobalSearchMatches({
    query: 'deposit',
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
  });
  assert.ok(depositMatches.some((m) => m.group === 'Workspace' && m.to === '/deposit'));
});

test('formatMarketPriceDisplay and formatQuantityDisplay apply thousand separators properly', () => {
  assert.equal(formatMarketPriceDisplay(63503.46), '63,503.46');
  assert.equal(formatMarketPriceDisplay(1.428), '1.4280');
  assert.equal(formatMarketPriceDisplay(0.3096), '0.309600');
  assert.equal(formatQuantityDisplay(14300), '14,300');
  assert.equal(formatQuantityDisplay(0.24), '0.24');
});

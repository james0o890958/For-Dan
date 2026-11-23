import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ASSETS, INITIAL_TRADING_PAIRS } from '../data/exchangeSeed';
import {
  applyPercentageShortcut,
  buildOrderPreviewSummary,
  buildSimulatedOrderBookFallback,
  buildSimulatedTradesFallback,
  filterWorkspacePairs,
  getPairPrecision,
  resolveTradingBalances,
  validateWorkspaceOrder,
} from './tradingWorkspaceModel';
import { resolveMarketsCatalogRows } from './marketsModel';
import { INITIAL_MARKET_PRICES } from '../data/exchangeSeed';

const btcPair = INITIAL_TRADING_PAIRS[0];
const trxPair = INITIAL_TRADING_PAIRS.find((p) => p.symbol === 'TRX/USDT')!;

test('resolveTradingBalances falls back cleanly to sandbox balances for empty accounts across all pairs', () => {
  const rows = resolveMarketsCatalogRows({
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: ['BTC/USDT'],
    categoryFilter: 'all',
  });

  const btcBalances = resolveTradingBalances({
    userBalances: [],
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    assets: INITIAL_ASSETS,
    marketRows: rows,
  });

  assert.equal(btcBalances.balanceSource, 'sandbox');
  assert.equal(btcBalances.quoteAvailable, 12450);
  assert.equal(btcBalances.baseAvailable, 0.215);

  const trxBalances = resolveTradingBalances({
    userBalances: [],
    baseAsset: 'TRX',
    quoteAsset: 'USDT',
    assets: INITIAL_ASSETS,
    marketRows: rows,
  });
  assert.equal(trxBalances.balanceSource, 'sandbox');
  assert.ok(trxBalances.baseAvailable > 0);
});

test('percentage shortcuts produce precision-valid Buy and Sell inputs that never exceed available balance', () => {
  const precision = getPairPrecision(64200, 8);
  const buy100 = applyPercentageShortcut({
    pct: 1,
    side: 'buy',
    orderType: 'limit',
    executionPrice: 64200,
    availableQuote: 12450,
    availableBase: 0.215,
    precision,
  });

  const validation = validateWorkspaceOrder({
    pair: btcPair,
    pairEnabled: true,
    assetEnabled: true,
    side: 'buy',
    orderType: 'limit',
    marketPrice: 64200,
    quoteSource: 'live',
    stopPriceRaw: '',
    limitPriceRaw: '64200',
    quantityRaw: buy100.quantityInput,
    totalRaw: buy100.totalInput,
    availableQuote: 12450,
    availableBase: 0.215,
    balanceSource: 'sandbox',
    precision,
  });

  assert.equal(validation.valid, true, validation.error ?? undefined);
  assert.ok(validation.grossTotalUsdt <= 12450);

  const sell50 = applyPercentageShortcut({
    pct: 0.5,
    side: 'sell',
    orderType: 'market',
    executionPrice: 64200,
    availableQuote: 12450,
    availableBase: 0.215,
    precision,
  });

  const sellVal = validateWorkspaceOrder({
    pair: btcPair,
    pairEnabled: true,
    assetEnabled: true,
    side: 'sell',
    orderType: 'market',
    marketPrice: 64200,
    quoteSource: 'live',
    stopPriceRaw: '',
    limitPriceRaw: '',
    quantityRaw: sell50.quantityInput,
    totalRaw: sell50.totalInput,
    availableQuote: 12450,
    availableBase: 0.215,
    balanceSource: 'sandbox',
    precision,
  });

  assert.equal(sellVal.valid, true, sellVal.error ?? undefined);
  assert.ok(sellVal.quantity <= 0.215);
});

test('validateWorkspaceOrder validates Limit, Market, Stop-Limit, precision, minimum notional, and balances', () => {
  const precision = getPairPrecision(64000, 8);

  // Stop-Limit missing stop price
  const missingStop = validateWorkspaceOrder({
    pair: btcPair,
    pairEnabled: true,
    assetEnabled: true,
    side: 'buy',
    orderType: 'stop_limit',
    marketPrice: 64000,
    quoteSource: 'live',
    stopPriceRaw: '',
    limitPriceRaw: '64500',
    quantityRaw: '0.1',
    totalRaw: '6450',
    availableQuote: 12450,
    availableBase: 0.215,
    balanceSource: 'sandbox',
    precision,
  });
  assert.equal(missingStop.valid, false);
  assert.match(missingStop.error ?? '', /stop trigger price/i);

  // Excess precision check
  const badPrecision = validateWorkspaceOrder({
    pair: btcPair,
    pairEnabled: true,
    assetEnabled: true,
    side: 'buy',
    orderType: 'limit',
    marketPrice: 64000,
    quoteSource: 'live',
    stopPriceRaw: '',
    limitPriceRaw: '64000.123',
    quantityRaw: '0.1',
    totalRaw: '6400',
    availableQuote: 12450,
    availableBase: 0.215,
    balanceSource: 'sandbox',
    precision,
  });
  assert.equal(badPrecision.valid, false);
  assert.match(badPrecision.error ?? '', /decimal places/i);

  // Minimum order notional check
  const belowMin = validateWorkspaceOrder({
    pair: btcPair,
    pairEnabled: true,
    assetEnabled: true,
    side: 'buy',
    orderType: 'limit',
    marketPrice: 64000,
    quoteSource: 'live',
    stopPriceRaw: '',
    limitPriceRaw: '64000',
    quantityRaw: '0.0001',
    totalRaw: '6.4',
    availableQuote: 12450,
    availableBase: 0.215,
    balanceSource: 'sandbox',
    precision,
  });
  assert.equal(belowMin.valid, false);
  assert.match(belowMin.error ?? '', /Minimum order value/i);

  // Valid Stop-Limit Buy with immediate trigger warning
  const validStopLimit = validateWorkspaceOrder({
    pair: btcPair,
    pairEnabled: true,
    assetEnabled: true,
    side: 'buy',
    orderType: 'stop_limit',
    marketPrice: 64000,
    quoteSource: 'reference',
    stopPriceRaw: '63500',
    limitPriceRaw: '63600',
    quantityRaw: '0.1',
    totalRaw: '6360',
    availableQuote: 12450,
    availableBase: 0.215,
    balanceSource: 'sandbox',
    precision,
  });
  assert.equal(validStopLimit.valid, true);
  assert.ok(validStopLimit.warnings.some((w) => /trigger immediately/i.test(w)));
  assert.ok(validStopLimit.warnings.some((w) => /sandbox reference/i.test(w)));

  const preview = buildOrderPreviewSummary({
    pair: btcPair,
    side: 'buy',
    orderType: 'stop_limit',
    validation: validStopLimit,
    balanceSource: 'sandbox',
    quoteSource: 'reference',
    precision,
  });
  assert.equal(preview.orderTypeLabel, 'Stop-Limit');
  assert.ok(preview.stopPriceFormatted);
  assert.match(preview.sandboxExecutionNotice, /Sandbox Preview Only/i);
});

test('filterWorkspacePairs searches by symbol or asset name and respects precision on low-priced pairs', () => {
  const rows = resolveMarketsCatalogRows({
    marketPrices: INITIAL_MARKET_PRICES,
    assets: INITIAL_ASSETS,
    tradingPairs: INITIAL_TRADING_PAIRS,
    watchlistSymbols: ['SOL/USDT'],
    categoryFilter: 'all',
  });

  const solMatches = filterWorkspacePairs(rows, 'solana');
  assert.equal(solMatches.length, 1);
  assert.equal(solMatches[0].symbol, 'SOL/USDT');

  const trxPrecision = getPairPrecision(0.2418, trxPair.baseAsset === 'TRX' ? 6 : 8);
  assert.equal(trxPrecision.priceDecimals, 6);
  assert.equal(trxPrecision.qtyDecimals, 1);
});

test('simulated order book and trades fallbacks generate deterministic reference ladders when upstream is offline', () => {
  const depth = buildSimulatedOrderBookFallback({
    symbol: 'ETH/USDT',
    referencePrice: 3400,
    tickSize: 0.5,
  });
  assert.equal(depth.bids.length, 12);
  assert.equal(depth.asks.length, 12);
  assert.ok(depth.asks[0][0] > depth.bids[0][0]);

  const trades = buildSimulatedTradesFallback({
    symbol: 'ETH/USDT',
    referencePrice: 3400,
  });
  assert.equal(trades.length, 16);
  assert.ok(trades.every((t) => t.price > 0 && t.quantity > 0));
});

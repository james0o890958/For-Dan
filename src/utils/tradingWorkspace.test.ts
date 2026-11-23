import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPairSelectorOptions,
  computeAllocationShortcut,
  evaluateTradingOrder,
  formatEditablePrice,
  partitionSpotOrders,
  syncQuantityFromTotal,
  syncTotalFromQuantity,
} from './tradingWorkspace';
import type { Asset, MarketPrice, SpotOrder, TradingPair } from '../types/domain';

test('bidirectional quantity/total synchronization computes exact totals and quantities', () => {
  const fromQty = syncTotalFromQuantity({ quantity: 0.25, unitPrice: 2000 });
  assert.equal(fromQty.quantityStr, '0.25');
  assert.equal(fromQty.totalStr, '500.00');

  const fromTotal = syncQuantityFromTotal({ totalUsdt: 1000, unitPrice: 50000 });
  assert.equal(fromTotal.totalStr, '1000');
  assert.equal(fromTotal.quantityStr, '0.02');

  const invalid = syncTotalFromQuantity({ quantity: 0, unitPrice: 2000 });
  assert.equal(invalid.totalStr, '');
});

test('percentage allocation shortcuts compute buy USDT & sell base qty without overflowing available balances', () => {
  const buy50 = computeAllocationShortcut({
    side: 'buy',
    pct: 0.5,
    effectivePrice: 2000,
    availableUsdt: 1500,
    availableBase: 1.5,
  });
  assert.equal(buy50.hasBalance, true);
  assert.equal(buy50.totalStr, '750.00');
  assert.equal(buy50.quantityStr, '0.375');

  const sell100 = computeAllocationShortcut({
    side: 'sell',
    pct: 1,
    effectivePrice: 2000,
    availableUsdt: 1500,
    availableBase: 1.25,
  });
  assert.equal(sell100.hasBalance, true);
  assert.equal(sell100.quantityStr, '1.25');
  assert.equal(sell100.totalStr, '2500.00');

  const emptyWallet = computeAllocationShortcut({
    side: 'buy',
    pct: 0.25,
    effectivePrice: 2000,
    availableUsdt: 0,
    availableBase: 0,
  });
  assert.equal(emptyWallet.hasBalance, false);
  assert.equal(emptyWallet.totalStr, '');
});

test('evaluateTradingOrder handles limit buy calculations, fee, and balance-after preview cleanly', () => {
  const res = evaluateTradingOrder({
    side: 'buy',
    orderType: 'limit',
    stopPriceInput: '',
    priceInput: '2000',
    quantityInput: '0.5',
    totalInput: '1000.00',
    lastEditedField: 'quantity',
    marketPrice: 2100,
    referencePrice: 2100,
    feeRate: 0.001,
    minOrderUsdt: 10,
    availableUsdt: 2500,
    availableBase: 1,
    dataStatus: 'live',
    isAuthenticated: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    pairEnabled: true,
    assetEnabled: true,
    baseAsset: 'ETH',
  });

  assert.equal(res.mathValid, true);
  assert.equal(res.canOpenPreview, true);
  assert.equal(res.canSubmitOrder, true);
  assert.equal(res.effectivePrice, 2000);
  assert.equal(res.quoteGrossUsdt, 1000);
  assert.equal(res.feeUsdt, 1);
  // (1000 - 1) / 2000 = 0.4995 ETH
  assert.equal(res.netReceiveBase, 0.4995);
  assert.equal(res.submitAmountInput, 1000);
  assert.equal(res.balancePreview.isMeaningful, true);
  assert.equal(res.balancePreview.beforeAssetText, '2,500.00 USDT');
  assert.equal(res.balancePreview.afterAssetText, '1,500.00 USDT');
  assert.equal(res.balancePreview.estimatedCreditText, '1.4995 ETH');
});

test('evaluateTradingOrder enforces minimum order, insufficient balance, auth, KYC, offline feed, and stop-limit preview-only guard', () => {
  const belowMin = evaluateTradingOrder({
    side: 'buy',
    orderType: 'market',
    stopPriceInput: '',
    priceInput: '',
    quantityInput: '',
    totalInput: '5',
    lastEditedField: 'total',
    marketPrice: 60000,
    referencePrice: 60000,
    feeRate: 0.001,
    minOrderUsdt: 10,
    availableUsdt: 5000,
    availableBase: 1,
    dataStatus: 'live',
    isAuthenticated: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    pairEnabled: true,
    assetEnabled: true,
    baseAsset: 'BTC',
  });
  assert.equal(belowMin.canSubmitOrder, false);
  assert.match(belowMin.blockingErrors[0], /Minimum order value/i);

  const insufficientSell = evaluateTradingOrder({
    side: 'sell',
    orderType: 'limit',
    stopPriceInput: '',
    priceInput: '2000',
    quantityInput: '5',
    totalInput: '10000',
    lastEditedField: 'quantity',
    marketPrice: 2000,
    referencePrice: 2000,
    feeRate: 0.001,
    minOrderUsdt: 10,
    availableUsdt: 100,
    availableBase: 1.5,
    dataStatus: 'live',
    isAuthenticated: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    pairEnabled: true,
    assetEnabled: true,
    baseAsset: 'ETH',
  });
  assert.equal(insufficientSell.canSubmitOrder, false);
  assert.match(insufficientSell.blockingErrors[0], /Insufficient available ETH balance/i);
  assert.equal(insufficientSell.balancePreview.afterAssetText, 'Insufficient ETH');

  const stopLimit = evaluateTradingOrder({
    side: 'buy',
    orderType: 'stop_limit',
    stopPriceInput: '1950',
    priceInput: '1960',
    quantityInput: '1',
    totalInput: '1960',
    lastEditedField: 'quantity',
    marketPrice: 2000,
    referencePrice: 2000,
    feeRate: 0.001,
    minOrderUsdt: 10,
    availableUsdt: 5000,
    availableBase: 0,
    dataStatus: 'live',
    isAuthenticated: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    pairEnabled: true,
    assetEnabled: true,
    baseAsset: 'ETH',
  });
  assert.equal(stopLimit.canOpenPreview, true);
  assert.equal(stopLimit.canSubmitOrder, false);
  assert.ok(stopLimit.blockingErrors.some((e) => /Stop-limit conditional trigger engine/i.test(e)));

  const offlineGuest = evaluateTradingOrder({
    side: 'buy',
    orderType: 'market',
    stopPriceInput: '',
    priceInput: '',
    quantityInput: '',
    totalInput: '500',
    lastEditedField: 'total',
    marketPrice: 0,
    referencePrice: 94000,
    feeRate: 0.001,
    minOrderUsdt: 10,
    availableUsdt: 0,
    availableBase: 0,
    dataStatus: 'unavailable',
    isAuthenticated: false,
    accountStatus: 'active',
    kycStatus: 'not_submitted',
    pairEnabled: true,
    assetEnabled: true,
    baseAsset: 'BTC',
  });
  assert.equal(offlineGuest.usingReferenceFallback, true);
  assert.equal(offlineGuest.canOpenPreview, true);
  assert.equal(offlineGuest.canSubmitOrder, false);
  assert.ok(offlineGuest.blockingErrors.some((e) => /Sign in/i.test(e)));
  assert.ok(offlineGuest.blockingErrors.some((e) => /unavailable/i.test(e)));

  const guestBelowMin = evaluateTradingOrder({
    side: 'buy',
    orderType: 'limit',
    stopPriceInput: '',
    priceInput: '200',
    quantityInput: '',
    totalInput: '5',
    lastEditedField: 'total',
    marketPrice: 200,
    referencePrice: 200,
    feeRate: 0.001,
    minOrderUsdt: 10,
    availableUsdt: 0,
    availableBase: 0,
    dataStatus: 'live',
    isAuthenticated: false,
    accountStatus: 'active',
    kycStatus: 'not_submitted',
    pairEnabled: true,
    assetEnabled: true,
    baseAsset: 'SOL',
  });
  assert.match(guestBelowMin.primaryValidationError ?? '', /Minimum order value/i);
  assert.equal(guestBelowMin.canSubmitOrder, false);
});

test('partitionSpotOrders splits open vs historical orders and buildPairSelectorOptions filters cleanly', () => {
  const orders: SpotOrder[] = [
    {
      id: 'o1',
      userId: 'u1',
      pairSymbol: 'BTC/USDT',
      side: 'buy',
      orderType: 'LIMIT',
      limitPrice: 60000,
      requestedAmount: 500,
      reservedAsset: 'USDT',
      reservedAmount: 500,
      filledBaseQty: 0,
      filledQuoteAmount: 0,
      feeUsdt: 0,
      venueName: null,
      venueOrderId: null,
      status: 'SUBMITTED',
      rejectReason: null,
      idempotencyKey: 'k1',
      createdAt: '2026-11-23T01:00:00Z',
      updatedAt: '2026-11-23T01:00:00Z',
    },
    {
      id: 'o2',
      userId: 'u1',
      pairSymbol: 'ETH/USDT',
      side: 'sell',
      orderType: 'MARKET',
      requestedAmount: 0.5,
      reservedAsset: 'ETH',
      reservedAmount: 0,
      filledBaseQty: 0,
      filledQuoteAmount: 0,
      feeUsdt: 0,
      venueName: 'Spot Liquidity Venue (Unconfigured)',
      venueOrderId: null,
      status: 'REJECTED',
      rejectReason: 'External venue not configured',
      idempotencyKey: 'k2',
      createdAt: '2026-11-23T02:00:00Z',
      updatedAt: '2026-11-23T02:00:00Z',
    },
  ];
  const partitioned = partitionSpotOrders(orders);
  assert.equal(partitioned.openOrders.length, 1);
  assert.equal(partitioned.openOrders[0].id, 'o1');
  assert.equal(partitioned.orderHistory.length, 1);
  assert.equal(partitioned.orderHistory[0].id, 'o2');

  const pairs: TradingPair[] = [
    { id: 'p1', symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'BTCUSDT', isEnabled: true },
    { id: 'p2', symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'SOLUSDT', isEnabled: true },
  ];
  const assets: Asset[] = [
    { id: 'a0', symbol: 'USDT', name: 'Tether USD', decimals: 2, isEnabled: true, sortOrder: 1, badgeColor: '#10C478', description: '' },
    { id: 'a1', symbol: 'BTC', name: 'Bitcoin', decimals: 8, isEnabled: true, sortOrder: 2, badgeColor: '#F7931A', description: '' },
    { id: 'a2', symbol: 'SOL', name: 'Solana', decimals: 6, isEnabled: true, sortOrder: 3, badgeColor: '#14F195', description: '' },
  ];
  const marketPrices: MarketPrice[] = [
    { symbol: 'BTC/USDT', price: 65000, change24hPct: 2.1, high24h: 66000, low24h: 63000, volume24h: 1000, dataStatus: 'live', updatedAt: '', candles: [] },
    { symbol: 'SOL/USDT', price: 0, change24hPct: 0, high24h: 0, low24h: 0, volume24h: 0, dataStatus: 'unavailable', updatedAt: '', candles: [] },
  ];

  const solSearch = buildPairSelectorOptions({
    pairs,
    marketPrices,
    assets,
    watchlist: ['BTC/USDT'],
    query: 'solana',
  });
  assert.equal(solSearch.length, 1);
  assert.equal(solSearch[0].pair.symbol, 'SOL/USDT');
  assert.equal(solSearch[0].isReference, true);
  assert.equal(formatEditablePrice(0.3108), '0.310800');
});

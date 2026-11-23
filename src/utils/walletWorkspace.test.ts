import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortWalletAssets, filterTransactionsByAssetAndType } from './walletWorkspace';
import type { Asset, LedgerTransaction, MarketPrice, WalletBalance } from '../types/domain';

test('filterAndSortWalletAssets handles zero-balance hiding, search query, and sorting correctly', () => {
  const assets: Asset[] = [
    { id: 'a1', symbol: 'BTC', name: 'Bitcoin', decimals: 8, isEnabled: true, sortOrder: 1, badgeColor: '#F7931A', description: '' },
    { id: 'a2', symbol: 'ETH', name: 'Ethereum', decimals: 8, isEnabled: true, sortOrder: 2, badgeColor: '#627EEA', description: '' },
    { id: 'a3', symbol: 'SOL', name: 'Solana', decimals: 6, isEnabled: true, sortOrder: 3, badgeColor: '#14F195', description: '' },
  ];
  const balances: WalletBalance[] = [
    { id: 'b1', userId: 'u1', assetSymbol: 'BTC', available: 0.5, reserved: 0.1, updatedAt: '' },
    { id: 'b2', userId: 'u1', assetSymbol: 'ETH', available: 0, reserved: 0, updatedAt: '' },
    { id: 'b3', userId: 'u1', assetSymbol: 'USDT', available: 1000, reserved: 200, updatedAt: '' },
  ];
  const marketPrices: MarketPrice[] = [
    { symbol: 'BTC/USDT', price: 60000, change24hPct: 3.5, high24h: 61000, low24h: 59000, volume24h: 100, dataStatus: 'live', updatedAt: '', candles: [] },
  ];

  // Hide zero balances
  const hiddenZero = filterAndSortWalletAssets({
    balances,
    assets,
    marketPrices,
    hideZeroBalances: true,
  });
  const symbols = hiddenZero.map((r) => r.symbol);
  assert.equal(symbols.includes('ETH'), false);
  assert.equal(symbols.includes('BTC'), true);
  assert.equal(symbols.includes('USDT'), true);
  assert.equal(symbols.includes('SOL'), false); // zero balance

  // Search query
  const searched = filterAndSortWalletAssets({
    balances,
    assets,
    marketPrices,
    searchQuery: 'bit',
    hideZeroBalances: false,
  });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].symbol, 'BTC');

  // Sorting by value descending
  const sortedValue = filterAndSortWalletAssets({
    balances,
    assets,
    marketPrices,
    sortField: 'value',
    sortDirection: 'desc',
  });
  // BTC: 0.6 * 60000 = 36000; USDT: 1200 * 1 = 1200
  assert.equal(sortedValue[0].symbol, 'BTC');
});

test('filterTransactionsByAssetAndType filters transactions correctly', () => {
  const txs: LedgerTransaction[] = [
    { id: 't1', userId: 'u1', type: 'deposit_credit', sourceAccount: 'USDT Vault', summary: 'Credited 500 USDT deposit', referenceId: 'DEP-1', reasonCode: null, reversalOfTxId: null, createdAt: '2026-11-23T01:00:00Z', idempotencyKey: 'k1' },
    { id: 't2', userId: 'u1', type: 'spot_buy', sourceAccount: 'BTC Spot', summary: 'Bought 0.1 BTC', referenceId: 'TRD-1', reasonCode: null, reversalOfTxId: null, createdAt: '2026-11-23T02:00:00Z', idempotencyKey: 'k2' },
  ];

  const filteredUsdt = filterTransactionsByAssetAndType({
    transactions: txs,
    assetSymbol: 'USDT',
    typeFilter: 'ALL',
  });
  assert.equal(filteredUsdt.length, 1);
  assert.equal(filteredUsdt[0].id, 't1');

  const filteredType = filterTransactionsByAssetAndType({
    transactions: txs,
    assetSymbol: 'ALL',
    typeFilter: 'spot_buy',
  });
  assert.equal(filteredType.length, 1);
  assert.equal(filteredType[0].id, 't2');
});

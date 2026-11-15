import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSpotBuyPreview,
  calculateSpotSellPreview,
  calculatePortfolioSummary,
  resolveNotificationRecipients,
} from './tradingMath';
import type { Asset, MarketPrice, Profile, WalletBalance } from '../types/domain';

test('spot buy enforces KYC approval and active account status', () => {
  const unverified = calculateSpotBuyPreview({
    usdtAmount: 500,
    executionPrice: 65000,
    feeRate: 0.001,
    availableUsdt: 1000,
    minOrderUsdt: 10,
    dataStatus: 'delayed',
    kycStatus: 'pending',
    accountStatus: 'active',
    pairEnabled: true,
    assetEnabled: true,
  });
  assert.equal(unverified.valid, false);
  assert.match(unverified.error ?? '', /KYC/i);

  const suspended = calculateSpotBuyPreview({
    usdtAmount: 500,
    executionPrice: 65000,
    feeRate: 0.001,
    availableUsdt: 1000,
    minOrderUsdt: 10,
    dataStatus: 'delayed',
    kycStatus: 'approved',
    accountStatus: 'suspended',
    pairEnabled: true,
    assetEnabled: true,
  });
  assert.equal(suspended.valid, false);
  assert.match(suspended.error ?? '', /suspended/i);
});

test('spot buy blocks execution when market data is unavailable', () => {
  const unavailableResult = calculateSpotBuyPreview({
    usdtAmount: 100,
    executionPrice: 65000,
    feeRate: 0.001,
    availableUsdt: 1000,
    minOrderUsdt: 10,
    dataStatus: 'unavailable',
    kycStatus: 'approved',
    accountStatus: 'active',
    pairEnabled: true,
    assetEnabled: true,
  });
  assert.equal(unavailableResult.valid, false);
  assert.match(unavailableResult.error ?? '', /unavailable/i);
});

test('spot buy calculates fee and base quantity accurately', () => {
  const res = calculateSpotBuyPreview({
    usdtAmount: 1000,
    executionPrice: 50000,
    feeRate: 0.001,
    availableUsdt: 2500,
    minOrderUsdt: 10,
    dataStatus: 'live',
    kycStatus: 'approved',
    accountStatus: 'active',
    pairEnabled: true,
    assetEnabled: true,
  });
  assert.equal(res.valid, true);
  assert.equal(res.feeUsdt, 1);
  assert.equal(res.netUsdt, 1000);
  // (1000 - 1) / 50000 = 0.01998
  assert.equal(res.baseQuantity, 0.01998);
});

test('spot sell calculates gross USDT, fee, and net USDT accurately', () => {
  const res = calculateSpotSellPreview({
    baseQuantity: 0.5,
    executionPrice: 2000,
    feeRate: 0.002,
    availableBase: 1.0,
    minOrderUsdt: 10,
    dataStatus: 'delayed',
    kycStatus: 'approved',
    accountStatus: 'active',
    pairEnabled: true,
    assetEnabled: true,
  });
  assert.equal(res.valid, true);
  assert.equal(res.quoteGrossUsdt, 1000);
  assert.equal(res.feeUsdt, 2);
  assert.equal(res.netUsdt, 998);
});

test('portfolio summary computes total USDT value including available and reserved balances', () => {
  const balances: WalletBalance[] = [
    { id: '1', userId: 'u1', assetSymbol: 'USDT', available: 800, reserved: 200, updatedAt: '' },
    { id: '2', userId: 'u1', assetSymbol: 'BTC', available: 0.05, reserved: 0, updatedAt: '' },
  ];
  const prices: MarketPrice[] = [
    {
      symbol: 'BTC/USDT',
      price: 60000,
      change24hPct: 1.5,
      high24h: 61000,
      low24h: 59000,
      volume24h: 1000,
      dataStatus: 'live',
      updatedAt: '',
      candles: [],
    },
  ];
  const assets: Asset[] = [
    {
      id: 'a1',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 2,
      isEnabled: true,
      sortOrder: 1,
      badgeColor: '#10C478',
      description: '',
    },
    {
      id: 'a2',
      symbol: 'BTC',
      name: 'Bitcoin',
      decimals: 8,
      isEnabled: true,
      sortOrder: 2,
      badgeColor: '#F7931A',
      description: '',
    },
  ];
  const summary = calculatePortfolioSummary(balances, prices, assets);
  assert.equal(summary.availableUsdt, 800);
  assert.equal(summary.reservedUsdt, 200);
  assert.equal(summary.cryptoValueUsdt, 3000);
  assert.equal(summary.totalUsdt, 4000);
  assert.equal(summary.holdings[0].symbol, 'BTC');
  assert.equal(summary.holdings[0].allocationPct, 75);
  assert.equal(summary.holdings[1].allocationPct, 25);
});

test('notification recipient resolution handles everyone, selected_group, and individual', () => {
  const profiles: Profile[] = [
    {
      id: 'u1',
      publicUserId: '6087699553',
      email: 'a@example.com',
      fullName: 'Alice',
      phone: '+10001',
      twoFactorEnabled: false,
      accountStatus: 'active',
      kycStatus: 'approved',
      preferredLanguage: 'English',
      createdAt: '',
    },
    {
      id: 'u2',
      publicUserId: '6087699554',
      email: 'b@example.com',
      fullName: 'Bob',
      phone: '+10002',
      twoFactorEnabled: false,
      accountStatus: 'suspended',
      kycStatus: 'pending',
      preferredLanguage: 'English',
      createdAt: '',
    },
  ];

  assert.equal(
    resolveNotificationRecipients(profiles, { recipientType: 'everyone' }).length,
    2
  );
  assert.equal(
    resolveNotificationRecipients(profiles, {
      recipientType: 'selected_group',
      kycFilter: 'approved',
      accountStatusFilter: 'active',
    }).length,
    1
  );
  assert.equal(
    resolveNotificationRecipients(profiles, {
      recipientType: 'individual',
      individualUserId: 'u2',
    })[0].id,
    'u2'
  );
});

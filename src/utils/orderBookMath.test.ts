import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderBookSnapshot, formatBookPrice, getTickOptionsForPrice } from './orderBookMath';

test('buildOrderBookSnapshot aggregates ticks, sorts asks top-down and bids descending, and computes spread', () => {
  const snap = buildOrderBookSnapshot({
    symbol: 'BTC/USDT',
    tickSize: 10,
    maxRows: 5,
    rawAsks: [
      [65012, 0.5],
      [65018, 0.3],
      [65025, 1.2],
    ],
    rawBids: [
      [65008, 0.4],
      [65001, 0.6],
      [64995, 1.5],
    ],
    updatedAt: '2026-11-16T12:00:00Z',
  });

  // Asks grouped by 10 ceiling: 65020 (0.8), 65030 (1.2). Displayed highest-first:
  assert.equal(snap.asks.length, 2);
  assert.equal(snap.asks[0].price, 65030);
  assert.equal(snap.asks[0].total, 2);
  assert.equal(snap.asks[0].depthPct, 100);
  assert.equal(snap.asks[1].price, 65020);
  assert.equal(snap.asks[1].size, 0.8);

  // Bids grouped by 10 floor: 65000 (1.0), 64990 (1.5)
  assert.equal(snap.bids.length, 2);
  assert.equal(snap.bids[0].price, 65000);
  assert.equal(snap.bids[0].size, 1);
  assert.equal(snap.bids[1].price, 64990);
  assert.equal(snap.bids[1].total, 2.5);

  assert.equal(snap.bestAsk, 65020);
  assert.equal(snap.bestBid, 65000);
  assert.equal(snap.spreadUsdt, 20);
  assert.equal(snap.midPrice, 65010);
});

test('getTickOptionsForPrice scales tick increments cleanly by asset price range', () => {
  assert.deepEqual(getTickOptionsForPrice(65000), [0.01, 1, 10, 50]);
  assert.deepEqual(getTickOptionsForPrice(0.31), [0.00001, 0.0001, 0.001, 0.01]);
});

test('formatBookPrice respects tick decimals cleanly', () => {
  assert.equal(formatBookPrice(65010, 10), '65,010.00');
  assert.equal(formatBookPrice(0.31452, 0.00001), '0.31452');
});

import type { OrderBookLevel, OrderBookSnapshot } from '../types/domain';
import { roundAmount } from './tradingMath';

export function getTickOptionsForPrice(referencePrice: number): number[] {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return [0.01, 0.1, 1];
  }
  if (referencePrice >= 10000) return [0.01, 1, 10, 50];
  if (referencePrice >= 1000) return [0.01, 0.5, 1, 5];
  if (referencePrice >= 100) return [0.01, 0.1, 0.5, 1];
  if (referencePrice >= 10) return [0.001, 0.01, 0.1, 0.5];
  if (referencePrice >= 1) return [0.0001, 0.001, 0.01, 0.1];
  return [0.00001, 0.0001, 0.001, 0.01];
}

export function formatBookPrice(price: number, tickSize: number): string {
  if (!Number.isFinite(price) || price <= 0) return '—';
  const tickStr = tickSize.toString();
  const dotIdx = tickStr.indexOf('.');
  const tickDecimals = dotIdx >= 0 ? tickStr.length - dotIdx - 1 : 0;
  const decimals = Math.max(tickDecimals, price >= 10 ? 2 : price >= 1 ? 4 : 5);
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function groupBookSide(
  rawLevels: Array<[number, number]>,
  tickSize: number,
  side: 'bid' | 'ask',
  maxRows: number
): OrderBookLevel[] {
  const safeTick = tickSize > 0 ? tickSize : 0.01;
  const buckets = new Map<number, number>();

  for (const [rawPrice, rawSize] of rawLevels) {
    if (!Number.isFinite(rawPrice) || !Number.isFinite(rawSize) || rawPrice <= 0 || rawSize <= 0) {
      continue;
    }
    const bucketIndex =
      side === 'ask'
        ? Math.ceil(rawPrice / safeTick - 1e-12)
        : Math.floor(rawPrice / safeTick + 1e-12);
    const groupedPrice = roundAmount(bucketIndex * safeTick, 8);
    buckets.set(groupedPrice, roundAmount((buckets.get(groupedPrice) ?? 0) + rawSize, 8));
  }

  const sortedEntries = Array.from(buckets.entries())
    .sort((a, b) => (side === 'ask' ? a[0] - b[0] : b[0] - a[0]))
    .slice(0, maxRows);

  let cumulative = 0;
  let cumulativeUsdt = 0;
  const withTotals = sortedEntries.map(([price, size]) => {
    cumulative = roundAmount(cumulative + size, 8);
    cumulativeUsdt = roundAmount(cumulativeUsdt + price * size, 4);
    return {
      price,
      size,
      total: cumulative,
      totalUsdt: cumulativeUsdt,
    };
  });

  const maxTotal = withTotals.length > 0 ? withTotals[withTotals.length - 1].total : 1;

  return withTotals.map((row) => ({
    ...row,
    depthPct: maxTotal > 0 ? Math.min(100, Math.round((row.total / maxTotal) * 1000) / 10) : 0,
  }));
}

export function buildOrderBookSnapshot(params: {
  symbol: string;
  rawBids: Array<[number, number]>;
  rawAsks: Array<[number, number]>;
  tickSize: number;
  maxRows?: number;
  updatedAt?: string;
}): OrderBookSnapshot {
  const maxRows = params.maxRows ?? 10;
  const asksAscending = groupBookSide(params.rawAsks, params.tickSize, 'ask', maxRows);
  const bidsDescending = groupBookSide(params.rawBids, params.tickSize, 'bid', maxRows);

  const bestAsk = asksAscending[0]?.price ?? 0;
  const bestBid = bidsDescending[0]?.price ?? 0;
  const midPrice =
    bestAsk > 0 && bestBid > 0 ? roundAmount((bestAsk + bestBid) / 2, 8) : bestAsk || bestBid;
  const spreadUsdt = bestAsk > 0 && bestBid > 0 ? roundAmount(Math.max(0, bestAsk - bestBid), 8) : 0;
  const spreadPct =
    midPrice > 0 && spreadUsdt > 0 ? roundAmount((spreadUsdt / midPrice) * 100, 4) : 0;

  return {
    symbol: params.symbol,
    // Asks displayed top-down (highest price down to lowest ask right above spread)
    asks: asksAscending.slice().reverse(),
    bids: bidsDescending,
    bestAsk,
    bestBid,
    midPrice,
    spreadUsdt,
    spreadPct,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
  };
}

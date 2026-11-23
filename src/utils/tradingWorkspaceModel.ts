import type {
  AccountStatus,
  Asset,
  KycStatus,
  PublicMarketTrade,
  TradeSide,
  TradingPair,
  WalletBalance,
} from '../types/domain';
import {
  formatMarketPriceDisplay,
  formatQuantityDisplay,
  SANDBOX_BALANCES,
  type MarketOverviewRow,
  type MarketQuoteSource,
} from './overviewModel';
import { formatUsdt, roundAmount } from './tradingMath';

export type WorkspaceOrderType = 'limit' | 'market' | 'stop_limit';

export interface PairPrecisionSpec {
  priceDecimals: number;
  qtyDecimals: number;
  totalDecimals: number;
  priceStep: string;
  qtyStep: string;
}

export interface TradingBalanceSummaryRow {
  symbol: string;
  name: string;
  badgeColor: string;
  available: number;
  reserved: number;
  total: number;
  estimatedUsdt: number;
}

export interface WorkspaceBalanceState {
  balanceSource: 'account' | 'sandbox';
  baseAvailable: number;
  baseReserved: number;
  quoteAvailable: number;
  quoteReserved: number;
  allAssetBalances: TradingBalanceSummaryRow[];
}

export interface WorkspaceOrderValidationResult {
  valid: boolean;
  error: string | null;
  warnings: string[];
  executionPrice: number;
  stopPrice: number | null;
  quantity: number;
  grossTotalUsdt: number;
  feeUsdt: number;
  feeRate: number;
  estimatedReceiveAmount: number;
  estimatedReceiveAsset: string;
}

export interface OrderPreviewSummary {
  pairSymbol: string;
  side: TradeSide;
  orderType: WorkspaceOrderType;
  orderTypeLabel: string;
  stopPriceFormatted: string | null;
  priceFormatted: string;
  quantityFormatted: string;
  totalFormatted: string;
  feeFormatted: string;
  estimatedReceiveFormatted: string;
  balanceSourceLabel: string;
  priceSourceLabel: string;
  warnings: string[];
  sandboxExecutionNotice: string;
}

const SANDBOX_TRADING_EXTRA_HOLDINGS: Record<string, { available: number; reserved: number }> = {
  LTC: { available: 18.5, reserved: 0 },
  BCH: { available: 3.25, reserved: 0 },
  TRX: { available: 6500, reserved: 0 },
};

export function getPairPrecision(
  referencePrice: number,
  baseAssetDecimals = 8
): PairPrecisionSpec {
  const priceDecimals =
    referencePrice >= 10 ? 2 : referencePrice >= 1 ? 4 : referencePrice > 0 ? 6 : 2;
  const derivedQtyDecimals =
    referencePrice >= 10000
      ? 5
      : referencePrice >= 1000
        ? 4
        : referencePrice >= 50
          ? 3
          : referencePrice >= 1
            ? 2
            : 1;
  const qtyDecimals = Math.min(Math.max(1, derivedQtyDecimals), Math.max(1, baseAssetDecimals));
  const totalDecimals = 2;

  return {
    priceDecimals,
    qtyDecimals,
    totalDecimals,
    priceStep: (1 / Math.pow(10, priceDecimals)).toFixed(priceDecimals),
    qtyStep: (1 / Math.pow(10, qtyDecimals)).toFixed(qtyDecimals),
  };
}

export function countDecimalPlaces(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('e') || trimmed.includes('E')) {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return 0;
    const str = parsed.toString();
    const dotIdx = str.indexOf('.');
    return dotIdx >= 0 ? str.length - dotIdx - 1 : 0;
  }
  const dotIdx = trimmed.indexOf('.');
  return dotIdx >= 0 ? trimmed.length - dotIdx - 1 : 0;
}

export function floorToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const factor = Math.pow(10, decimals);
  return Math.floor((value + 1e-12) * factor) / factor;
}

export function formatInputNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number(value.toFixed(decimals)).toString();
}

export function resolveTradingBalances(params: {
  userBalances: WalletBalance[];
  baseAsset: string;
  quoteAsset: string;
  assets: Asset[];
  marketRows: MarketOverviewRow[];
}): WorkspaceBalanceState {
  const { userBalances, baseAsset, quoteAsset, assets, marketRows } = params;
  const hasRealBalances = userBalances.some((b) => b.available > 0 || b.reserved > 0);
  const balanceSource: 'account' | 'sandbox' = hasRealBalances ? 'account' : 'sandbox';

  const priceByAsset = new Map<string, number>();
  priceByAsset.set('USDT', 1);
  for (const row of marketRows) {
    priceByAsset.set(row.baseAsset, row.price);
  }

  const rawBySymbol = new Map<string, { available: number; reserved: number }>();

  if (balanceSource === 'account') {
    for (const b of userBalances) {
      rawBySymbol.set(b.assetSymbol, { available: b.available, reserved: b.reserved });
    }
  } else {
    for (const sb of SANDBOX_BALANCES) {
      rawBySymbol.set(sb.assetSymbol, { available: sb.available, reserved: sb.reserved });
    }
    for (const [sym, extra] of Object.entries(SANDBOX_TRADING_EXTRA_HOLDINGS)) {
      if (!rawBySymbol.has(sym)) {
        rawBySymbol.set(sym, extra);
      }
    }
  }

  const allAssetBalances: TradingBalanceSummaryRow[] = assets
    .filter((a) => a.isEnabled)
    .map((asset) => {
      const bal = rawBySymbol.get(asset.symbol) ?? { available: 0, reserved: 0 };
      const total = roundAmount(bal.available + bal.reserved, 8);
      const unitPrice = priceByAsset.get(asset.symbol) ?? 0;
      return {
        symbol: asset.symbol,
        name: asset.name,
        badgeColor: asset.badgeColor,
        available: bal.available,
        reserved: bal.reserved,
        total,
        estimatedUsdt: roundAmount(total * unitPrice, 2),
      };
    })
    .sort((a, b) => b.estimatedUsdt - a.estimatedUsdt);

  const baseEntry = rawBySymbol.get(baseAsset) ?? { available: 0, reserved: 0 };
  const quoteEntry = rawBySymbol.get(quoteAsset) ?? { available: 0, reserved: 0 };

  return {
    balanceSource,
    baseAvailable: baseEntry.available,
    baseReserved: baseEntry.reserved,
    quoteAvailable: quoteEntry.available,
    quoteReserved: quoteEntry.reserved,
    allAssetBalances,
  };
}

export function applyPercentageShortcut(params: {
  pct: number;
  side: TradeSide;
  orderType: WorkspaceOrderType;
  executionPrice: number;
  availableQuote: number;
  availableBase: number;
  precision: PairPrecisionSpec;
}): { quantityInput: string; totalInput: string } {
  const {
    pct,
    side,
    orderType,
    executionPrice,
    availableQuote,
    availableBase,
    precision,
  } = params;

  const clampedPct = Math.max(0, Math.min(1, pct));

  if (side === 'buy') {
    const targetTotal = floorToDecimals(availableQuote * clampedPct, precision.totalDecimals);
    if (targetTotal <= 0) {
      return { quantityInput: '', totalInput: '' };
    }
    const derivedQty =
      executionPrice > 0
        ? floorToDecimals(targetTotal / executionPrice, precision.qtyDecimals)
        : 0;
    if (orderType === 'market') {
      return {
        quantityInput: derivedQty > 0 ? formatInputNumber(derivedQty, precision.qtyDecimals) : '',
        totalInput: formatInputNumber(targetTotal, precision.totalDecimals),
      };
    }
    const adjustedTotal =
      derivedQty > 0 && executionPrice > 0
        ? Math.min(targetTotal, roundAmount(derivedQty * executionPrice, 4))
        : targetTotal;
    return {
      quantityInput: derivedQty > 0 ? formatInputNumber(derivedQty, precision.qtyDecimals) : '',
      totalInput: formatInputNumber(adjustedTotal, 4),
    };
  }

  const targetQty = floorToDecimals(availableBase * clampedPct, precision.qtyDecimals);
  if (targetQty <= 0) {
    return { quantityInput: '', totalInput: '' };
  }
  const derivedTotal =
    executionPrice > 0 ? roundAmount(targetQty * executionPrice, 4) : 0;
  return {
    quantityInput: formatInputNumber(targetQty, precision.qtyDecimals),
    totalInput: derivedTotal > 0 ? formatInputNumber(derivedTotal, 4) : '',
  };
}

export function validateWorkspaceOrder(params: {
  pair: TradingPair;
  pairEnabled: boolean;
  assetEnabled: boolean;
  side: TradeSide;
  orderType: WorkspaceOrderType;
  marketPrice: number;
  quoteSource: MarketQuoteSource;
  stopPriceRaw: string;
  limitPriceRaw: string;
  quantityRaw: string;
  totalRaw: string;
  availableQuote: number;
  availableBase: number;
  balanceSource: 'account' | 'sandbox';
  precision: PairPrecisionSpec;
  accountStatus?: AccountStatus;
  kycStatus?: KycStatus;
}): WorkspaceOrderValidationResult {
  const {
    pair,
    pairEnabled,
    assetEnabled,
    side,
    orderType,
    marketPrice,
    quoteSource,
    stopPriceRaw,
    limitPriceRaw,
    quantityRaw,
    totalRaw,
    availableQuote,
    availableBase,
    balanceSource,
    precision,
    accountStatus,
    kycStatus,
  } = params;

  const warnings: string[] = [];

  if (quoteSource === 'reference') {
    warnings.push(
      'Pricing currently reflects sandbox reference quotes while the live exchange feed is offline.'
    );
  } else if (quoteSource === 'cached') {
    warnings.push('Market quote reflects a recently cached snapshot.');
  }

  if (balanceSource === 'sandbox') {
    warnings.push(
      'Using non-persistent sandbox balances. Live execution and ledger settlement are not yet active.'
    );
  } else if (kycStatus && kycStatus !== 'approved') {
    warnings.push(
      'Real account KYC is pending/unverified; live execution remains gated even though preview validation runs in sandbox.'
    );
  }

  const fail = (error: string, execPrice = marketPrice, stopPrice: number | null = null): WorkspaceOrderValidationResult => ({
    valid: false,
    error,
    warnings,
    executionPrice: execPrice,
    stopPrice,
    quantity: 0,
    grossTotalUsdt: 0,
    feeUsdt: 0,
    feeRate: pair.feeRate,
    estimatedReceiveAmount: 0,
    estimatedReceiveAsset: side === 'buy' ? pair.baseAsset : pair.quoteAsset,
  });

  if (balanceSource === 'account' && accountStatus && accountStatus !== 'active') {
    return fail(
      accountStatus === 'closed'
        ? 'Account is closed. Trading actions are disabled.'
        : 'Account is suspended. Trading actions are disabled.'
    );
  }

  if (!pairEnabled || !assetEnabled) {
    return fail('This trading pair is currently disabled.');
  }

  let parsedStopPrice: number | null = null;
  if (orderType === 'stop_limit') {
    if (!stopPriceRaw.trim()) {
      return fail('Enter a valid stop trigger price.');
    }
    const stopVal = Number(stopPriceRaw);
    if (!Number.isFinite(stopVal) || stopVal <= 0) {
      return fail('Stop price must be greater than zero.');
    }
    if (countDecimalPlaces(stopPriceRaw) > precision.priceDecimals) {
      return fail(`Stop price supports up to ${precision.priceDecimals} decimal places.`);
    }
    parsedStopPrice = stopVal;

    if (marketPrice > 0) {
      if (side === 'buy' && stopVal <= marketPrice) {
        warnings.push(
          `Buy stop price (${formatMarketPriceDisplay(stopVal)}) is at or below current market price and would trigger immediately.`
        );
      } else if (side === 'sell' && stopVal >= marketPrice) {
        warnings.push(
          `Sell stop price (${formatMarketPriceDisplay(stopVal)}) is at or above current market price and would trigger immediately.`
        );
      }
    }
  }

  let executionPrice = marketPrice;
  if (orderType === 'limit' || orderType === 'stop_limit') {
    if (!limitPriceRaw.trim()) {
      return fail('Enter a valid limit price.', 0, parsedStopPrice);
    }
    const limitVal = Number(limitPriceRaw);
    if (!Number.isFinite(limitVal) || limitVal <= 0) {
      return fail('Limit price must be greater than zero.', 0, parsedStopPrice);
    }
    if (countDecimalPlaces(limitPriceRaw) > precision.priceDecimals) {
      return fail(
        `Limit price supports up to ${precision.priceDecimals} decimal places.`,
        limitVal,
        parsedStopPrice
      );
    }
    executionPrice = limitVal;
  } else {
    if (quoteSource === 'unavailable' || !Number.isFinite(marketPrice) || marketPrice <= 0) {
      return fail('Market quote is currently unavailable. Try switching to Limit or retry feed.', 0, null);
    }
  }

  const qtyTrimmed = quantityRaw.trim();
  const totalTrimmed = totalRaw.trim();

  if (!qtyTrimmed && !totalTrimmed) {
    return fail(
      side === 'buy' && orderType === 'market'
        ? `Enter total ${pair.quoteAsset} or ${pair.baseAsset} quantity.`
        : `Enter ${pair.baseAsset} quantity.`,
      executionPrice,
      parsedStopPrice
    );
  }

  const parsedQty = Number(qtyTrimmed);
  const parsedTotal = Number(totalTrimmed);

  if (qtyTrimmed && (!Number.isFinite(parsedQty) || parsedQty <= 0)) {
    return fail(`Quantity must be greater than zero.`, executionPrice, parsedStopPrice);
  }
  if (qtyTrimmed && countDecimalPlaces(qtyTrimmed) > precision.qtyDecimals) {
    return fail(
      `${pair.baseAsset} quantity supports up to ${precision.qtyDecimals} decimal places.`,
      executionPrice,
      parsedStopPrice
    );
  }
  if (totalTrimmed && (!Number.isFinite(parsedTotal) || parsedTotal <= 0)) {
    return fail(`Order total must be greater than zero.`, executionPrice, parsedStopPrice);
  }
  if (totalTrimmed && countDecimalPlaces(totalTrimmed) > 4) {
    return fail(`${pair.quoteAsset} total supports up to 4 decimal places.`, executionPrice, parsedStopPrice);
  }

  const effectiveQty =
    qtyTrimmed && Number.isFinite(parsedQty) && parsedQty > 0
      ? roundAmount(parsedQty, precision.qtyDecimals)
      : roundAmount(parsedTotal / executionPrice, precision.qtyDecimals);

  const effectiveTotal =
    totalTrimmed && orderType === 'market' && side === 'buy' && Number.isFinite(parsedTotal) && parsedTotal > 0
      ? roundAmount(parsedTotal, 4)
      : roundAmount(effectiveQty * executionPrice, 4);

  if (effectiveQty <= 0 || effectiveTotal <= 0) {
    return fail('Order size is too small for current pair precision.', executionPrice, parsedStopPrice);
  }

  if (effectiveTotal < pair.minOrderUsdt) {
    return fail(
      `Minimum order value is ${formatUsdt(pair.minOrderUsdt)} ${pair.quoteAsset}.`,
      executionPrice,
      parsedStopPrice
    );
  }

  if (side === 'buy') {
    if (effectiveTotal > availableQuote + 1e-9) {
      return fail(
        `Insufficient available ${pair.quoteAsset} balance (${formatUsdt(availableQuote)} ${pair.quoteAsset} available).`,
        executionPrice,
        parsedStopPrice
      );
    }
  } else {
    if (effectiveQty > availableBase + 1e-12) {
      return fail(
        `Insufficient available ${pair.baseAsset} balance (${formatQuantityDisplay(availableBase, precision.qtyDecimals)} ${pair.baseAsset} available).`,
        executionPrice,
        parsedStopPrice
      );
    }
  }

  const feeUsdt = roundAmount(effectiveTotal * pair.feeRate, 4);
  const estimatedReceiveAmount =
    side === 'buy'
      ? orderType === 'market'
        ? roundAmount((effectiveTotal - feeUsdt) / executionPrice, precision.qtyDecimals)
        : effectiveQty
      : roundAmount(effectiveTotal - feeUsdt, 4);

  return {
    valid: true,
    error: null,
    warnings,
    executionPrice,
    stopPrice: parsedStopPrice,
    quantity: effectiveQty,
    grossTotalUsdt: effectiveTotal,
    feeUsdt,
    feeRate: pair.feeRate,
    estimatedReceiveAmount,
    estimatedReceiveAsset: side === 'buy' ? pair.baseAsset : pair.quoteAsset,
  };
}

export function buildOrderPreviewSummary(params: {
  pair: TradingPair;
  side: TradeSide;
  orderType: WorkspaceOrderType;
  validation: WorkspaceOrderValidationResult;
  balanceSource: 'account' | 'sandbox';
  quoteSource: MarketQuoteSource;
  precision: PairPrecisionSpec;
}): OrderPreviewSummary {
  const { pair, side, orderType, validation, balanceSource, quoteSource, precision } = params;

  const orderTypeLabel =
    orderType === 'limit' ? 'Limit' : orderType === 'market' ? 'Market' : 'Stop-Limit';

  const quoteLabel =
    quoteSource === 'live'
      ? 'Live Exchange Feed'
      : quoteSource === 'cached'
        ? 'Cached Market Snapshot'
        : quoteSource === 'reference'
          ? 'Sandbox Reference Quote'
          : 'Feed Unavailable';

  return {
    pairSymbol: pair.symbol,
    side,
    orderType,
    orderTypeLabel,
    stopPriceFormatted:
      validation.stopPrice !== null
        ? `${formatMarketPriceDisplay(validation.stopPrice)} ${pair.quoteAsset}`
        : null,
    priceFormatted:
      orderType === 'market'
        ? `Est. ${formatMarketPriceDisplay(validation.executionPrice)} ${pair.quoteAsset}`
        : `${formatMarketPriceDisplay(validation.executionPrice)} ${pair.quoteAsset}`,
    quantityFormatted: `${formatQuantityDisplay(validation.quantity, precision.qtyDecimals)} ${pair.baseAsset}`,
    totalFormatted: `${formatUsdt(validation.grossTotalUsdt)} ${pair.quoteAsset}`,
    feeFormatted: `${formatUsdt(validation.feeUsdt)} ${pair.quoteAsset} (${(validation.feeRate * 100).toFixed(2)}%)`,
    estimatedReceiveFormatted:
      validation.estimatedReceiveAsset === pair.baseAsset
        ? `${formatQuantityDisplay(validation.estimatedReceiveAmount, precision.qtyDecimals)} ${pair.baseAsset}`
        : `${formatUsdt(validation.estimatedReceiveAmount)} ${pair.quoteAsset}`,
    balanceSourceLabel: balanceSource === 'sandbox' ? 'Sandbox Simulation Balance' : 'Account Ledger Balance',
    priceSourceLabel: quoteLabel,
    warnings: validation.warnings,
    sandboxExecutionNotice:
      'Sandbox Preview Only — Order matching, balance debits, and persistent ledger settlement are disabled in Phase 2.2.',
  };
}

export function filterWorkspacePairs(
  rows: MarketOverviewRow[],
  searchQuery: string,
  watchlistOnly = false
): MarketOverviewRow[] {
  const q = searchQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (watchlistOnly && !row.isWatchlisted) return false;
    if (!q) return true;
    return (
      row.symbol.toLowerCase().includes(q) ||
      row.baseAsset.toLowerCase().includes(q) ||
      row.name.toLowerCase().includes(q)
    );
  });
}

export function buildSimulatedOrderBookFallback(params: {
  symbol: string;
  referencePrice: number;
  tickSize: number;
  levelsPerSide?: number;
}): { bids: Array<[number, number]>; asks: Array<[number, number]>; updatedAt: string } {
  const { symbol, referencePrice, tickSize, levelsPerSide = 12 } = params;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return { bids: [], asks: [], updatedAt: new Date().toISOString() };
  }

  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 33 + symbol.charCodeAt(i)) % 991;
  }

  const safeTick = tickSize > 0 ? tickSize : referencePrice >= 100 ? 0.5 : 0.01;
  const baseQtyScale =
    referencePrice >= 10000
      ? 0.25
      : referencePrice >= 1000
        ? 2.4
        : referencePrice >= 50
          ? 24
          : referencePrice >= 1
            ? 850
            : 4500;

  const bids: Array<[number, number]> = [];
  const asks: Array<[number, number]> = [];

  for (let i = 1; i <= levelsPerSide; i++) {
    const stepOffset = i * Math.max(safeTick, referencePrice * 0.00035);
    const askPrice = roundAmount(referencePrice + stepOffset, 6);
    const bidPrice = roundAmount(Math.max(0.000001, referencePrice - stepOffset), 6);
    const askMult = 0.45 + ((i * 7 + seed) % 19) * 0.14;
    const bidMult = 0.45 + ((i * 11 + seed) % 17) * 0.15;

    asks.push([askPrice, roundAmount(baseQtyScale * askMult, 5)]);
    bids.push([bidPrice, roundAmount(baseQtyScale * bidMult, 5)]);
  }

  return {
    bids,
    asks,
    updatedAt: new Date(Date.UTC(2026, 10, 23, 12, 0, 0)).toISOString(),
  };
}

export function buildSimulatedTradesFallback(params: {
  symbol: string;
  referencePrice: number;
  count?: number;
  nowMs?: number;
}): PublicMarketTrade[] {
  const { symbol, referencePrice, count = 16, nowMs = Date.UTC(2026, 10, 23, 12, 0, 0) } = params;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return [];

  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 31 + symbol.charCodeAt(i)) % 977;
  }

  const baseQty =
    referencePrice >= 10000
      ? 0.08
      : referencePrice >= 1000
        ? 0.65
        : referencePrice >= 50
          ? 6.2
          : referencePrice >= 1
            ? 220
            : 1400;

  const trades: PublicMarketTrade[] = [];
  for (let i = 0; i < count; i++) {
    const wave = (((i * 13 + seed) % 15) - 7) * 0.0003;
    const price = roundAmount(referencePrice * (1 + wave), 6);
    const qty = roundAmount(baseQty * (0.25 + ((i * 5 + seed) % 12) * 0.12), 5);
    const quoteAmount = roundAmount(price * qty, 2);
    const side: TradeSide = (i + seed) % 2 === 0 ? 'buy' : 'sell';

    trades.push({
      id: `sim-trade-${symbol}-${i}`,
      symbol,
      price,
      quantity: qty,
      quoteAmount,
      side,
      timestamp: new Date(nowMs - i * 19000).toISOString(),
    });
  }
  return trades;
}

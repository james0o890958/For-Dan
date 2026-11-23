import type {
  AccountStatus,
  Asset,
  KycStatus,
  MarketDataStatus,
  MarketPrice,
  SpotOrder,
  TradeSide,
  TradingPair,
} from '../types/domain';
import {
  formatCryptoPrice,
  formatQty,
  formatUsdt,
  roundAmount,
} from './tradingMath';
import { SANDBOX_REFERENCE_MARKETS } from './overviewModel';

export type OrderEntryType = 'limit' | 'market' | 'stop_limit';

export interface PairOptionRow {
  pair: TradingPair;
  baseName: string;
  badgeColor: string;
  price: number;
  change24hPct: number;
  volume24h: number;
  quoteVolume24h: number;
  isReference: boolean;
  isWatchlisted: boolean;
}

export interface OrderBalancePreview {
  isMeaningful: boolean;
  beforeAssetText: string;
  afterAssetText: string;
  estimatedCreditText: string;
}

export interface TradingOrderEvaluation {
  side: TradeSide;
  orderType: OrderEntryType;
  effectivePrice: number;
  stopPrice: number | null;
  baseQuantity: number;
  quoteGrossUsdt: number;
  feeUsdt: number;
  netUsdt: number;
  netReceiveBase: number;
  usingReferenceFallback: boolean;
  mathValid: boolean;
  canOpenPreview: boolean;
  canSubmitOrder: boolean;
  submitAmountInput: number;
  blockingErrors: string[];
  primaryValidationError: string | null;
  warnings: string[];
  balancePreview: OrderBalancePreview;
}

export function formatEditablePrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '';
  if (price >= 10) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatEditableQuantity(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return '';
  return String(roundAmount(qty, 6));
}

export function formatEditableTotal(totalUsdt: number): string {
  if (!Number.isFinite(totalUsdt) || totalUsdt <= 0) return '';
  return String(roundAmount(totalUsdt, 2));
}

export function syncTotalFromQuantity(params: {
  quantity: number;
  unitPrice: number;
}): { quantityStr: string; totalStr: string } {
  const { quantity, unitPrice } = params;
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return {
      quantityStr: Number.isFinite(quantity) && quantity > 0 ? String(quantity) : '',
      totalStr: '',
    };
  }
  const total = roundAmount(quantity * unitPrice, 2);
  return {
    quantityStr: String(quantity),
    totalStr: total > 0 ? total.toFixed(2) : '',
  };
}

export function syncQuantityFromTotal(params: {
  totalUsdt: number;
  unitPrice: number;
}): { quantityStr: string; totalStr: string } {
  const { totalUsdt, unitPrice } = params;
  if (!Number.isFinite(totalUsdt) || totalUsdt <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return {
      quantityStr: '',
      totalStr: Number.isFinite(totalUsdt) && totalUsdt > 0 ? String(totalUsdt) : '',
    };
  }
  const qty = roundAmount(totalUsdt / unitPrice, 6);
  return {
    quantityStr: qty > 0 ? String(qty) : '',
    totalStr: String(totalUsdt),
  };
}

export function computeAllocationShortcut(params: {
  side: TradeSide;
  pct: number;
  effectivePrice: number;
  availableUsdt: number;
  availableBase: number;
}): {
  hasBalance: boolean;
  quantityStr: string;
  totalStr: string;
} {
  const { side, pct, effectivePrice, availableUsdt, availableBase } = params;
  const clampedPct = Math.max(0, Math.min(1, pct));
  if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
    return { hasBalance: false, quantityStr: '', totalStr: '' };
  }

  if (side === 'buy') {
    if (!Number.isFinite(availableUsdt) || availableUsdt <= 0) {
      return { hasBalance: false, quantityStr: '', totalStr: '' };
    }
    const targetTotal = roundAmount(availableUsdt * clampedPct, 2);
    const targetQty = roundAmount(targetTotal / effectivePrice, 6);
    return {
      hasBalance: true,
      totalStr: targetTotal > 0 ? targetTotal.toFixed(2) : '',
      quantityStr: targetQty > 0 ? String(targetQty) : '',
    };
  }

  if (!Number.isFinite(availableBase) || availableBase <= 0) {
    return { hasBalance: false, quantityStr: '', totalStr: '' };
  }
  const targetQty = roundAmount(availableBase * clampedPct, 6);
  const targetTotal = roundAmount(targetQty * effectivePrice, 2);
  return {
    hasBalance: true,
    quantityStr: targetQty > 0 ? String(targetQty) : '',
    totalStr: targetTotal > 0 ? targetTotal.toFixed(2) : '',
  };
}

export function evaluateTradingOrder(params: {
  side: TradeSide;
  orderType: OrderEntryType;
  stopPriceInput: string;
  priceInput: string;
  quantityInput: string;
  totalInput: string;
  lastEditedField: 'quantity' | 'total';
  marketPrice: number;
  referencePrice: number;
  feeRate: number;
  minOrderUsdt: number;
  availableUsdt: number;
  availableBase: number;
  dataStatus: MarketDataStatus;
  isAuthenticated: boolean;
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  pairEnabled: boolean;
  assetEnabled: boolean;
  baseAsset: string;
}): TradingOrderEvaluation {
  const {
    side,
    orderType,
    stopPriceInput,
    priceInput,
    quantityInput,
    totalInput,
    lastEditedField,
    marketPrice,
    referencePrice,
    feeRate,
    minOrderUsdt,
    availableUsdt,
    availableBase,
    dataStatus,
    isAuthenticated,
    accountStatus,
    kycStatus,
    pairEnabled,
    assetEnabled,
    baseAsset,
  } = params;

  const liveAvailable = dataStatus !== 'unavailable' && marketPrice > 0;
  const usingReferenceFallback = !liveAvailable && referencePrice > 0;

  const parsedLimitPrice = Number(priceInput);
  const effectivePrice =
    orderType === 'market'
      ? liveAvailable
        ? marketPrice
        : referencePrice
      : Number.isFinite(parsedLimitPrice) && parsedLimitPrice > 0
        ? parsedLimitPrice
        : 0;

  const parsedStopPrice = Number(stopPriceInput);
  const stopPrice =
    orderType === 'stop_limit'
      ? Number.isFinite(parsedStopPrice) && parsedStopPrice > 0
        ? parsedStopPrice
        : null
      : null;

  const parsedQty = Number(quantityInput);
  const parsedTotal = Number(totalInput);

  let baseQuantity = 0;
  let quoteGrossUsdt = 0;

  if (effectivePrice > 0) {
    if (lastEditedField === 'total' && totalInput.trim() !== '' && Number.isFinite(parsedTotal) && parsedTotal > 0) {
      quoteGrossUsdt = roundAmount(parsedTotal, 8);
      baseQuantity = roundAmount(quoteGrossUsdt / effectivePrice, 8);
    } else if (quantityInput.trim() !== '' && Number.isFinite(parsedQty) && parsedQty > 0) {
      baseQuantity = roundAmount(parsedQty, 8);
      quoteGrossUsdt = roundAmount(baseQuantity * effectivePrice, 8);
    } else if (totalInput.trim() !== '' && Number.isFinite(parsedTotal) && parsedTotal > 0) {
      quoteGrossUsdt = roundAmount(parsedTotal, 8);
      baseQuantity = roundAmount(quoteGrossUsdt / effectivePrice, 8);
    }
  }

  const feeUsdt = quoteGrossUsdt > 0 ? roundAmount(quoteGrossUsdt * feeRate, 8) : 0;
  const netReceiveBase =
    side === 'buy' && effectivePrice > 0 && quoteGrossUsdt > 0
      ? roundAmount(Math.max(0, quoteGrossUsdt - feeUsdt) / effectivePrice, 8)
      : baseQuantity;
  const netUsdt =
    side === 'sell' && quoteGrossUsdt > 0
      ? roundAmount(Math.max(0, quoteGrossUsdt - feeUsdt), 8)
      : quoteGrossUsdt;

  const stopPriceValid = orderType !== 'stop_limit' || stopPrice !== null;
  const priceValid = effectivePrice > 0;
  const amountsValid = baseQuantity > 0 && quoteGrossUsdt > 0;
  const mathValid = priceValid && stopPriceValid && amountsValid;

  const blockingErrors: string[] = [];
  let inputValidationError: string | null = null;

  if (!pairEnabled || !assetEnabled) {
    blockingErrors.push('This trading pair is currently disabled.');
  }

  if (!isAuthenticated) {
    blockingErrors.push('Sign in with a verified customer account to submit spot orders.');
  } else {
    if (accountStatus !== 'active') {
      blockingErrors.push(
        accountStatus === 'closed'
          ? 'Account is closed. Trading is disabled.'
          : 'Account is suspended. Trading is disabled.'
      );
    }
    if (kycStatus !== 'approved') {
      blockingErrors.push('Approved KYC verification is required before trading.');
    }
  }

  if (!liveAvailable) {
    blockingErrors.push(
      'Order execution blocked: live market data and liquidity venue are unavailable.'
    );
  }

  if (orderType === 'stop_limit') {
    blockingErrors.push(
      'Stop-limit conditional trigger engine is not active in sandbox (preview only).'
    );
  }

  if (orderType !== 'market' && priceInput.trim() !== '' && !priceValid) {
    const msg = 'Enter a valid positive limit price.';
    blockingErrors.push(msg);
    inputValidationError ??= msg;
  } else if (orderType !== 'market' && !priceValid) {
    const msg = 'Limit price is required.';
    blockingErrors.push(msg);
    inputValidationError ??= msg;
  }

  if (orderType === 'stop_limit' && stopPriceInput.trim() !== '' && stopPrice === null) {
    const msg = 'Enter a valid positive stop trigger price.';
    blockingErrors.push(msg);
    inputValidationError ??= msg;
  } else if (orderType === 'stop_limit' && stopPrice === null) {
    blockingErrors.push('Stop trigger price is required.');
  }

  if ((quantityInput.trim() !== '' || totalInput.trim() !== '') && !amountsValid) {
    const msg =
      side === 'buy'
        ? 'Enter a valid positive USDT order total or quantity.'
        : `Enter a valid positive ${baseAsset} quantity.`;
    blockingErrors.push(msg);
    inputValidationError ??= msg;
  } else if (!amountsValid) {
    blockingErrors.push(
      side === 'buy' ? 'Enter an order amount.' : `Enter a ${baseAsset} quantity.`
    );
  } else if (quoteGrossUsdt < minOrderUsdt) {
    const msg = `Minimum order value is ${formatUsdt(minOrderUsdt)} USDT.`;
    blockingErrors.push(msg);
    inputValidationError ??= msg;
  }

  if (isAuthenticated && amountsValid) {
    if (side === 'buy' && quoteGrossUsdt > availableUsdt) {
      const msg = 'Insufficient available USDT balance.';
      blockingErrors.push(msg);
      inputValidationError ??= msg;
    }
    if (side === 'sell' && baseQuantity > availableBase) {
      const msg = `Insufficient available ${baseAsset} balance.`;
      blockingErrors.push(msg);
      inputValidationError ??= msg;
    }
  }

  const warnings: string[] = [
    'Sandbox workspace: spot order previews and failed venue routing do not settle real funds or mainnet trades.',
  ];
  if (usingReferenceFallback) {
    warnings.push(
      `Live feed offline: displaying non-executable sandbox reference price (${formatCryptoPrice(referencePrice)} USDT).`
    );
  }
  if (orderType === 'stop_limit') {
    warnings.push(
      'Stop-Limit interface is preview-only; conditional stop triggers require Phase D OMS execution.'
    );
  } else {
    warnings.push(
      'External liquidity venue credentials are unconfigured (Phase D); confirmed orders will be rejected cleanly without debits.'
    );
  }

  const submitAmountInput = side === 'buy' ? quoteGrossUsdt : baseQuantity;

  const hasSufficientBalance =
    isAuthenticated &&
    amountsValid &&
    (side === 'buy' ? quoteGrossUsdt <= availableUsdt : baseQuantity <= availableBase);

  const balancePreview: OrderBalancePreview = !isAuthenticated
    ? {
        isMeaningful: false,
        beforeAssetText: 'Sign in required',
        afterAssetText: '—',
        estimatedCreditText:
          mathValid
            ? side === 'buy'
              ? `+${formatQty(netReceiveBase)} ${baseAsset}`
              : `+${formatUsdt(netUsdt)} USDT`
            : '—',
      }
    : side === 'buy'
      ? {
          isMeaningful: mathValid && hasSufficientBalance,
          beforeAssetText: `${formatUsdt(availableUsdt)} USDT`,
          afterAssetText: mathValid
            ? hasSufficientBalance
              ? `${formatUsdt(roundAmount(availableUsdt - quoteGrossUsdt, 2))} USDT`
              : 'Insufficient USDT'
            : `${formatUsdt(availableUsdt)} USDT`,
          estimatedCreditText: mathValid
            ? `${formatQty(roundAmount(availableBase + netReceiveBase, 6))} ${baseAsset}`
            : `${formatQty(availableBase)} ${baseAsset}`,
        }
      : {
          isMeaningful: mathValid && hasSufficientBalance,
          beforeAssetText: `${formatQty(availableBase)} ${baseAsset}`,
          afterAssetText: mathValid
            ? hasSufficientBalance
              ? `${formatQty(roundAmount(availableBase - baseQuantity, 6))} ${baseAsset}`
              : `Insufficient ${baseAsset}`
            : `${formatQty(availableBase)} ${baseAsset}`,
          estimatedCreditText: mathValid
            ? `${formatUsdt(roundAmount(availableUsdt + netUsdt, 2))} USDT`
            : `${formatUsdt(availableUsdt)} USDT`,
        };

  const hasInput =
    quantityInput.trim() !== '' ||
    totalInput.trim() !== '' ||
    (orderType !== 'market' && priceInput.trim() !== '') ||
    (orderType === 'stop_limit' && stopPriceInput.trim() !== '');

  const primaryValidationError = inputValidationError
    ? inputValidationError
    : hasInput || !liveAvailable || (isAuthenticated && (accountStatus !== 'active' || kycStatus !== 'approved'))
      ? blockingErrors[0] ?? null
      : null;

  return {
    side,
    orderType,
    effectivePrice,
    stopPrice,
    baseQuantity,
    quoteGrossUsdt,
    feeUsdt,
    netUsdt,
    netReceiveBase,
    usingReferenceFallback,
    mathValid,
    canOpenPreview: mathValid,
    canSubmitOrder: mathValid && blockingErrors.length === 0 && orderType !== 'stop_limit',
    submitAmountInput,
    blockingErrors,
    primaryValidationError,
    warnings,
    balancePreview,
  };
}

export function partitionSpotOrders(orders: SpotOrder[]): {
  openOrders: SpotOrder[];
  orderHistory: SpotOrder[];
} {
  const openOrders: SpotOrder[] = [];
  const orderHistory: SpotOrder[] = [];
  for (const order of orders) {
    if (order.status === 'SUBMITTED' || order.status === 'PARTIALLY_FILLED') {
      openOrders.push(order);
    } else {
      orderHistory.push(order);
    }
  }
  return { openOrders, orderHistory };
}

export function buildPairSelectorOptions(params: {
  pairs: TradingPair[];
  marketPrices: MarketPrice[];
  assets: Asset[];
  watchlist: string[];
  query?: string;
  watchlistOnly?: boolean;
}): PairOptionRow[] {
  const { pairs, marketPrices, assets, watchlist, query = '', watchlistOnly = false } = params;
  const marketMap = new Map(marketPrices.map((m) => [m.symbol, m]));
  const assetMap = new Map(assets.map((a) => [a.symbol, a]));
  const watchSet = new Set(watchlist.map((s) => s.trim().toUpperCase()));
  const q = query.trim().toLowerCase();

  return pairs
    .filter((p) => {
      const base = assetMap.get(p.baseAsset);
      const quote = assetMap.get(p.quoteAsset);
      if (!p.isEnabled || !base?.isEnabled || !quote?.isEnabled) return false;
      if (watchlistOnly && !watchSet.has(p.symbol)) return false;
      if (!q) return true;
      return (
        p.symbol.toLowerCase().includes(q) ||
        p.baseAsset.toLowerCase().includes(q) ||
        (base.name ?? '').toLowerCase().includes(q)
      );
    })
    .map((p) => {
      const market = marketMap.get(p.symbol);
      const base = assetMap.get(p.baseAsset);
      const ref = SANDBOX_REFERENCE_MARKETS[p.symbol];
      const hasLive = Boolean(market && market.price > 0);
      const price = hasLive ? market!.price : (ref?.price ?? 0);
      const volume24h = hasLive ? market!.volume24h : (ref?.volume24h ?? 0);
      return {
        pair: p,
        baseName: base?.name ?? p.baseAsset,
        badgeColor: base?.badgeColor ?? '#004AE2',
        price,
        change24hPct: hasLive ? market!.change24hPct : (ref?.change24hPct ?? 0),
        volume24h,
        quoteVolume24h: roundAmount(volume24h * price, 2),
        isReference: !hasLive && Boolean(ref),
        isWatchlisted: watchSet.has(p.symbol),
      };
    });
}

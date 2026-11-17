import type {
  AccountStatus,
  Asset,
  KycStatus,
  MarketDataStatus,
  MarketPrice,
  NotificationRecipientType,
  Profile,
  WalletBalance,
} from '../types/domain';

export interface SpotOrderPreview {
  valid: boolean;
  error: string | null;
  baseQuantity: number;
  quoteGrossUsdt: number;
  feeUsdt: number;
  netUsdt: number;
  executionPrice: number;
}

export function roundAmount(value: number, decimals = 8): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatUsdt(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCryptoPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '—';
  if (price >= 1000) return price.toFixed(2);
  if (price >= 10) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatQty(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  return Number(value.toFixed(maxDecimals)).toString();
}

export function calculateSpotBuyPreview(params: {
  usdtAmount: number;
  executionPrice: number;
  feeRate: number;
  availableUsdt: number;
  minOrderUsdt: number;
  dataStatus: MarketDataStatus;
  kycStatus: KycStatus;
  accountStatus: AccountStatus;
  pairEnabled: boolean;
  assetEnabled: boolean;
}): SpotOrderPreview {
  const {
    usdtAmount,
    executionPrice,
    feeRate,
    availableUsdt,
    minOrderUsdt,
    dataStatus,
    kycStatus,
    accountStatus,
    pairEnabled,
    assetEnabled,
  } = params;

  const empty: SpotOrderPreview = {
    valid: false,
    error: null,
    baseQuantity: 0,
    quoteGrossUsdt: 0,
    feeUsdt: 0,
    netUsdt: 0,
    executionPrice,
  };

  if (accountStatus !== 'active') {
    return {
      ...empty,
      error:
        accountStatus === 'closed'
          ? 'Account is closed. Trading is disabled.'
          : 'Account is suspended. Trading is disabled.',
    };
  }
  if (kycStatus !== 'approved') {
    return { ...empty, error: 'Approved KYC verification is required before trading.' };
  }
  if (!pairEnabled || !assetEnabled) {
    return { ...empty, error: 'This trading pair is currently disabled.' };
  }
  if (dataStatus === 'unavailable' || executionPrice <= 0) {
    return {
      ...empty,
      error: 'Order execution blocked: live market data and liquidity venue are unavailable.',
    };
  }
  if (!Number.isFinite(usdtAmount) || usdtAmount <= 0) {
    return { ...empty, error: 'Enter a valid USDT amount.' };
  }
  if (usdtAmount < minOrderUsdt) {
    return {
      ...empty,
      error: `Minimum order amount is ${formatUsdt(minOrderUsdt)} USDT.`,
    };
  }
  if (usdtAmount > availableUsdt) {
    return { ...empty, error: 'Insufficient available USDT balance.' };
  }

  const feeUsdt = roundAmount(usdtAmount * feeRate, 8);
  const netQuoteForAsset = roundAmount(usdtAmount - feeUsdt, 8);
  const baseQuantity = roundAmount(netQuoteForAsset / executionPrice, 8);

  return {
    valid: true,
    error: null,
    baseQuantity,
    quoteGrossUsdt: roundAmount(usdtAmount, 8),
    feeUsdt,
    netUsdt: roundAmount(usdtAmount, 8),
    executionPrice,
  };
}

export function calculateSpotSellPreview(params: {
  baseQuantity: number;
  executionPrice: number;
  feeRate: number;
  availableBase: number;
  minOrderUsdt: number;
  dataStatus: MarketDataStatus;
  kycStatus: KycStatus;
  accountStatus: AccountStatus;
  pairEnabled: boolean;
  assetEnabled: boolean;
}): SpotOrderPreview {
  const {
    baseQuantity,
    executionPrice,
    feeRate,
    availableBase,
    minOrderUsdt,
    dataStatus,
    kycStatus,
    accountStatus,
    pairEnabled,
    assetEnabled,
  } = params;

  const empty: SpotOrderPreview = {
    valid: false,
    error: null,
    baseQuantity: 0,
    quoteGrossUsdt: 0,
    feeUsdt: 0,
    netUsdt: 0,
    executionPrice,
  };

  if (accountStatus !== 'active') {
    return {
      ...empty,
      error:
        accountStatus === 'closed'
          ? 'Account is closed. Trading is disabled.'
          : 'Account is suspended. Trading is disabled.',
    };
  }
  if (kycStatus !== 'approved') {
    return { ...empty, error: 'Approved KYC verification is required before trading.' };
  }
  if (!pairEnabled || !assetEnabled) {
    return { ...empty, error: 'This trading pair is currently disabled.' };
  }
  if (dataStatus === 'unavailable' || executionPrice <= 0) {
    return {
      ...empty,
      error: 'Order execution blocked: live market data and liquidity venue are unavailable.',
    };
  }
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
    return { ...empty, error: 'Enter a valid asset quantity.' };
  }
  if (baseQuantity > availableBase) {
    return { ...empty, error: 'Insufficient available asset balance.' };
  }

  const quoteGrossUsdt = roundAmount(baseQuantity * executionPrice, 8);
  if (quoteGrossUsdt < minOrderUsdt) {
    return {
      ...empty,
      error: `Minimum order value is ${formatUsdt(minOrderUsdt)} USDT.`,
    };
  }

  const feeUsdt = roundAmount(quoteGrossUsdt * feeRate, 8);
  const netUsdt = roundAmount(quoteGrossUsdt - feeUsdt, 8);

  return {
    valid: true,
    error: null,
    baseQuantity: roundAmount(baseQuantity, 8),
    quoteGrossUsdt,
    feeUsdt,
    netUsdt,
    executionPrice,
  };
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  available: number;
  reserved: number;
  totalBalance: number;
  priceUsdt: number;
  valueUsdt: number;
  allocationPct: number;
  change24hPct: number;
  badgeColor: string;
}

export interface PortfolioSummary {
  totalUsdt: number;
  availableUsdt: number;
  reservedUsdt: number;
  cryptoValueUsdt: number;
  holdings: PortfolioHolding[];
}

export function calculatePortfolioSummary(
  balances: WalletBalance[],
  prices: MarketPrice[],
  assets: Asset[]
): PortfolioSummary {
  const priceMap = new Map<string, MarketPrice>();
  for (const p of prices) {
    const base = p.symbol.split('/')[0];
    priceMap.set(base, p);
  }
  const assetMap = new Map<string, Asset>(assets.map((a) => [a.symbol, a]));

  let availableUsdt = 0;
  let reservedUsdt = 0;
  let cryptoValueUsdt = 0;

  const rawHoldings: Omit<PortfolioHolding, 'allocationPct'>[] = balances
    .filter((b) => b.available > 0 || b.reserved > 0 || b.assetSymbol === 'USDT')
    .map((b) => {
      const assetMeta = assetMap.get(b.assetSymbol);
      const totalBalance = roundAmount(b.available + b.reserved, 8);
      if (b.assetSymbol === 'USDT') {
        availableUsdt = b.available;
        reservedUsdt = b.reserved;
        return {
          symbol: 'USDT',
          name: assetMeta?.name ?? 'Tether USD',
          available: b.available,
          reserved: b.reserved,
          totalBalance,
          priceUsdt: 1,
          valueUsdt: roundAmount(totalBalance, 2),
          change24hPct: 0,
          badgeColor: assetMeta?.badgeColor ?? '#10C478',
        };
      }
      const m = priceMap.get(b.assetSymbol);
      const unitPrice = m?.price ?? 0;
      const val = roundAmount(totalBalance * unitPrice, 2);
      cryptoValueUsdt = roundAmount(cryptoValueUsdt + val, 2);
      return {
        symbol: b.assetSymbol,
        name: assetMeta?.name ?? b.assetSymbol,
        available: b.available,
        reserved: b.reserved,
        totalBalance,
        priceUsdt: unitPrice,
        valueUsdt: val,
        change24hPct: m?.change24hPct ?? 0,
        badgeColor: assetMeta?.badgeColor ?? '#004AE2',
      };
    });

  const totalUsdt = roundAmount(availableUsdt + reservedUsdt + cryptoValueUsdt, 2);

  const holdings: PortfolioHolding[] = rawHoldings
    .map((h) => ({
      ...h,
      allocationPct: totalUsdt > 0 ? roundAmount((h.valueUsdt / totalUsdt) * 100, 2) : 0,
    }))
    .sort((a, b) => b.valueUsdt - a.valueUsdt);

  return {
    totalUsdt,
    availableUsdt: roundAmount(availableUsdt, 2),
    reservedUsdt: roundAmount(reservedUsdt, 2),
    cryptoValueUsdt,
    holdings,
  };
}

export function resolveNotificationRecipients(
  customerProfiles: Profile[],
  criteria: {
    recipientType: NotificationRecipientType;
    kycFilter?: KycStatus | 'all';
    accountStatusFilter?: AccountStatus | 'all';
    manualUserIds?: string[];
    individualUserId?: string | null;
  }
): Profile[] {
  if (criteria.recipientType === 'everyone') {
    return customerProfiles;
  }

  if (criteria.recipientType === 'individual') {
    if (!criteria.individualUserId) return [];
    return customerProfiles.filter((p) => p.id === criteria.individualUserId);
  }

  const filtered = customerProfiles.filter((p) => {
    const matchKyc =
      !criteria.kycFilter || criteria.kycFilter === 'all' || p.kycStatus === criteria.kycFilter;
    const matchStatus =
      !criteria.accountStatusFilter ||
      criteria.accountStatusFilter === 'all' ||
      p.accountStatus === criteria.accountStatusFilter;
    return matchKyc && matchStatus;
  });

  if (criteria.manualUserIds && criteria.manualUserIds.length > 0) {
    const selectedSet = new Set(criteria.manualUserIds);
    return filtered.filter((p) => selectedSet.has(p.id));
  }

  return filtered;
}

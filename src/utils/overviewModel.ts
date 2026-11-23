import type {
  Asset,
  DepositRecord,
  LedgerTransaction,
  MarketPrice,
  MarketTimeframe,
  Trade,
  TradingPair,
  WalletBalance,
  WithdrawalRequest,
} from '../types/domain';
import { calculatePortfolioSummary, roundAmount } from './tradingMath';

export function formatMarketPriceDisplay(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '—';
  if (price >= 10) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}

export function formatQuantityDisplay(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const rounded = Number(value.toFixed(maxDecimals));
  return rounded.toLocaleString('en-US', {
    maximumFractionDigits: maxDecimals,
  });
}

export type PortfolioChartTimeframe = '24H' | '7D' | '30D' | '90D' | 'ALL';
export type OverviewDataMode = 'sandbox' | 'live';
export type MarketOverviewFilter = 'popular' | 'watchlist' | 'gainers' | 'all';
export type ActivityFilter = 'all' | 'deposit' | 'withdrawal' | 'trade' | 'transfer';
export type MarketQuoteSource = 'live' | 'cached' | 'reference' | 'unavailable';

export const WATCHLIST_STORAGE_KEY = 'exchange_overview_watchlist_v1';

export interface SandboxReferenceMarket {
  symbol: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  sparkline: number[];
}

export const DEFAULT_WATCHLIST_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export function parseStoredWatchlist(raw: string | null): string[] {
  if (!raw) return DEFAULT_WATCHLIST_SYMBOLS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return Array.from(new Set(parsed.map((item) => item.trim().toUpperCase()).filter(Boolean)));
    }
    return DEFAULT_WATCHLIST_SYMBOLS;
  } catch {
    return DEFAULT_WATCHLIST_SYMBOLS;
  }
}

export function toggleWatchlistSymbol(list: string[], symbol: string): string[] {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return list;
  return list.includes(normalized)
    ? list.filter((s) => s !== normalized)
    : [...list, normalized];
}

export const SANDBOX_REFERENCE_MARKETS: Record<string, SandboxReferenceMarket> = {
  'BTC/USDT': {
    symbol: 'BTC/USDT',
    price: 94280.5,
    change24hPct: 2.84,
    high24h: 95120.0,
    low24h: 91450.0,
    volume24h: 28412.6,
    sparkline: [91450, 91980, 92410, 92150, 93020, 93640, 93480, 94280.5],
  },
  'ETH/USDT': {
    symbol: 'ETH/USDT',
    price: 3418.2,
    change24hPct: 3.62,
    high24h: 3465.0,
    low24h: 3280.5,
    volume24h: 194280.4,
    sparkline: [3280.5, 3305, 3328, 3314, 3362, 3395, 3388, 3418.2],
  },
  'SOL/USDT': {
    symbol: 'SOL/USDT',
    price: 186.45,
    change24hPct: 5.18,
    high24h: 189.2,
    low24h: 175.8,
    volume24h: 2841900.0,
    sparkline: [175.8, 177.2, 179.4, 178.9, 181.5, 184.0, 185.1, 186.45],
  },
  'XRP/USDT': {
    symbol: 'XRP/USDT',
    price: 1.428,
    change24hPct: -1.24,
    high24h: 1.462,
    low24h: 1.401,
    volume24h: 148200000,
    sparkline: [1.455, 1.448, 1.452, 1.439, 1.431, 1.418, 1.422, 1.428],
  },
  'LTC/USDT': {
    symbol: 'LTC/USDT',
    price: 92.64,
    change24hPct: 1.15,
    high24h: 94.1,
    low24h: 90.8,
    volume24h: 412890,
    sparkline: [91.2, 91.5, 91.1, 91.9, 92.2, 92.8, 92.4, 92.64],
  },
  'BCH/USDT': {
    symbol: 'BCH/USDT',
    price: 468.9,
    change24hPct: -0.78,
    high24h: 477.5,
    low24h: 462.0,
    volume24h: 89410,
    sparkline: [474.0, 472.5, 470.8, 471.2, 469.4, 467.0, 468.2, 468.9],
  },
  'TRX/USDT': {
    symbol: 'TRX/USDT',
    price: 0.2418,
    change24hPct: 0.92,
    high24h: 0.2445,
    low24h: 0.2382,
    volume24h: 412000000,
    sparkline: [0.2392, 0.2398, 0.2401, 0.2395, 0.2409, 0.2414, 0.2411, 0.2418],
  },
};

export const SANDBOX_BALANCES: WalletBalance[] = [
  {
    id: 'sbx-bal-usdt',
    userId: 'sandbox-preview',
    assetSymbol: 'USDT',
    available: 12450.0,
    reserved: 1850.0,
    updatedAt: '2026-11-23T05:00:00Z',
  },
  {
    id: 'sbx-bal-btc',
    userId: 'sandbox-preview',
    assetSymbol: 'BTC',
    available: 0.215,
    reserved: 0.025,
    updatedAt: '2026-11-23T05:00:00Z',
  },
  {
    id: 'sbx-bal-eth',
    userId: 'sandbox-preview',
    assetSymbol: 'ETH',
    available: 2.85,
    reserved: 0.35,
    updatedAt: '2026-11-23T05:00:00Z',
  },
  {
    id: 'sbx-bal-sol',
    userId: 'sandbox-preview',
    assetSymbol: 'SOL',
    available: 24.0,
    reserved: 0.0,
    updatedAt: '2026-11-23T05:00:00Z',
  },
  {
    id: 'sbx-bal-xrp',
    userId: 'sandbox-preview',
    assetSymbol: 'XRP',
    available: 1450.0,
    reserved: 0.0,
    updatedAt: '2026-11-23T05:00:00Z',
  },
];

export interface PortfolioAllocationItem {
  symbol: string;
  name: string;
  badgeColor: string;
  availableQty: number;
  lockedQty: number;
  totalQty: number;
  priceUsdt: number;
  valueUsdt: number;
  availableValueUsdt: number;
  lockedValueUsdt: number;
  allocationPct: number;
  change24hPct: number;
}

export interface PortfolioChartPoint {
  label: string;
  valueUsdt: number;
  deltaUsdt: number;
  deltaPct: number;
}

export interface PortfolioOverviewModel {
  dataMode: OverviewDataMode;
  usingSimulatedBalances: boolean;
  hasLiveBalances: boolean;
  totalValueUsdt: number;
  availableBalanceUsdt: number;
  lockedBalanceUsdt: number;
  periodDeltaUsdt: number;
  periodDeltaPct: number;
  allocations: PortfolioAllocationItem[];
  chartPoints: PortfolioChartPoint[];
}

export function resolveEffectiveMarketPrices(marketPrices: MarketPrice[]): {
  prices: MarketPrice[];
  usingReferenceFallback: boolean;
} {
  let usingReferenceFallback = false;
  const prices = marketPrices.map((mp) => {
    if (mp.price > 0) return mp;
    const ref = SANDBOX_REFERENCE_MARKETS[mp.symbol];
    if (!ref) return mp;
    usingReferenceFallback = true;
    return {
      ...mp,
      price: ref.price,
      change24hPct: ref.change24hPct,
      high24h: ref.high24h,
      low24h: ref.low24h,
      volume24h: ref.volume24h,
    };
  });
  return { prices, usingReferenceFallback };
}

export function generatePortfolioSeries(
  currentTotalUsdt: number,
  timeframe: PortfolioChartTimeframe,
  weighted24hPct: number,
  nowMs = Date.UTC(2026, 10, 23, 12, 0, 0)
): PortfolioChartPoint[] {
  const configs: Record<
    PortfolioChartTimeframe,
    { count: number; stepMs: number; scale: number; format: 'time' | 'date' }
  > = {
    '24H': { count: 16, stepMs: 90 * 60 * 1000, scale: 1, format: 'time' },
    '7D': { count: 14, stepMs: 12 * 3600 * 1000, scale: 2.3, format: 'date' },
    '30D': { count: 15, stepMs: 2 * 24 * 3600 * 1000, scale: 4.1, format: 'date' },
    '90D': { count: 18, stepMs: 5 * 24 * 3600 * 1000, scale: 6.4, format: 'date' },
    ALL: { count: 16, stepMs: 14 * 24 * 3600 * 1000, scale: 9.2, format: 'date' },
  };
  const cfg = configs[timeframe];

  const points: PortfolioChartPoint[] = [];
  if (currentTotalUsdt <= 0) {
    for (let i = 0; i < cfg.count; i++) {
      const ts = nowMs - (cfg.count - 1 - i) * cfg.stepMs;
      points.push({
        label: formatChartAxisLabel(ts, cfg.format),
        valueUsdt: 0,
        deltaUsdt: 0,
        deltaPct: 0,
      });
    }
    return points;
  }

  const effectiveReturnPct =
    Math.abs(weighted24hPct) > 0.05 ? weighted24hPct * cfg.scale : 1.8 * cfg.scale;
  const clampedPct = Math.max(-42, Math.min(85, effectiveReturnPct));
  const startValue = currentTotalUsdt / (1 + clampedPct / 100);

  for (let i = 0; i < cfg.count; i++) {
    const progress = cfg.count === 1 ? 1 : i / (cfg.count - 1);
    const ts = nowMs - (cfg.count - 1 - i) * cfg.stepMs;
    const oscillation =
      i === 0 || i === cfg.count - 1
        ? 0
        : Math.sin(progress * Math.PI * 3.2 + cfg.scale) * 0.0085 +
          Math.cos(progress * Math.PI * 5.5) * 0.0042;
    const rawVal = startValue + (currentTotalUsdt - startValue) * progress;
    const val = i === cfg.count - 1 ? currentTotalUsdt : roundAmount(rawVal * (1 + oscillation), 2);
    const deltaUsdt = roundAmount(val - startValue, 2);
    const deltaPct = startValue > 0 ? roundAmount(((val - startValue) / startValue) * 100, 2) : 0;

    points.push({
      label: formatChartAxisLabel(ts, cfg.format),
      valueUsdt: val,
      deltaUsdt,
      deltaPct,
    });
  }

  return points;
}

function formatChartAxisLabel(ts: number, format: 'time' | 'date'): string {
  const d = new Date(ts);
  if (format === 'time') {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function buildPortfolioOverviewModel(params: {
  userBalances: WalletBalance[];
  marketPrices: MarketPrice[];
  assets: Asset[];
  preferredMode?: OverviewDataMode;
  timeframe: PortfolioChartTimeframe;
  nowMs?: number;
}): PortfolioOverviewModel {
  const { userBalances, marketPrices, assets, preferredMode, timeframe, nowMs } = params;
  const { prices } = resolveEffectiveMarketPrices(marketPrices);

  const liveSummary = calculatePortfolioSummary(userBalances, prices, assets);
  const hasLiveBalances = liveSummary.totalUsdt > 0;

  const dataMode: OverviewDataMode =
    preferredMode === 'live'
      ? 'live'
      : preferredMode === 'sandbox'
        ? 'sandbox'
        : hasLiveBalances
          ? 'live'
          : 'sandbox';

  const activeBalances = dataMode === 'sandbox' ? SANDBOX_BALANCES : userBalances;
  const activeSummary = calculatePortfolioSummary(activeBalances, prices, assets);

  let availableBalanceUsdt = 0;
  let lockedBalanceUsdt = 0;
  let weightedPctSum = 0;

  const allocations: PortfolioAllocationItem[] = activeSummary.holdings.map((h) => {
    const availVal = roundAmount(h.available * h.priceUsdt, 2);
    const lockVal = roundAmount(h.reserved * h.priceUsdt, 2);
    availableBalanceUsdt = roundAmount(availableBalanceUsdt + availVal, 2);
    lockedBalanceUsdt = roundAmount(lockedBalanceUsdt + lockVal, 2);
    weightedPctSum += h.valueUsdt * h.change24hPct;

    return {
      symbol: h.symbol,
      name: h.name,
      badgeColor: h.badgeColor,
      availableQty: h.available,
      lockedQty: h.reserved,
      totalQty: h.totalBalance,
      priceUsdt: h.priceUsdt,
      valueUsdt: h.valueUsdt,
      availableValueUsdt: availVal,
      lockedValueUsdt: lockVal,
      allocationPct: h.allocationPct,
      change24hPct: h.change24hPct,
    };
  });

  const weighted24hPct =
    activeSummary.totalUsdt > 0 ? weightedPctSum / activeSummary.totalUsdt : 0;
  const chartPoints = generatePortfolioSeries(
    activeSummary.totalUsdt,
    timeframe,
    weighted24hPct,
    nowMs
  );
  const firstPoint = chartPoints[0];
  const lastPoint = chartPoints[chartPoints.length - 1];
  const periodDeltaUsdt =
    firstPoint && lastPoint ? roundAmount(lastPoint.valueUsdt - firstPoint.valueUsdt, 2) : 0;
  const periodDeltaPct =
    firstPoint && firstPoint.valueUsdt > 0
      ? roundAmount(((lastPoint.valueUsdt - firstPoint.valueUsdt) / firstPoint.valueUsdt) * 100, 2)
      : 0;

  return {
    dataMode,
    usingSimulatedBalances: dataMode === 'sandbox',
    hasLiveBalances,
    totalValueUsdt: activeSummary.totalUsdt,
    availableBalanceUsdt,
    lockedBalanceUsdt,
    periodDeltaUsdt,
    periodDeltaPct,
    allocations,
    chartPoints,
  };
}

export interface MarketOverviewRow {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  description: string;
  venueSymbol: string;
  feeRate: number;
  minOrderUsdt: number;
  badgeColor: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  sparkline: number[];
  isWatchlisted: boolean;
  isReferenceQuote: boolean;
  quoteSource: MarketQuoteSource;
  updatedAt: string;
}

export function buildSparklineForPair(mp: MarketPrice, fallback?: SandboxReferenceMarket): number[] {
  if (mp.candles.length >= 4) {
    return mp.candles.slice(-12).map((c) => c.close);
  }
  if (mp.price > 0) {
    const start = mp.price / (1 + mp.change24hPct / 100 || 1);
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const wave = i === 0 || i === 7 ? 0 : Math.sin(t * Math.PI * 2.5) * 0.004 * mp.price;
      pts.push(roundAmount(start + (mp.price - start) * t + wave, 6));
    }
    return pts;
  }
  return fallback?.sparkline ?? [1, 1, 1, 1];
}

export function resolveMarketOverviewRows(params: {
  marketPrices: MarketPrice[];
  assets: Asset[];
  tradingPairs: TradingPair[];
  watchlistSymbols: string[];
  filterTab: MarketOverviewFilter;
  searchQuery?: string;
  feedIsCached?: boolean;
}): MarketOverviewRow[] {
  const {
    marketPrices,
    assets,
    tradingPairs,
    watchlistSymbols,
    filterTab,
    searchQuery = '',
    feedIsCached = false,
  } = params;

  const assetMap = new Map(assets.map((a) => [a.symbol, a]));
  const pairMap = new Map(tradingPairs.map((p) => [p.symbol, p]));
  const watchSet = new Set(watchlistSymbols);
  const q = searchQuery.trim().toLowerCase();

  let rows: MarketOverviewRow[] = marketPrices
    .filter((mp) => {
      const pair = pairMap.get(mp.symbol);
      const base = mp.symbol.split('/')[0];
      const asset = assetMap.get(base);
      if (pair && !pair.isEnabled) return false;
      if (asset && !asset.isEnabled) return false;
      return true;
    })
    .map((mp) => {
      const [baseAsset, quoteAsset = 'USDT'] = mp.symbol.split('/');
      const asset = assetMap.get(baseAsset);
      const pair = pairMap.get(mp.symbol);
      const ref = SANDBOX_REFERENCE_MARKETS[mp.symbol];
      const isLivePrice = mp.price > 0;
      const effectivePrice = isLivePrice ? mp.price : (ref?.price ?? 0);
      const effectiveChange = isLivePrice ? mp.change24hPct : (ref?.change24hPct ?? 0);
      const effectiveVolume = isLivePrice ? mp.volume24h : (ref?.volume24h ?? 0);
      const quoteSource: MarketQuoteSource = isLivePrice
        ? feedIsCached || mp.dataStatus === 'delayed'
          ? 'cached'
          : 'live'
        : ref
          ? 'reference'
          : 'unavailable';

      return {
        symbol: mp.symbol,
        baseAsset,
        quoteAsset,
        name: asset?.name ?? baseAsset,
        description: asset?.description ?? '',
        venueSymbol: pair?.venueSymbol ?? `${baseAsset}${quoteAsset}`,
        feeRate: pair?.feeRate ?? 0.001,
        minOrderUsdt: pair?.minOrderUsdt ?? 10,
        badgeColor: asset?.badgeColor ?? '#004AE2',
        price: effectivePrice,
        change24hPct: effectiveChange,
        high24h: isLivePrice ? mp.high24h : (ref?.high24h ?? 0),
        low24h: isLivePrice ? mp.low24h : (ref?.low24h ?? 0),
        volume24h: effectiveVolume,
        quoteVolume24h: roundAmount(effectiveVolume * effectivePrice, 2),
        sparkline: buildSparklineForPair(mp, ref),
        isWatchlisted: watchSet.has(mp.symbol),
        isReferenceQuote: quoteSource === 'reference',
        quoteSource,
        updatedAt: mp.updatedAt,
      };
    });

  if (q) {
    rows = rows.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        r.baseAsset.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
    );
  }

  if (filterTab === 'watchlist') {
    rows = rows.filter((r) => r.isWatchlisted);
  } else if (filterTab === 'gainers') {
    rows = [...rows].sort((a, b) => b.change24hPct - a.change24hPct);
  } else if (filterTab === 'popular') {
    const popularOrder = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'LTC/USDT'];
    rows = [...rows].sort((a, b) => {
      const ia = popularOrder.indexOf(a.symbol);
      const ib = popularOrder.indexOf(b.symbol);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }

  return rows;
}

export interface ActivityRow {
  id: string;
  category: Exclude<ActivityFilter, 'all'>;
  typeLabel: string;
  assetSymbol: string;
  description: string;
  amountDisplay: string;
  status: string;
  statusTone: 'positive' | 'pending' | 'negative' | 'neutral';
  referenceId: string;
  createdAt: string;
  isSandboxSample: boolean;
}

export function buildSandboxSampleActivity(nowMs = Date.UTC(2026, 10, 23, 12, 0, 0)): ActivityRow[] {
  return [
    {
      id: 'sbx-act-1',
      category: 'trade',
      typeLabel: 'Spot Buy',
      assetSymbol: 'BTC',
      description: 'Simulated BTC/USDT Market Fill',
      amountDisplay: '+0.042000 BTC',
      status: 'Simulated Filled',
      statusTone: 'positive',
      referenceId: 'SBX-TRD-90412',
      createdAt: new Date(nowMs - 45 * 60 * 1000).toISOString(),
      isSandboxSample: true,
    },
    {
      id: 'sbx-act-2',
      category: 'deposit',
      typeLabel: 'Deposit',
      assetSymbol: 'USDT',
      description: 'Sandbox Credit (TRC-20 Test Vault)',
      amountDisplay: '+5,000.00 USDT',
      status: 'Sandbox Credited',
      statusTone: 'positive',
      referenceId: 'SBX-DEP-88210',
      createdAt: new Date(nowMs - 4 * 3600 * 1000).toISOString(),
      isSandboxSample: true,
    },
    {
      id: 'sbx-act-3',
      category: 'trade',
      typeLabel: 'Spot Sell',
      assetSymbol: 'ETH',
      description: 'Simulated ETH/USDT Market Fill',
      amountDisplay: '-0.850000 ETH',
      status: 'Simulated Filled',
      statusTone: 'positive',
      referenceId: 'SBX-TRD-87904',
      createdAt: new Date(nowMs - 14 * 3600 * 1000).toISOString(),
      isSandboxSample: true,
    },
    {
      id: 'sbx-act-4',
      category: 'withdrawal',
      typeLabel: 'Withdrawal',
      assetSymbol: 'USDT',
      description: 'Sandbox Withdrawal Queue (ERC-20)',
      amountDisplay: '-1,850.00 USDT',
      status: 'Pending Review',
      statusTone: 'pending',
      referenceId: 'SBX-WD-87411',
      createdAt: new Date(nowMs - 26 * 3600 * 1000).toISOString(),
      isSandboxSample: true,
    },
    {
      id: 'sbx-act-5',
      category: 'transfer',
      typeLabel: 'Allocation',
      assetSymbol: 'SOL',
      description: 'Sandbox Starter Allocation Grant',
      amountDisplay: '+24.000000 SOL',
      status: 'Test Environment',
      statusTone: 'neutral',
      referenceId: 'SBX-INIT-00105',
      createdAt: new Date(nowMs - 72 * 3600 * 1000).toISOString(),
      isSandboxSample: true,
    },
  ];
}

export function buildRecentActivityRows(params: {
  deposits: DepositRecord[];
  withdrawals: WithdrawalRequest[];
  trades: Trade[];
  ledgerTransactions: LedgerTransaction[];
  filter?: ActivityFilter;
  useSandboxSampleWhenEmpty?: boolean;
  nowMs?: number;
}): { rows: ActivityRow[]; isSandboxSample: boolean } {
  const {
    deposits,
    withdrawals,
    trades,
    ledgerTransactions,
    filter = 'all',
    useSandboxSampleWhenEmpty = true,
    nowMs,
  } = params;

  const liveRows: ActivityRow[] = [];

  for (const d of deposits) {
    liveRows.push({
      id: `dep-${d.id}`,
      category: 'deposit',
      typeLabel: 'Deposit',
      assetSymbol: d.assetSymbol,
      description: `${d.assetSymbol} via ${d.networkCode}`,
      amountDisplay: `+${d.amount} ${d.assetSymbol}`,
      status: d.status.replace(/_/g, ' '),
      statusTone:
        d.status === 'CREDITED' || d.status === 'APPROVED'
          ? 'positive'
          : d.status === 'REJECTED'
            ? 'negative'
            : 'pending',
      referenceId: d.txHash.slice(0, 14),
      createdAt: d.createdAt,
      isSandboxSample: false,
    });
  }

  for (const w of withdrawals) {
    liveRows.push({
      id: `wd-${w.id}`,
      category: 'withdrawal',
      typeLabel: 'Withdrawal',
      assetSymbol: w.assetSymbol,
      description: `${w.assetSymbol} via ${w.networkCode}`,
      amountDisplay: `-${w.grossAmount} ${w.assetSymbol}`,
      status: w.status.replace(/_/g, ' '),
      statusTone:
        w.status === 'COMPLETED' || w.status === 'APPROVED'
          ? 'positive'
          : w.status === 'REJECTED' || w.status === 'FAILED'
            ? 'negative'
            : 'pending',
      referenceId: w.id.toUpperCase(),
      createdAt: w.createdAt,
      isSandboxSample: false,
    });
  }

  for (const t of trades) {
    liveRows.push({
      id: `trd-${t.id}`,
      category: 'trade',
      typeLabel: t.side === 'buy' ? 'Spot Buy' : 'Spot Sell',
      assetSymbol: t.baseAsset,
      description: `${t.pairSymbol} @ ${t.executedPrice}`,
      amountDisplay: `${t.side === 'buy' ? '+' : '-'}${t.baseQuantity} ${t.baseAsset}`,
      status: 'Settled',
      statusTone: 'positive',
      referenceId: t.venueTradeId,
      createdAt: t.createdAt,
      isSandboxSample: false,
    });
  }

  for (const tx of ledgerTransactions) {
    if (tx.type === 'adjustment' || tx.type === 'reversal') {
      liveRows.push({
        id: `ltx-${tx.id}`,
        category: 'transfer',
        typeLabel: tx.type === 'reversal' ? 'Reversal' : 'Adjustment',
        assetSymbol: 'USDT',
        description: tx.summary,
        amountDisplay: tx.sourceAccount,
        status: 'Recorded',
        statusTone: 'neutral',
        referenceId: tx.referenceId,
        createdAt: tx.createdAt,
        isSandboxSample: false,
      });
    }
  }

  const hasLiveHistory = liveRows.length > 0;
  const sourceRows = hasLiveHistory
    ? liveRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : useSandboxSampleWhenEmpty
      ? buildSandboxSampleActivity(nowMs)
      : [];

  const filtered = filter === 'all' ? sourceRows : sourceRows.filter((r) => r.category === filter);
  return {
    rows: filtered,
    isSandboxSample: !hasLiveHistory && useSandboxSampleWhenEmpty,
  };
}

export interface GlobalSearchResult {
  id: string;
  group: 'Markets' | 'Workspace';
  label: string;
  subtitle: string;
  to: string;
}

const WORKSPACE_SEARCH_TARGETS: Array<{ label: string; subtitle: string; to: string; keywords: string }> = [
  { label: 'Overview', subtitle: 'Portfolio & exchange summary', to: '/overview', keywords: 'overview home dashboard portfolio' },
  { label: 'Markets', subtitle: 'All spot pairs & live quotes', to: '/markets', keywords: 'markets tickers prices crypto' },
  { label: 'Spot Trade', subtitle: 'Order book & market execution', to: '/trade', keywords: 'trade buy sell orderbook spot' },
  { label: 'Wallets', subtitle: 'Asset balances & custody overview', to: '/wallets', keywords: 'wallets balances assets holdings' },
  { label: 'Deposit', subtitle: 'Deposit assets & network config', to: '/deposit', keywords: 'deposit receive address custody' },
  { label: 'Withdraw', subtitle: 'Submit 2FA withdrawal request', to: '/withdraw', keywords: 'withdraw send transfer payout' },
  { label: 'Transactions', subtitle: 'Ledger history & audit trail', to: '/transactions', keywords: 'transactions ledger history activity' },
  { label: 'Settings', subtitle: 'Security, 2FA & preferences', to: '/settings', keywords: 'settings profile security 2fa password' },
  { label: 'KYC Verification', subtitle: 'Compliance & identity screening', to: '/kyc', keywords: 'kyc identity compliance verification' },
];

export function buildGlobalSearchMatches(params: {
  query: string;
  marketPrices: MarketPrice[];
  assets: Asset[];
}): GlobalSearchResult[] {
  const q = params.query.trim().toLowerCase();
  if (!q) return [];

  const assetMap = new Map(params.assets.map((a) => [a.symbol, a]));
  const results: GlobalSearchResult[] = [];

  for (const mp of params.marketPrices) {
    const base = mp.symbol.split('/')[0];
    const asset = assetMap.get(base);
    const assetName = asset?.name ?? base;
    if (
      mp.symbol.toLowerCase().includes(q) ||
      base.toLowerCase().includes(q) ||
      assetName.toLowerCase().includes(q)
    ) {
      results.push({
        id: `mkt-${mp.symbol}`,
        group: 'Markets',
        label: mp.symbol,
        subtitle: `${assetName} · Spot Market`,
        to: `/markets/${encodeURIComponent(mp.symbol)}`,
      });
    }
  }

  for (const item of WORKSPACE_SEARCH_TARGETS) {
    if (
      item.label.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.keywords.includes(q)
    ) {
      results.push({
        id: `nav-${item.to}`,
        group: 'Workspace',
        label: item.label,
        subtitle: item.subtitle,
        to: item.to,
      });
    }
  }

  return results.slice(0, 8);
}

export function timeframeSummaryText(tf: PortfolioChartTimeframe | MarketTimeframe): string {
  switch (tf) {
    case '24H':
      return 'Past 24 hours';
    case '7D':
      return 'Past 7 days';
    case '30D':
      return 'Past 30 days';
    case '90D':
      return 'Past 90 days';
    case 'ALL':
      return 'Since sandbox inception';
    default:
      return String(tf);
  }
}

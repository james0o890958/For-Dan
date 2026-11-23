import type { Asset, LedgerTransaction, MarketPrice, WalletBalance } from '../types/domain';
import { roundAmount } from './tradingMath';

export interface WalletAssetRow {
  symbol: string;
  name: string;
  badgeColor: string;
  available: number;
  reserved: number;
  total: number;
  priceUsdt: number;
  valueUsdt: number;
  change24hPct: number;
  hasBalance: boolean;
  isReferencePrice: boolean;
}

export function filterAndSortWalletAssets(params: {
  balances: WalletBalance[];
  assets: Asset[];
  marketPrices: MarketPrice[];
  searchQuery?: string;
  hideZeroBalances?: boolean;
  sortField?: 'symbol' | 'value' | 'change';
  sortDirection?: 'asc' | 'desc';
}): WalletAssetRow[] {
  const {
    balances,
    assets,
    marketPrices,
    searchQuery = '',
    hideZeroBalances = false,
    sortField = 'value',
    sortDirection = 'desc',
  } = params;

  const assetMap = new Map(assets.map((a) => [a.symbol, a]));
  const marketMap = new Map(marketPrices.map((m) => [m.symbol, m]));
  const balanceMap = new Map(balances.map((b) => [b.assetSymbol, b]));

  const allSymbols = Array.from(
    new Set([...assets.map((a) => a.symbol), ...balances.map((b) => b.assetSymbol), 'USDT'])
  );

  const q = searchQuery.trim().toLowerCase();

  let rows: WalletAssetRow[] = allSymbols.map((sym) => {
    const assetMeta = assetMap.get(sym);
    const bal = balanceMap.get(sym);
    const available = bal?.available ?? 0;
    const reserved = bal?.reserved ?? 0;
    const total = roundAmount(available + reserved, 8);

    const mkt = marketMap.get(`${sym}/USDT`);
    const isUsdt = sym === 'USDT';
    const priceUsdt = isUsdt ? 1 : mkt && mkt.price > 0 ? mkt.price : 0;
    const change24hPct = isUsdt ? 0 : mkt ? mkt.change24hPct : 0;
    const valueUsdt = roundAmount(total * priceUsdt, 2);

    return {
      symbol: sym,
      name: assetMeta?.name ?? sym,
      badgeColor: assetMeta?.badgeColor ?? '#004AE2',
      available,
      reserved,
      total,
      priceUsdt,
      valueUsdt,
      change24hPct,
      hasBalance: total > 0,
      isReferencePrice: !isUsdt && (!mkt || mkt.price <= 0),
    };
  });

  if (hideZeroBalances) {
    rows = rows.filter((r) => r.hasBalance);
  }

  if (q) {
    rows = rows.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
    );
  }

  const factor = sortDirection === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    if (sortField === 'symbol') {
      return a.symbol.localeCompare(b.symbol) * factor;
    }
    if (sortField === 'change') {
      return (a.change24hPct - b.change24hPct) * factor;
    }
    return (a.valueUsdt - b.valueUsdt) * factor;
  });

  return rows;
}

export function filterTransactionsByAssetAndType(params: {
  transactions: LedgerTransaction[];
  assetSymbol?: string;
  typeFilter?: string;
  searchQuery?: string;
}): LedgerTransaction[] {
  const { transactions, assetSymbol = 'ALL', typeFilter = 'ALL', searchQuery = '' } = params;
  const q = searchQuery.trim().toLowerCase();

  return transactions.filter((tx) => {
    if (assetSymbol !== 'ALL') {
      const matchesSummary = tx.summary.toUpperCase().includes(assetSymbol.toUpperCase());
      const matchesSource = tx.sourceAccount.toUpperCase().includes(assetSymbol.toUpperCase());
      if (!matchesSummary && !matchesSource) return false;
    }
    if (typeFilter !== 'ALL' && tx.type !== typeFilter) {
      return false;
    }
    if (q) {
      const matchesSummary = tx.summary.toLowerCase().includes(q);
      const matchesRef = tx.referenceId.toLowerCase().includes(q);
      const matchesSource = tx.sourceAccount.toLowerCase().includes(q);
      if (!matchesSummary && !matchesRef && !matchesSource) return false;
    }
    return true;
  });
}

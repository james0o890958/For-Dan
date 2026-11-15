import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  ChangeBadge,
  CoinAvatar,
  EmptyState,
  MarketFeedLabel,
  SearchInput,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { formatCryptoPrice } from '../../utils/tradingMath';

export const MarketsPage: React.FC = () => {
  const { marketPrices, tradingPairs, assets, marketSettings } = useAppState();
  const [search, setSearch] = useState('');

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.symbol, a])), [assets]);
  const pairMap = useMemo(() => new Map(tradingPairs.map((p) => [p.symbol, p])), [tradingPairs]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return marketPrices.filter((mp) => {
      const base = mp.symbol.split('/')[0];
      const asset = assetMap.get(base);
      const pair = pairMap.get(mp.symbol);
      if (pair && !pair.isEnabled) return false;
      if (asset && !asset.isEnabled) return false;
      return (
        mp.symbol.toLowerCase().includes(q) ||
        (asset?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [marketPrices, search, assetMap, pairMap]);

  return (
    <CustomerLayout title="Markets">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search keywords"
            ariaLabel="Search trading pairs"
            className="w-full sm:w-96"
          />
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <MarketFeedLabel status={marketSettings.providerStatus} />
            <span className="text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
              {marketSettings.providerName}
            </span>
          </div>
        </div>

        {marketSettings.providerStatus === 'unavailable' && (
          <div className="rounded-xl bg-[#D97706]/10 border border-[#D97706]/40 px-4 py-3 text-xs text-[#D97706]">
            Live market data feed is currently <strong>offline</strong>. Spot order execution is blocked until real venue quotes are streaming.
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title="No matching markets"
            description="Try searching another symbol such as BTC, ETH, or SOL."
          />
        ) : (
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-3 bg-[#E8EAEE] dark:bg-[#262629] text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
              <div className="col-span-5">Name</div>
              <div className="col-span-4">MarketPrice</div>
              <div className="col-span-3 text-right">Change</div>
            </div>
            <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
              {rows.map((mp) => {
                const base = mp.symbol.split('/')[0];
                const asset = assetMap.get(base);
                const unavailable = mp.price <= 0;
                return (
                  <Link
                    key={mp.symbol}
                    to={`/markets/${encodeURIComponent(mp.symbol)}`}
                    className="grid grid-cols-12 items-center px-4 py-3.5 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] transition-colors"
                  >
                    <div className="col-span-5 flex items-center gap-3 min-w-0">
                      <CoinAvatar symbol={base} color={asset?.badgeColor} size="sm" />
                      <div className="truncate">
                        <span className="font-semibold text-sm text-[#111214] dark:text-white">
                          {base}
                        </span>
                        <span className="text-xs text-[#686D76] dark:text-[#7E828A]">/USDT</span>
                        <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] hidden sm:block">
                          {asset?.name}
                        </p>
                      </div>
                    </div>

                    <div className="col-span-4 min-w-0">
                      <p className="font-mono-num text-sm font-semibold">
                        {unavailable ? 'Feed Offline' : formatCryptoPrice(mp.price)}
                      </p>
                      <p className="font-mono-num text-[10px] sm:text-[11px] text-[#686D76] dark:text-[#7E828A] whitespace-nowrap truncate">
                        24H {unavailable ? '—' : mp.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </p>
                    </div>

                    <div className="col-span-3 flex justify-end">
                      <ChangeBadge changePct={mp.change24hPct} unavailable={unavailable} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </CustomerLayout>
  );
};

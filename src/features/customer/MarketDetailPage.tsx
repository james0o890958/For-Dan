import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  ChangeBadge,
  CoinAvatar,
  EmptyState,
  MarketFeedLabel,
} from '../../components/ui/CommonPrimitives';
import { PriceChart } from '../../components/ui/PriceChart';
import { useAppState } from '../../context/AppStateContext';
import { formatCryptoPrice } from '../../utils/tradingMath';

export const MarketDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const decodedSymbol = symbol ? decodeURIComponent(symbol) : 'BTC/USDT';

  const { marketPrices, tradingPairs, assets, marketSettings } = useAppState();
  const market = marketPrices.find((m) => m.symbol === decodedSymbol);
  const pair = tradingPairs.find((p) => p.symbol === decodedSymbol);
  const base = decodedSymbol.split('/')[0];
  const asset = assets.find((a) => a.symbol === base);

  if (!market || !pair) {
    return (
      <CustomerLayout title="Market Details">
        <EmptyState
          title="Trading pair not found"
          description={`No market record found for ${decodedSymbol}.`}
          action={
            <Link
              to="/markets"
              className="inline-flex px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Back to Markets
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  const unavailable = market.price <= 0;

  return (
    <CustomerLayout title={decodedSymbol}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/markets')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Markets</span>
          </button>
          <MarketFeedLabel status={marketSettings.providerStatus} />
        </div>

        {/* Pair Summary Card */}
        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            <CoinAvatar symbol={base} color={asset?.badgeColor} />
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold">{decodedSymbol}</h2>
                <ChangeBadge changePct={market.change24hPct} unavailable={unavailable} />
              </div>
              <p className="text-xs text-[#686D76] dark:text-[#7E828A] mt-0.5">
                {asset?.name} · Spot Market ({pair.venueSymbol})
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono-num">
            <div>
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">Last Price</p>
              <p className="text-base font-bold">
                {unavailable ? 'Feed Offline' : `${formatCryptoPrice(market.price)} USDT`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">24H High</p>
              <p className="text-sm font-semibold">
                {unavailable ? '—' : formatCryptoPrice(market.high24h)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">24H Low</p>
              <p className="text-sm font-semibold">
                {unavailable ? '—' : formatCryptoPrice(market.low24h)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">24H Volume</p>
              <p className="text-sm font-semibold">
                {unavailable
                  ? '—'
                  : `${market.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${base}`}
              </p>
            </div>
          </div>
        </div>

        {/* Interactive Chart */}
        <PriceChart
          symbol={decodedSymbol}
          candles={market.candles}
          currentPrice={market.price}
          changePct={market.change24hPct}
        />

        {/* Pair Info & Direct Trade Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-3">
            <h3 className="text-sm font-semibold">Trading Pair Specification</h3>
            <p className="text-xs text-[#686D76] dark:text-[#7E828A] leading-relaxed">
              {asset?.description}
            </p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 text-xs">
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Trading Fee Rate</dt>
                <dd className="font-mono-num font-semibold mt-0.5">
                  {(pair.feeRate * 100).toFixed(2)}%
                </dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Minimum Order</dt>
                <dd className="font-mono-num font-semibold mt-0.5">{pair.minOrderUsdt} USDT</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Order Routing</dt>
                <dd className="font-semibold mt-0.5">Market Order</dd>
              </div>
            </dl>
          </div>

          <div className="lg:col-span-5 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-col justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Spot Order Execution</h3>
              <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A]">
                Open the spot trading terminal pre-selected with {decodedSymbol}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to={`/trade?pair=${encodeURIComponent(decodedSymbol)}&side=buy`}
                className="py-3 rounded-full bg-[#10C478] text-white text-sm font-semibold text-center hover:opacity-95"
              >
                Buy {base}
              </Link>
              <Link
                to={`/trade?pair=${encodeURIComponent(decodedSymbol)}&side=sell`}
                className="py-3 rounded-full bg-[#F0525E] text-white text-sm font-semibold text-center hover:opacity-95"
              >
                Sell {base}
              </Link>
            </div>
            <Link
              to={`/trade?pair=${encodeURIComponent(decodedSymbol)}`}
              className="inline-flex items-center justify-center gap-2 text-xs font-medium text-[#004AE2] dark:text-[#60A5FA]"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Open Spot Terminal</span>
            </Link>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};

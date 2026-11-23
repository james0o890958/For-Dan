import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, Star } from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  ChangeBadge,
  CoinAvatar,
  EmptyState,
  MarketFeedLabel,
} from '../../components/ui/CommonPrimitives';
import { OrderBook } from '../../components/ui/OrderBook';
import { PriceChart } from '../../components/ui/PriceChart';
import { TradeHistoryPanel } from '../../components/ui/TradeHistoryPanel';
import { useAppState } from '../../context/AppStateContext';
import { formatCompactVolume, quoteSourceLabelText } from '../../utils/marketsModel';
import {
  formatMarketPriceDisplay,
  SANDBOX_REFERENCE_MARKETS,
  type MarketQuoteSource,
} from '../../utils/overviewModel';
import { roundAmount } from '../../utils/tradingMath';

export const MarketDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const decodedSymbol = symbol ? decodeURIComponent(symbol).toUpperCase() : 'BTC/USDT';

  const {
    marketPrices,
    tradingPairs,
    assets,
    networks,
    marketSettings,
    marketFeedIsCached,
    isWatchlisted,
    toggleWatchlist,
  } = useAppState();

  const market = marketPrices.find((m) => m.symbol === decodedSymbol);
  const pair = tradingPairs.find((p) => p.symbol === decodedSymbol);
  const base = decodedSymbol.split('/')[0];
  const asset = assets.find((a) => a.symbol === base);
  const assetNetworks = networks.filter((n) => n.assetSymbol === base);

  if (!market || !pair) {
    return (
      <CustomerLayout title="Market Details">
        <EmptyState
          title="Trading pair not found"
          description={`No market record found for ${decodedSymbol}.`}
          action={
            <Link
              to="/markets"
              className="inline-flex px-5 py-2.5 rounded-lg bg-[#004AE2] text-white text-sm font-semibold"
            >
              Back to Markets
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  const refQuote = SANDBOX_REFERENCE_MARKETS[decodedSymbol];
  const hasLiveTicker = market.price > 0;
  const displayPrice = hasLiveTicker ? market.price : (refQuote?.price ?? 0);
  const displayChange = hasLiveTicker ? market.change24hPct : (refQuote?.change24hPct ?? 0);
  const displayHigh = hasLiveTicker ? market.high24h : (refQuote?.high24h ?? 0);
  const displayLow = hasLiveTicker ? market.low24h : (refQuote?.low24h ?? 0);
  const displayVol = hasLiveTicker ? market.volume24h : (refQuote?.volume24h ?? 0);
  const displayQuoteVol = roundAmount(displayVol * displayPrice, 2);

  const quoteSource: MarketQuoteSource = hasLiveTicker
    ? marketFeedIsCached || market.dataStatus === 'delayed'
      ? 'cached'
      : 'live'
    : refQuote
      ? 'reference'
      : 'unavailable';

  const watchlisted = isWatchlisted(decodedSymbol);

  return (
    <CustomerLayout
      title={decodedSymbol}
      subtitle={`${asset?.name ?? base} · ${quoteSourceLabelText(quoteSource)}`}
      actions={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => toggleWatchlist(decodedSymbol)}
            aria-pressed={watchlisted}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              watchlisted
                ? 'border-[#F59E0B]/60 bg-[#F59E0B]/10 text-[#F59E0B]'
                : 'border-[#D4D7DF] dark:border-[#2A2C34] bg-[#F4F5F7] dark:bg-[#1B1D22] text-[#4B5059] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${watchlisted ? 'fill-[#F59E0B] text-[#F59E0B]' : ''}`} aria-hidden="true" />
            <span>{watchlisted ? 'Watchlisted' : 'Add to Watchlist'}</span>
          </button>

          <Link
            to={`/trade?pair=${encodeURIComponent(decodedSymbol)}`}
            state={{ selectedPair: decodedSymbol, fromMarkets: true }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#004AE2] hover:bg-[#003ec0] text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Trade {base}</span>
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/markets')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to Markets</span>
          </button>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <MarketFeedLabel status={marketSettings.providerStatus} />
            <span className="text-[#686D76] dark:text-[#7E828A]">
              · {quoteSourceLabelText(quoteSource)}
            </span>
          </div>
        </div>

        {quoteSource === 'reference' && (
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#D97706]/40 px-4 py-3 text-xs text-[#4B5059] dark:text-[#9CA0A8]">
            <strong className="text-[#D97706]">Sandbox Reference Quote</strong> · Live upstream venue feed is offline. Displayed figures and chart curve are illustrative sandbox references and cannot be executed as live spot orders.
          </div>
        )}

        {/* Pair Summary Card */}
        <section
          aria-label={`${decodedSymbol} summary`}
          className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5"
        >
          <div className="flex items-center gap-3.5">
            <CoinAvatar symbol={base} color={asset?.badgeColor} />
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold">{decodedSymbol}</h2>
                <ChangeBadge changePct={displayChange} unavailable={quoteSource === 'unavailable'} />
              </div>
              <p className="text-xs text-[#686D76] dark:text-[#7E828A] mt-0.5">
                {asset?.name} · Spot Market ({pair.venueSymbol})
                {quoteSource !== 'live' ? ` · ${quoteSourceLabelText(quoteSource)}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono-num">
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">
                {quoteSource === 'reference' ? 'Reference Price' : 'Last Price'}
              </p>
              <p className="text-base font-bold">
                {displayPrice > 0 ? `${formatMarketPriceDisplay(displayPrice)} USDT` : 'Feed Offline'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">24H High</p>
              <p className="text-sm font-semibold">
                {displayHigh > 0 ? formatMarketPriceDisplay(displayHigh) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">24H Low</p>
              <p className="text-sm font-semibold">
                {displayLow > 0 ? formatMarketPriceDisplay(displayLow) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-sans text-[#686D76] dark:text-[#7E828A]">24H Volume</p>
              <p className="text-sm font-semibold">
                {displayVol > 0 ? `${formatCompactVolume(displayVol)} ${base}` : '—'}
              </p>
              {displayQuoteVol > 0 && (
                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                  ${formatCompactVolume(displayQuoteVol)} USDT
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Chart + Live Order Book */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-8">
            <PriceChart
              symbol={decodedSymbol}
              candles={market.candles}
              currentPrice={market.price}
              changePct={displayChange}
              allowIllustrativeFallback={true}
              fallbackReferencePrice={displayPrice}
              fallbackChangePct={displayChange}
            />
          </div>
          <div className="lg:col-span-4">
            <OrderBook symbol={decodedSymbol} currentPrice={market.price} />
          </div>
        </div>

        {/* Recent Market Trades Tape */}
        <TradeHistoryPanel symbol={decodedSymbol} showAccountTabs={false} />

        {/* Asset Information, Custody Networks & Trade Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <section
            aria-label="Asset specifications and networks"
            className="lg:col-span-7 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <div>
              <h3 className="text-sm font-semibold">About {asset?.name ?? base} ({base})</h3>
              <p className="mt-1.5 text-xs text-[#686D76] dark:text-[#7E828A] leading-relaxed">
                {asset?.description}
              </p>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-[#E2E4E9] dark:border-[#22242A] text-xs">
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
                <dt className="text-[#686D76] dark:text-[#7E828A]">Asset Precision</dt>
                <dd className="font-mono-num font-semibold mt-0.5">{asset?.decimals ?? 8} decimals</dd>
              </div>
              <div>
                <dt className="text-[#686D76] dark:text-[#7E828A]">Quote Feed</dt>
                <dd className="font-semibold mt-0.5">{quoteSourceLabelText(quoteSource)}</dd>
              </div>
            </dl>

            {assetNetworks.length > 0 && (
              <div className="pt-3 border-t border-[#E2E4E9] dark:border-[#22242A] space-y-2">
                <h4 className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                  Supported Custody Networks
                </h4>
                <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E2026]">
                  {assetNetworks.map((net) => (
                    <div
                      key={net.id}
                      className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-medium text-[#111214] dark:text-[#F4F5F7]">
                          {net.name}
                        </span>
                        <span className="text-[#686D76] dark:text-[#7E828A]">
                          {' · '}{net.requiredConfirmations} confirmations
                        </span>
                      </div>
                      <span className="font-mono-num text-[11px] text-[#686D76] dark:text-[#9CA0A8]">
                        Min Dep {net.minDeposit} {base} · Min Wd {net.minWithdrawal} {base}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section
            aria-label="Trade navigation"
            className="lg:col-span-5 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">Spot Trading Workspace</h3>
              <p className="text-xs text-[#686D76] dark:text-[#7E828A] leading-relaxed">
                Open the spot terminal pre-configured with {decodedSymbol}. Order execution requires authentication, approved KYC, and active live feed pricing.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to={`/trade?pair=${encodeURIComponent(decodedSymbol)}&side=buy`}
                state={{ selectedPair: decodedSymbol, side: 'buy', fromMarkets: true }}
                className="py-2.5 rounded-lg bg-[#10C478] text-white text-sm font-semibold text-center hover:opacity-95 transition-opacity"
              >
                Buy {base}
              </Link>
              <Link
                to={`/trade?pair=${encodeURIComponent(decodedSymbol)}&side=sell`}
                state={{ selectedPair: decodedSymbol, side: 'sell', fromMarkets: true }}
                className="py-2.5 rounded-lg bg-[#F0525E] text-white text-sm font-semibold text-center hover:opacity-95 transition-opacity"
              >
                Sell {base}
              </Link>
            </div>
            <Link
              to={`/trade?pair=${encodeURIComponent(decodedSymbol)}`}
              state={{ selectedPair: decodedSymbol, fromMarkets: true }}
              className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#D4D7DF] dark:border-[#2A2C34] text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA] hover:bg-[#F4F5F7] dark:hover:bg-[#1B1D22] transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Open {decodedSymbol} in Spot Terminal</span>
            </Link>
          </section>
        </div>
      </div>
    </CustomerLayout>
  );
};

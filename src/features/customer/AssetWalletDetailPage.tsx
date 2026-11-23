import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, RefreshCw, TrendingUp } from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { CoinAvatar, EmptyState } from '../../components/ui/CommonPrimitives';
import { PriceChart } from '../../components/ui/PriceChart';
import { useAppState } from '../../context/AppStateContext';
import {
  formatCryptoPrice,
  formatQty,
  formatUsdt,
  roundAmount,
} from '../../utils/tradingMath';
import { SANDBOX_REFERENCE_MARKETS } from '../../utils/overviewModel';

export const AssetWalletDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const decodedSymbol = decodeURIComponent(symbol ?? '').toUpperCase();

  const {
    currentProfile,
    assets,
    currentUserBalances,
    currentUserTransactions,
    marketPrices,
    marketLoading,
    refreshMarketTickers,
  } = useAppState();

  const assetMeta = assets.find((a) => a.symbol === decodedSymbol);
  const pairSymbol = `${decodedSymbol}/USDT`;

  const marketPriceObj = marketPrices.find((m) => m.symbol === pairSymbol);
  const refMarket = SANDBOX_REFERENCE_MARKETS[pairSymbol];

  const hasLivePrice = marketPriceObj && marketPriceObj.price > 0;
  const priceUsdt = decodedSymbol === 'USDT' ? 1 : hasLivePrice ? marketPriceObj.price : (refMarket?.price ?? 0);
  const change24hPct = decodedSymbol === 'USDT' ? 0 : hasLivePrice ? marketPriceObj.change24hPct : (refMarket?.change24hPct ?? 0);

  const balanceRow = currentUserBalances.find((b) => b.assetSymbol === decodedSymbol);
  const available = balanceRow?.available ?? 0;
  const reserved = balanceRow?.reserved ?? 0;
  const total = roundAmount(available + reserved, 8);
  const estimatedUsdtValue = roundAmount(total * priceUsdt, 2);

  const assetTransactions = useMemo(() => {
    return currentUserTransactions.filter(
      (tx) =>
        tx.summary.toUpperCase().includes(decodedSymbol) ||
        tx.sourceAccount.toUpperCase().includes(decodedSymbol)
    );
  }, [currentUserTransactions, decodedSymbol]);

  if (!assetMeta && decodedSymbol !== 'USDT') {
    return (
      <CustomerLayout title="Asset Wallet">
        <EmptyState
          title="Asset not found"
          description={`The symbol "${decodedSymbol}" is not recognized in the exchange catalog.`}
          action={
            <Link
              to="/wallets"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Wallets</span>
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  const assetName = assetMeta?.name ?? (decodedSymbol === 'USDT' ? 'Tether USD' : decodedSymbol);
  const badgeColor = assetMeta?.badgeColor ?? '#004AE2';

  return (
    <CustomerLayout title={`${decodedSymbol} Wallet`}>
      <div className="space-y-6">
        {/* Top Navigation & Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/wallets"
              aria-label="Back to wallets"
              className="p-2 rounded-xl bg-[#E8EAEE] dark:bg-[#242528] text-[#111214] dark:text-white hover:opacity-90"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-3">
              <CoinAvatar symbol={decodedSymbol} color={badgeColor} size="md" />
              <div>
                <h1 className="text-xl font-bold text-[#111214] dark:text-[#F4F5F7] flex items-center gap-2">
                  <span>{assetName}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-[#E8EAEE] dark:bg-[#242528] font-mono-num font-semibold">
                    {decodedSymbol}
                  </span>
                </h1>
                <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                  Custody Wallet & Settlement Ledger
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to={`/deposit?asset=${decodedSymbol}`}
              className="px-4 py-2 rounded-full bg-[#004AE2] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#003ec0]"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>Deposit</span>
            </Link>
            <Link
              to={`/withdraw?asset=${decodedSymbol}`}
              className="px-4 py-2 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-[#111214] dark:text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" />
              <span>Withdraw</span>
            </Link>
            {decodedSymbol !== 'USDT' && (
              <Link
                to={`/trade?pair=${encodeURIComponent(pairSymbol)}`}
                className="px-4 py-2 rounded-full bg-[#10C478] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#0eb06b]"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Trade {pairSymbol}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Valuation & Holdings Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Total Holdings</p>
            <p className="mt-2 text-2xl font-bold font-mono-num text-[#111214] dark:text-[#F4F5F7]">
              {formatQty(total)} {decodedSymbol}
            </p>
            <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A]">
              ≈ ${formatUsdt(estimatedUsdtValue)} USDT
            </p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Available Balance</p>
            <p className="mt-2 text-2xl font-bold font-mono-num text-[#10C478]">
              {formatQty(available)} {decodedSymbol}
            </p>
            <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A]">Ready for orders & transfers</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Reserved / Locked</p>
            <p className="mt-2 text-2xl font-bold font-mono-num text-[#D97706]">
              {formatQty(reserved)} {decodedSymbol}
            </p>
            <p className="mt-1 text-xs text-[#686D76] dark:text-[#7E828A]">In open orders / withdrawal hold</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Reference Market Price</p>
              <button
                type="button"
                onClick={() => void refreshMarketTickers()}
                aria-label="Refresh price"
                className="p-1 rounded text-[#686D76]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${marketLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono-num text-[#111214] dark:text-[#F4F5F7]">
              {decodedSymbol === 'USDT' ? '1.00 USDT' : `${formatCryptoPrice(priceUsdt)} USDT`}
            </p>
            <p className={`mt-1 text-xs font-semibold ${change24hPct >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'}`}>
              {change24hPct >= 0 ? '+' : ''}
              {change24hPct.toFixed(2)}% (24H)
            </p>
          </div>
        </div>

        {/* Price Chart Section (for non-USDT pairs) */}
        {decodedSymbol !== 'USDT' && (
          <PriceChart
            symbol={pairSymbol}
            candles={marketPriceObj?.candles ?? []}
            currentPrice={priceUsdt}
            changePct={change24hPct}
            allowIllustrativeFallback={true}
            fallbackReferencePrice={refMarket?.price ?? 100}
            fallbackChangePct={refMarket?.change24hPct ?? 1.5}
          />
        )}

        {/* Recent Asset Transactions */}
        <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#111214] dark:text-[#F4F5F7]">
              Recent Transactions ({decodedSymbol})
            </h2>
            <Link to="/transactions" className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]">
              View All Ledger Records
            </Link>
          </div>

          {assetTransactions.length === 0 ? (
            <div className="py-8 text-center rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-dashed border-[#E2E4E9] dark:border-[#22242A]">
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                No ledger transactions recorded for {decodedSymbol} yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[#E2E4E9] dark:border-[#22242A] text-left text-[#686D76] dark:text-[#7E828A]">
                    <th className="py-2.5 pr-3 font-medium">Type</th>
                    <th className="py-2.5 pr-3 font-medium">Summary</th>
                    <th className="py-2.5 pr-3 font-medium">Reference</th>
                    <th className="py-2.5 font-medium text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                  {assetTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20]">
                      <td className="py-3 pr-3 font-semibold whitespace-nowrap">{tx.type}</td>
                      <td className="py-3 pr-3 text-[#111214] dark:text-[#F4F5F7]">{tx.summary}</td>
                      <td className="py-3 pr-3 font-mono-num text-xs text-[#686D76] dark:text-[#7E828A]">
                        {tx.referenceId}
                      </td>
                      <td className="py-3 text-right font-mono-num text-xs text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </CustomerLayout>
  );
};

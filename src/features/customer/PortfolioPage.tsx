import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { ChangeBadge, CoinAvatar, EmptyState } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import {
  calculatePortfolioSummary,
  formatCryptoPrice,
  formatQty,
  formatUsdt,
} from '../../utils/tradingMath';

export const PortfolioPage: React.FC = () => {
  const { currentProfile, currentUserBalances, marketPrices, assets, hideBalances } = useAppState();

  const summary = useMemo(
    () => calculatePortfolioSummary(currentUserBalances, marketPrices, assets),
    [currentUserBalances, marketPrices, assets]
  );

  if (!currentProfile) {
    return (
      <CustomerLayout title="Portfolio">
        <EmptyState
          title="Sign in to view portfolio"
          description="Inspect your available and reserved balances, spot asset valuation, and portfolio allocation."
          action={
            <Link
              to="/login"
              className="inline-flex px-5 py-2.5 rounded-full bg-[#004AE2] text-white text-sm font-semibold"
            >
              Sign in
            </Link>
          }
        />
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout title="Portfolio">
      <div className="space-y-6">
        {/* Top Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-[#004AE2] text-white p-5">
            <p className="text-xs text-blue-100">Total Portfolio Value</p>
            <p className="mt-2 text-2xl font-bold font-mono-num">
              {hideBalances ? '•••••• USDT' : `${formatUsdt(summary.totalUsdt)} USDT`}
            </p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Available USDT</p>
            <p className="mt-2 text-2xl font-bold font-mono-num">
              {hideBalances ? '••••••' : `${formatUsdt(summary.availableUsdt)} USDT`}
            </p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Reserved USDT</p>
            <p className="mt-2 text-2xl font-bold font-mono-num">
              {hideBalances ? '••••••' : `${formatUsdt(summary.reservedUsdt)} USDT`}
            </p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5">
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">Spot Asset Valuation</p>
            <p className="mt-2 text-2xl font-bold font-mono-num">
              {hideBalances ? '••••••' : `${formatUsdt(summary.cryptoValueUsdt)} USDT`}
            </p>
          </div>
        </div>

        {/* Allocation Bar */}
        <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Asset Allocation</h2>
            <Link to="/trade" className="text-xs font-semibold text-[#004AE2] dark:text-[#60A5FA]">
              Spot Trade
            </Link>
          </div>

          {summary.totalUsdt > 0 ? (
            <>
              <div className="h-3.5 w-full rounded-full overflow-hidden flex bg-[#E8EAEE] dark:bg-[#242528]">
                {summary.holdings.map((h) => (
                  <div
                    key={h.symbol}
                    style={{
                      width: `${Math.max(h.allocationPct, 0.5)}%`,
                      backgroundColor: h.badgeColor,
                    }}
                    title={`${h.symbol}: ${h.allocationPct}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                {summary.holdings.map((h) => (
                  <div key={h.symbol} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: h.badgeColor }}
                      aria-hidden="true"
                    />
                    <span className="font-semibold">{h.symbol}</span>
                    <span className="font-mono-num text-[#686D76] dark:text-[#7E828A]">
                      {h.allocationPct.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
              Your account currently holds 0.00 available and 0.00 reserved balances. Complete KYC verification and deposit supported assets to fund your wallet.
            </p>
          )}
        </section>

        {/* Individual Asset Breakdown */}
        <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2E4E9] dark:border-[#22242A]">
            <h2 className="text-base font-semibold">Asset Holdings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                  <th className="py-3 px-4 font-medium">Asset</th>
                  <th className="py-3 px-4 font-medium text-right">Available</th>
                  <th className="py-3 px-4 font-medium text-right">Reserved</th>
                  <th className="py-3 px-4 font-medium text-right">Market Price</th>
                  <th className="py-3 px-4 font-medium text-right">Value (USDT)</th>
                  <th className="py-3 px-4 font-medium text-right">Allocation</th>
                  <th className="py-3 px-4 font-medium text-right">24h Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                {summary.holdings.map((h) => {
                  const unavailable = h.symbol !== 'USDT' && h.priceUsdt <= 0;
                  return (
                    <tr key={h.symbol} className="hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20]">
                      <td className="py-3.5 px-4 font-sans">
                        <div className="flex items-center gap-3">
                          <CoinAvatar symbol={h.symbol} color={h.badgeColor} size="sm" />
                          <div>
                            <p className="font-semibold">{h.symbol}</p>
                            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">{h.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold">
                        {hideBalances ? '••••' : formatQty(h.available)}
                      </td>
                      <td className="py-3.5 px-4 text-right text-[#686D76] dark:text-[#7E828A]">
                        {hideBalances ? '••••' : formatQty(h.reserved)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {h.symbol === 'USDT'
                          ? '1.00'
                          : unavailable
                            ? 'Offline'
                            : formatCryptoPrice(h.priceUsdt)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold">
                        {hideBalances ? '••••' : formatUsdt(h.valueUsdt)}
                      </td>
                      <td className="py-3.5 px-4 text-right">{h.allocationPct.toFixed(2)}%</td>
                      <td className="py-3.5 px-4 text-right">
                        {h.symbol === 'USDT' ? (
                          <span className="text-[#686D76] dark:text-[#7E828A]">0.00%</span>
                        ) : (
                          <ChangeBadge
                            changePct={h.change24hPct}
                            variant="text"
                            unavailable={unavailable}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </CustomerLayout>
  );
};

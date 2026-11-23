import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import type { PublicMarketTrade, SpotOrder, Trade, TradeSide } from '../../types/domain';
import { formatCryptoPrice, formatQty, formatUsdt } from '../../utils/tradingMath';
import { partitionSpotOrders } from '../../utils/tradingWorkspace';

type HistoryTab = 'market_trades' | 'open_orders' | 'order_history' | 'my_trades';

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export const TradeHistoryPanel: React.FC<{
  symbol: string;
  showAccountTabs?: boolean;
  userTrades?: Trade[];
  userOrders?: SpotOrder[];
  isAuthenticated?: boolean;
  onSelectPrice?: (price: number, side: TradeSide) => void;
}> = ({
  symbol,
  showAccountTabs = true,
  userTrades = [],
  userOrders = [],
  isAuthenticated = false,
  onSelectPrice,
}) => {
  const [activeTab, setActiveTab] = useState<HistoryTab>('market_trades');
  const [pairFilter, setPairFilter] = useState<'current' | 'all'>('all');
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all');

  const [marketTrades, setMarketTrades] = useState<PublicMarketTrade[] | null>(null);
  const [tradesIsCached, setTradesIsCached] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadMarketTrades = useCallback(
    async (signal?: AbortSignal) => {
      if (!symbol) return;
      try {
        const res = await fetch(
          `/api/markets/${encodeURIComponent(symbol)}/trades?limit=30`,
          { signal }
        );
        const body = (await res.json()) as {
          ok?: boolean;
          message?: string;
          data?: { trades?: PublicMarketTrade[]; isCached?: boolean };
        };
        if (!res.ok || !body.ok || !Array.isArray(body.data?.trades)) {
          throw new Error(body.message || 'Unable to load recent market trades.');
        }
        setMarketTrades(body.data.trades);
        setTradesIsCached(Boolean(body.data.isCached));
        setError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Market trades stream unavailable.');
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [symbol]
  );

  useEffect(() => {
    setMarketTrades(null);
    setTradesIsCached(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    void loadMarketTrades(controller.signal);

    const timer = window.setInterval(() => {
      void loadMarketTrades();
    }, 4000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadMarketTrades]);

  const filteredUserTrades = useMemo(() => {
    return userTrades.filter((t) => {
      if (pairFilter === 'current' && t.pairSymbol !== symbol) return false;
      if (sideFilter !== 'all' && t.side !== sideFilter) return false;
      return true;
    });
  }, [userTrades, pairFilter, sideFilter, symbol]);

  const filteredUserOrders = useMemo(() => {
    return userOrders.filter((o) => {
      if (pairFilter === 'current' && o.pairSymbol !== symbol) return false;
      if (sideFilter !== 'all' && o.side !== sideFilter) return false;
      return true;
    });
  }, [userOrders, pairFilter, sideFilter, symbol]);

  const { openOrders: allOpenOrders, orderHistory: allOrderHistory } = useMemo(
    () => partitionSpotOrders(userOrders),
    [userOrders]
  );

  const filteredOpenOrders = useMemo(
    () => partitionSpotOrders(filteredUserOrders).openOrders,
    [filteredUserOrders]
  );

  const filteredOrderHistory = useMemo(
    () => partitionSpotOrders(filteredUserOrders).orderHistory,
    [filteredUserOrders]
  );

  const baseAsset = symbol.split('/')[0] || 'ASSET';

  return (
    <section
      data-testid="trade-history-panel"
      aria-label="Orders and Trade History"
      className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E4E9] dark:border-[#22242A] pb-3">
        {showAccountTabs ? (
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Trade history views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'market_trades'}
              onClick={() => setActiveTab('market_trades')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'market_trades'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              Market Trades ({symbol})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'open_orders'}
              onClick={() => setActiveTab('open_orders')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'open_orders'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              Open Orders ({allOpenOrders.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'order_history'}
              onClick={() => setActiveTab('order_history')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'order_history'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              Order History ({allOrderHistory.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'my_trades'}
              onClick={() => setActiveTab('my_trades')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'my_trades'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              Trade History ({userTrades.length})
            </button>
          </div>
        ) : (
          <div>
            <h2 className="text-sm font-semibold text-[#111214] dark:text-[#F4F5F7]">
              Recent Market Trades · {symbol}
            </h2>
            <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
              {marketTrades && marketTrades.length > 0
                ? tradesIsCached
                  ? 'Public Venue Reference Tape · Cached'
                  : 'Public Venue Reference Tape · Non-custodial'
                : 'External Market Feed'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {showAccountTabs && activeTab !== 'market_trades' && (
            <>
              <div className="flex items-center gap-1 bg-[#E8EAEE] dark:bg-[#242528] p-0.5 rounded-md">
                <button
                  type="button"
                  onClick={() => setPairFilter('all')}
                  className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap ${
                    pairFilter === 'all'
                      ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                      : 'text-[#686D76] dark:text-[#9CA0A8]'
                  }`}
                >
                  All Pairs
                </button>
                <button
                  type="button"
                  onClick={() => setPairFilter('current')}
                  className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap ${
                    pairFilter === 'current'
                      ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                      : 'text-[#686D76] dark:text-[#9CA0A8]'
                  }`}
                >
                  {symbol}
                </button>
              </div>

              <div className="flex items-center gap-1 bg-[#E8EAEE] dark:bg-[#242528] p-0.5 rounded-md">
                {(['all', 'buy', 'sell'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSideFilter(s)}
                    className={`px-2 py-1 rounded text-[11px] font-medium capitalize whitespace-nowrap ${
                      sideFilter === s
                        ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                        : 'text-[#686D76] dark:text-[#9CA0A8]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {(!showAccountTabs || activeTab === 'market_trades') && (
            <div className="flex items-center gap-2">
              {showAccountTabs && marketTrades && marketTrades.length > 0 && (
                <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                  {tradesIsCached ? 'Public Venue Tape · Cached' : 'Public Venue Reference Tape'}
                </span>
              )}
              <button
                type="button"
                onClick={() => void loadMarketTrades()}
                aria-label="Refresh market trades"
                className="p-1.5 rounded-md bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab 1: Live Public Market Trades Tape */}
      {(!showAccountTabs || activeTab === 'market_trades') && (
        <div data-testid="market-trades-list">
          {loading && !marketTrades ? (
            <p className="py-8 text-center text-xs text-[#686D76] dark:text-[#7E828A]">
              Loading recent {symbol} executions...
            </p>
          ) : !marketTrades || marketTrades.length === 0 ? (
            <div className="py-8 px-4 text-center space-y-2 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-dashed border-[#D4D7DF] dark:border-[#2B2C32]">
              <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                Recent Market Trades Unavailable
              </p>
              <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                {error || 'Live trade tape requires an active market data provider connection.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-[#141518] z-10">
                  <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                    <th className="py-2 pr-3 font-medium">Price (USDT)</th>
                    <th className="py-2 pr-3 font-medium">Side</th>
                    <th className="py-2 pr-3 font-medium text-right">Size ({baseAsset})</th>
                    <th className="py-2 pr-3 font-medium text-right">Total (USDT)</th>
                    <th className="py-2 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                  {marketTrades.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-[#F4F5F7] dark:hover:bg-[#1B1D22] transition-colors"
                    >
                      <td className="py-1.5 pr-3">
                        {onSelectPrice ? (
                          <button
                            type="button"
                            onClick={() => onSelectPrice(t.price, t.side)}
                            className={`font-semibold hover:underline ${
                              t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                            }`}
                          >
                            {formatCryptoPrice(t.price)}
                          </button>
                        ) : (
                          <span
                            className={`font-semibold ${
                              t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                            }`}
                          >
                            {formatCryptoPrice(t.price)}
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-1.5 pr-3 font-sans text-[11px] font-semibold uppercase ${
                          t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {t.side}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{formatQty(t.quantity, 5)}</td>
                      <td className="py-1.5 pr-3 text-right text-[#686D76] dark:text-[#9CA0A8]">
                        {formatUsdt(t.quoteAmount)}
                      </td>
                      <td className="py-1.5 text-right text-[#686D76] dark:text-[#7E828A]">
                        {formatClockTime(t.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Market Trades & Account Order/Trade Tabs */}

      {/* Tab 2: Open Orders */}
      {showAccountTabs && activeTab === 'open_orders' && (
        <div data-testid="open-orders-list">
          {!isAuthenticated ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
                Sign in to view open spot orders. No simulated or fabricated orders are created in guest mode.
              </p>
              <Link
                to="/login"
                className="inline-flex px-4 py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold"
              >
                Sign in
              </Link>
            </div>
          ) : filteredOpenOrders.length === 0 ? (
            <div className="py-8 px-4 text-center rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]">
              <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                No Open Spot Orders
              </p>
              <p className="mt-1 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                Resting limit orders only persist once live OMS and liquidity routing are enabled in Phase D.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Pair</th>
                    <th className="py-2 pr-3 font-medium">Side</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium text-right">Price</th>
                    <th className="py-2 pr-3 font-medium text-right">Amount</th>
                    <th className="py-2 pr-3 font-medium text-right">Filled</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                  {filteredOpenOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2.5 pr-3 text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                        {formatDateTime(o.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3 font-sans font-semibold">{o.pairSymbol}</td>
                      <td
                        className={`py-2.5 pr-3 font-sans font-semibold uppercase ${
                          o.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {o.side}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-[#686D76] dark:text-[#9CA0A8]">
                        {o.orderType}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        {o.limitPrice ? formatCryptoPrice(o.limitPrice) : 'Market'}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        {formatQty(o.requestedAmount)} {o.reservedAsset}
                      </td>
                      <td className="py-2.5 pr-3 text-right">{formatQty(o.filledBaseQty)}</td>
                      <td className="py-2.5 font-sans font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                        {o.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Order History */}
      {showAccountTabs && activeTab === 'order_history' && (
        <div data-testid="order-history-list">
          {!isAuthenticated ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
                Sign in to inspect submitted, filled, and rejected spot order records.
              </p>
              <Link
                to="/login"
                className="inline-flex px-4 py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold"
              >
                Sign in
              </Link>
            </div>
          ) : filteredOrderHistory.length === 0 ? (
            <div className="py-8 px-4 text-center rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]">
              <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                No Spot Order History
              </p>
              <p className="mt-1 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                Submitted or rejected order attempts for this account appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Pair</th>
                    <th className="py-2 pr-3 font-medium">Side</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium text-right">Price</th>
                    <th className="py-2 pr-3 font-medium text-right">Requested</th>
                    <th className="py-2 pr-3 font-medium text-right">Filled Base</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Venue Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                  {filteredOrderHistory.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2.5 pr-3 text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                        {formatDateTime(o.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3 font-sans font-semibold">{o.pairSymbol}</td>
                      <td
                        className={`py-2.5 pr-3 font-sans font-semibold uppercase ${
                          o.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {o.side}
                      </td>
                      <td className="py-2.5 pr-3 font-sans text-[#686D76] dark:text-[#9CA0A8]">
                        {o.orderType}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        {o.limitPrice ? formatCryptoPrice(o.limitPrice) : 'Market'}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        {formatQty(o.requestedAmount)} {o.reservedAsset}
                      </td>
                      <td className="py-2.5 pr-3 text-right">{formatQty(o.filledBaseQty)}</td>
                      <td
                        className={`py-2.5 pr-3 font-sans font-semibold ${
                          o.status === 'FILLED' ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {o.status}
                      </td>
                      <td className="py-2.5 font-sans text-[#686D76] dark:text-[#7E828A]">
                        {o.rejectReason || o.venueOrderId || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Account Settled Trade History */}
      {showAccountTabs && activeTab === 'my_trades' && (
        <div data-testid="my-trade-history-list">
          {!isAuthenticated ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
                Sign in to view your account execution and settlement trade history.
              </p>
              <Link
                to="/login"
                className="inline-flex px-4 py-2 rounded-lg bg-[#004AE2] text-white text-xs font-semibold"
              >
                Sign in
              </Link>
            </div>
          ) : filteredUserTrades.length === 0 ? (
            <div className="py-8 px-4 text-center rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A]">
              <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
                No Settled Account Trades
              </p>
              <p className="mt-1 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                Executed spot fills credited or debited on your ledger will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Pair</th>
                    <th className="py-2 pr-3 font-medium">Side</th>
                    <th className="py-2 pr-3 font-medium text-right">Executed Price</th>
                    <th className="py-2 pr-3 font-medium text-right">Qty</th>
                    <th className="py-2 pr-3 font-medium text-right">Fee (USDT)</th>
                    <th className="py-2 pr-3 font-medium text-right">Total (USDT)</th>
                    <th className="py-2 font-medium text-right">Trade Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                  {filteredUserTrades.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 pr-3 text-[#686D76] dark:text-[#7E828A] whitespace-nowrap">
                        {formatDateTime(t.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3 font-sans font-semibold">{t.pairSymbol}</td>
                      <td
                        className={`py-2.5 pr-3 font-sans font-semibold uppercase ${
                          t.side === 'buy' ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {t.side}
                      </td>
                      <td className="py-2.5 pr-3 text-right">{formatCryptoPrice(t.executedPrice)}</td>
                      <td className="py-2.5 pr-3 text-right">{formatQty(t.baseQuantity)}</td>
                      <td className="py-2.5 pr-3 text-right">{formatUsdt(t.feeUsdt)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold">{formatUsdt(t.totalUsdt)}</td>
                      <td className="py-2.5 text-right text-[#686D76] dark:text-[#7E828A]">
                        {t.venueTradeId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

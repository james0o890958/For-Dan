import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { TradeSide } from '../../types/domain';
import {
  buildOrderBookSnapshot,
  formatBookPrice,
  getTickOptionsForPrice,
} from '../../utils/orderBookMath';
import { formatCryptoPrice, formatUsdt } from '../../utils/tradingMath';

type BookViewMode = 'both' | 'bids' | 'asks';

interface RawDepthPayload {
  symbol: string;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  updatedAt: string;
}

export const OrderBook: React.FC<{
  symbol: string;
  currentPrice: number;
  onSelectPrice?: (price: number, side: TradeSide) => void;
}> = ({ symbol, currentPrice, onSelectPrice }) => {
  const [viewMode, setViewMode] = useState<BookViewMode>('both');
  const [depth, setDepth] = useState<RawDepthPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const tickOptions = useMemo(() => {
    const fallbackMid =
      currentPrice > 0
        ? currentPrice
        : depth && depth.asks[0] && depth.bids[0]
          ? (depth.asks[0][0] + depth.bids[0][0]) / 2
          : 0;
    return getTickOptionsForPrice(fallbackMid);
  }, [currentPrice, depth]);

  const [selectedTick, setSelectedTick] = useState<number>(tickOptions[0]);

  useEffect(() => {
    if (!tickOptions.includes(selectedTick)) {
      setSelectedTick(tickOptions[0]);
    }
  }, [tickOptions, selectedTick]);

  const loadOrderBook = useCallback(
    async (signal?: AbortSignal) => {
      if (!symbol) return;
      try {
        const res = await fetch(
          `/api/markets/${encodeURIComponent(symbol)}/orderbook?limit=60`,
          { signal }
        );
        const body = (await res.json()) as {
          ok?: boolean;
          message?: string;
          data?: RawDepthPayload;
        };
        if (!res.ok || !body.ok || !body.data) {
          throw new Error(body.message || 'Unable to load order book depth.');
        }
        setDepth(body.data);
        setError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Order book stream unavailable.');
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [symbol]
  );

  useEffect(() => {
    setDepth(null);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    void loadOrderBook(controller.signal);

    const timer = window.setInterval(() => {
      void loadOrderBook();
    }, 3500);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadOrderBook]);

  const maxRows = viewMode === 'both' ? 8 : 16;

  const snapshot = useMemo(() => {
    if (!depth) return null;
    return buildOrderBookSnapshot({
      symbol,
      rawBids: depth.bids,
      rawAsks: depth.asks,
      tickSize: selectedTick,
      maxRows,
      updatedAt: depth.updatedAt,
    });
  }, [depth, symbol, selectedTick, maxRows]);

  const baseAsset = symbol.split('/')[0] || 'ASSET';

  return (
    <section
      data-testid="order-book-panel"
      aria-label={`${symbol} Order Book`}
      className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex flex-col justify-between"
    >
      {/* Header & Controls */}
      <div className="space-y-2 pb-2.5 border-b border-[#E2E4E9] dark:border-[#22242A]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#111214] dark:text-[#F4F5F7]">Order Book</h2>
          <button
            type="button"
            onClick={() => void loadOrderBook()}
            aria-label="Refresh order book"
            className="p-1.5 rounded-md bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528]"
            role="group"
            aria-label="Order book view mode"
          >
            {(['both', 'bids', 'asks'] as BookViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`px-2 py-1 rounded-md text-[11px] font-medium capitalize whitespace-nowrap shrink-0 transition-colors ${
                  viewMode === mode
                    ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white shadow-xs'
                    : 'text-[#686D76] dark:text-[#9CA0A8]'
                }`}
              >
                {mode === 'both' ? 'All' : mode}
              </button>
            ))}
          </div>

          <label htmlFor="orderbook-tick-select" className="sr-only">
            Order book tick grouping
          </label>
          <select
            id="orderbook-tick-select"
            value={selectedTick}
            onChange={(e) => setSelectedTick(Number(e.target.value))}
            className="px-2 py-1 rounded-md bg-[#E8EAEE] dark:bg-[#242528] text-[11px] font-mono-num font-medium text-[#111214] dark:text-[#F4F5F7] focus:outline-none focus:ring-1 focus:ring-[#004AE2]"
          >
            {tickOptions.map((tick) => (
              <option key={tick} value={tick}>
                {tick}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-[11px] text-[#686D76] dark:text-[#7E828A] py-2 font-medium">
        <span>Price (USDT)</span>
        <span className="text-right">Size ({baseAsset})</span>
        <span className="text-right">Total ({baseAsset})</span>
      </div>

      {loading && !snapshot ? (
        <div
          data-testid="order-book-loading"
          className="py-12 text-center text-xs text-[#686D76] dark:text-[#7E828A]"
        >
          Loading live order book depth...
        </div>
      ) : !snapshot || (snapshot.asks.length === 0 && snapshot.bids.length === 0) ? (
        <div
          data-testid="order-book-unavailable"
          className="py-10 px-3 text-center space-y-2 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-dashed border-[#D4D7DF] dark:border-[#2B2C32]"
        >
          <p className="text-xs font-semibold text-[#111214] dark:text-[#F4F5F7]">
            Order Book Unavailable
          </p>
          <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
            {error || 'Live market depth requires an active liquidity feed.'}
          </p>
          <button
            type="button"
            onClick={() => void loadOrderBook()}
            className="px-3.5 py-1.5 rounded-full bg-[#004AE2] text-white text-[11px] font-semibold"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Asks (Sell Side) */}
          {(viewMode === 'both' || viewMode === 'asks') && (
            <div data-testid="order-book-asks" className="space-y-0.5">
              {snapshot.asks.map((level) => (
                <button
                  key={`ask-${level.price}`}
                  type="button"
                  onClick={() => onSelectPrice?.(level.price, 'buy')}
                  aria-label={`Select ask price ${formatBookPrice(level.price, selectedTick)} USDT`}
                  className="w-full relative overflow-hidden grid grid-cols-3 items-center px-1.5 py-1 rounded text-xs font-mono-num hover:bg-[#F4F5F7] dark:hover:bg-[#1B1D22] transition-colors text-left"
                >
                  <span
                    aria-hidden="true"
                    style={{ width: `${level.depthPct}%` }}
                    className="absolute right-0 inset-y-0 bg-[#F0525E]/15 pointer-events-none"
                  />
                  <span className="relative z-10 text-[#F0525E] font-medium">
                    {formatBookPrice(level.price, selectedTick)}
                  </span>
                  <span className="relative z-10 text-right text-[#111214] dark:text-[#F4F5F7]">
                    {level.size.toFixed(4)}
                  </span>
                  <span className="relative z-10 text-right text-[#686D76] dark:text-[#9CA0A8]">
                    {level.total.toFixed(4)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Mid / Spread Bar */}
          <div
            data-testid="order-book-spread"
            className="my-1.5 px-2 py-2 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] flex items-center justify-between gap-2 font-mono-num"
          >
            <span className="text-sm font-bold text-[#111214] dark:text-[#F4F5F7]">
              {formatCryptoPrice(currentPrice > 0 ? currentPrice : snapshot.midPrice)}
            </span>
            <span className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
              Spread {formatUsdt(snapshot.spreadUsdt)} ({snapshot.spreadPct.toFixed(3)}%)
            </span>
          </div>

          {/* Bids (Buy Side) */}
          {(viewMode === 'both' || viewMode === 'bids') && (
            <div data-testid="order-book-bids" className="space-y-0.5">
              {snapshot.bids.map((level) => (
                <button
                  key={`bid-${level.price}`}
                  type="button"
                  onClick={() => onSelectPrice?.(level.price, 'sell')}
                  aria-label={`Select bid price ${formatBookPrice(level.price, selectedTick)} USDT`}
                  className="w-full relative overflow-hidden grid grid-cols-3 items-center px-1.5 py-1 rounded text-xs font-mono-num hover:bg-[#F4F5F7] dark:hover:bg-[#1B1D22] transition-colors text-left"
                >
                  <span
                    aria-hidden="true"
                    style={{ width: `${level.depthPct}%` }}
                    className="absolute right-0 inset-y-0 bg-[#10C478]/15 pointer-events-none"
                  />
                  <span className="relative z-10 text-[#10C478] font-medium">
                    {formatBookPrice(level.price, selectedTick)}
                  </span>
                  <span className="relative z-10 text-right text-[#111214] dark:text-[#F4F5F7]">
                    {level.size.toFixed(4)}
                  </span>
                  <span className="relative z-10 text-right text-[#686D76] dark:text-[#9CA0A8]">
                    {level.total.toFixed(4)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CandlePoint, MarketTimeframe } from '../../types/domain';
import { formatCryptoPrice } from '../../utils/tradingMath';

type ChartMode = 'candles' | 'line';
const TIMEFRAMES: MarketTimeframe[] = ['15M', '1H', '4H', '1D', '1W'];

export const PriceChart: React.FC<{
  symbol: string;
  candles: CandlePoint[];
  currentPrice: number;
  changePct: number;
}> = ({ symbol, candles, currentPrice, changePct }) => {
  const [mode, setMode] = useState<ChartMode>('candles');
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('1H');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [remoteCandles, setRemoteCandles] = useState<CandlePoint[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadCandles = useCallback(
    async (signal?: AbortSignal) => {
      if (!symbol) return;
      setLoading((prev) => (remoteCandles === null ? true : prev));
      try {
        const res = await fetch(
          `/api/markets/${encodeURIComponent(symbol)}/candles?timeframe=${encodeURIComponent(timeframe)}`,
          { signal }
        );
        const body = (await res.json()) as {
          ok?: boolean;
          message?: string;
          data?: { candles?: CandlePoint[] };
        };
        if (!res.ok || !body.ok || !Array.isArray(body.data?.candles)) {
          throw new Error(body.message || 'Unable to load candlestick data.');
        }
        setRemoteCandles(body.data.candles);
        setFetchError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setFetchError(err instanceof Error ? err.message : 'Market data stream offline.');
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, timeframe]
  );

  useEffect(() => {
    setRemoteCandles(null);
    setHoverIdx(null);
    setFetchError(null);
    const controller = new AbortController();
    void loadCandles(controller.signal);

    const interval = window.setInterval(() => {
      void loadCandles();
    }, 15000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadCandles]);

  const displayCandles = useMemo(() => {
    if (remoteCandles && remoteCandles.length > 0) {
      return remoteCandles;
    }
    if (!fetchError && candles.length > 0) {
      return candles;
    }
    return [];
  }, [remoteCandles, fetchError, candles]);

  const latestClose =
    currentPrice > 0
      ? currentPrice
      : displayCandles.length > 0
        ? displayCandles[displayCandles.length - 1].close
        : 0;

  const isUnavailable = displayCandles.length === 0 && !loading;

  const stats = useMemo(() => {
    if (displayCandles.length === 0) {
      return { minLow: 0, maxHigh: 1, maxVol: 1 };
    }
    let minLow = Infinity;
    let maxHigh = -Infinity;
    let maxVol = 0;
    for (const c of displayCandles) {
      if (c.low < minLow) minLow = c.low;
      if (c.high > maxHigh) maxHigh = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }
    const spread = maxHigh - minLow;
    const pad = spread > 0 ? spread * 0.1 : Math.max(latestClose * 0.005, 0.001);
    return {
      minLow: Math.max(0, minLow - pad),
      maxHigh: maxHigh + pad,
      maxVol: maxVol > 0 ? maxVol : 1,
    };
  }, [displayCandles, latestClose]);

  const width = 640;
  const height = 410;
  const padLeft = 10;
  const padRight = 76;
  const priceTop = 14;
  const priceBottom = 292;
  const priceHeight = priceBottom - priceTop;
  const volTop = 308;
  const volBottom = 374;
  const volHeight = volBottom - volTop;
  const timeAxisY = 398;
  const plotW = width - padLeft - padRight;

  const yForPrice = (price: number) => {
    const ratio = (price - stats.minLow) / (stats.maxHigh - stats.minLow || 1);
    return priceTop + priceHeight - ratio * priceHeight;
  };

  const activePoint =
    hoverIdx !== null && displayCandles[hoverIdx]
      ? displayCandles[hoverIdx]
      : displayCandles[displayCandles.length - 1];

  const activeChangePct = activePoint
    ? activePoint.open > 0
      ? ((activePoint.close - activePoint.open) / activePoint.open) * 100
      : 0
    : changePct;

  const linePoints = displayCandles
    .map((c, idx) => {
      const x = padLeft + (idx + 0.5) * (plotW / Math.max(displayCandles.length, 1));
      const y = yForPrice(c.close);
      return `${x},${y}`;
    })
    .join(' ');

  const areaPolygonPoints = useMemo(() => {
    if (displayCandles.length < 2) return '';
    const slotW = plotW / displayCandles.length;
    const firstX = padLeft + 0.5 * slotW;
    const lastX = padLeft + (displayCandles.length - 0.5) * slotW;
    return `${firstX},${priceBottom} ${linePoints} ${lastX},${priceBottom}`;
  }, [displayCandles.length, linePoints, padLeft, plotW, priceBottom]);

  const lineColor = changePct >= 0 ? '#10C478' : '#F0525E';

  const lastPriceY =
    latestClose > 0
      ? Math.max(priceTop + 6, Math.min(priceBottom - 6, yForPrice(latestClose)))
      : null;

  const timeTickIndices = useMemo(() => {
    const count = displayCandles.length;
    if (count === 0) return [];
    if (count <= 6) return displayCandles.map((_, i) => i);
    const steps = 5;
    const indices: number[] = [];
    for (let s = 0; s <= steps; s++) {
      indices.push(Math.min(count - 1, Math.round((s * (count - 1)) / steps)));
    }
    return Array.from(new Set(indices));
  }, [displayCandles]);

  return (
    <div
      data-testid="price-chart-card"
      className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1" role="group" aria-label="Chart timeframe">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              aria-pressed={timeframe === tf}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                timeframe === tf
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 bg-[#E8EAEE] dark:bg-[#242528] p-0.5 rounded-lg"
            role="group"
            aria-label="Chart style"
          >
            <button
              type="button"
              onClick={() => setMode('candles')}
              aria-pressed={mode === 'candles'}
              className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                mode === 'candles'
                  ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white shadow-xs'
                  : 'text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Candles
            </button>
            <button
              type="button"
              onClick={() => setMode('line')}
              aria-pressed={mode === 'line'}
              className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                mode === 'line'
                  ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white shadow-xs'
                  : 'text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Line
            </button>
          </div>
          <button
            type="button"
            onClick={() => void loadCandles()}
            aria-label="Refresh chart candles"
            className="p-1.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && displayCandles.length === 0 ? (
        <div
          data-testid="price-chart-loading"
          className="aspect-[640/410] w-full rounded-lg border border-[#E2E4E9] dark:border-[#22242A] bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center justify-center text-center px-4"
        >
          <p className="text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
            Loading {symbol} {timeframe} market candles...
          </p>
        </div>
      ) : isUnavailable ? (
        <div
          data-testid="price-chart-unavailable"
          className="aspect-[640/410] w-full rounded-lg border border-dashed border-[#D4D7DF] dark:border-[#2B2C32] bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center justify-center text-center px-4"
        >
          <p className="text-sm font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {symbol} Market Data Unavailable
          </p>
          <p className="mt-1.5 text-xs text-[#686D76] dark:text-[#7E828A] max-w-md">
            {fetchError ||
              'Historical candlesticks require an active market data provider connection. No synthetic prices are displayed.'}
          </p>
          <button
            type="button"
            onClick={() => void loadCandles()}
            className="mt-4 px-4 py-2 rounded-full bg-[#004AE2] text-white text-xs font-semibold whitespace-nowrap shrink-0"
          >
            Retry Feed
          </button>
        </div>
      ) : (
        <>
          {activePoint && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#686D76] dark:text-[#7E828A] mb-2 font-mono-num">
              <span className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                {symbol} · {timeframe}
              </span>
              <span>{activePoint.timeLabel}</span>
              <span>O {formatCryptoPrice(activePoint.open)}</span>
              <span>H {formatCryptoPrice(activePoint.high)}</span>
              <span>L {formatCryptoPrice(activePoint.low)}</span>
              <span>C {formatCryptoPrice(activePoint.close)}</span>
              <span className={activeChangePct >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'}>
                {activeChangePct >= 0 ? '+' : ''}
                {activeChangePct.toFixed(2)}%
              </span>
              <span>
                Vol{' '}
                {activePoint.volume.toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          )}

          <div className="w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto block select-none"
              role="img"
              aria-label={`${symbol} ${timeframe} price and volume chart`}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <defs>
                <linearGradient id={`area-${symbol.replace(/[^A-Z0-9]/gi, '')}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {/* Price Gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = priceTop + priceHeight * ratio;
                const labelVal = stats.maxHigh - (stats.maxHigh - stats.minLow) * ratio;
                const overlapsLastPrice = lastPriceY !== null && Math.abs(y - lastPriceY) < 18;
                return (
                  <g key={ratio}>
                    <line
                      x1={padLeft}
                      x2={width - padRight}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      className="text-[#E2E4E9] dark:text-[#22242A]"
                      strokeDasharray="3 3"
                    />
                    {!overlapsLastPrice && (
                      <text
                        x={width - 6}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-[#686D76] dark:fill-[#7E828A] text-[10px]"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {formatCryptoPrice(labelVal)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Volume Panel Divider */}
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={volTop - 8}
                y2={volTop - 8}
                stroke="currentColor"
                className="text-[#E2E4E9] dark:text-[#22242A]"
              />
              <text
                x={width - 6}
                y={volTop + 8}
                textAnchor="end"
                className="fill-[#686D76] dark:fill-[#7E828A] text-[9px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                VOL
              </text>

              {/* Line + Area Fill */}
              {mode === 'line' && displayCandles.length > 1 && (
                <>
                  <polygon
                    points={areaPolygonPoints}
                    fill={`url(#area-${symbol.replace(/[^A-Z0-9]/gi, '')})`}
                  />
                  <polyline
                    fill="none"
                    stroke={lineColor}
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    points={linePoints}
                  />
                </>
              )}

              {/* Candlesticks + Volume Histogram */}
              {displayCandles.map((c, idx) => {
                const slotW = plotW / Math.max(displayCandles.length, 1);
                const cx = padLeft + (idx + 0.5) * slotW;
                const candleW = Math.max(3, Math.min(12, slotW * 0.58));
                const isUp = c.close >= c.open;
                const color = isUp ? '#10C478' : '#F0525E';
                const yHigh = yForPrice(c.high);
                const yLow = yForPrice(c.low);
                const yOpen = yForPrice(c.open);
                const yClose = yForPrice(c.close);
                const rectTop = Math.min(yOpen, yClose);
                const rectH = Math.max(2, Math.abs(yClose - yOpen));
                const volBarH = Math.max(2, (c.volume / stats.maxVol) * volHeight);
                const volBarY = volBottom - volBarH;
                const isHovered = hoverIdx === idx;

                return (
                  <g
                    key={`${c.timeLabel}-${idx}`}
                    onMouseEnter={() => setHoverIdx(idx)}
                    className="cursor-crosshair"
                  >
                    {isHovered && (
                      <>
                        <line
                          x1={cx}
                          x2={cx}
                          y1={priceTop}
                          y2={volBottom}
                          stroke="#686D76"
                          strokeDasharray="3 3"
                          strokeOpacity={0.55}
                        />
                        <line
                          x1={padLeft}
                          x2={width - padRight}
                          y1={yClose}
                          y2={yClose}
                          stroke="#686D76"
                          strokeDasharray="3 3"
                          strokeOpacity={0.45}
                        />
                      </>
                    )}

                    {/* Volume bar */}
                    <rect
                      x={cx - candleW / 2}
                      y={volBarY}
                      width={candleW}
                      height={volBarH}
                      rx={1}
                      fill={color}
                      fillOpacity={isHovered ? 0.78 : 0.34}
                    />

                    {mode === 'candles' ? (
                      <>
                        <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1.4" />
                        <rect
                          x={cx - candleW / 2}
                          y={rectTop}
                          width={candleW}
                          height={rectH}
                          rx={1}
                          fill={color}
                        />
                      </>
                    ) : (
                      <circle
                        cx={cx}
                        cy={yClose}
                        r={isHovered ? 4 : 0}
                        fill={lineColor}
                      />
                    )}

                    {/* Transparent hit area covering price & volume */}
                    <rect
                      x={cx - slotW / 2}
                      y={priceTop}
                      width={slotW}
                      height={volBottom - priceTop}
                      fill="transparent"
                    />
                  </g>
                );
              })}

              {/* Last Price Line & Tag */}
              {lastPriceY !== null && latestClose > 0 && (
                <g>
                  <line
                    x1={padLeft}
                    x2={width - padRight}
                    y1={lastPriceY}
                    y2={lastPriceY}
                    stroke="#004AE2"
                    strokeDasharray="4 3"
                    strokeWidth="1.2"
                  />
                  <rect
                    x={width - padRight + 4}
                    y={lastPriceY - 9}
                    width={padRight - 6}
                    height={18}
                    rx={4}
                    fill="#004AE2"
                  />
                  <text
                    x={width - 7}
                    y={lastPriceY + 3.5}
                    textAnchor="end"
                    fill="#FFFFFF"
                    className="text-[10px] font-semibold"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {formatCryptoPrice(latestClose)}
                  </text>
                </g>
              )}

              {/* Bottom Time Axis Labels */}
              {timeTickIndices.map((idx) => {
                const c = displayCandles[idx];
                if (!c) return null;
                const slotW = plotW / Math.max(displayCandles.length, 1);
                const cx = padLeft + (idx + 0.5) * slotW;
                return (
                  <text
                    key={`time-${idx}`}
                    x={cx}
                    y={timeAxisY}
                    textAnchor="middle"
                    className="fill-[#686D76] dark:fill-[#7E828A] text-[10px]"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {c.timeLabel}
                  </text>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
};

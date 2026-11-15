import React, { useMemo, useState } from 'react';
import type { CandlePoint } from '../../types/domain';
import { formatCryptoPrice } from '../../utils/tradingMath';

type ChartMode = 'candles' | 'line';
type Timeframe = '15M' | '1H' | '4H' | '1D' | '1W';

export const PriceChart: React.FC<{
  symbol: string;
  candles: CandlePoint[];
  currentPrice: number;
  changePct: number;
}> = ({ symbol, candles, currentPrice, changePct }) => {
  const [mode, setMode] = useState<ChartMode>('candles');
  const [timeframe, setTimeframe] = useState<Timeframe>('1H');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const displayCandles = useMemo(() => {
    if (timeframe === '15M') return candles.slice(-14);
    if (timeframe === '4H') return candles.filter((_, i) => i % 2 === 0);
    if (timeframe === '1W') return candles.map((c, idx) => ({ ...c, timeLabel: `D${idx + 1}` }));
    return candles;
  }, [candles, timeframe]);

  const isUnavailable = displayCandles.length === 0 || currentPrice <= 0;

  const stats = useMemo(() => {
    if (displayCandles.length === 0) {
      return { minLow: 0, maxHigh: 1 };
    }
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (const c of displayCandles) {
      if (c.low < minLow) minLow = c.low;
      if (c.high > maxHigh) maxHigh = c.high;
    }
    const pad = (maxHigh - minLow) * 0.1 || Math.max(currentPrice * 0.01, 0.01);
    return { minLow: minLow - pad, maxHigh: maxHigh + pad };
  }, [displayCandles, currentPrice]);

  const width = 760;
  const height = 280;
  const padLeft = 16;
  const padRight = 78;
  const padY = 20;
  const plotW = width - padLeft - padRight;
  const plotH = height - padY * 2;

  const yForPrice = (price: number) => {
    const ratio = (price - stats.minLow) / (stats.maxHigh - stats.minLow || 1);
    return padY + plotH - ratio * plotH;
  };

  const activePoint =
    hoverIdx !== null && displayCandles[hoverIdx]
      ? displayCandles[hoverIdx]
      : displayCandles[displayCandles.length - 1];

  const linePoints = displayCandles
    .map((c, idx) => {
      const x = padLeft + (idx + 0.5) * (plotW / Math.max(displayCandles.length, 1));
      const y = yForPrice(c.close);
      return `${x},${y}`;
    })
    .join(' ');

  const areaColor = changePct >= 0 ? '#10C478' : '#F0525E';

  return (
    <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          {(['15M', '1H', '4H', '1D', '1W'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                timeframe === tf
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8] hover:text-[#111214] dark:hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#E8EAEE] dark:bg-[#242528] p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setMode('candles')}
            className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              mode === 'candles'
                ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                : 'text-[#686D76] dark:text-[#9CA0A8]'
            }`}
          >
            Candles
          </button>
          <button
            type="button"
            onClick={() => setMode('line')}
            className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              mode === 'line'
                ? 'bg-white dark:bg-[#141518] text-[#111214] dark:text-white'
                : 'text-[#686D76] dark:text-[#9CA0A8]'
            }`}
          >
            Line
          </button>
        </div>
      </div>

      {isUnavailable ? (
        <div className="h-[240px] sm:h-[280px] rounded-lg border border-dashed border-[#D4D7DF] dark:border-[#2B2C32] bg-[#F4F5F7] dark:bg-[#0B0C0E] flex flex-col items-center justify-center text-center px-4">
          <p className="text-sm font-semibold text-[#111214] dark:text-[#F4F5F7]">
            {symbol} Market Data Unavailable
          </p>
          <p className="mt-1.5 text-xs text-[#686D76] dark:text-[#7E828A] max-w-md">
            Historical candlesticks and live order book streams require an active market data provider connection. No synthetic prices are displayed.
          </p>
        </div>
      ) : (
        <>
          {activePoint && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#686D76] dark:text-[#7E828A] mb-2 font-mono-num">
              <span className="font-semibold text-[#111214] dark:text-[#F4F5F7]">{symbol}</span>
              <span>{activePoint.timeLabel}</span>
              <span>O {formatCryptoPrice(activePoint.open)}</span>
              <span>H {formatCryptoPrice(activePoint.high)}</span>
              <span>L {formatCryptoPrice(activePoint.low)}</span>
              <span>C {formatCryptoPrice(activePoint.close)}</span>
              <span>Vol {activePoint.volume.toLocaleString()}</span>
            </div>
          )}

          <div className="w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-[240px] sm:h-[280px] select-none"
              role="img"
              aria-label={`${symbol} price chart`}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
                const y = padY + plotH * ratio;
                const labelVal = stats.maxHigh - (stats.maxHigh - stats.minLow) * ratio;
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
                    <text
                      x={width - 4}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-[#686D76] dark:fill-[#7E828A] text-[10px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatCryptoPrice(labelVal)}
                    </text>
                  </g>
                );
              })}

              {mode === 'line' && displayCandles.length > 1 && (
                <polyline
                  fill="none"
                  stroke={areaColor}
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  points={linePoints}
                />
              )}

              {displayCandles.map((c, idx) => {
                const slotW = plotW / Math.max(displayCandles.length, 1);
                const cx = padLeft + (idx + 0.5) * slotW;
                const candleW = Math.max(4, Math.min(14, slotW * 0.52));
                const isUp = c.close >= c.open;
                const color = isUp ? '#10C478' : '#F0525E';
                const yHigh = yForPrice(c.high);
                const yLow = yForPrice(c.low);
                const yOpen = yForPrice(c.open);
                const yClose = yForPrice(c.close);
                const rectTop = Math.min(yOpen, yClose);
                const rectH = Math.max(2, Math.abs(yClose - yOpen));

                return (
                  <g
                    key={c.timeLabel + idx}
                    onMouseEnter={() => setHoverIdx(idx)}
                    className="cursor-crosshair"
                  >
                    {hoverIdx === idx && (
                      <line
                        x1={cx}
                        x2={cx}
                        y1={padY}
                        y2={height - padY}
                        stroke="#686D76"
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                      />
                    )}
                    {mode === 'candles' ? (
                      <>
                        <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1.5" />
                        <rect
                          x={cx - candleW / 2}
                          y={rectTop}
                          width={candleW}
                          height={rectH}
                          rx={1.5}
                          fill={color}
                        />
                      </>
                    ) : (
                      <circle
                        cx={cx}
                        cy={yClose}
                        r={hoverIdx === idx ? 4.5 : 0}
                        fill={areaColor}
                      />
                    )}
                    <rect
                      x={cx - slotW / 2}
                      y={padY}
                      width={slotW}
                      height={plotH}
                      fill="transparent"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
};

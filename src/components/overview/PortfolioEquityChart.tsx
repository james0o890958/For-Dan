import React, { useMemo, useState } from 'react';
import type { PortfolioChartPoint } from '../../utils/overviewModel';
import { formatUsdt } from '../../utils/tradingMath';

function formatAxisCompactUsdt(val: number): string {
  if (!Number.isFinite(val)) return '0';
  if (val >= 1000) {
    return `${(val / 1000).toFixed(val >= 10000 ? 1 : 2)}k`;
  }
  return val.toFixed(0);
}

export const PortfolioEquityChart: React.FC<{
  points: PortfolioChartPoint[];
  hideBalances: boolean;
  isPositiveTrend: boolean;
}> = ({ points, hideBalances, isPositiveTrend }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 720;
  const height = 228;
  const padLeft = 10;
  const padRight = 56;
  const padTop = 18;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const stats = useMemo(() => {
    if (points.length === 0) return { min: 0, max: 1, allZero: true };
    let min = Infinity;
    let max = -Infinity;
    for (const pt of points) {
      if (pt.valueUsdt < min) min = pt.valueUsdt;
      if (pt.valueUsdt > max) max = pt.valueUsdt;
    }
    const allZero = max === 0 && min === 0;
    if (allZero) return { min: 0, max: 100, allZero: true };
    const spread = max - min;
    const pad = spread > 0 ? spread * 0.2 : Math.max(max * 0.05, 1);
    return {
      min: Math.max(0, min - pad),
      max: max + pad,
      allZero: false,
    };
  }, [points]);

  const coords = useMemo(() => {
    if (points.length === 0) return [];
    const divisor = Math.max(points.length - 1, 1);
    return points.map((pt, idx) => {
      const x = padLeft + (idx / divisor) * plotW;
      const ratio = (pt.valueUsdt - stats.min) / (stats.max - stats.min || 1);
      const y = padTop + plotH - ratio * plotH;
      return { x, y, pt };
    });
  }, [points, plotW, plotH, padLeft, padTop, stats]);

  const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPolygon =
    coords.length >= 2
      ? `${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} ${polylinePoints} ${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)}`
      : '';

  const strokeColor = stats.allZero
    ? '#686D76'
    : isPositiveTrend
      ? '#10C478'
      : '#F0525E';

  const tickIndices = useMemo(() => {
    const n = coords.length;
    if (n <= 4) return coords.map((_, i) => i);
    return [0, Math.floor((n - 1) * 0.33), Math.floor((n - 1) * 0.66), n - 1];
  }, [coords]);

  const active = hoverIdx !== null && coords[hoverIdx] ? coords[hoverIdx] : null;

  return (
    <div className="relative w-full">
      {active && (
        <div
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] px-3 py-1.5 text-xs font-mono-num"
          data-testid="portfolio-chart-readout"
        >
          <span className="text-[#686D76] dark:text-[#7E828A]">{active.pt.label}</span>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
              {hideBalances ? '•••••• USDT' : `${formatUsdt(active.pt.valueUsdt)} USDT`}
            </span>
            <span className={active.pt.deltaPct >= 0 ? 'text-[#10C478]' : 'text-[#F0525E]'}>
              {active.pt.deltaPct >= 0 ? '+' : ''}
              {active.pt.deltaPct.toFixed(2)}%
            </span>
          </div>
        </div>
      )}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block select-none"
        role="img"
        aria-label="Portfolio valuation history chart"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="portfolioEquityGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines + right-edge Y-axis labels */}
        {[0, 0.33, 0.66, 1].map((ratio) => {
          const y = padTop + plotH * ratio;
          const axisVal = stats.max - (stats.max - stats.min) * ratio;
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-[#E2E4E9] dark:text-[#1F2127]"
                strokeDasharray="3 3"
              />
              <text
                x={width - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-[#686D76] dark:fill-[#7E828A] text-[10px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {hideBalances ? '•••' : formatAxisCompactUsdt(axisVal)}
              </text>
            </g>
          );
        })}

        {areaPolygon && (
          <polygon points={areaPolygon} fill="url(#portfolioEquityGrad)" />
        )}

        {polylinePoints && (
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={polylinePoints}
          />
        )}

        {/* Active hover hairline & marker */}
        {active && (
          <g>
            <line
              x1={active.x}
              x2={active.x}
              y1={padTop}
              y2={padTop + plotH}
              stroke="#686D76"
              strokeDasharray="3 3"
              strokeOpacity={0.65}
            />
            <circle
              cx={active.x}
              cy={active.y}
              r={4.5}
              fill={strokeColor}
              stroke="#0B0C0E"
              strokeWidth={1.5}
            />
          </g>
        )}

        {/* Interactive pointer slices */}
        {coords.map((c, idx) => {
          const sliceW = plotW / Math.max(coords.length, 1);
          const xStart = Math.max(padLeft, c.x - sliceW / 2);
          return (
            <rect
              key={`slice-${c.pt.label}-${idx}`}
              x={xStart}
              y={padTop}
              width={sliceW}
              height={plotH}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          );
        })}

        {/* Bottom time axis ticks */}
        {tickIndices.map((idx) => {
          const c = coords[idx];
          if (!c) return null;
          const anchor = idx === 0 ? 'start' : idx === coords.length - 1 ? 'end' : 'middle';
          return (
            <text
              key={`tick-${idx}`}
              x={c.x}
              y={height - 8}
              textAnchor={anchor}
              className="fill-[#686D76] dark:fill-[#7E828A] text-[10px]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {c.pt.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

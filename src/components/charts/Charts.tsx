/**
 * Charts.tsx — Lightweight dependency-free SVG charts.
 *
 * Deliberately hand-written instead of pulling in a charting library: keeps the bundle
 * small, works offline with no font/Canvas dependencies, renders Bengali labels through
 * normal SVG text, and never fabricates data (it draws exactly what it is given).
 */

import { formatMoney } from '@/lib/money';

export interface TrendPoint {
  label: string;
  sales: number;
  profit?: number;
  expenses?: number;
  orders?: number;
}

const PALETTE = ['#15803d', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b', '#eab308'];

/* ------------------------------------------------------------------ */
/* Line / area trend chart                                             */
/* ------------------------------------------------------------------ */

export interface TrendChartProps {
  data: TrendPoint[];
  height?: number;
  showProfit?: boolean;
  emptyMessage?: string;
}

export function TrendChart({ data, height = 220, showProfit = true, emptyMessage = 'এই সময়ে কোনো বিক্রয় নেই' }: TrendChartProps) {
  if (data.length === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  const width = 640;
  const padding = { top: 16, right: 12, bottom: 26, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((d) => Math.max(d.sales, showProfit && d.profit !== undefined ? d.profit : 0)), 1);
  const minValue = Math.min(0, ...data.map((d) => (showProfit ? (d.profit ?? 0) : 0)));
  const span = maxValue - minValue || 1;

  const x = (index: number) => padding.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
  const y = (value: number) => padding.top + innerH - ((value - minValue) / span) * innerH;

  const line = (accessor: (point: TrendPoint) => number) =>
    data.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(accessor(point)).toFixed(1)}`).join(' ');

  const area = `${line((p) => p.sales)} L${x(data.length - 1).toFixed(1)},${y(minValue).toFixed(1)} L${x(0).toFixed(1)},${y(minValue).toFixed(1)} Z`;

  const labelStep = Math.max(1, Math.ceil(data.length / 6));

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="বিক্রয় প্রবণতা">
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerH * ratio}
            y2={padding.top + innerH * ratio}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        <path d={area} fill="url(#salesFill)" />
        <path d={line((p) => p.sales)} fill="none" stroke="#15803d" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {showProfit && (
          <path d={line((p) => p.profit ?? 0)} fill="none" stroke="#0ea5e9" strokeWidth={1.8} strokeDasharray="4 3" strokeLinejoin="round" />
        )}

        {data.map((point, index) =>
          data.length <= 30 ? (
            <circle key={point.label} cx={x(index)} cy={y(point.sales)} r={2.5} fill="#15803d">
              <title>{`${point.label}: বিক্রয় ${formatMoney(point.sales)}${point.profit !== undefined ? `, লাভ ${formatMoney(point.profit)}` : ''}`}</title>
            </circle>
          ) : null,
        )}

        {data.map((point, index) =>
          index % labelStep === 0 || index === data.length - 1 ? (
            <text key={`l-${index}`} x={x(index)} y={height - 8} textAnchor="middle" fontSize={11} fill="#64748b">
              {point.label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-brand-700" /> বিক্রয়
        </span>
        {showProfit && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-sky-500" /> আনুমানিক লাভ
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Vertical bar chart                                                  */
/* ------------------------------------------------------------------ */

export function BarChart({
  data,
  height = 200,
  color = '#15803d',
  emptyMessage = 'কোনো তথ্য নেই',
  valueFormatter = (value: number) => formatMoney(value, { compact: true }),
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  emptyMessage?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (data.length === 0) return <ChartEmpty message={emptyMessage} height={height} />;
  const width = 640;
  const padding = { top: 12, right: 8, bottom: 26, left: 8 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const band = innerW / data.length;
  const barWidth = Math.max(Math.min(band * 0.62, 46), 4);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="বার চার্ট">
      <line x1={padding.left} x2={width - padding.right} y1={padding.top + innerH} y2={padding.top + innerH} stroke="#e2e8f0" />
      {data.map((point, index) => {
        const barHeight = (point.value / max) * innerH;
        const cx = padding.left + band * index + band / 2;
        return (
          <g key={point.label}>
            <rect
              x={cx - barWidth / 2}
              y={padding.top + innerH - barHeight}
              width={barWidth}
              height={Math.max(barHeight, 1)}
              rx={3}
              fill={color}
            >
              <title>{`${point.label}: ${valueFormatter(point.value)}`}</title>
            </rect>
            {data.length <= 12 && (
              <text x={cx} y={padding.top + innerH - barHeight - 4} textAnchor="middle" fontSize={10} fill="#475569">
                {valueFormatter(point.value)}
              </text>
            )}
            <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="#64748b">
              {point.label.length > 10 ? `${point.label.slice(0, 9)}…` : point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Donut chart                                                         */
/* ------------------------------------------------------------------ */

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export function DonutChart({ slices, size = 180, centerLabel, emptyMessage = 'কোনো তথ্য নেই' }: { slices: DonutSlice[]; size?: number; centerLabel?: string; emptyMessage?: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <ChartEmpty message={emptyMessage} height={size} />;

  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="বিতরণ চার্ট">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={22} />
          {slices.map((slice, index) => {
            const fraction = slice.value / total;
            const length = fraction * circumference;
            const dash = `${length} ${circumference - length}`;
            const element = (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color ?? PALETTE[index % PALETTE.length]}
                strokeWidth={22}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              >
                <title>{`${slice.label}: ${slice.value} (${(fraction * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            offset += length;
            return element;
          })}
        </g>
        {centerLabel && (
          <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={15} fontWeight={600} fill="#0f172a">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="w-full space-y-1.5 text-sm">
        {slices.map((slice, index) => (
          <li key={slice.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.color ?? PALETTE[index % PALETTE.length] }} />
              <span className="truncate text-ink-600">{slice.label}</span>
            </span>
            <span className="tabular shrink-0 text-ink-800">
              {slice.value} <span className="text-ink-400">({((slice.value / total) * 100).toFixed(0)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal bars                                                     */
/* ------------------------------------------------------------------ */

export function HorizontalBars({
  items,
  emptyMessage = 'কোনো তথ্য নেই',
  formatter = (value: number) => formatMoney(value, { compact: true }),
}: {
  items: { label: string; value: number }[];
  emptyMessage?: string;
  formatter?: (value: number) => string;
}) {
  if (items.length === 0) return <ChartEmpty message={emptyMessage} height={120} />;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-600">{item.label}</span>
            <span className="tabular shrink-0 font-medium text-ink-800">{formatter(item.value)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max((Math.abs(item.value) / max) * 100, 2)}%`, background: PALETTE[index % PALETTE.length] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Shared empty state                                                  */
/* ------------------------------------------------------------------ */

export function ChartEmpty({ message, height = 160 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-ink-200 bg-ink-50/60 text-sm text-ink-400"
      style={{ minHeight: height }}
    >
      {message}
    </div>
  );
}

export { PALETTE as CHART_PALETTE };

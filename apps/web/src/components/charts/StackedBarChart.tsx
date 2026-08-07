'use client';

import Legend from './Legend';

export interface BarSeries {
  key: string;
  label: string;
  color: string;
  values: number[]; // 與 categories 等長
}

export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[]; // 與 categories 等長，null 代表無資料不連線
  unit?: string;
}

/** 泛化自 dashboard 原 TrendChart：堆疊長條 + 右軸折線（純手刻 SVG，不依賴圖表函式庫） */
export default function StackedBarChart({
  categories, series, line, yLabel, y2Label,
}: {
  categories: (string | number)[];
  series: BarSeries[];
  line?: LineSeries;
  yLabel?: string;
  y2Label?: string;
}) {
  const W = 820, H = 380;
  const padL = 64, padR = line ? 64 : 24, padT = 24, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = categories.length;

  const stackTotals = categories.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const maxBar = Math.max(1, ...stackTotals) * 1.15;
  const lineVals = line ? line.values.filter((v): v is number => v != null) : [];
  const maxLine = Math.max(1, ...lineVals) * 1.25;

  const groupW = n > 0 ? plotW / n : plotW;
  const barW = Math.min(48, groupW * 0.55);

  const yBar = (v: number) => padT + plotH - (v / maxBar) * plotH;
  const yLine = (v: number) => padT + plotH - (v / maxLine) * plotH;
  const xCenter = (i: number) => padL + groupW * i + groupW / 2;

  const ticks = 5;
  const barTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxBar / ticks) * i);
  const lineTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxLine / ticks) * i);

  const linePath = () => {
    if (!line) return null;
    const pts = line.values.map((v, i) => ({ x: xCenter(i), v, i })).filter((p) => p.v != null) as { x: number; v: number; i: number }[];
    if (pts.length === 0) return null;
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${yLine(p.v)}`).join(' ');
  };

  if (n === 0) return <p className="text-sm text-gray-400 py-10 text-center">尚無資料可繪圖。</p>;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img" aria-label="堆疊長條與趨勢圖">
        {barTicks.map((t, i) => (
          <g key={`gl${i}`}>
            <line x1={padL} y1={yBar(t)} x2={W - padR} y2={yBar(t)} stroke="#eceff2" />
            <text x={padL - 8} y={yBar(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}
        {line && lineTicks.map((t, i) => (
          <text key={`rl${i}`} x={W - padR + 8} y={yLine(t) + 3} textAnchor="start" fontSize="10" fill={line.color}>
            {t.toFixed(2)}
          </text>
        ))}

        {/* 堆疊長條 */}
        {categories.map((c, i) => {
          const cx = xCenter(i);
          let acc = 0;
          return (
            <g key={`bar${i}`}>
              {series.map((s) => {
                const v = s.values[i] || 0;
                const y0 = yBar(acc + v);
                const y1 = yBar(acc);
                acc += v;
                return (
                  <rect key={s.key} x={cx - barW / 2} y={y0} width={barW} height={Math.max(0, y1 - y0)}
                    fill={s.color} rx="1.5" />
                );
              })}
              <text x={cx} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#374151" fontWeight="600">{c}</text>
            </g>
          );
        })}

        {/* 折線 */}
        {line && (() => {
          const path = linePath();
          if (!path) return null;
          return <path d={path} fill="none" stroke={line.color} strokeWidth={2.5} />;
        })()}
        {line && categories.map((_, i) => {
          const v = line.values[i];
          if (v == null) return null;
          return (
            <g key={`pt${i}`}>
              <circle cx={xCenter(i)} cy={yLine(v)} r="3.5" fill={line.color} />
              <text x={xCenter(i)} y={yLine(v) - 8} textAnchor="middle" fontSize="10" fill={line.color} fontWeight="700">
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}

        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#cbd5e1" />
        <line x1={W - padR} y1={padT} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" />
        {yLabel && <text x={padL} y={14} fontSize="10" fill="#9ca3af">{yLabel}</text>}
        {line && y2Label && <text x={W - padR} y={14} textAnchor="end" fontSize="10" fill={line.color}>{y2Label}</text>}
      </svg>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 text-xs px-2">
        {series.map((s) => <Legend key={s.key} color={s.color} label={s.label} />)}
        {line && <Legend color={line.color} label={line.label} line />}
      </div>
    </div>
  );
}

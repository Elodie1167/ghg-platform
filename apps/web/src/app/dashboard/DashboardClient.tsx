'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RegionScope, YearScope, AnnualMetric } from './page';

const HEADER_BG = '#0C3D2E';
const YEARS = [2023, 2024, 2025, 2026, 2027];

const COUNTRY_LABELS: Record<string, string> = {
  TWN: '台灣', CHN: '中國', NVN: '北越', SVN: '南越',
  CAB: '柬埔寨', SLV: '薩爾瓦多', BGD: '孟加拉', IND: '印尼',
};
const COUNTRY_ORDER = ['BGD', 'CAB', 'CHN', 'IND', 'NVN', 'SVN', 'SLV', 'TWN'];

// chart colours
const C_S1 = '#166534';   // 直接
const C_S2 = '#9ca3af';   // 間接
const C_TOT = '#0C3D2E';  // 直接與間接
const C_INT1 = '#0d9488'; // 排放強度（每標打）
const C_INT2 = '#cbd5e1'; // 排放強度（營業額）

const fmt = (v: number, d = 0) => v === 0 ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DashboardClient({
  year, regionScopes, yearScopes, annualMetrics,
}: {
  year: number;
  regionScopes: RegionScope[];
  yearScopes: YearScope[];
  annualMetrics: AnnualMetric[];
}) {
  const router = useRouter();
  const cur = annualMetrics.find((m) => m.year === year);
  const [stdUnits, setStdUnits] = useState(cur?.standard_units != null ? String(cur.standard_units) : '');
  const [revenue, setRevenue] = useState(cur?.revenue_thousands != null ? String(cur.revenue_thousands) : '');
  const [saveMsg, setSaveMsg] = useState('');

  async function saveMetrics() {
    setSaveMsg('儲存中…');
    try {
      const res = await fetch('/api/annual-metrics', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          standard_units: stdUnits === '' ? null : Number(stdUnits),
          revenue_thousands: revenue === '' ? null : Number(revenue),
        }),
      });
      if (!res.ok) throw new Error();
      setSaveMsg('✅ 已儲存');
      router.refresh();
      setTimeout(() => setSaveMsg(''), 2500);
    } catch { setSaveMsg('❌ 儲存失敗'); }
  }

  // ── 各產區（選定年度）──
  const regionMap: Record<string, { s1: number; s2mkt: number; s2loc: number; s3: number }> = {};
  for (const r of regionScopes) {
    const m = (regionMap[r.country_code] ??= { s1: 0, s2mkt: 0, s2loc: 0, s3: 0 });
    if (r.scope === 1) m.s1 += r.co2e_total;
    else if (r.scope === 2) { m.s2mkt += r.co2e_market; m.s2loc += r.co2e_location; }
    else if (r.scope === 3) m.s3 += r.co2e_total;
  }
  const regions = [
    ...COUNTRY_ORDER.filter((c) => regionMap[c]),
    ...Object.keys(regionMap).filter((c) => !COUNTRY_ORDER.includes(c)),
  ];
  const gt = regions.reduce((a, c) => {
    const m = regionMap[c];
    a.s1 += m.s1; a.s2mkt += m.s2mkt; a.s3 += m.s3;
    return a;
  }, { s1: 0, s2mkt: 0, s3: 0 });

  // ── 趨勢圖資料（各年度集團合計）──
  const byYear: Record<number, { s1: number; s2mkt: number }> = {};
  for (const r of yearScopes) {
    const y = (byYear[r.year] ??= { s1: 0, s2mkt: 0 });
    if (r.scope === 1) y.s1 += r.co2e_total;
    else if (r.scope === 2) y.s2mkt += r.co2e_market;
  }
  const metricMap: Record<number, AnnualMetric> = {};
  for (const m of annualMetrics) metricMap[m.year] = m;
  const chartYears = [...new Set(yearScopes.map((r) => r.year))].sort((a, b) => a - b);
  const chart = chartYears.map((y) => {
    const s1 = byYear[y]?.s1 ?? 0;
    const s2 = byYear[y]?.s2mkt ?? 0;
    const total = s1 + s2;
    const mm = metricMap[y];
    const int1 = mm?.standard_units ? total * 1000 / mm.standard_units : null; // kgCO2e/標打
    const int2 = mm?.revenue_thousands ? total * 1000 / mm.revenue_thousands : null; // kgCO2e/千元
    return { year: y, s1, s2, total, int1, int2 };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
            <h1 className="text-xl font-bold mt-0.5">集團碳排儀表板</h1>
            <p className="text-green-300 text-sm">全營運據點溫室氣體排放量（市場別）｜ 僅計入已查核資料</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/summary" className="text-green-300 text-sm hover:underline">明細彙整表 →</a>
            <span className="text-green-300 text-sm">盤查年度</span>
            <select value={year} onChange={(e) => router.push(`/dashboard?year=${e.target.value}`)}
              className="bg-white/10 text-white border border-white/30 rounded-lg px-3 py-1.5 text-sm">
              {YEARS.map((y) => <option key={y} value={y} className="text-black">{y} 年</option>)}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        {/* 標打產能 / 營業額 輸入 */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-1">{year} 年度指標（供排放強度計算）</h2>
          <p className="text-xs text-gray-400 mb-4">填入全集團當年度數值；排放強度 = (S1 + S2 市場) × 1000 ÷ 分母。1 標打 = 12 件。</p>
          <div className="flex flex-wrap items-end gap-5">
            <div>
              <label className="block text-xs text-gray-500 mb-1">標打產能（標打）</label>
              <input type="number" min="0" step="any" value={stdUnits} onChange={(e) => setStdUnits(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-52 focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">營業額（新臺幣千元）</label>
              <input type="number" min="0" step="any" value={revenue} onChange={(e) => setRevenue(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-52 focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <button onClick={saveMetrics}
              className="px-5 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
              style={{ backgroundColor: HEADER_BG }}>儲存並更新圖表</button>
            {saveMsg && <span className="text-xs text-gray-600">{saveMsg}</span>}
          </div>
        </section>

        {/* 趨勢圖 */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">排放量與排放強度趨勢（市場別）</h2>
          {chart.length === 0
            ? <p className="text-sm text-gray-400 py-10 text-center">尚無已查核資料可繪圖。</p>
            : <TrendChart data={chart} />}
          <p className="text-xs text-gray-400 mt-2">
            長條：直接(S1)、間接(S2 市場)、直接與間接（tCO₂e，左軸）｜ 折線：排放強度（右軸）｜ 需填標打產能/營業額才會出現對應折線 ｜ AI 計算，需相關部門複核
          </p>
        </section>

        {/* 各產區表 */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 px-1">{year} 各產區排放量（tCO₂e，市場別）</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full border-collapse text-sm bg-white">
              <thead>
                <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                  <th className="px-4 py-2.5 text-left">產區</th>
                  <th className="px-4 py-2.5 text-right">直接 S1</th>
                  <th className="px-4 py-2.5 text-right">間接 S2（市場）</th>
                  <th className="px-4 py-2.5 text-right">S1 + S2</th>
                  <th className="px-4 py-2.5 text-right">價值鏈 S3</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-blue-50/60 font-semibold">
                  <td className="px-4 py-2 text-[#1e3a5f]">集團合計</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(gt.s1, 2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(gt.s2mkt, 2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(gt.s1 + gt.s2mkt, 2)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(gt.s3, 2)}</td>
                </tr>
                {regions.map((c, i) => {
                  const m = regionMap[c];
                  return (
                    <tr key={c} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-medium text-gray-700">{COUNTRY_LABELS[c] ?? c}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(m.s1, 2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(m.s2mkt, 2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(m.s1 + m.s2mkt, 2)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{fmt(m.s3, 2)}</td>
                    </tr>
                  );
                })}
                {regions.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">此年度尚無已查核資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

// ── 長條 + 折線 雙軸圖（純 SVG）──
function TrendChart({ data }: {
  data: { year: number; s1: number; s2: number; total: number; int1: number | null; int2: number | null }[];
}) {
  const W = 820, H = 380;
  const padL = 64, padR = 64, padT = 24, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxBar = Math.max(1, ...data.map((d) => d.total)) * 1.15;
  const maxLine = Math.max(1, ...data.flatMap((d) => [d.int1 ?? 0, d.int2 ?? 0])) * 1.25;

  const n = data.length;
  const groupW = plotW / n;
  const barW = Math.min(26, groupW / 5);

  const yBar = (v: number) => padT + plotH - (v / maxBar) * plotH;
  const yLine = (v: number) => padT + plotH - (v / maxLine) * plotH;
  const xCenter = (i: number) => padL + groupW * i + groupW / 2;

  const ticks = 5;
  const barTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxBar / ticks) * i);
  const lineTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxLine / ticks) * i);

  const linePath = (key: 'int1' | 'int2') => {
    const pts = data.map((d, i) => ({ x: xCenter(i), v: d[key], i }))
      .filter((p) => p.v != null) as { x: number; v: number; i: number }[];
    if (pts.length === 0) return null;
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${yLine(p.v)}`).join(' ');
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img"
        aria-label="排放量與排放強度趨勢圖">
        {/* grid + 左軸刻度 */}
        {barTicks.map((t, i) => (
          <g key={`gl${i}`}>
            <line x1={padL} y1={yBar(t)} x2={W - padR} y2={yBar(t)} stroke="#eceff2" />
            <text x={padL - 8} y={yBar(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}
        {/* 右軸刻度 */}
        {lineTicks.map((t, i) => (
          <text key={`rl${i}`} x={W - padR + 8} y={yLine(t) + 3} textAnchor="start" fontSize="10" fill="#0d9488">
            {t.toFixed(2)}
          </text>
        ))}

        {/* 長條 */}
        {data.map((d, i) => {
          const cx = xCenter(i);
          const bars = [
            { v: d.s1, color: C_S1, off: -barW * 1.6 },
            { v: d.s2, color: C_S2, off: -barW * 0.5 },
            { v: d.total, color: C_TOT, off: barW * 0.6 },
          ];
          return (
            <g key={`bar${d.year}`}>
              {bars.map((b, bi) => (
                <rect key={bi} x={cx + b.off} y={yBar(b.v)} width={barW} height={Math.max(0, padT + plotH - yBar(b.v))}
                  fill={b.color} rx="1.5" />
              ))}
              <text x={cx} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#374151" fontWeight="600">{d.year}</text>
            </g>
          );
        })}

        {/* 折線 int1 / int2 */}
        {(['int2', 'int1'] as const).map((key) => {
          const path = linePath(key);
          if (!path) return null;
          const color = key === 'int1' ? C_INT1 : C_INT2;
          return <path key={key} d={path} fill="none" stroke={color} strokeWidth={key === 'int1' ? 2.5 : 2} />;
        })}
        {data.map((d, i) => (
          <g key={`pt${d.year}`}>
            {d.int1 != null && (<>
              <circle cx={xCenter(i)} cy={yLine(d.int1)} r="3.5" fill={C_INT1} />
              <text x={xCenter(i)} y={yLine(d.int1) - 8} textAnchor="middle" fontSize="10" fill={C_INT1} fontWeight="700">{d.int1.toFixed(2)}</text>
            </>)}
            {d.int2 != null && (
              <circle cx={xCenter(i)} cy={yLine(d.int2)} r="3" fill="#94a3b8" />
            )}
          </g>
        ))}

        {/* 軸線 */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#cbd5e1" />
        <line x1={W - padR} y1={padT} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" />
        <text x={padL} y={14} fontSize="10" fill="#9ca3af">tCO₂e</text>
        <text x={W - padR} y={14} textAnchor="end" fontSize="10" fill="#0d9488">kgCO₂e/單位</text>
      </svg>

      {/* 圖例 */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 text-xs px-2">
        <Legend color={C_S1} label="直接 S1" />
        <Legend color={C_S2} label="間接 S2（市場）" />
        <Legend color={C_TOT} label="直接與間接" />
        <Legend color={C_INT1} label="排放強度（kgCO₂e/標打）" line />
        <Legend color="#94a3b8" label="排放強度（kgCO₂e/營業額千元）" line />
      </div>
    </div>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600">
      {line
        ? <span style={{ backgroundColor: color }} className="inline-block w-4 h-0.5" />
        : <span style={{ backgroundColor: color }} className="inline-block w-3 h-3 rounded-sm" />}
      {label}
    </span>
  );
}

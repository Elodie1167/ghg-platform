'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRY_LABELS, type ReductionResult, type FactoryReduction } from '@/lib/reduction-types';

const HEADER_BG = '#0C3D2E';
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const COUNTRY_ORDER = ['TWN', 'CHN', 'NVN', 'SVN', 'CAB', 'SLV', 'BGD', 'IND'];

// pathway 目標：2030 相比 2020 減 50%，2050 減 100%
const T2030_RATIO = 0.5;

const fmt2 = (v: number) => (v === 0 ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmt0 = (v: number) => (v === 0 ? '—' : Math.round(v).toLocaleString());
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

export default function ReductionClient({ data }: { data: ReductionResult }) {
  const router = useRouter();
  const { source, year, monthFrom, monthTo, factorYear } = data;

  function nav(patch: Record<string, string | number>) {
    const params = new URLSearchParams({
      source: data.source, year: String(data.year),
      monthFrom: String(data.monthFrom), monthTo: String(data.monthTo),
      recSource: data.recSource,
      factorYear: String(data.factorYear ?? data.year - 1),
    });
    for (const [k, v] of Object.entries(patch)) params.set(k, String(v));
    router.push(`/reduction?${params.toString()}`);
  }

  const b2020 = data.baselines.find((b) => b.base_year === 2020)?.intensity_market_kg ?? null;
  const b2025 = data.baselines.find((b) => b.base_year === 2025)?.intensity_market_kg ?? null;
  const im = data.intensity_market_kg;
  const iloc = data.intensity_location_kg;
  const redVs = (base: number | null) => (base && base > 0 && im != null ? ((base - im) / base) * 100 : null);

  // 依產區分組
  const byCountry = new Map<string, FactoryReduction[]>();
  for (const f of data.factories) {
    if (!byCountry.has(f.country_code)) byCountry.set(f.country_code, []);
    byCountry.get(f.country_code)!.push(f);
  }
  const countries = [
    ...COUNTRY_ORDER.filter((c) => byCountry.has(c)),
    ...[...byCountry.keys()].filter((c) => !COUNTRY_ORDER.includes(c)),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
              <h1 className="text-xl font-bold mt-0.5">減碳績效追蹤</h1>
              <p className="text-green-300 text-sm">S1/S2（地域·市場）· 減碳 KPI · 綠電占比 · 2020–2050 減碳路徑</p>
            </div>
            <div className="text-right text-[11px] leading-relaxed bg-amber-400/15 border border-amber-300/40 rounded-lg px-3 py-1.5">
              ⚠️ AI 試算，基準值與減碳%<br />需<span className="font-semibold">永續發展部確認</span>，非最終結論
            </div>
          </div>

          {/* 控制列 */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Seg label="資料來源"
              value={source}
              options={[['csr', 'CSR 匯出'], ['platform', 'GHG 平台']]}
              onChange={(v) => nav({ source: v, ...(v === 'platform' ? { recSource: 'platform' } : {}) })} />
            <label className="flex items-center gap-1.5 text-green-200">年度
              <select value={year} onChange={(e) => nav({ year: e.target.value })}
                className="bg-white/10 text-white border border-white/30 rounded-lg px-2 py-1 text-sm">
                {YEARS.map((y) => <option key={y} value={y} className="text-black">{y}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-green-200">月份
              <select value={monthFrom} onChange={(e) => nav({ monthFrom: e.target.value })}
                className="bg-white/10 text-white border border-white/30 rounded-lg px-2 py-1 text-sm">
                {MONTHS.map((m) => <option key={m} value={m} className="text-black">{m}</option>)}
              </select>
              <span>–</span>
              <select value={monthTo} onChange={(e) => nav({ monthTo: e.target.value })}
                className="bg-white/10 text-white border border-white/30 rounded-lg px-2 py-1 text-sm">
                {MONTHS.map((m) => <option key={m} value={m} className="text-black">{m}</option>)}
              </select>
            </label>
            {source === 'csr' && (<>
              <Seg label="iREC"
                value={data.recSource}
                options={[['platform', '平台帶入'], ['manual', '手動試算']]}
                onChange={(v) => nav({ recSource: v })} />
              <label className="flex items-center gap-1.5 text-green-200">係數年度
                <select value={factorYear ?? year - 1} onChange={(e) => nav({ factorYear: e.target.value })}
                  className="bg-white/10 text-white border border-white/30 rounded-lg px-2 py-1 text-sm">
                  {rangeYears(2020, year).map((y) => <option key={y} value={y} className="text-black">{y}</option>)}
                </select>
              </label>
            </>)}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        {data.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
            {data.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
          </div>
        )}

        {/* KPI 卡 */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Kpi title="市場別強度" value={im == null ? '—' : im.toFixed(4)} unit="kgCO₂e/標打"
            sub={`期間 S1+S2(市) ÷ 標打產能（${fmt0(data.production)} 標打）`} accent />
          <Kpi title="相比 2020 減碳" value={pct(redVs(b2020))} unit={b2020 != null ? `基準 ${b2020}` : ''}
            sub="市場別 · 2020 原定基準年" />
          <Kpi title="相比 2025 減碳" value={pct(redVs(b2025))} unit={b2025 != null ? `基準 ${b2025}` : ''}
            sub="市場別 · 2025 預計基準年" />
        </section>
        <p className="-mt-4 text-xs text-gray-400">
          地域別強度 = {iloc == null ? '—' : `${iloc.toFixed(4)} kgCO₂e/標打`}（僅供參考，基準年僅有市場別、地域別不比基準）
        </p>

        {/* 綠電占比 */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">綠電占比（連動所選月份）</h2>
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="text-3xl font-bold" style={{ color: HEADER_BG }}>{data.greenPower.ratio.toFixed(1)}%</div>
              <div className="text-xs text-gray-400 mt-1">(iREC + 太陽能) ÷ 總用電</div>
            </div>
            <GreenCol label="iREC 憑證" kwh={data.greenPower.irec_kwh} />
            <GreenCol label="自發太陽能" kwh={data.greenPower.solar_kwh} />
            <GreenCol label="總用電" kwh={data.greenPower.total_kwh} muted />
          </div>
        </section>

        {/* 各廠 / 產區碳排表 */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 px-1">各廠區碳排（tCO₂e）· 產區加總</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full border-collapse text-sm bg-white">
              <thead>
                <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                  <th className="px-4 py-2.5 text-left">廠 / 產區</th>
                  <th className="px-3 py-2.5 text-right">S1</th>
                  <th className="px-3 py-2.5 text-right">S2 地域</th>
                  <th className="px-3 py-2.5 text-right">S2 市場</th>
                  <th className="px-3 py-2.5 text-right">S1+S2 地域</th>
                  <th className="px-3 py-2.5 text-right">S1+S2 市場</th>
                </tr>
              </thead>
              <tbody>
                <Row bold bg="bg-blue-50/60" label="集團合計" f={data.totals} labelClass="text-[#1e3a5f]" />
                {countries.map((c) => {
                  const rows = byCountry.get(c)!;
                  const sub = rows.reduce(
                    (a, f) => ({
                      s1: a.s1 + f.s1, s2_loc: a.s2_loc + f.s2_loc, s2_mkt: a.s2_mkt + f.s2_mkt,
                      s1s2_loc: a.s1s2_loc + f.s1s2_loc, s1s2_mkt: a.s1s2_mkt + f.s1s2_mkt,
                    }),
                    { s1: 0, s2_loc: 0, s2_mkt: 0, s1s2_loc: 0, s1s2_mkt: 0 },
                  );
                  return (
                    <FragmentGroup key={c}>
                      <Row bold bg="bg-gray-100" label={`${COUNTRY_LABELS[c] ?? c} 產區加總`} f={sub} labelClass="text-gray-700" />
                      {rows.map((f) => (
                        <Row key={f.factory_code} label={f.factory_code} sublabel={f.name_zh} f={f} />
                      ))}
                    </FragmentGroup>
                  );
                })}
                {data.factories.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">此條件下尚無資料</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 減碳路徑圖 */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">減碳路徑圖（市場別 kgCO₂e/標打，2020–2050）</h2>
          <PathwayChart b2020={b2020} b2025={b2025} actualYear={year} actual={im} />
          <p className="text-xs text-gray-400 mt-2">
            兩條基準線皆收斂至 2030 減 50%、2050 減 100%（歸零）｜ 綠點為所選條件之市場別實際強度 ｜ AI 試算，需永續發展部確認
          </p>
        </section>
      </main>
    </div>
  );
}

// ── 小元件 ──────────────────────────────────────────────────
function rangeYears(from: number, to: number): number[] {
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

function FragmentGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function Seg({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <span className="flex items-center gap-1.5 text-green-200">{label}
      <span className="inline-flex rounded-lg overflow-hidden border border-white/30">
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onChange(v)}
            className="px-2.5 py-1 text-xs transition"
            style={value === v ? { backgroundColor: '#fff', color: HEADER_BG } : { color: '#fff' }}>
            {lbl}
          </button>
        ))}
      </span>
    </span>
  );
}

function Kpi({ title, value, unit, sub, accent }: {
  title: string; value: string; unit?: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border shadow-sm p-5 ${accent ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono" style={{ color: HEADER_BG }}>{value}</span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-gray-400 mt-1.5">{sub}</div>}
    </div>
  );
}

function GreenCol({ label, kwh, muted }: { label: string; kwh: number; muted?: boolean }) {
  return (
    <div>
      <div className={`text-xl font-bold font-mono ${muted ? 'text-gray-500' : 'text-teal-700'}`}>{fmt0(kwh)}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}（kWh）</div>
    </div>
  );
}

function Row({ label, sublabel, f, bold, bg, labelClass }: {
  label: string; sublabel?: string;
  f: { s1: number; s2_loc: number; s2_mkt: number; s1s2_loc: number; s1s2_mkt: number };
  bold?: boolean; bg?: string; labelClass?: string;
}) {
  const td = `px-3 py-2 text-right font-mono ${bold ? 'font-semibold' : 'text-gray-700'}`;
  return (
    <tr className={`${bg ?? 'bg-white'} ${bold ? '' : 'hover:bg-gray-50'}`}>
      <td className={`px-4 py-2 ${bold ? 'font-semibold' : 'font-medium text-gray-700'} ${labelClass ?? ''}`}>
        {label}{sublabel && <span className="text-xs text-gray-400 ml-2">{sublabel}</span>}
      </td>
      <td className={td}>{fmt2(f.s1)}</td>
      <td className={td}>{fmt2(f.s2_loc)}</td>
      <td className={td}>{fmt2(f.s2_mkt)}</td>
      <td className={td}>{fmt2(f.s1s2_loc)}</td>
      <td className={td}>{fmt2(f.s1s2_mkt)}</td>
    </tr>
  );
}

// ── 減碳路徑圖（純 SVG 折線）──────────────────────────────────
function PathwayChart({ b2020, b2025, actualYear, actual }: {
  b2020: number | null; b2025: number | null; actualYear: number; actual: number | null;
}) {
  const W = 820, H = 340;
  const padL = 56, padR = 24, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const Y0 = 2020, Y1 = 2050;

  const t2030 = b2020 != null ? b2020 * (1 - T2030_RATIO) : null;
  const yMax = Math.max(b2020 ?? 0, b2025 ?? 0, actual ?? 0, 1) * 1.15;

  const xs = (yr: number) => padL + ((yr - Y0) / (Y1 - Y0)) * plotW;
  const ys = (v: number) => padT + plotH - (v / yMax) * plotH;

  const lineA = b2020 != null && t2030 != null
    ? [[Y0, b2020], [2030, t2030], [Y1, 0]] as [number, number][] : null;
  const lineB = b2025 != null && t2030 != null
    ? [[2025, b2025], [2030, t2030], [Y1, 0]] as [number, number][] : null;

  const path = (pts: [number, number][]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p[0])} ${ys(p[1])}`).join(' ');
  const xticks = [2020, 2025, 2030, 2035, 2040, 2045, 2050];
  const yticks = Array.from({ length: 6 }, (_, i) => (yMax / 5) * i);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img" aria-label="減碳路徑圖">
        {yticks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={padL} y1={ys(t)} x2={W - padR} y2={ys(t)} stroke="#eceff2" />
            <text x={padL - 8} y={ys(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{t.toFixed(2)}</text>
          </g>
        ))}
        {xticks.map((yr) => (
          <text key={yr} x={xs(yr)} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#374151">{yr}</text>
        ))}

        {lineA && <path d={path(lineA)} fill="none" stroke="#0C3D2E" strokeWidth={2.5} />}
        {lineB && <path d={path(lineB)} fill="none" stroke="#0d9488" strokeWidth={2.5} strokeDasharray="6 4" />}
        {lineA && lineA.map(([yr, v]) => <circle key={`a${yr}`} cx={xs(yr)} cy={ys(v)} r="3" fill="#0C3D2E" />)}
        {lineB && lineB.map(([yr, v]) => <circle key={`b${yr}`} cx={xs(yr)} cy={ys(v)} r="3" fill="#0d9488" />)}

        {actual != null && (<>
          <circle cx={xs(actualYear)} cy={ys(actual)} r="5" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
          <text x={xs(actualYear)} y={ys(actual) - 10} textAnchor="middle" fontSize="10" fill="#b45309" fontWeight="700">
            {actual.toFixed(2)}
          </text>
        </>)}

        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#cbd5e1" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" />
        <text x={padL} y={12} fontSize="10" fill="#9ca3af">kgCO₂e/標打</text>
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 text-xs px-2 text-gray-600">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ backgroundColor: '#0C3D2E' }} />2020 基準路徑</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ backgroundColor: '#0d9488' }} />2025 基準路徑</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />實際（市場別）</span>
      </div>
    </div>
  );
}

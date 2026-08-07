'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  COUNTRY_LABELS, IREC_KWH_PER_CERT,
  type ReductionResult, type FactoryReduction, type ScopeKey, type Basis,
} from '@/lib/reduction-types';
import FilterBar from './FilterBar';
import KpiCard from '@/components/KpiCard';
import StackedBarChart from '@/components/charts/StackedBarChart';
import DonutChart from '@/components/charts/DonutChart';
import HBarChart from '@/components/charts/HBarChart';
import { SCOPE_COLORS } from '@/components/theme';

const HEADER_BG = '#0C3D2E';
const COUNTRY_ORDER = ['TWN', 'CHN', 'NVN', 'SVN', 'CAB', 'SLV', 'BGD', 'IND'];
const T2030_RATIO = 0.5; // 2030 相比 2020 減 50%，2050 減 100%

type RowAgg = { s1: number; s2_loc: number; s2_mkt: number; s1s2_loc: number; s1s2_mkt: number; irec_kwh: number; biomass_co2: number };

const fmt2 = (v: number) => (v === 0 ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmt0 = (v: number) => (v === 0 ? '—' : Math.round(v).toLocaleString());
const certsFmt = (kwh: number) => (kwh === 0 ? '—' : (kwh / IREC_KWH_PER_CERT).toLocaleString(undefined, { maximumFractionDigits: 1 }));

// 相比基準變化：(當前 − 基準) ÷ 基準 × 100。負 = 減碳(變好)，正 = 增加(變差)。
function changeDisplay(v: number | null): { text: string; cls: string } {
  if (v == null) return { text: '—', cls: '' };
  if (v <= 0) return { text: `減碳 ${Math.abs(v).toFixed(1)}%`, cls: 'text-green-700' };
  return { text: `增加 ${v.toFixed(1)}%`, cls: 'text-red-600' };
}

export interface DashboardFilters {
  yearFrom: number;
  countryCode: string;
  factoryCode: string;
  scopes: ScopeKey[];
  basis: Basis;
}

export default function ReductionClient({ data, anomalyOpenCount, anomalyYear, allFactories, filters }: {
  data: ReductionResult; anomalyOpenCount?: number; anomalyYear?: number;
  allFactories: { factory_code: string; name_zh: string; country_code: string }[];
  filters: DashboardFilters;
}) {
  const router = useRouter();
  const { source, year, monthFrom, monthTo, factorYear } = data;
  const { countryCode, factoryCode, scopes, basis } = filters;
  const filterActive = countryCode !== '' || factoryCode !== '';

  // 依產區/工廠篩選（顯示層過濾；未影響伺服器端計算的集團級分母）
  const scopedFactories = useMemo(() => data.factories.filter((f) =>
    (!countryCode || f.country_code === countryCode) &&
    (!factoryCode || f.factory_code === factoryCode),
  ), [data.factories, countryCode, factoryCode]);
  const [projOn, setProjOn] = useState(false);
  // 投影僅 CSR 路徑（需 market_elec_kwh 等原始欄位；平台路徑為 undefined）
  const projectable = source === 'csr' && data.factories.some((f) => f.market_elec_kwh !== undefined);

  function buildParams(patch: Record<string, string | number> = {}) {
    const params = new URLSearchParams({
      source: data.source, year: String(data.year),
      monthFrom: String(data.monthFrom), monthTo: String(data.monthTo),
      recSource: data.recSource, factorYear: String(data.factorYear ?? data.year - 1),
    });
    for (const [k, v] of Object.entries(patch)) params.set(k, String(v));
    return params;
  }
  // 重新試算 → 回到設定引導（不帶 ready，page.tsx 便會改渲染 SetupWizard）
  function restart() {
    router.push('/reduction');
    router.refresh();
  }

  const b2020 = data.baselines.find((b) => b.base_year === 2020)?.intensity_market_kg ?? null;
  const b2025 = data.baselines.find((b) => b.base_year === 2025)?.intensity_market_kg ?? null;
  const im = data.intensity_market_kg;
  const iloc = data.intensity_location_kg;
  // 變化% = (當前 − 基準) ÷ 基準；負值代表減碳
  const chgVs = (base: number | null) => (base && base > 0 && im != null ? ((im - base) / base) * 100 : null);
  const c2020 = changeDisplay(chgVs(b2020));
  const c2025 = changeDisplay(chgVs(b2025));

  // 依產區分組（供明細表 + 產區加總表）
  const byCountry = new Map<string, FactoryReduction[]>();
  for (const f of data.factories) {
    if (!byCountry.has(f.country_code)) byCountry.set(f.country_code, []);
    byCountry.get(f.country_code)!.push(f);
  }
  const countries = [
    ...COUNTRY_ORDER.filter((c) => byCountry.has(c)),
    ...[...byCountry.keys()].filter((c) => !COUNTRY_ORDER.includes(c)),
  ];
  const regionAgg = (rows: FactoryReduction[]): RowAgg => rows.reduce(
    (a, f) => ({
      s1: a.s1 + f.s1, s2_loc: a.s2_loc + f.s2_loc, s2_mkt: a.s2_mkt + f.s2_mkt,
      s1s2_loc: a.s1s2_loc + f.s1s2_loc, s1s2_mkt: a.s1s2_mkt + f.s1s2_mkt,
      irec_kwh: a.irec_kwh + f.irec_kwh, biomass_co2: a.biomass_co2 + f.biomass_co2,
    }),
    { s1: 0, s2_loc: 0, s2_mkt: 0, s1s2_loc: 0, s1s2_mkt: 0, irec_kwh: 0, biomass_co2: 0 },
  );

  const exportUrl = `/api/reduction/export?${buildParams().toString()}`;

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
            <div className="flex flex-col items-end gap-2">
              <div className="text-right text-[11px] leading-relaxed bg-amber-400/15 border border-amber-300/40 rounded-lg px-3 py-1.5">
                ⚠️ AI 試算，基準值與減碳%<br />需<span className="font-semibold">永續發展部確認</span>，非最終結論
              </div>
              {!!anomalyOpenCount && (
                <a href={`/admin/anomaly${anomalyYear ? `?year=${anomalyYear}` : ''}`}
                  className="text-[11px] px-3 py-1 rounded-full bg-red-400/20 border border-red-300/50 hover:bg-red-400/30 transition">
                  ⚠ {anomalyYear} 年有 {anomalyOpenCount} 筆待處理異常 →
                </a>
              )}
            </div>
          </div>

          {/* 目前試算條件（唯讀；要改請按「重新試算減碳績效」回到設定引導） */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Chip label="資料來源" value={source === 'csr' ? 'CSR 匯出' : 'GHG 平台'} />
            <Chip label="年度" value={String(year)} />
            <Chip label="月份" value={`${monthFrom}–${monthTo} 月（${monthTo - monthFrom + 1} 個月）`} />
            {source === 'csr' && <>
              <Chip label="iREC" value={data.recSource === 'platform' ? 'GHG 平台帶入' : '手動輸入'} />
              <Chip label="係數年度" value={String(factorYear ?? year - 1)} />
            </>}
          </div>

          {/* 儀表板篩選：產區 / 工廠 / 年度區間 / 範疇 / 市場地域基準 */}
          <FilterBar
            factories={allFactories}
            source={source}
            yearFrom={filters.yearFrom}
            yearTo={year}
            scopes={scopes}
            basis={basis}
            countryCode={countryCode}
            factoryCode={factoryCode}
          />

          {/* 操作列：重新試算 / 情境試算 */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={restart}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/95 hover:bg-white transition"
              style={{ color: HEADER_BG }}>
              ↻ 重新試算減碳績效
            </button>
            {projectable && (
              <button type="button" onClick={() => setProjOn((v) => !v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/40 text-white hover:bg-white/10 transition">
                {projOn ? '▲ 收合情境試算' : '🧮 情境試算（推估至目標月／年底 iREC 缺口）'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        {data.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
            {data.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
          </div>
        )}

        {/* 手動 iREC 試算輸入（CSR + 手動模式） */}
        {source === 'csr' && data.recSource === 'manual' && (
          <ManualIrecPanel year={year} factories={data.factories} onSaved={() => router.refresh()} />
        )}

        {/* KPI 卡：標打強度 / 營業額強度（僅集團層級）/ 總排放當量（依範疇+基準篩選）/ 綠電占比 */}
        {(() => {
          const scopedEmission = scopedFactories.reduce((a, f) => {
            if (scopes.includes(1)) a += f.s1;
            if (scopes.includes(2)) a += basis === 'market' ? f.s2_mkt : f.s2_loc;
            if (scopes.includes(3)) a += f.s3;
            return a;
          }, 0);
          const scopedProduction = source === 'csr'
            ? scopedFactories.reduce((a, f) => a + (f.production ?? 0), 0)
            : (filterActive ? null : data.production);
          const scopedIntensity = scopedProduction && scopedProduction > 0
            ? (scopedEmission * 1000) / scopedProduction : null;
          const revenueDisabled = filterActive; // 營業額僅有集團年度資料
          const productionDisabled = source === 'platform' && filterActive; // 平台路徑無廠別標打產能

          return (
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <KpiCard title={`標打強度（${basis === 'market' ? '市場別' : '地域別'}）`}
                disabled={productionDisabled}
                disabledReason="平台路徑僅集團層級有標打產能"
                value={scopedIntensity == null ? '—' : scopedIntensity.toFixed(4)} unit="kgCO₂e/標打"
                sub={`已選範疇 S${scopes.join('/')} ÷ 標打產能（${scopedProduction != null ? fmt0(scopedProduction) : '—'} 標打）`}
                accent />
              <KpiCard title="營業額排放強度" disabled={revenueDisabled} disabledReason="僅在集團層級顯示"
                value={(() => {
                  if (revenueDisabled) return '—';
                  return '（需於年度指標維護頁填入營業額後顯示）';
                })()}
                unit="" sub="集團層級 · 需 annual_metrics.revenue_thousands" />
              <KpiCard title="總排放當量" value={fmt0(scopedEmission)} unit="tCO₂e"
                sub={`已選範疇 S${scopes.join('/')} · ${basis === 'market' ? '市場別' : '地域別'}（S2）`} accent />
              <KpiCard title="綠電占比" value={`${data.greenPower.ratio.toFixed(1)}%`} unit=""
                sub={filterActive ? '集團層級（尚未支援廠別綠電占比）' : 'iREC ÷ 總電量'} />
            </section>
          );
        })()}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard title="相比 2020 基準" value={c2020.text} valueClassName={c2020.cls} unit={b2020 != null ? `基準 ${b2020}` : ''}
            sub="市場別 · 2020 原定基準年 · 集團層級" />
          <KpiCard title="相比 2025 基準" value={c2025.text} valueClassName={c2025.cls} unit={b2025 != null ? `基準 ${b2025}` : ''}
            sub="市場別 · 2025 預計基準年 · 集團層級" />
        </section>
        <p className="-mt-4 text-xs text-gray-400">
          地域別強度 = {iloc == null ? '—' : `${iloc.toFixed(4)} kgCO₂e/標打`}（僅供參考，基準年僅有市場別、地域別不比基準）
        </p>

        {/* 圖表列 1：各產區排放當量 + 範疇占比（依篩選） */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-800 mb-3">各產區排放當量（tCO₂e）</h2>
            <HBarChart unit="t" rows={countries.map((c) => {
              const rows = byCountry.get(c)!.filter((f) =>
                (!countryCode || f.country_code === countryCode) && (!factoryCode || f.factory_code === factoryCode));
              return {
                label: COUNTRY_LABELS[c] ?? c,
                segments: [
                  ...(scopes.includes(1) ? [{ key: 's1', color: SCOPE_COLORS.s1, value: rows.reduce((a, f) => a + f.s1, 0) }] : []),
                  ...(scopes.includes(2) ? [{ key: 's2', color: basis === 'market' ? SCOPE_COLORS.s2_mkt : SCOPE_COLORS.s2_loc, value: rows.reduce((a, f) => a + (basis === 'market' ? f.s2_mkt : f.s2_loc), 0) }] : []),
                  ...(scopes.includes(3) ? [{ key: 's3', color: SCOPE_COLORS.s3, value: rows.reduce((a, f) => a + f.s3, 0) }] : []),
                ],
              };
            }).filter((r) => r.segments.some((s) => s.value > 0))} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-800 mb-3">範疇占比（{basis === 'market' ? '市場別' : '地域別'}）</h2>
            <DonutChart slices={[
              ...(scopes.includes(1) ? [{ label: '範疇一', color: SCOPE_COLORS.s1, value: scopedFactories.reduce((a, f) => a + f.s1, 0) }] : []),
              ...(scopes.includes(2) ? [{ label: '範疇二', color: basis === 'market' ? SCOPE_COLORS.s2_mkt : SCOPE_COLORS.s2_loc, value: scopedFactories.reduce((a, f) => a + (basis === 'market' ? f.s2_mkt : f.s2_loc), 0) }] : []),
              ...(scopes.includes(3) ? [{ label: '範疇三', color: SCOPE_COLORS.s3, value: scopedFactories.reduce((a, f) => a + f.s3, 0) }] : []),
            ]} />
          </div>
        </section>

        {/* 圖表列 2：年走勢（恆為全年，不受月份篩選影響） */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800">年走勢（{filters.yearFrom}–{year}）</h2>
            <span className="text-[11px] text-gray-400">此圖恆為全年聚合，不受月份篩選影響</span>
          </div>
          <StackedBarChart
            categories={data.yearly.map((y) => y.year)}
            series={[
              ...(scopes.includes(1) ? [{ key: 's1', label: '範疇一', color: SCOPE_COLORS.s1, values: data.yearly.map((y) => y.s1) }] : []),
              ...(scopes.includes(2) ? [{ key: 's2', label: `範疇二（${basis === 'market' ? '市場別' : '地域別'}）`, color: basis === 'market' ? SCOPE_COLORS.s2_mkt : SCOPE_COLORS.s2_loc, values: data.yearly.map((y) => (basis === 'market' ? y.s2_mkt : y.s2_loc)) }] : []),
              ...(scopes.includes(3) ? [{ key: 's3', label: '範疇三', color: SCOPE_COLORS.s3, values: data.yearly.map((y) => y.s3) }] : []),
            ]}
            line={{
              label: '排放強度（kgCO₂e/標打）', color: '#0d9488',
              values: data.yearly.map((y) => {
                const e = (scopes.includes(1) ? y.s1 : 0) + (scopes.includes(2) ? (basis === 'market' ? y.s2_mkt : y.s2_loc) : 0) + (scopes.includes(3) ? y.s3 : 0);
                return y.production > 0 ? (e * 1000) / y.production : null;
              }),
            }}
            yLabel="tCO₂e" y2Label="kgCO₂e/標打"
          />
        </section>

        {/* 情境試算（CSR，前端即時，不寫入資料庫） */}
        {projOn && projectable && (
          <ProjectionPanel data={data} b2020={b2020} b2025={b2025} />
        )}

        {/* 綠電占比 */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-3">綠電占比（連動所選月份）</h2>
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="text-3xl font-bold" style={{ color: HEADER_BG }}>{data.greenPower.ratio.toFixed(1)}%</div>
              <div className="text-xs text-gray-400 mt-1">iREC ÷ 總電量（非再生＋再生）</div>
            </div>
            <GreenCol label="iREC 憑證（分子）" kwh={data.greenPower.irec_kwh} sub={`${certsFmt(data.greenPower.irec_kwh)} 張`} />
            <GreenCol label="自發太陽能（參考）" kwh={data.greenPower.solar_kwh} />
            <GreenCol label="總電量（分母）" kwh={data.greenPower.total_kwh} muted />
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

        {/* 匯出列：緊貼兩張碳排數據表上方，看表時即可直接下載 */}
        <div className="flex flex-wrap items-center justify-between gap-3 -mb-2">
          <p className="text-xs text-gray-500">以下兩表為所選條件之碳排數據（tCO₂e）</p>
          <a href={exportUrl}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium transition shadow-sm"
            style={{ backgroundColor: HEADER_BG }}>
            ⬇ 匯出 Excel（產區加總＋各廠明細）
          </a>
        </div>

        {/* 表一：產區加總 */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 px-1">① 各產區加總（tCO₂e）</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full border-collapse text-sm bg-white">
              <TableHead first="產區" />
              <tbody>
                <Row bold bg="bg-blue-50/60" label="集團合計" f={data.totals} labelClass="text-[#1e3a5f]" />
                {countries.map((c) => (
                  <Row key={c} bold bg="bg-gray-50" label={COUNTRY_LABELS[c] ?? c} f={regionAgg(byCountry.get(c)!)} labelClass="text-gray-700" />
                ))}
                {data.factories.length === 0 && <EmptyRow />}
              </tbody>
            </table>
          </div>
        </section>

        {/* 表二：各廠明細 */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 px-1">② 各廠區碳排明細（tCO₂e）</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full border-collapse text-sm bg-white">
              <TableHead first="廠" />
              <tbody>
                {countries.map((c) => (
                  <FragmentGroup key={c}>
                    <Row bold bg="bg-gray-100" label={`${COUNTRY_LABELS[c] ?? c} 產區加總`} f={regionAgg(byCountry.get(c)!)} labelClass="text-gray-700" />
                    {byCountry.get(c)!.map((f) => (
                      <Row key={f.factory_code} label={f.factory_code} sublabel={f.name_zh} f={f} />
                    ))}
                  </FragmentGroup>
                ))}
                {data.factories.length === 0 && <EmptyRow />}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

// ── 手動 iREC 試算輸入 ───────────────────────────────────────
function ManualIrecPanel({ year, factories, onSaved }: {
  year: number; factories: FactoryReduction[]; onSaved: () => void;
}) {
  // 輸入框需顯示「全年」已存張數（不受目前所選月份攤提影響），故另向 GET /api/csr-rec 取值，
  // 不可直接用 f.irec_kwh（那已依所選月份數 ÷12 攤提，只供市場別強度計算用）。
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/csr-rec?year=${year}`).then((r) => r.json()).then((res) => {
      if (cancelled) return;
      const byCode = new Map<string, number>(
        (res.data ?? []).map((d: { factory_code: string; certs: number }) => [d.factory_code, d.certs]),
      );
      setVals(Object.fromEntries(factories.map((f) => {
        const certs = byCode.get(f.factory_code);
        return [f.factory_code, certs ? String(certs) : ''];
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function saveAll() {
    setSaving(true); setMsg('儲存中…');
    try {
      for (const f of factories) {
        const raw = vals[f.factory_code];
        const certs = raw === '' || raw == null ? 0 : Number(raw);
        if (isNaN(certs)) continue;
        await fetch('/api/csr-rec', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, factory_code: f.factory_code, certs }),
        });
      }
      setMsg('✅ 已儲存，重新計算中…');
      onSaved();
    } catch {
      setMsg('❌ 儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  // 依產區分組：一列一個產區
  const byCC = new Map<string, FactoryReduction[]>();
  for (const f of factories) {
    if (!byCC.has(f.country_code)) byCC.set(f.country_code, []);
    byCC.get(f.country_code)!.push(f);
  }
  const regions = [
    ...COUNTRY_ORDER.filter((c) => byCC.has(c)),
    ...[...byCC.keys()].filter((c) => !COUNTRY_ORDER.includes(c)),
  ];

  return (
    <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-amber-900">手動 iREC 試算（各廠購買張數，1 張 = 1 MWh）</h2>
          <p className="text-xs text-amber-700 mt-0.5">此模式改用手動輸入取代平台 iREC，供情境試算；儲存後即重算市場別與綠電占比。一列為一個產區。</p>
        </div>
        <button onClick={saveAll} disabled={saving}
          className="px-5 py-2 rounded-lg text-white text-sm font-medium transition disabled:opacity-60"
          style={{ backgroundColor: HEADER_BG }}>{saving ? '儲存中…' : '儲存並重算'}</button>
      </div>
      <div className="divide-y divide-amber-200 border-t border-amber-200">
        {regions.map((cc) => (
          <div key={cc} className="flex flex-wrap items-center gap-2 py-2.5">
            <div className="w-16 shrink-0 text-sm font-bold text-amber-900">{COUNTRY_LABELS[cc] ?? cc}</div>
            {byCC.get(cc)!.map((f) => (
              <label key={f.factory_code} title={f.name_zh}
                className="flex items-center gap-1.5 bg-white rounded-lg border border-amber-100 px-2.5 py-1.5">
                <span className="text-xs text-gray-600 font-mono whitespace-nowrap">{f.factory_code}</span>
                <input type="number" min="0" step="any" value={vals[f.factory_code] ?? ''}
                  onChange={(e) => setVals((p) => ({ ...p, [f.factory_code]: e.target.value }))}
                  className="border border-gray-300 rounded px-2 py-0.5 text-sm font-mono w-20 focus:outline-none focus:ring-2 focus:ring-green-500" />
                <span className="text-xs text-gray-400">張</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {msg && <p className="text-xs text-amber-800 mt-3">{msg}</p>}
    </section>
  );
}

// ── 情境試算（projection）───────────────────────────────────
// 前端即時線性外推，不寫入資料庫。能源／產出／S1／S2 隨活動量等比放大；
// iREC 以「年度規劃量」另按 ÷12×目標月 攤提（與能源不同基準）。市場別 S2 因逐廠
// 有 max(0, 電量−iREC) 封頂，必須逐廠重算再加總，故需 market_elec_kwh、mkt_factor。

type ProjRow = {
  s1: number; s2_loc: number; s2_mkt: number; s1s2_mkt: number;
  irecKwh: number; purchased: number; solar: number; clamped: boolean;
};

// scale = 目標月/實際月；irecKwh = 已攤提後的度數（呼叫端算好）
function projectFactory(f: FactoryReduction, scale: number, irecKwh: number): ProjRow {
  const s1 = f.s1 * scale;
  const s2_loc = f.s2_loc * scale;
  const mktBase = Math.max(0, (f.market_elec_kwh ?? 0) * scale - irecKwh);
  const s2_mkt = (mktBase * (f.mkt_factor ?? 0)) / 1000;
  return {
    s1, s2_loc, s2_mkt, s1s2_mkt: s1 + s2_mkt, irecKwh,
    purchased: (f.purchased_kwh ?? 0) * scale, solar: (f.solar_kwh ?? 0) * scale,
    clamped: mktBase === 0 && irecKwh > 0,
  };
}

// 2025 基準路徑於指定年度線性內插：2025→b2025、2030→b2020×0.5、2050→0
function pathwayTargetAt(yr: number, b2020: number | null, b2025: number | null): number | null {
  if (b2020 == null || b2025 == null) return null;
  const t2030 = b2020 * (1 - T2030_RATIO);
  if (yr <= 2025) return b2025;
  if (yr <= 2030) return b2025 + ((t2030 - b2025) * (yr - 2025)) / 5;
  if (yr <= 2050) return t2030 + ((0 - t2030) * (yr - 2030)) / 20;
  return 0;
}

function ProjectionPanel({ data, b2020, b2025 }: {
  data: ReductionResult; b2020: number | null; b2025: number | null;
}) {
  const factories = data.factories;
  const [actualM, setActualM] = useState(String(data.csrActualMonths || (data.monthTo - data.monthFrom + 1)));
  const [targetM, setTargetM] = useState('9');
  const [annualCerts, setAnnualCerts] = useState<Record<string, string>>({});
  const [targetMode, setTargetMode] = useState<'pathway' | 'manual'>('pathway');
  const [manualTarget, setManualTarget] = useState('');
  const [exporting, setExporting] = useState(false);

  const aM = Math.max(1, Number(actualM) || 0);
  const tM = Math.max(0, Number(targetM) || 0);
  const scale = tM / aM;
  const certsOf = (code: string) => Number(annualCerts[code]) || 0;
  const irecKwhTarget = (code: string) => certsOf(code) * IREC_KWH_PER_CERT * (tM / 12);

  // 帶入 GHG 平台目前 iREC 量：抓「全年」已登錄的 rec_certificates 總量（不受頁首所選月份攤提影響），
  // 因這裡的「年度規劃 iREC」欄位本身即代表全年一次性採購量。
  async function fillFromPlatform() {
    try {
      const res = await fetch(`/api/rec-certificates?year=${data.year}`);
      const json = await res.json();
      const sums = new Map<string, number>();
      for (const row of (json.data ?? []) as Array<{ factory_code: string; rec_kwh: number }>) {
        sums.set(row.factory_code, (sums.get(row.factory_code) || 0) + (Number(row.rec_kwh) || 0));
      }
      setAnnualCerts(Object.fromEntries(
        factories.map((f) => [f.factory_code, String(Math.round((sums.get(f.factory_code) || 0) / IREC_KWH_PER_CERT * 100) / 100)]),
      ));
    } catch { /* 忽略：維持原輸入值 */ }
  }

  // ── 目標月投影 ──
  const proj = useMemo(() => {
    let s1 = 0, s1s2_mkt = 0, s2_mkt = 0, greenIrec = 0, greenTotal = 0;
    const clamped: string[] = [];
    const rows = factories.map((f) => {
      const r = projectFactory(f, scale, irecKwhTarget(f.factory_code));
      s1 += r.s1; s1s2_mkt += r.s1s2_mkt; s2_mkt += r.s2_mkt;
      greenIrec += r.irecKwh; greenTotal += r.purchased + r.solar;
      if (r.clamped) clamped.push(f.factory_code);
      return { f, r };
    });
    const production = data.production * scale;
    const intensity = production > 0 ? (s1s2_mkt * 1000) / production : null;
    const greenRatio = greenTotal > 0 ? (greenIrec / greenTotal) * 100 : 0;
    return { rows, s1, s2_mkt, s1s2_mkt, production, intensity, greenRatio, greenIrec, greenTotal, clamped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories, scale, tM, annualCerts, data.production]);

  // ── 年底(12月)缺口 ──
  const gap = useMemo(() => {
    const scale12 = 12 / aM;
    let s1_12 = 0, s1s2_mkt_12 = 0, s2_mkt_12 = 0;
    for (const f of factories) {
      const r = projectFactory(f, scale12, certsOf(f.factory_code) * IREC_KWH_PER_CERT); // 全年 iREC
      s1_12 += r.s1; s1s2_mkt_12 += r.s1s2_mkt; s2_mkt_12 += r.s2_mkt;
    }
    const prod12 = data.production * scale12;
    const T = targetMode === 'pathway' ? pathwayTargetAt(data.year, b2020, b2025) : (manualTarget === '' ? null : Number(manualTarget));
    // 加權平均市場別係數（實際期間電量加權）
    let wNum = 0, wDen = 0;
    for (const f of factories) { wNum += (f.mkt_factor ?? 0) * (f.market_elec_kwh ?? 0); wDen += f.market_elec_kwh ?? 0; }
    const wbar = wDen > 0 ? wNum / wDen : 0;
    if (T == null || prod12 <= 0) return { T, prod12, s1s2_mkt_12, s1_12, s2_mkt_12, wbar, allowed: null as number | null, gap_t: null as number | null, feasible: true, certs: null as number | null };
    const allowed = (T * prod12) / 1000; // 允許之 S1+S2(市) tCO₂e
    const gap_t = s1s2_mkt_12 - allowed;
    const feasible = allowed > s1_12; // 即使 S2 歸零仍 > 允許 → 單靠 iREC 無法達標
    const certs = gap_t > 0 && feasible && wbar > 0 ? (gap_t * 1000) / wbar / IREC_KWH_PER_CERT : gap_t <= 0 ? 0 : null;
    return { T, prod12, s1s2_mkt_12, s1_12, s2_mkt_12, wbar, allowed, gap_t, feasible, certs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories, aM, annualCerts, targetMode, manualTarget, b2020, b2025, data.year, data.production]);

  const projChg = (base: number | null) => (base && base > 0 && proj.intensity != null ? ((proj.intensity - base) / base) * 100 : null);
  const pc2020 = changeDisplay(projChg(b2020));
  const pc2025 = changeDisplay(projChg(b2025));

  // ── 依產區分組（iREC 輸入格）──
  const byCC = new Map<string, FactoryReduction[]>();
  for (const f of factories) { if (!byCC.has(f.country_code)) byCC.set(f.country_code, []); byCC.get(f.country_code)!.push(f); }
  const regions = [
    ...COUNTRY_ORDER.filter((c) => byCC.has(c)),
    ...[...byCC.keys()].filter((c) => !COUNTRY_ORDER.includes(c)),
  ];

  async function exportExcel() {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const meta: (string | number)[][] = [
        ['減碳績效追蹤 — 情境試算匯出'],
        ['資料來源', 'CSR 匯出'], ['年度', data.year],
        ['實際資料月數', aM], ['投影目標月數', tM], ['放大倍率 (目標/實際)', r2(scale)],
        ['目標基準來源', targetMode === 'pathway' ? '依減碳路徑自動' : '手動輸入'],
        ['目標市場別強度 T (kgCO₂e/標打)', gap.T == null ? '—' : r2(gap.T)],
        ['投影市場別強度 (kgCO₂e/標打)', proj.intensity == null ? '—' : r2(proj.intensity)],
        ['年底(12月)投影 S1+S2(市) tCO₂e', r2(gap.s1s2_mkt_12)],
        ['年底缺口 tCO₂e', gap.gap_t == null ? '—' : r2(gap.gap_t)],
        ['年底約需額外 iREC (張，近似)', gap.certs == null ? (gap.feasible ? '—' : '單靠iREC無法達標') : Math.ceil(gap.certs)],
        ['備註', 'AI 試算，情境模擬結果需永續發展部確認，非最終結論'],
      ];
      const irecPlan: (string | number)[][] = [['廠代碼', '名稱', '產區', '年度規劃 iREC (張)']];
      for (const f of factories) irecPlan.push([f.factory_code, f.name_zh, COUNTRY_LABELS[f.country_code] ?? f.country_code, certsOf(f.factory_code)]);

      const header = ['S1', 'S2 市場', 'S1+S2 市場', '投影 iREC 度數', '封頂'];
      const facRows: (string | number)[][] = [[`各廠明細（投影至 ${tM} 月，tCO₂e）`], ['廠代碼', '名稱', '產區', ...header]];
      const region = new Map<string, { s1: number; s2_mkt: number; s1s2_mkt: number; irecKwh: number }>();
      for (const { f, r } of proj.rows) {
        facRows.push([f.factory_code, f.name_zh, COUNTRY_LABELS[f.country_code] ?? f.country_code,
          r2(r.s1), r2(r.s2_mkt), r2(r.s1s2_mkt), Math.round(r.irecKwh), r.clamped ? '是' : '']);
        const cur = region.get(f.country_code) ?? { s1: 0, s2_mkt: 0, s1s2_mkt: 0, irecKwh: 0 };
        cur.s1 += r.s1; cur.s2_mkt += r.s2_mkt; cur.s1s2_mkt += r.s1s2_mkt; cur.irecKwh += r.irecKwh;
        region.set(f.country_code, cur);
      }
      const regRows: (string | number)[][] = [[`產區加總（投影至 ${tM} 月，tCO₂e）`], ['產區', 'S1', 'S2 市場', 'S1+S2 市場', '投影 iREC 度數']];
      regRows.push(['集團合計', r2(proj.s1), r2(proj.s2_mkt), r2(proj.s1s2_mkt), Math.round(proj.greenIrec)]);
      for (const [cc, t] of region) regRows.push([COUNTRY_LABELS[cc] ?? cc, r2(t.s1), r2(t.s2_mkt), r2(t.s1s2_mkt), Math.round(t.irecKwh)]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '試算摘要');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(regRows), '產區加總(投影)');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(facRows), '各廠明細(投影)');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(irecPlan), 'iREC規劃');
      XLSX.writeFile(wb, `reduction_projection_${data.year}_${aM}to${tM}m.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  const monthOnlyLump = data.csrActualMonths === 0;

  return (
    <section className="bg-blue-50/40 border border-blue-200 rounded-xl p-5 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-[#1e3a5f]">🧮 情境試算（推估至目標月）</h2>
          <p className="text-xs text-blue-800/70 mt-0.5">
            以實際期間資料線性外推：能源／產出／S1／S2 按 <b>÷實際月×目標月</b> 放大；iREC 以年度規劃量按 <b>÷12×目標月</b> 攤提（基準不同）。全在前端即時計算，<b>不寫入資料庫</b>。
          </p>
        </div>
        <button onClick={exportExcel} disabled={exporting}
          className="px-4 py-2 rounded-lg text-white text-sm font-medium transition disabled:opacity-60 shrink-0"
          style={{ backgroundColor: HEADER_BG }}>{exporting ? '匯出中…' : '⬇ 另存試算 Excel'}</button>
      </div>

      {monthOnlyLump && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          ⚠️ 該年 CSR 能源為整年式（month=0）或查無月度資料，無法自動偵測實際月數；請手動確認「實際月數」，月度線性外推可能失真。
        </div>
      )}

      {/* 控制列 */}
      <div className="flex flex-wrap items-end gap-4">
        <NumField label="實際資料月數" hint={`偵測 ${data.csrActualMonths ?? '—'} 個月`} value={actualM} onChange={setActualM} />
        <NumField label="投影目標月數" hint="例：至 9 月填 9" value={targetM} onChange={setTargetM} />
        <div className="text-xs text-blue-800/70 pb-1.5">放大倍率 <b className="font-mono text-sm">{isFinite(scale) ? scale.toFixed(3) : '—'}×</b></div>
      </div>

      {/* 投影 KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-blue-200 bg-white shadow-sm p-4">
          <div className="text-xs text-gray-500">投影市場別強度</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#1e3a5f]">{proj.intensity == null ? '—' : proj.intensity.toFixed(4)}</span>
            <span className="text-xs text-gray-400">kgCO₂e/標打</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1.5">
            實際（{aM} 月）= {data.intensity_market_kg == null ? '—' : data.intensity_market_kg.toFixed(4)} → 投影（{tM} 月）
          </div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-white shadow-sm p-4">
          <div className="text-xs text-gray-500">投影相比 2020 基準</div>
          <div className={`mt-1 text-2xl font-bold font-mono ${pc2020.cls}`}>{pc2020.text}</div>
          <div className="text-[11px] text-gray-400 mt-1.5">{b2020 != null ? `基準 ${b2020}` : ''}</div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-white shadow-sm p-4">
          <div className="text-xs text-gray-500">投影相比 2025 基準</div>
          <div className={`mt-1 text-2xl font-bold font-mono ${pc2025.cls}`}>{pc2025.text}</div>
          <div className="text-[11px] text-gray-400 mt-1.5">{b2025 != null ? `基準 ${b2025}` : ''}</div>
        </div>
      </div>

      {/* 各廠年度規劃 iREC 輸入 */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="text-sm font-bold text-[#1e3a5f]">各廠年度規劃 iREC（張，1 張 = 1 MWh）</div>
          <button type="button" onClick={fillFromPlatform}
            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-blue-300 text-[#1e3a5f] bg-white hover:bg-blue-50 transition">
            ⤵ 帶入 GHG 平台目前 iREC 量
          </button>
        </div>
        <p className="text-xs text-blue-800/70 mb-2">此為<b>全年</b>規劃量；投影至目標月時自動按 ÷12×{tM || '?'} 攤提。留空 = 0。可先按上方按鈕帶入 GHG 平台 {data.year} 年全年已登錄 iREC（不受頁首所選月份影響），再手動調整。</p>
        <div className="divide-y divide-blue-100 border-t border-blue-100">
          {regions.map((cc) => (
            <div key={cc} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="w-16 shrink-0 text-sm font-bold text-[#1e3a5f]">{COUNTRY_LABELS[cc] ?? cc}</div>
              {byCC.get(cc)!.map((f) => {
                const isClamped = proj.clamped.includes(f.factory_code);
                return (
                  <label key={f.factory_code} title={f.name_zh}
                    className={`flex items-center gap-1.5 bg-white rounded-lg border px-2.5 py-1.5 ${isClamped ? 'border-amber-300' : 'border-blue-100'}`}>
                    <span className="text-xs text-gray-600 font-mono whitespace-nowrap">{f.factory_code}</span>
                    <input type="number" min="0" step="any" value={annualCerts[f.factory_code] ?? ''}
                      onChange={(e) => setAnnualCerts((p) => ({ ...p, [f.factory_code]: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-0.5 text-sm font-mono w-20 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <span className="text-xs text-gray-400">張</span>
                    {isClamped && <span className="text-[10px] text-amber-600" title="攤提後 iREC 超過市場電量，超買無效">超買</span>}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 路徑圖（含投影點） */}
      <div className="bg-white rounded-xl border border-blue-100 p-4">
        <div className="text-sm font-bold text-[#1e3a5f] mb-2">減碳路徑圖（含情境投影點）</div>
        <PathwayChart b2020={b2020} b2025={b2025} actualYear={data.year} actual={data.intensity_market_kg} projected={proj.intensity} />
      </div>

      {/* 年底 iREC 缺口 */}
      <div className="bg-white rounded-xl border border-blue-100 p-4 space-y-3">
        <div className="text-sm font-bold text-[#1e3a5f]">年底（12 月）達標缺口 — 還需補多少 iREC</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Seg label="目標來源" value={targetMode}
            options={[['pathway', '依減碳路徑自動'], ['manual', '手動輸入']]}
            onChange={(v) => setTargetMode(v as 'pathway' | 'manual')} />
          {targetMode === 'manual'
            ? <NumField label="目標市場別強度 T" hint="kgCO₂e/標打" value={manualTarget} onChange={setManualTarget} />
            : <div className="text-xs text-gray-500 pb-1.5">路徑推算 {data.year} 年應達 <b className="font-mono text-sm text-[#1e3a5f]">{gap.T == null ? '—' : gap.T.toFixed(4)}</b> kgCO₂e/標打</div>}
        </div>
        <GapResult gap={gap} />
        <p className="text-[11px] text-gray-400">
          缺口以年底（12 月）視野推估：允許排放 = T × 年化標打產能。約需 iREC 以「各廠市場別係數之電量加權平均」換算，為<b>近似值</b>——未計各廠係數差異與逐廠封頂，實際採購請依廠別逐一核算。
        </p>
      </div>

      <div className="text-[11px] leading-relaxed bg-amber-400/15 border border-amber-300/40 rounded-lg px-3 py-2 text-amber-800">
        ⚠️ AI 試算，情境模擬結果（投影強度、減碳%、iREC 缺口）需<b>永續發展部確認</b>，非最終結論。
      </div>
    </section>
  );
}

function GapResult({ gap }: { gap: { T: number | null; gap_t: number | null; feasible: boolean; certs: number | null; allowed: number | null; s1s2_mkt_12: number } }) {
  if (gap.T == null) return <div className="text-sm text-gray-500">請選擇或輸入目標強度以計算缺口。</div>;
  if (gap.allowed == null) return <div className="text-sm text-gray-500">查無標打產能，無法計算缺口。</div>;
  if (!gap.feasible) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        ⚠️ 即使市場別 S2 全數以 iREC 抵銷歸零，年底 S1 仍高於允許排放 —— <b>單靠 iREC 無法達標，需同時削減 Scope 1</b>。
        <div className="text-xs text-red-500 mt-1">年底投影 S1+S2(市) {gap.s1s2_mkt_12.toFixed(1)} tCO₂e ｜ 允許 {gap.allowed.toFixed(1)} tCO₂e</div>
      </div>
    );
  }
  if ((gap.gap_t ?? 0) <= 0) {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
        ✅ 依目前規劃，年底投影已達標（無需額外 iREC）。
        <div className="text-xs text-green-600 mt-1">年底投影 S1+S2(市) {gap.s1s2_mkt_12.toFixed(1)} tCO₂e ≤ 允許 {gap.allowed.toFixed(1)} tCO₂e</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
      約需額外 <b className="font-mono text-lg text-[#1e3a5f]">{gap.certs == null ? '—' : Math.ceil(gap.certs).toLocaleString()}</b> 張 iREC（近似）才能於年底達標。
      <div className="text-xs text-blue-600 mt-1">缺口 {gap.gap_t!.toFixed(1)} tCO₂e ｜ 年底投影 {gap.s1s2_mkt_12.toFixed(1)} → 允許 {gap.allowed.toFixed(1)} tCO₂e</div>
    </div>
  );
}

function NumField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-600">{label}{hint && <span className="text-gray-400 ml-1">({hint})</span>}</span>
      <input type="number" min="0" step="any" value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded-lg px-2.5 py-1 text-sm font-mono w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </label>
  );
}

// ── 小元件 ──────────────────────────────────────────────────
/** 頁首唯讀條件標籤（試算條件由設定引導決定，此處僅呈現） */
function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/25 px-2.5 py-1">
      <span className="text-green-300">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </span>
  );
}

function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TableHead({ first }: { first: string }) {
  return (
    <thead>
      <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
        <th className="px-4 py-2.5 text-left">{first}</th>
        <th className="px-3 py-2.5 text-right">S1</th>
        <th className="px-3 py-2.5 text-right">S2 地域</th>
        <th className="px-3 py-2.5 text-right">S2 市場</th>
        <th className="px-3 py-2.5 text-right">S1+S2 地域</th>
        <th className="px-3 py-2.5 text-right">S1+S2 市場</th>
        <th className="px-3 py-2.5 text-right">iREC 張數</th>
        <th className="px-3 py-2.5 text-right">生質CO₂<br /><span className="text-[10px] font-normal opacity-80">另計·不入S1</span></th>
      </tr>
    </thead>
  );
}

function EmptyRow() {
  return <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">此條件下尚無資料</td></tr>;
}

function Seg({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <span className="flex items-center gap-1.5 text-green-200">{label}
      <span className="inline-flex rounded-lg overflow-hidden border border-white/30">
        {options.map(([v, lbl]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className="px-2.5 py-1 text-xs transition"
            style={value === v ? { backgroundColor: '#fff', color: HEADER_BG } : { color: '#fff' }}>
            {lbl}
          </button>
        ))}
      </span>
    </span>
  );
}

function Kpi({ title, value, unit, sub, accent, valueClassName }: {
  title: string; value: string; unit?: string; sub?: string; accent?: boolean; valueClassName?: string;
}) {
  return (
    <div className={`rounded-xl border shadow-sm p-5 ${accent ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold font-mono ${valueClassName ?? ''}`}
          style={valueClassName ? undefined : { color: HEADER_BG }}>{value}</span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-gray-400 mt-1.5">{sub}</div>}
    </div>
  );
}

function GreenCol({ label, kwh, muted, sub }: { label: string; kwh: number; muted?: boolean; sub?: string }) {
  return (
    <div>
      <div className={`text-xl font-bold font-mono ${muted ? 'text-gray-500' : 'text-teal-700'}`}>{fmt0(kwh)}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}（kWh）{sub && <span className="text-teal-600 ml-1">· {sub}</span>}</div>
    </div>
  );
}

function Row({ label, sublabel, f, bold, bg, labelClass }: {
  label: string; sublabel?: string; f: RowAgg;
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
      <td className={`${td} text-teal-700`}>{certsFmt(f.irec_kwh)}</td>
      <td className={`${td} text-amber-700`}>{fmt2(f.biomass_co2)}</td>
    </tr>
  );
}

// ── 減碳路徑圖（純 SVG 折線）──────────────────────────────────
function PathwayChart({ b2020, b2025, actualYear, actual, projected }: {
  b2020: number | null; b2025: number | null; actualYear: number; actual: number | null;
  projected?: number | null;
}) {
  const W = 820, H = 340;
  const padL = 56, padR = 24, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const Y0 = 2020, Y1 = 2050;

  const t2030 = b2020 != null ? b2020 * (1 - T2030_RATIO) : null;
  const yMax = Math.max(b2020 ?? 0, b2025 ?? 0, actual ?? 0, projected ?? 0, 1) * 1.15;

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

        {projected != null && (<>
          <circle cx={xs(actualYear)} cy={ys(projected)} r="5" fill="#fff" stroke="#2563eb" strokeWidth="2" />
          <text x={xs(actualYear)} y={ys(projected) + (actual != null && projected > actual ? 16 : -10)}
            textAnchor="middle" fontSize="10" fill="#2563eb" fontWeight="700">
            {projected.toFixed(2)}
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
        {projected != null && (
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: '#2563eb', backgroundColor: '#fff' }} />情境模擬（投影至目標月）</span>
        )}
      </div>
    </div>
  );
}

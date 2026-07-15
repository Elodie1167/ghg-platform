'use client';

import { useRouter } from 'next/navigation';
import type { FactoryMeta, SourceMeta, MatrixCell, ScopeAgg, RecAgg, GasAgg, ScopeGasAgg } from './page';

const CAT_PREFIX: Record<string, string> = {
  '1-1': '固定燃燒', '1-2': '移動燃燒', '1-3': '製程排放', '1-4': '逸散排放',
  '2-1': '外購電力',
  '3-1': '採購商品與服務', '3-3': '燃料及能源相關', '3-4': '上游運輸',
  '3-5': '廢棄物處理', '3-6': '商務旅行', '3-7': '員工通勤', '3-9': '下游運輸',
};

// These categories are collapsed to a single merged row
const MERGED_CAT: Record<string, string> = {
  '1-1': '鍋爐類',
  '1-3': '焊條',
  '3-5': '廢棄物處理',
};

const SCOPE_NAMES: Record<number, string> = {
  1: '範疇一 Scope 1',
  2: '範疇二 Scope 2',
  3: '範疇三 Scope 3',
};

const FACTORY_ORDER = [
  'TWN_TPE', 'TWN_CHY', 'TWN_ECO',
  'CHN_JY', 'CHN_JY_SP', 'CHN_SH', 'CHN_HY',
  'NVN_HN', 'NVN_MK1', 'NVN_MK2',
  'SVN_LDR', 'SVN_TRP',
  'CAB_MK1', 'CAB_MK2', 'CAB_MK5', 'CAB_MOHA',
  'SLV_MK', 'BGD_MK',
  'IND_DMK', 'IND_GLR1', 'IND_GLR2', 'IND_GLS', 'IND_STL',
];

const COUNTRY_LABELS: Record<string, string> = {
  TWN: '台灣', CHN: '中國', NVN: '北越', SVN: '南越',
  CAB: '柬埔寨', SLV: '薩爾瓦多', BGD: '孟加拉', IND: '印尼',
};

const HEADER_BG = '#0C3D2E';
const YEARS = [2023, 2024, 2025, 2026, 2027];
const COL_W = 72;

export default function SummaryClient({
  year, factories, sources, cells, scopeAggs, recAggs, gasAggs, scopeGasAggs,
}: {
  year: number;
  factories: FactoryMeta[];
  sources: SourceMeta[];
  cells: MatrixCell[];
  scopeAggs: ScopeAgg[];
  recAggs: RecAgg[];
  gasAggs: GasAgg[];
  scopeGasAggs: ScopeGasAgg[];
}) {
  const router = useRouter();

  // ── matrix: factory_code → source_code → co2e ──
  const matrix: Record<string, Record<string, number>> = {};
  for (const c of cells) {
    if (!matrix[c.factory_code]) matrix[c.factory_code] = {};
    matrix[c.factory_code][c.source_code] = c.co2e;
  }

  // ── scope aggregates: factory_code → scope → {loc, mkt, bio} ──
  const scopeMatrix: Record<string, Record<number, { loc: number; mkt: number; bio: number }>> = {};
  for (const a of scopeAggs) {
    if (!scopeMatrix[a.factory_code]) scopeMatrix[a.factory_code] = {};
    scopeMatrix[a.factory_code][a.scope] = {
      loc: a.co2e_location, mkt: a.co2e_market, bio: a.co2e_biomass,
    };
  }

  // ── rec & gas maps ──
  const recMap: Record<string, number> = {};
  for (const r of recAggs) recMap[r.factory_code] = r.rec_mwh;
  const gasMap: Record<string, GasAgg> = {};
  for (const g of gasAggs) gasMap[g.factory_code] = g;
  const scopeGasMap: Record<number, ScopeGasAgg> = {};
  for (const g of scopeGasAggs) scopeGasMap[g.scope] = g;

  // ── ordered factories ──
  const orderedFactories = [
    ...FACTORY_ORDER.filter((fc) => factories.some((f) => f.factory_code === fc)),
    ...factories
      .filter((f) => !FACTORY_ORDER.includes(f.factory_code))
      .map((f) => f.factory_code),
  ]
    .map((fc) => factories.find((f) => f.factory_code === fc)!)
    .filter(Boolean);

  // ── group sources by scope → category ──
  const scopeGroups = new Map<number, Map<string, SourceMeta[]>>();
  for (const s of sources) {
    if (!scopeGroups.has(s.scope)) scopeGroups.set(s.scope, new Map());
    const catKey = s.source_code.length >= 3 ? s.source_code.slice(0, 3) : s.source_code;
    const cat = scopeGroups.get(s.scope)!;
    if (!cat.has(catKey)) cat.set(catKey, []);
    cat.get(catKey)!.push(s);
  }

  const val = (fc: string, sc: string) => matrix[fc]?.[sc] ?? 0;
  const fmt = (v: number) => (v === 0 ? '—' : v.toFixed(4));
  const fmt2 = (v: number) => (v === 0 ? '—' : v.toFixed(2));
  const rowTotal = (sc: string) =>
    orderedFactories.reduce((s, f) => s + val(f.factory_code, sc), 0);
  const colSum = (fc: string, scodes: string[]) =>
    scodes.reduce((s, sc) => s + val(fc, sc), 0);

  const scopeList = [...scopeGroups.keys()].sort();

  // country band header
  const countryBands: { cc: string; count: number }[] = [];
  let lastCC = '';
  for (const f of orderedFactories) {
    if (f.country_code !== lastCC) {
      countryBands.push({ cc: f.country_code, count: 1 });
      lastCC = f.country_code;
    } else {
      countryBands[countryBands.length - 1].count++;
    }
  }

  // ── per-factory supplementary helpers ──
  const s1Total = (fc: string) => {
    const scodes = [...(scopeGroups.get(1)?.values() ?? [])].flatMap((v) =>
      v.map((x) => x.source_code),
    );
    return colSum(fc, scodes);
  };
  const s2Loc = (fc: string) => scopeMatrix[fc]?.[2]?.loc ?? 0;
  const s2Mkt = (fc: string) => scopeMatrix[fc]?.[2]?.mkt ?? 0;
  const s3Total = (fc: string) => {
    const scodes = [...(scopeGroups.get(3)?.values() ?? [])].flatMap((v) =>
      v.map((x) => x.source_code),
    );
    return colSum(fc, scodes);
  };
  const bioTotal = (fc: string) =>
    scopeList.reduce((sum, s) => sum + (scopeMatrix[fc]?.[s]?.bio ?? 0), 0);
  const recMwh = (fc: string) => recMap[fc] ?? 0;
  const s2Deducted = (fc: string) => s2Loc(fc) - s2Mkt(fc);

  const grandS1 = orderedFactories.reduce((s, f) => s + s1Total(f.factory_code), 0);
  const grandS2Loc = orderedFactories.reduce((s, f) => s + s2Loc(f.factory_code), 0);
  const grandS2Mkt = orderedFactories.reduce((s, f) => s + s2Mkt(f.factory_code), 0);
  const grandS3 = orderedFactories.reduce((s, f) => s + s3Total(f.factory_code), 0);
  const grandBio = orderedFactories.reduce((s, f) => s + bioTotal(f.factory_code), 0);
  const grandRec = orderedFactories.reduce((s, f) => s + recMwh(f.factory_code), 0);
  const grandDeducted = grandS2Loc - grandS2Mkt;

  // Total column count: 2 label + 1 集團合計 + N factories
  const totalCols = orderedFactories.length + 3;
  const tableMinWidth = `${300 + COL_W * (orderedFactories.length + 1)}px`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-full px-6 py-4 flex items-center justify-between">
          <div>
            <a href="/" className="text-green-300 text-xs hover:underline">
              ← 返回首頁
            </a>
            <h1 className="text-xl font-bold mt-0.5">集團碳排彙整表</h1>
            <p className="text-green-300 text-sm">
              {year} 年 ｜ 單位：tCO₂e ｜ 涵蓋全排放源 × 全廠別
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-green-300 text-sm">盤查年度</span>
            <select
              value={year}
              onChange={(e) => router.push(`/summary?year=${e.target.value}`)}
              className="bg-white/10 text-white border border-white/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            >
              {YEARS.map((y) => (
                <option key={y} value={y} className="text-black">
                  {y} 年
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="px-4 py-6">
        {/* ── CO₂e 彙整表 ── */}
        {/* overflow-auto + max-h 讓表格在有界容器內捲動，sticky 表頭/左欄才有作用 */}
        <div className="overflow-auto max-h-[80vh] rounded-xl border border-gray-200 shadow-sm">
          <table
            className="border-collapse text-xs bg-white"
            style={{ minWidth: tableMinWidth }}
          >
            <thead>
              {/* Row 1: country bands, 集團合計 FIRST（sticky top:0）*/}
              <tr style={{ backgroundColor: HEADER_BG }}>
                <th
                  colSpan={2}
                  className="sticky left-0 top-0 z-30 px-3 py-2 text-left text-white font-semibold border-r border-white/20"
                  style={{ backgroundColor: HEADER_BG, minWidth: '300px', height: '36px' }}
                >
                  排放源
                </th>
                <th
                  className="sticky top-0 z-20 px-2 py-2 text-center text-white font-bold border-l-2 border-white/40 whitespace-nowrap"
                  style={{ backgroundColor: HEADER_BG, minWidth: `${COL_W}px` }}
                >
                  集團合計
                </th>
                {countryBands.map((b) => (
                  <th
                    key={b.cc}
                    colSpan={b.count}
                    className="sticky top-0 z-20 px-2 py-2 text-center text-white font-semibold border-l border-white/20 whitespace-nowrap"
                    style={{ backgroundColor: HEADER_BG }}
                  >
                    {COUNTRY_LABELS[b.cc] ?? b.cc}
                  </th>
                ))}
              </tr>
              {/* Row 2: factory codes, 集團合計 FIRST（sticky top:36px 疊在 Row1 下方）*/}
              <tr className="border-b border-gray-200">
                <th
                  className="sticky left-0 z-30 px-2 py-2 text-left text-gray-600 font-medium border-r border-gray-200 whitespace-nowrap"
                  style={{ backgroundColor: '#f3f4f6', top: '36px', width: '80px', minWidth: '80px' }}
                >
                  代碼
                </th>
                <th
                  className="sticky z-30 px-2 py-2 text-left text-gray-600 font-medium border-r border-gray-300"
                  style={{ backgroundColor: '#f3f4f6', top: '36px', left: '80px', minWidth: '220px', width: '220px' }}
                >
                  排放源名稱
                </th>
                <th
                  className="sticky top-[36px] z-20 px-2 py-2 text-center text-gray-800 font-bold border-l-2 border-gray-400 whitespace-nowrap"
                  style={{ backgroundColor: '#f3f4f6', top: '36px', minWidth: `${COL_W}px` }}
                >
                  集團合計
                </th>
                {orderedFactories.map((f) => (
                  <th
                    key={f.factory_code}
                    className="sticky z-20 px-1 py-2 text-center border-l border-gray-200"
                    style={{ backgroundColor: '#f3f4f6', top: '36px', width: `${COL_W}px`, minWidth: `${COL_W}px` }}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="font-mono text-gray-400" style={{ fontSize: '9px' }}>
                        {f.factory_code}
                      </span>
                      <span
                        className="text-gray-700 font-medium"
                        style={{
                          fontSize: '10px',
                          maxWidth: `${COL_W - 4}px`,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {f.name_zh}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {scopeList.map((scope) => {
                const catMap = scopeGroups.get(scope)!;
                const catKeys = [...catMap.keys()].sort();
                const allScopeSrc = catKeys.flatMap((k) =>
                  catMap.get(k)!.map((s) => s.source_code),
                );
                const scopeTotal = allScopeSrc.reduce((s, sc) => s + rowTotal(sc), 0);

                return (
                  <ScopeRows
                    key={`scope-${scope}`}
                    scope={scope}
                    catKeys={catKeys}
                    catMap={catMap}
                    allScopeSrc={allScopeSrc}
                    scopeTotal={scopeTotal}
                    orderedFactories={orderedFactories}
                    val={val}
                    fmt={fmt}
                    rowTotal={rowTotal}
                    colSum={colSum}
                    COL_W={COL_W}
                  />
                );
              })}

              {/* S1 合計 */}
              <GrandRow
                label="S1 合計"
                bg="#166534"
                orderedFactories={orderedFactories}
                getVal={s1Total}
                grandTotal={grandS1}
                fmt={fmt}
              />
              {/* S2 地域合計 */}
              <GrandRow
                label="S2 地域合計"
                bg="#155e75"
                orderedFactories={orderedFactories}
                getVal={s2Loc}
                grandTotal={grandS2Loc}
                fmt={fmt}
              />
              {/* S3 合計 */}
              <GrandRow
                label="S3 合計"
                bg="#3730a3"
                orderedFactories={orderedFactories}
                getVal={s3Total}
                grandTotal={grandS3}
                fmt={fmt}
              />

              {/* ── supplementary section ── */}
              <tr>
                <td
                  colSpan={totalCols}
                  className="py-1"
                  style={{ backgroundColor: '#f8fafc' }}
                />
              </tr>
              <tr style={{ backgroundColor: '#1e3a5f' }}>
                <td
                  colSpan={2}
                  className="sticky left-0 z-10 px-3 py-1.5 font-bold text-white text-xs border-r border-white/20"
                  style={{ backgroundColor: '#1e3a5f' }}
                >
                  補充揭露指標
                </td>
                <td className="border-l-2 border-white/30" />
                {orderedFactories.map((f) => (
                  <td key={f.factory_code} className="border-l border-white/10" />
                ))}
              </tr>

              <SupplRow
                label="生質 CO₂ 排放量（Biomass CO₂）"
                unit="tCO₂"
                orderedFactories={orderedFactories}
                getVal={bioTotal}
                grandTotal={grandBio}
                fmt={fmt}
                bg="#eff6ff"
                textColor="#1e40af"
              />
              <SupplRow
                label="S2 市場（Market-Based）"
                unit="tCO₂e"
                orderedFactories={orderedFactories}
                getVal={s2Mkt}
                grandTotal={grandS2Mkt}
                fmt={fmt}
                bg="#f8fafc"
                textColor="#0f172a"
              />
              <SupplRow
                label="iREC 購入量（Renewable Energy Certificates）"
                unit="MWh"
                orderedFactories={orderedFactories}
                getVal={recMwh}
                grandTotal={grandRec}
                fmt={fmt2}
                bg="#f0fdf4"
                textColor="#166534"
                indent
              />
              <SupplRow
                label="S2 iREC 扣減量（地域 − 市場）"
                unit="tCO₂e"
                orderedFactories={orderedFactories}
                getVal={s2Deducted}
                grandTotal={grandDeducted}
                fmt={fmt}
                bg="#fef9c3"
                textColor="#854d0e"
                indent
              />
              <SupplRow
                label="S1 + S2 地域合計"
                unit="tCO₂e"
                orderedFactories={orderedFactories}
                getVal={(fc) => s1Total(fc) + s2Loc(fc)}
                grandTotal={grandS1 + grandS2Loc}
                fmt={fmt}
                bg="#f1f5f9"
                textColor="#1e293b"
                bold
              />
              <SupplRow
                label="S1 + S2 市場合計"
                unit="tCO₂e"
                orderedFactories={orderedFactories}
                getVal={(fc) => s1Total(fc) + s2Mkt(fc)}
                grandTotal={grandS1 + grandS2Mkt}
                fmt={fmt}
                bg="#f1f5f9"
                textColor="#1e293b"
                bold
              />
              <SupplRow
                label="S1 + S2 + S3 地域合計"
                unit="tCO₂e"
                orderedFactories={orderedFactories}
                getVal={(fc) => s1Total(fc) + s2Loc(fc) + s3Total(fc)}
                grandTotal={grandS1 + grandS2Loc + grandS3}
                fmt={fmt}
                bg="#f1f5f9"
                textColor="#1e293b"
                bold
              />
              <SupplRow
                label="S1 + S2 + S3 市場合計"
                unit="tCO₂e"
                orderedFactories={orderedFactories}
                getVal={(fc) => s1Total(fc) + s2Mkt(fc) + s3Total(fc)}
                grandTotal={grandS1 + grandS2Mkt + grandS3}
                fmt={fmt}
                bg="#f1f5f9"
                textColor="#1e293b"
                bold
              />
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3 px-1">
          單位：tCO₂e ｜ 4 位小數 ｜「—」表示 0 或無資料 ｜ 範疇三僅供參考 ｜ S2 地域 = co2e_location；S2 市場 = co2e_market
        </p>

        {/* ── 分氣體排放量表（按 S1/S2/S3 分列）── */}
        <h2 className="text-base font-bold text-gray-800 mt-8 mb-3 px-1">
          溫室氣體分氣體排放量（非 CO₂e）
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="border-collapse text-xs bg-white">
            <thead>
              <tr style={{ backgroundColor: '#1e3a5f' }}>
                <th className="px-3 py-2 text-left text-white font-semibold border-r border-white/20 whitespace-nowrap" style={{ minWidth: '200px' }}>
                  氣體種類
                </th>
                <th className="px-2 py-2 text-center text-white font-semibold border-r border-white/20 whitespace-nowrap">
                  單位
                </th>
                <th className="px-2 py-2 text-center text-white font-bold border-l-2 border-white/40 whitespace-nowrap" style={{ minWidth: `${COL_W}px` }}>
                  集團合計
                </th>
                {[1, 2, 3].map((s) => (
                  <th key={s} className="px-2 py-2 text-center text-white font-semibold border-l border-white/20 whitespace-nowrap" style={{ minWidth: `${COL_W}px` }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span>S{s}</span>
                      <span className="text-white/60 font-normal" style={{ fontSize: '9px' }}>
                        {s === 1 ? '直接排放' : s === 2 ? '電力' : '價值鏈'}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  { key: 'co2_t' as keyof ScopeGasAgg, label: 'CO₂', unit: 'tCO₂', color: '#1e293b' },
                  { key: 'ch4_t' as keyof ScopeGasAgg, label: 'CH₄（甲烷）', unit: 'tCH₄', color: '#166534' },
                  { key: 'n2o_t' as keyof ScopeGasAgg, label: 'N₂O（氧化亞氮）', unit: 'tN₂O', color: '#7e22ce' },
                  { key: 'sf6_t' as keyof ScopeGasAgg, label: 'SF₆（六氟化硫）', unit: 'tSF₆', color: '#b45309' },
                  { key: 'hfc_t' as keyof ScopeGasAgg, label: 'HFCs（氫氟碳化物）', unit: 'tHFCs', color: '#b91c1c' },
                ]
              ).map(({ key, label, unit, color }, rowIdx) => {
                const grandTotal = [1, 2, 3].reduce((s, sc) => s + ((scopeGasMap[sc]?.[key] as number) ?? 0), 0);
                const bg = rowIdx % 2 === 0 ? '#ffffff' : '#f9fafb';
                return (
                  <tr key={key} style={{ backgroundColor: bg }}>
                    <td className="px-3 py-1.5 font-medium text-xs border-r border-gray-200 whitespace-nowrap" style={{ color, backgroundColor: bg }}>
                      {label}
                    </td>
                    <td className="px-2 py-1.5 text-center text-gray-500 text-xs border-r border-gray-200 whitespace-nowrap" style={{ backgroundColor: bg }}>
                      {unit}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold border-l-2 border-gray-300 tabular-nums" style={{ backgroundColor: bg, color: grandTotal === 0 ? '#d1d5db' : color }}>
                      {fmt(grandTotal)}
                    </td>
                    {[1, 2, 3].map((sc) => {
                      const v = (scopeGasMap[sc]?.[key] as number) ?? 0;
                      return (
                        <td key={sc} className="px-2 py-1.5 text-right font-mono border-l border-gray-100 tabular-nums" style={{ backgroundColor: bg, color: v === 0 ? '#d1d5db' : color }}>
                          {fmt(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2 px-1">
          各氣體實際重量（非 CO₂e 換算）｜ S1 CO₂ 含化石燃燒，S2 CO₂ 含電力，S3 無個別氣體分解 ｜ 僅計入已查核資料 ｜ 4 位小數
        </p>

        {/* ── 各工廠氣體彙總表 ── */}
        <h2 className="text-base font-bold text-gray-800 mt-8 mb-3 px-1">
          各工廠氣體彙總表
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="border-collapse text-xs bg-white">
            <thead>
              <tr style={{ backgroundColor: '#1e3a5f' }}>
                <th
                  className="px-3 py-2 text-left text-white font-semibold border-r border-white/20 whitespace-nowrap sticky left-0 z-10"
                  style={{ minWidth: '160px', backgroundColor: '#1e3a5f' }}
                >
                  工廠
                </th>
                {(
                  [
                    { label: 'CO₂', sub: 'tCO₂', color: '#93c5fd' },
                    { label: 'CH₄', sub: 'tCH₄', color: '#86efac' },
                    { label: 'N₂O', sub: 'tN₂O', color: '#d8b4fe' },
                    { label: 'SF₆', sub: 'tSF₆', color: '#fcd34d' },
                    { label: 'HFCs', sub: 'tHFCs', color: '#fca5a5' },
                  ] as { label: string; sub: string; color: string }[]
                ).map(({ label, sub, color }) => (
                  <th
                    key={label}
                    className="px-2 py-2 text-center text-white font-semibold border-r border-white/20 whitespace-nowrap"
                    style={{ minWidth: `${COL_W}px` }}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span style={{ color }}>{label}</span>
                      <span className="text-white/60 font-normal" style={{ fontSize: '9px' }}>{sub}</span>
                    </div>
                  </th>
                ))}
                <th
                  className="px-2 py-2 text-center text-white font-bold border-l-2 border-white/40 whitespace-nowrap"
                  style={{ minWidth: `${COL_W}px` }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span>CO₂e</span>
                    <span className="text-white/60 font-normal" style={{ fontSize: '9px' }}>S1+S2 地域</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* 集團合計 row */}
              {(() => {
                const totalCo2  = orderedFactories.reduce((s, f) => s + (gasMap[f.factory_code]?.co2_t ?? 0), 0);
                const totalCh4  = orderedFactories.reduce((s, f) => s + (gasMap[f.factory_code]?.ch4_t ?? 0), 0);
                const totalN2o  = orderedFactories.reduce((s, f) => s + (gasMap[f.factory_code]?.n2o_t ?? 0), 0);
                const totalSf6  = orderedFactories.reduce((s, f) => s + (gasMap[f.factory_code]?.sf6_t ?? 0), 0);
                const totalHfc  = orderedFactories.reduce((s, f) => s + (gasMap[f.factory_code]?.hfc_t ?? 0), 0);
                const totalCo2e = orderedFactories.reduce((s, f) => s + s1Total(f.factory_code) + s2Loc(f.factory_code), 0);
                return (
                  <tr style={{ backgroundColor: '#f0f9ff' }}>
                    <td className="px-3 py-1.5 font-bold text-xs border-r border-gray-200 whitespace-nowrap text-[#1e3a5f] sticky left-0 z-10" style={{ backgroundColor: '#f0f9ff' }}>
                      集團合計
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-r border-gray-200" style={{ color: totalCo2 === 0 ? '#d1d5db' : '#1e293b' }}>{fmt(totalCo2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-r border-gray-200" style={{ color: totalCh4 === 0 ? '#d1d5db' : '#166534' }}>{fmt(totalCh4)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-r border-gray-200" style={{ color: totalN2o === 0 ? '#d1d5db' : '#7e22ce' }}>{fmt(totalN2o)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-r border-gray-200" style={{ color: totalSf6 === 0 ? '#d1d5db' : '#b45309' }}>{fmt(totalSf6)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-r border-gray-200" style={{ color: totalHfc === 0 ? '#d1d5db' : '#b91c1c' }}>{fmt(totalHfc)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-l-2 border-gray-300" style={{ color: totalCo2e === 0 ? '#d1d5db' : '#1e3a5f' }}>{fmt(totalCo2e)}</td>
                  </tr>
                );
              })()}
              {orderedFactories.map((f, idx) => {
                const fc = f.factory_code;
                const g = gasMap[fc];
                const co2  = g?.co2_t ?? 0;
                const ch4  = g?.ch4_t ?? 0;
                const n2o  = g?.n2o_t ?? 0;
                const sf6  = g?.sf6_t ?? 0;
                const hfc  = g?.hfc_t ?? 0;
                const co2e = s1Total(fc) + s2Loc(fc);
                const bg   = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
                return (
                  <tr key={fc} style={{ backgroundColor: bg }}>
                    <td className="px-3 py-1.5 border-r border-gray-200 whitespace-nowrap sticky left-0 z-10" style={{ backgroundColor: bg }}>
                      <div className="flex flex-col">
                        <span className="font-mono text-blue-500" style={{ fontSize: '9px' }}>{fc}</span>
                        <span className="text-xs font-medium text-gray-700">{f.name_zh}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs border-r border-gray-100" style={{ backgroundColor: bg, color: co2 === 0 ? '#d1d5db' : '#1e293b' }}>{fmt(co2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs border-r border-gray-100" style={{ backgroundColor: bg, color: ch4 === 0 ? '#d1d5db' : '#166534' }}>{fmt(ch4)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs border-r border-gray-100" style={{ backgroundColor: bg, color: n2o === 0 ? '#d1d5db' : '#7e22ce' }}>{fmt(n2o)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs border-r border-gray-100" style={{ backgroundColor: bg, color: sf6 === 0 ? '#d1d5db' : '#b45309' }}>{fmt(sf6)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs border-r border-gray-100" style={{ backgroundColor: bg, color: hfc === 0 ? '#d1d5db' : '#b91c1c' }}>{fmt(hfc)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-xs border-l-2 border-gray-300" style={{ backgroundColor: bg, color: co2e === 0 ? '#d1d5db' : '#1e3a5f' }}>{fmt(co2e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2 px-1">
          各氣體實際重量（非 CO₂e 換算）｜ CO₂e = S1+S2 地域基準 ｜ 僅計入已查核資料 ｜ 4 位小數
        </p>
      </main>
    </div>
  );
}

// ── Scope section ──────────────────────────────────────────────────────────

function ScopeRows({
  scope, catKeys, catMap, allScopeSrc, scopeTotal,
  orderedFactories, val, fmt, rowTotal, colSum, COL_W,
}: {
  scope: number; catKeys: string[]; catMap: Map<string, SourceMeta[]>;
  allScopeSrc: string[]; scopeTotal: number; orderedFactories: FactoryMeta[];
  val: (fc: string, sc: string) => number; fmt: (v: number) => string;
  rowTotal: (sc: string) => number; colSum: (fc: string, scodes: string[]) => number;
  COL_W: number;
}) {
  const scopeName = SCOPE_NAMES[scope] ?? `範疇 ${scope}`;
  const rows: React.ReactNode[] = [];

  // Scope header
  rows.push(
    <tr key={`sh-${scope}`} style={{ backgroundColor: HEADER_BG }}>
      <td
        colSpan={orderedFactories.length + 3}
        className="sticky left-0 z-10 px-3 py-2 font-bold text-white text-xs whitespace-nowrap"
        style={{ backgroundColor: HEADER_BG }}
      >
        {scopeName}
      </td>
    </tr>,
  );

  for (const catKey of catKeys) {
    const catSources = catMap.get(catKey)!;
    const catCodes = catSources.map((s) => s.source_code);
    const catName = CAT_PREFIX[catKey] ?? catKey;
    const catTotal = catCodes.reduce((s, sc) => s + rowTotal(sc), 0);

    if (MERGED_CAT[catKey]) {
      // Single merged row — no category header, no subtotal
      const mergedName = MERGED_CAT[catKey];
      const bg = '#f0fdf4';
      rows.push(
        <tr key={`merged-${catKey}`} style={{ backgroundColor: bg }}>
          <td
            className="sticky left-0 z-10 px-2 py-1.5 font-mono text-green-700 text-xs border-r border-gray-100 whitespace-nowrap"
            style={{ backgroundColor: bg }}
          >
            {catKey}
          </td>
          <td
            className="sticky z-10 px-2 py-1.5 text-green-800 font-semibold text-xs border-r border-gray-200 whitespace-nowrap"
            style={{ left: '80px', backgroundColor: bg, minWidth: '220px' }}
          >
            {mergedName}
          </td>
          {/* Grand total FIRST */}
          <td
            className="px-2 py-1.5 text-right font-mono font-bold border-l-2 border-gray-300 tabular-nums"
            style={{ backgroundColor: bg, color: catTotal === 0 ? '#d1d5db' : HEADER_BG }}
          >
            {fmt(catTotal)}
          </td>
          {orderedFactories.map((f) => {
            const v = colSum(f.factory_code, catCodes);
            return (
              <td
                key={f.factory_code}
                className="px-1 py-1.5 text-right font-mono border-l border-gray-100 tabular-nums"
                style={{ backgroundColor: bg, color: v === 0 ? '#d1d5db' : '#111827' }}
              >
                {fmt(v)}
              </td>
            );
          })}
        </tr>,
      );
      continue;
    }

    // Category header (non-merged)
    rows.push(
      <tr key={`ch-${catKey}`} style={{ backgroundColor: '#f0fdf4' }}>
        <td
          colSpan={2}
          className="sticky left-0 z-10 px-3 py-1.5 text-green-800 font-semibold text-xs border-r border-gray-200 whitespace-nowrap"
          style={{ backgroundColor: '#f0fdf4' }}
        >
          {catKey}　{catName}
        </td>
        {/* Grand total col (empty in category header) */}
        <td className="border-l-2 border-gray-300" style={{ backgroundColor: '#f0fdf4' }} />
        {orderedFactories.map((f) => (
          <td
            key={f.factory_code}
            className="border-l border-gray-200 py-1"
            style={{ width: `${COL_W}px`, backgroundColor: '#f0fdf4' }}
          />
        ))}
      </tr>,
    );

    // Individual source rows
    catSources.forEach((src, idx) => {
      const total = rowTotal(src.source_code);
      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      rows.push(
        <tr key={src.source_code}>
          <td
            className="sticky left-0 z-10 px-2 py-1.5 font-mono text-gray-500 text-xs border-r border-gray-100 whitespace-nowrap"
            style={{ backgroundColor: bg }}
          >
            {src.source_code}
          </td>
          <td
            className="sticky z-10 px-2 py-1.5 text-gray-700 text-xs border-r border-gray-200 whitespace-nowrap"
            style={{ left: '80px', backgroundColor: bg, minWidth: '220px' }}
          >
            {src.name_zh}
          </td>
          {/* Grand total FIRST */}
          <td
            className="px-2 py-1.5 text-right font-mono font-semibold border-l-2 border-gray-300 tabular-nums"
            style={{ backgroundColor: bg, color: total === 0 ? '#d1d5db' : HEADER_BG }}
          >
            {fmt(total)}
          </td>
          {orderedFactories.map((f) => {
            const v = val(f.factory_code, src.source_code);
            return (
              <td
                key={f.factory_code}
                className="px-1 py-1.5 text-right font-mono border-l border-gray-100 tabular-nums"
                style={{ backgroundColor: bg, color: v === 0 ? '#d1d5db' : '#111827' }}
              >
                {fmt(v)}
              </td>
            );
          })}
        </tr>,
      );
    });

    // Category subtotal
    rows.push(
      <tr
        key={`cs-${catKey}`}
        style={{ backgroundColor: '#dcfce7', borderTop: '1px solid #bbf7d0' }}
      >
        <td
          colSpan={2}
          className="sticky left-0 z-10 px-3 py-1.5 text-green-800 font-bold text-xs border-r border-green-200 whitespace-nowrap"
          style={{ backgroundColor: '#dcfce7' }}
        >
          {catKey} 小計
        </td>
        {/* Grand total FIRST */}
        <td
          className="px-2 py-1.5 text-right font-mono font-bold border-l-2 border-green-400 tabular-nums"
          style={{ backgroundColor: '#dcfce7', color: catTotal === 0 ? '#86efac' : '#166534' }}
        >
          {fmt(catTotal)}
        </td>
        {orderedFactories.map((f) => {
          const sub = colSum(f.factory_code, catCodes);
          return (
            <td
              key={f.factory_code}
              className="px-1 py-1.5 text-right font-mono font-semibold border-l border-green-200 tabular-nums"
              style={{ backgroundColor: '#dcfce7', color: sub === 0 ? '#86efac' : '#166534' }}
            >
              {fmt(sub)}
            </td>
          );
        })}
      </tr>,
    );
  }

  // Scope total row
  rows.push(
    <tr key={`st-${scope}`} style={{ backgroundColor: HEADER_BG }}>
      <td
        colSpan={2}
        className="sticky left-0 z-10 px-3 py-2 font-bold text-white text-xs border-r border-white/20 whitespace-nowrap"
        style={{ backgroundColor: HEADER_BG }}
      >
        {scopeName} 合計
      </td>
      {/* Grand total FIRST */}
      <td
        className="px-2 py-2 text-right font-mono font-bold border-l-2 border-white/40 tabular-nums"
        style={{
          backgroundColor: HEADER_BG,
          color: scopeTotal === 0 ? 'rgba(255,255,255,0.25)' : 'white',
        }}
      >
        {fmt(scopeTotal)}
      </td>
      {orderedFactories.map((f) => {
        const sub = colSum(f.factory_code, allScopeSrc);
        return (
          <td
            key={f.factory_code}
            className="px-1 py-2 text-right font-mono font-bold border-l border-white/20 tabular-nums"
            style={{ color: sub === 0 ? 'rgba(255,255,255,0.25)' : 'white' }}
          >
            {fmt(sub)}
          </td>
        );
      })}
    </tr>,
  );

  return <>{rows}</>;
}

// ── Grand total row ────────────────────────────────────────────────────────

function GrandRow({
  label, bg, orderedFactories, getVal, grandTotal, fmt,
}: {
  label: string; bg: string; orderedFactories: FactoryMeta[];
  getVal: (fc: string) => number; grandTotal: number; fmt: (v: number) => string;
}) {
  return (
    <tr style={{ backgroundColor: bg }}>
      <td
        colSpan={2}
        className="sticky left-0 z-10 px-3 py-2.5 font-bold text-white text-xs whitespace-nowrap border-r border-white/20"
        style={{ backgroundColor: bg }}
      >
        {label}
      </td>
      {/* Grand total FIRST */}
      <td
        className="px-2 py-2.5 text-right font-mono font-bold border-l-2 border-white/40 tabular-nums text-white"
        style={{ backgroundColor: bg }}
      >
        {fmt(grandTotal)}
      </td>
      {orderedFactories.map((f) => {
        const v = getVal(f.factory_code);
        return (
          <td
            key={f.factory_code}
            className="px-1 py-2.5 text-right font-mono font-bold border-l border-white/20 tabular-nums"
            style={{ color: v === 0 ? 'rgba(255,255,255,0.25)' : 'white' }}
          >
            {fmt(v)}
          </td>
        );
      })}
    </tr>
  );
}

// ── Supplementary row ──────────────────────────────────────────────────────

function SupplRow({
  label, unit, orderedFactories, getVal, grandTotal, fmt, bg, textColor, bold = false, indent = false,
}: {
  label: string; unit: string; orderedFactories: FactoryMeta[];
  getVal: (fc: string) => number; grandTotal: number; fmt: (v: number) => string;
  bg: string; textColor: string; bold?: boolean; indent?: boolean;
}) {
  const weight = bold ? 'font-bold' : 'font-medium';
  return (
    <tr style={{ backgroundColor: bg }}>
      <td
        colSpan={2}
        className={`sticky left-0 z-10 ${indent ? 'pl-8 pr-3' : 'px-3'} py-1.5 text-xs border-r border-gray-200 whitespace-nowrap ${weight}`}
        style={{ backgroundColor: bg, color: textColor }}
      >
        {indent && <span className="mr-1 opacity-30">↳</span>}
        {label}
        <span className="ml-1 font-normal text-gray-400">({unit})</span>
      </td>
      {/* Grand total FIRST */}
      <td
        className={`px-2 py-1.5 text-right font-mono border-l-2 border-gray-300 tabular-nums ${weight}`}
        style={{ backgroundColor: bg, color: grandTotal === 0 ? '#d1d5db' : textColor }}
      >
        {fmt(grandTotal)}
      </td>
      {orderedFactories.map((f) => {
        const v = getVal(f.factory_code);
        return (
          <td
            key={f.factory_code}
            className={`px-1 py-1.5 text-right font-mono border-l border-gray-200 tabular-nums ${weight}`}
            style={{ color: v === 0 ? '#d1d5db' : textColor, backgroundColor: bg }}
          >
            {fmt(v)}
          </td>
        );
      })}
    </tr>
  );
}

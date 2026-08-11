'use client';

import { useState, useRef, useEffect } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { MONTHS, HEADER_BG, BTN_BG, computeGas, fmtGas } from './tabTypes';
import type { EmissionSource, ActivityRecord, AssignedFactor } from './page';
import LineItemsCell from './LineItemsCell';

// 用月度表格（帳單/計量）
const MONTHLY_CODES = ['1-1A-3', '1-1A-9'];

interface EventRow {
  tempKey: string;
  id: string | null;
  month: number;
  date_from: string;
  sub_location: string;
  activity_value: string;
  meter_number: string;
  notes: string;
  co2e_total: number | null;
  co2_t: number | null;
  ch4_t: number | null;
  n2o_t: number | null;
  hfc_t: number | null;
  biomass_co2_t: number | null;
  is_reviewed: boolean;
  line_items_count: number;
  saveStatus: SaveStatus;
}

interface LpgRow { barrels: string; kgPerBarrel: string; }

export default function CombustionTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, setActiveTab, assignedFactors, onReviewToggle,
}: TabProps) {
  const sources = emissionSources
    .filter((s) => s.source_code.startsWith('1-1') && selectedSourceIds.has(s.id))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-gray-400">
        <p className="text-base mb-2">尚未設定固定燃燒排放源</p>
        <p className="text-sm">
          請至
          <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">
            基本資訊
          </button>
          勾選鍋爐、發電機等固定燃燒設備。
        </p>
      </div>
    );
  }

  const monthlySources = sources.filter((s) => MONTHLY_CODES.includes(s.source_code));
  const eventSources = sources.filter((s) => !MONTHLY_CODES.includes(s.source_code));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">其他燃燒 S1 — 固定燃燒</h2>
        <p className="text-sm text-gray-500 mt-0.5">鍋爐、發電機、廚房 LPG 等固定燃燒設備</p>
      </div>

      {monthlySources.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            月度用量（帳單 / 計量）
          </h3>
          {monthlySources.map((src) => (
            <MonthlySection
              key={src.id}
              source={src}
              factory={factory}
              year={year}
              records={existingRecords.filter((r) => r.emission_source_id === src.id)}
              assignedFactor={assignedFactors?.find((f) => f.emission_source_id === src.id)}
            />
          ))}
        </div>
      )}

      {eventSources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            逐次記錄（加油 / 燃燒事件）
          </h3>
          {eventSources.map((src) => (
            <EventSection
              key={src.id}
              source={src}
              factory={factory}
              year={year}
              records={existingRecords.filter((r) => r.emission_source_id === src.id)}
              assignedFactor={assignedFactors?.find((f) => f.emission_source_id === src.id)}
              onReviewToggle={onReviewToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 係數顯示面板 ────────────────────────────────────────────────
function FactorPanel({ factor }: { factor: AssignedFactor }) {
  const [open, setOpen] = useState(false);
  const fmt = (v: number | null) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 10 }) : '—';
  return (
    <div className="mt-2 mb-3">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-green-700 hover:text-green-900 transition">
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span>已套用係數</span>
        {factor.source_reference && (
          <span className="text-gray-400 font-normal">· {factor.source_reference}</span>
        )}
      </button>
      {open && (
        <div className="mt-2 p-3 bg-green-50 border border-green-100 rounded-lg text-xs text-gray-700 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5">
          {factor.ncv != null && (
            <div><span className="text-gray-400">NCV</span><br /><span className="font-mono">{fmt(factor.ncv)} {factor.ncv_unit ?? ''}</span></div>
          )}
          {factor.density != null && (
            <div><span className="text-gray-400">密度</span><br /><span className="font-mono">{fmt(factor.density)} {factor.density_unit ?? ''}</span></div>
          )}
          {factor.factor_co2 != null && (
            <div><span className="text-gray-400">EF CO₂</span><br /><span className="font-mono">{fmt(factor.factor_co2)} kg/TJ</span></div>
          )}
          {factor.factor_ch4 != null && (
            <div><span className="text-gray-400">EF CH₄</span><br /><span className="font-mono">{fmt(factor.factor_ch4)} kg/TJ</span></div>
          )}
          {factor.factor_n2o != null && (
            <div><span className="text-gray-400">EF N₂O</span><br /><span className="font-mono">{fmt(factor.factor_n2o)} kg/TJ</span></div>
          )}
          {factor.factor_co2_bio != null && (
            <div><span className="text-gray-400">EF CO₂ (生質)</span><br /><span className="font-mono">{fmt(factor.factor_co2_bio)} kg/TJ</span></div>
          )}
          {factor.factor_ch4_bio != null && (
            <div><span className="text-gray-400">EF CH₄ (生質)</span><br /><span className="font-mono">{fmt(factor.factor_ch4_bio)} kg/TJ</span></div>
          )}
          {factor.factor_n2o_bio != null && (
            <div><span className="text-gray-400">EF N₂O (生質)</span><br /><span className="font-mono">{fmt(factor.factor_n2o_bio)} kg/TJ</span></div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 月度表格（LPG 帳單、廢布月度重量）───────────────────────────────
function MonthlySection({
  source, factory, year, records, assignedFactor, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  assignedFactor?: AssignedFactor;
  onReviewToggle?: (id: string, newVal: boolean) => void;
}) {
  const isLPG = source.source_code === '1-1A-3';

  // Non-LPG: direct activity_value per month via autosave
  const [lv, setLv] = useState<Record<number, string>>(() => {
    if (isLPG) return {};
    const init: Record<number, string> = {};
    for (const r of records) {
      init[r.month] = r.activity_value != null ? String(r.activity_value) : '';
    }
    return init;
  });
  const lvRef = useRef(lv);

  // LPG: barrels + kgPerBarrel, stored in sub_location + meter_number
  const [lpgData, setLpgData] = useState<Record<number, LpgRow>>(() => {
    if (!isLPG) return {};
    const init: Record<number, LpgRow> = {};
    for (const r of records) {
      init[r.month] = { barrels: r.sub_location ?? '', kgPerBarrel: r.meter_number ?? '' };
    }
    return init;
  });
  const lpgRef = useRef(lpgData);
  useEffect(() => { if (isLPG) lpgRef.current = lpgData; }, [lpgData, isLPG]);
  // 本 session 手動編輯過的月份：用來區分「匯入(未編輯、只有合計量)」與「手動清空」
  const [lpgEdited, setLpgEdited] = useState<Set<number>>(new Set());

  const [recordIds, setRecordIds] = useState<Record<number, string | null>>(() => {
    const init: Record<number, string | null> = {};
    for (const r of records) { init[r.month] = r.id; }
    return init;
  });
  const [reviewed, setReviewed] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    for (const r of records) { init[r.month] = r.is_reviewed ?? false; }
    return init;
  });

  const [status, setStatus] = useState<SaveStatus>('idle');
  const tmr = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Non-LPG autosave
  function onChange(month: number, val: string) {
    const next = { ...lvRef.current, [month]: val };
    lvRef.current = next;
    setLv(next);
    if (tmr.current) clearTimeout(tmr.current);
    tmr.current = setTimeout(async () => {
      const v = lvRef.current[month];
      const num = v === '' ? null : parseFloat(v);
      if (v !== '' && (num === null || isNaN(num!))) return;
      setStatus('saving');
      try {
        const res = await fetch('/api/records/autosave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            factory_id: factory.id,
            emission_source_id: source.id,
            year, month,
            activity_value: num,
            activity_unit: source.default_unit,
          }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRecordIds((prev) => ({ ...prev, [month]: data.data.id }));
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } catch { setStatus('error'); }
    }, 1000);
  }

  // LPG: two-field change → save via regular endpoint with meter_number
  function onLpgChange(month: number, field: 'barrels' | 'kgPerBarrel', val: string) {
    const current = lpgRef.current[month] ?? { barrels: '', kgPerBarrel: '' };
    const next = { ...lpgRef.current, [month]: { ...current, [field]: val } };
    lpgRef.current = next;
    setLpgData(next);
    setLpgEdited((prev) => new Set(prev).add(month));
    if (tmr.current) clearTimeout(tmr.current);
    tmr.current = setTimeout(() => saveLpgMonth(month), 1000);
  }

  async function saveLpgMonth(month: number) {
    const row = lpgRef.current[month] ?? { barrels: '', kgPerBarrel: '' };
    const b = parseFloat(row.barrels) || 0;
    const k = parseFloat(row.kgPerBarrel) || 0;
    const totalKg = b > 0 && k > 0 ? b * k : null;
    const id = recordIds[month];
    setStatus('saving');
    try {
      const payload = {
        factory_id: factory.id, emission_source_id: source.id, year, month,
        activity_value: totalKg, activity_unit: source.default_unit,
        sub_location: row.barrels || null, meter_number: row.kgPerBarrel || null,
      };
      if (id) {
        const res = await fetch(`/api/records/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRecordIds((prev) => ({ ...prev, [month]: data.data.id }));
      }
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch { setStatus('error'); }
  }

  // 清空某月的值（保留記錄列，activity_value 歸 null → 後端一併清 co2e）
  async function clearMonth(month: number) {
    const id = recordIds[month];
    if (isLPG) {
      const next = { ...lpgRef.current, [month]: { barrels: '', kgPerBarrel: '' } };
      lpgRef.current = next; setLpgData(next);
      setLpgEdited((prev) => new Set(prev).add(month));
    } else {
      const next = { ...lvRef.current, [month]: '' };
      lvRef.current = next; setLv(next);
    }
    if (!id) return;
    setStatus('saving');
    try {
      const res = await fetch(`/api/records/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_value: null, sub_location: null, meter_number: null }),
      });
      if (!res.ok) throw new Error();
      setStatus('saved'); setTimeout(() => setStatus('idle'), 2000);
    } catch { setStatus('error'); }
  }

  async function toggleReview(month: number) {
    const id = recordIds[month];
    if (!id) return;
    const newVal = !(reviewed[month] ?? false);
    setReviewed((prev) => ({ ...prev, [month]: newVal }));
    await fetch(`/api/records/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    if (onReviewToggle) onReviewToggle(id, newVal);
  }

  const co2eTotal = records.filter((r) => r.co2e_total != null).reduce((s, r) => s + (r.co2e_total ?? 0), 0);
  // 月 → 單據明細筆數（>0 表示該月為多張單據加總，顯示「查看明細」）
  const liCountByMonth: Record<number, number> = {};
  for (const r of records) liCountByMonth[r.month] = r.line_items_count ?? 0;

  if (isLPG) {
    const lpgTotals = MONTHS.reduce((acc, m) => {
      const row = lpgData[m] ?? { barrels: '', kgPerBarrel: '' };
      const b = parseFloat(row.barrels) || 0;
      const k = parseFloat(row.kgPerBarrel) || 0;
      const rec = records.find((r) => r.month === m);
      // 匯入只有合計量(activity_value)時也計入；手動清空(edited)則不計
      const eff = b > 0 && k > 0 ? b * k : (!lpgEdited.has(m) && rec?.activity_value != null ? Number(rec.activity_value) : 0);
      const g = assignedFactor ? computeGas(eff, assignedFactor, source.default_unit, source.is_biomass, 0) : null;
      acc.kg += eff;
      acc.co2 += g?.co2_t ?? 0;
      acc.ch4 += g?.ch4_t ?? 0;
      acc.n2o += g?.n2o_t ?? 0;
      return acc;
    }, { kg: 0, co2: 0, ch4: 0, n2o: 0 });
    const totalKg = lpgTotals.kg;

    return (
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h4 className="font-semibold text-gray-800">
            {source.name_zh}
            <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
          </h4>
          {status !== 'idle' && (
            <span className={`text-xs ${status === 'saving' ? 'text-yellow-500' : status === 'saved' ? 'text-green-600' : 'text-red-500'}`}>
              {status === 'saving' ? '⏳ 儲存中' : status === 'saved' ? '✅ 已儲存' : '❌ 失敗'}
            </span>
          )}
        </div>
        {assignedFactor && <FactorPanel factor={assignedFactor} />}
        <div className="overflow-x-auto rounded-lg border border-gray-200 max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                <th className="px-4 py-2 text-left w-16">月份</th>
                <th className="px-4 py-2 text-right w-28">採購桶數</th>
                <th className="px-4 py-2 text-right w-28">一桶 (kg)</th>
                <th className="px-4 py-2 text-right w-28">合計 kg（自動）</th>
                <th className="px-2 py-2 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CO₂ (t)</th>
                <th className="px-2 py-2 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CH₄ (t)</th>
                <th className="px-2 py-2 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>N₂O (t)</th>
                <th className="px-4 py-2 text-right w-28">CO₂e (t)</th>
                <th className="px-3 py-2 text-center w-16">明細</th>
                <th className="px-4 py-2 text-center w-10">查核</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m) => {
                const rec = records.find((r) => r.month === m);
                const row = lpgData[m] ?? { barrels: '', kgPerBarrel: '' };
                const hasId = !!recordIds[m];
                const isRev = reviewed[m] ?? false;
                const b = parseFloat(row.barrels) || 0;
                const k = parseFloat(row.kgPerBarrel) || 0;
                const edited = lpgEdited.has(m);
                // 合計 kg：優先用「桶數×每桶kg」；若無(例如 ERP/範本匯入只帶合計量)且本 session
                // 未手動編輯過該月，則回退用 activity_value（匯入的合計量）。手動清空(edited)時不回退，維持歸零。
                const effectiveKg = b > 0 && k > 0
                  ? b * k
                  : (!edited && rec?.activity_value != null ? Number(rec.activity_value) : 0);
                const computedKg = effectiveKg > 0 ? effectiveKg.toLocaleString(undefined, { maximumFractionDigits: 10 }) : '—';
                const gasResult = assignedFactor ? computeGas(effectiveKg, assignedFactor, source.default_unit) : null;
                return (
                  <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                    <td className="px-4 py-1.5">
                      <input type="number" min="0" step="1" placeholder="桶數"
                        value={row.barrels}
                        onChange={(e) => onLpgChange(m, 'barrels', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-4 py-1.5">
                      <input type="number" min="0" step="any" placeholder="kg/桶"
                        value={row.kgPerBarrel}
                        onChange={(e) => onLpgChange(m, 'kgPerBarrel', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-gray-600 text-xs">
                      {computedKg}
                      {!edited && b === 0 && rec?.activity_value != null && (
                        <span className="ml-1 text-[10px] text-blue-400 align-middle" title="由 ERP/範本匯入的合計量；如需改為桶數×每桶kg 直接於左側填入即可覆蓋">匯入</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                      {gasResult?.co2_t?.toFixed(4) ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                      {gasResult?.ch4_t?.toFixed(4) ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                      {gasResult?.n2o_t?.toFixed(4) ?? '—'}
                    </td>
                    <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono">
                      {/* 有活動數據(手動或匯入)才顯示 co2e；手動清空(edited 且無輸入)顯示「—」，避免殘留 */}
                      {gasResult?.co2e_t?.toFixed(4) ?? (!edited && rec?.activity_value != null && rec?.co2e_total != null ? rec.co2e_total.toFixed(4) : '—')}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <LineItemsCell recordId={recordIds[m] ?? null} count={liCountByMonth[m] ?? 0}
                        title={`${source.name_zh} ${m} 月`} unit={source.default_unit} sourceCode={source.source_code} />
                    </td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button onClick={() => toggleReview(m)} disabled={!hasId}
                        title={isRev ? '已查核（點擊取消）' : '點擊標記查核完成'}
                        className={`text-base leading-none transition-all ${isRev ? 'text-green-500' : 'text-gray-300'} ${!hasId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                        {isRev ? '✅' : '⬜'}
                      </button>
                      <button onClick={() => clearMonth(m)} disabled={!hasId || isRev}
                        title={isRev ? '已查核不可清空，請先取消查核' : '清空此月數值'}
                        className={`ml-1.5 text-sm leading-none transition ${!hasId || isRev ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
                <td className="px-4 py-2 text-gray-700">合計</td>
                <td colSpan={2} />
                <td className="px-4 py-2 text-right font-mono text-gray-700">
                  {totalKg.toLocaleString(undefined, { maximumFractionDigits: 10 })} kg
                </td>
                <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(lpgTotals.co2)}</td>
                <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(lpgTotals.ch4)}</td>
                <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(lpgTotals.n2o)}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700">
                  {co2eTotal > 0 ? co2eTotal.toFixed(4) + ' t' : '—'}
                </td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  // Non-LPG monthly table
  const monthGas = (m: number) => {
    const rec = records.find((r) => r.month === m);
    const v = lv[m] ?? (rec?.activity_value != null ? String(rec.activity_value) : '');
    return assignedFactor ? computeGas(parseFloat(v) || 0, assignedFactor, source.default_unit, source.is_biomass, 0) : null;
  };
  const total = Object.values(lv).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const nonLpgTotals = MONTHS.reduce((acc, m) => {
    const g = monthGas(m);
    acc.co2 += g?.co2_t ?? 0;
    acc.ch4 += g?.ch4_t ?? 0;
    acc.n2o += g?.n2o_t ?? 0;
    return acc;
  }, { co2: 0, ch4: 0, n2o: 0 });

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <h4 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
        </h4>
        {status !== 'idle' && (
          <span className={`text-xs ${status === 'saving' ? 'text-yellow-500' : status === 'saved' ? 'text-green-600' : 'text-red-500'}`}>
            {status === 'saving' ? '⏳ 儲存中' : status === 'saved' ? '✅ 已儲存' : '❌ 失敗'}
          </span>
        )}
      </div>
      {assignedFactor && <FactorPanel factor={assignedFactor} />}
      <div className="overflow-x-auto rounded-lg border border-gray-200 max-w-lg">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
              <th className="px-4 py-2 text-left w-16">月份</th>
              <th className="px-4 py-2 text-right">重量 ({source.default_unit})</th>
              <th className="px-2 py-2 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CO₂ (t)</th>
              <th className="px-2 py-2 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CH₄ (t)</th>
              <th className="px-2 py-2 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>N₂O (t)</th>
              <th className="px-4 py-2 text-right w-28">CO₂e (t)</th>
              <th className="px-3 py-2 text-center w-16">明細</th>
              <th className="px-4 py-2 text-center w-10">查核</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m) => {
              const rec = records.find((r) => r.month === m);
              const val = lv[m] ?? (rec?.activity_value != null ? String(rec.activity_value) : '');
              const hasId = !!recordIds[m];
              const isRev = reviewed[m] ?? false;
              const gasResult = assignedFactor ? computeGas(parseFloat(val) || 0, assignedFactor, source.default_unit, source.is_biomass, 0) : null;
              return (
                <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                  <td className="px-4 py-1.5">
                    <input type="number" min="0" step="any" placeholder="輸入數量"
                      value={val}
                      onChange={(e) => onChange(m, e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {gasResult?.co2_t?.toFixed(4) ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {gasResult?.ch4_t?.toFixed(4) ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {gasResult?.n2o_t?.toFixed(4) ?? '—'}
                  </td>
                  <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono">
                    {/* 輸入清空時直接顯示「—」，不 fallback 到 DB 舊 co2e，避免殘留 */}
                    {gasResult?.co2e_t?.toFixed(4) ?? ((parseFloat(val) || 0) > 0 && rec?.co2e_total != null ? rec.co2e_total.toFixed(4) : '—')}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <LineItemsCell recordId={recordIds[m] ?? null} count={liCountByMonth[m] ?? 0}
                      title={`${source.name_zh} ${m} 月`} unit={source.default_unit} sourceCode={source.source_code} />
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <button onClick={() => toggleReview(m)} disabled={!hasId}
                      title={isRev ? '已查核（點擊取消）' : '點擊標記查核完成'}
                      className={`text-base leading-none transition-all ${isRev ? 'text-green-500' : 'text-gray-300'} ${!hasId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                      {isRev ? '✅' : '⬜'}
                    </button>
                    <button onClick={() => clearMonth(m)} disabled={!hasId || isRev}
                      title={isRev ? '已查核不可清空，請先取消查核' : '清空此月數值'}
                      className={`ml-1.5 text-sm leading-none transition ${!hasId || isRev ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
              <td className="px-4 py-2 text-gray-700">合計</td>
              <td className="px-4 py-2 text-right font-mono text-gray-700">
                {total.toLocaleString(undefined, { maximumFractionDigits: 10 })} {source.default_unit}
              </td>
              <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(nonLpgTotals.co2)}</td>
              <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(nonLpgTotals.ch4)}</td>
              <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(nonLpgTotals.n2o)}</td>
              <td className="px-4 py-2 text-right font-mono text-gray-700">
                {co2eTotal > 0 ? co2eTotal.toFixed(4) + ' t' : '—'}
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── 逐筆事件列（發電機、消防演練、鍋爐等）─────────────────────────────
function EventSection({
  source, factory, year, records, assignedFactor, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  assignedFactor?: AssignedFactor;
  onReviewToggle?: (id: string, newVal: boolean) => void;
}) {
  const hasBioFactor = source.is_biomass;

  const [rows, setRows] = useState<EventRow[]>(() =>
    records.map((r) => ({
      tempKey: r.id,
      id: r.id,
      month: r.month,
      date_from: r.date_from ?? '',
      sub_location: r.sub_location ?? '',
      activity_value: r.activity_value != null ? String(r.activity_value) : '',
      meter_number: r.meter_number ?? '',
      notes: r.notes ?? '',
      co2e_total: r.co2e_total,
      co2_t: r.co2_t ?? null,
      ch4_t: r.ch4_t ?? null,
      n2o_t: r.n2o_t ?? null,
      hfc_t: r.hfc_t ?? null,
      biomass_co2_t: r.co2e_biomass_co2 ?? null,
      is_reviewed: r.is_reviewed ?? false,
      line_items_count: r.line_items_count ?? 0,
      saveStatus: 'idle' as SaveStatus,
    }))
  );

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(tempKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tempKey)) next.delete(tempKey); else next.add(tempKey);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.tempKey))));
  }

  function targetRows() {
    return selected.size > 0 ? rows.filter((r) => selected.has(r.tempKey)) : rows;
  }

  async function bulkReview() {
    const targets = targetRows().filter((r) => r.id && !r.is_reviewed);
    await Promise.all(targets.map((r) => toggleReview(r.tempKey)));
    setSelected(new Set());
  }

  async function bulkDelete() {
    const candidates = targetRows();
    const targets = candidates.filter((r) => r.id && !r.is_reviewed);
    if (targets.length === 0) {
      if (candidates.some((r) => r.is_reviewed)) {
        alert('所選記錄都已查核，無法刪除，請先取消查核再刪除。');
      }
      setSelected(new Set());
      return;
    }
    if (!confirm(`確定要刪除 ${targets.length} 筆尚未查核的資料？`)) return;
    await Promise.all(targets.map((r) => deleteRow(r.tempKey)));
    setSelected(new Set());
  }

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((p) => [...p, {
      tempKey, id: null,
      month: new Date().getMonth() + 1,
      date_from: '', sub_location: '', activity_value: '', meter_number: '', notes: '',
      co2e_total: null, co2_t: null, ch4_t: null, n2o_t: null, hfc_t: null, biomass_co2_t: null,
      is_reviewed: false, line_items_count: 0, saveStatus: 'idle',
    }]);
  }

  async function toggleReview(tempKey: string) {
    const row = rowsRef.current.find((r) => r.tempKey === tempKey);
    if (!row?.id) return;
    const newVal = !row.is_reviewed;
    setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, is_reviewed: newVal } : r));
    await fetch(`/api/records/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    if (onReviewToggle && row.id) onReviewToggle(row.id, newVal);
  }

  function updateRow(tempKey: string, field: keyof EventRow, value: string | number) {
    setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, [field]: value } : r));
    if (timers.current[tempKey]) clearTimeout(timers.current[tempKey]);
    timers.current[tempKey] = setTimeout(() => saveRow(tempKey), 1000);
  }

  async function saveRow(tempKey: string) {
    const row = rowsRef.current.find((r) => r.tempKey === tempKey);
    if (!row) return;
    setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saving' } : r));
    const numVal = row.activity_value !== '' ? parseFloat(row.activity_value) : null;
    const payload = {
      factory_id: factory.id,
      emission_source_id: source.id,
      year, month: row.month,
      activity_value: numVal != null && !isNaN(numVal) ? numVal : null,
      activity_unit: source.default_unit,
      sub_location: row.sub_location || null,
      meter_number: row.meter_number || null,
      date_from: row.date_from || null,
      notes: row.notes || null,
    };
    try {
      if (row.id) {
        const res = await fetch(`/api/records/${row.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, id: data.data.id } : r));
      }
      setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saved' } : r));
      setTimeout(() => setRows((p) => p.map((r) =>
        r.tempKey === tempKey && r.saveStatus === 'saved' ? { ...r, saveStatus: 'idle' } : r
      )), 2000);
    } catch {
      setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'error' } : r));
    }
  }

  async function deleteRow(tempKey: string) {
    const row = rowsRef.current.find((r) => r.tempKey === tempKey);
    if (!row) return;
    if (row.id) {
      const res = await fetch(`/api/records/${row.id}`, { method: 'DELETE' });
      if (!res.ok) return;
    }
    setRows((p) => p.filter((r) => r.tempKey !== tempKey));
  }

  // 每列即時氣體（有輸入用即時值，否則回退資料庫已存值），合計與列顯示一致
  const rowGas = rows.map((r) => ({
    r,
    g: assignedFactor
      ? computeGas(parseFloat(r.activity_value) || 0, assignedFactor, source.default_unit, hasBioFactor, parseFloat(r.meter_number) || 0)
      : null,
  }));
  const totalVol = rows.reduce((s, r) => s + (parseFloat(r.activity_value) || 0), 0);
  const totalCo2e = rowGas.reduce((s, { r, g }) => s + (g?.co2e_t ?? r.co2e_total ?? 0), 0);
  const totalCo2 = rowGas.reduce((s, { r, g }) => s + (g?.co2_t ?? r.co2_t ?? 0), 0);
  const totalCh4 = rowGas.reduce((s, { r, g }) => s + (g?.ch4_t ?? r.ch4_t ?? 0), 0);
  const totalN2o = rowGas.reduce((s, { r, g }) => s + (g?.n2o_t ?? r.n2o_t ?? 0), 0);
  const totalBiomassCo2 = rowGas.reduce((s, { r, g }) => s + (g?.biomass_co2_t ?? r.biomass_co2_t ?? 0), 0);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
          {source.is_biomass && <span className="ml-2 text-xs text-green-600">🌿 生質</span>}
          {hasBioFactor && <span className="ml-2 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded">含生質係數</span>}
        </h4>
        <div className="flex items-center gap-2">
          <button onClick={bulkReview}
            disabled={rows.length === 0}
            className="px-3 py-1.5 rounded-lg border border-green-700 text-green-700 text-xs font-medium transition hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed">
            全選查核
          </button>
          <button onClick={bulkDelete}
            disabled={rows.length === 0}
            className="px-3 py-1.5 rounded-lg border border-red-400 text-red-500 text-xs font-medium transition hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed">
            全選刪除
          </button>
          <button onClick={addRow}
            className="px-3 py-1.5 rounded-lg text-white text-xs font-medium hover:opacity-90 transition"
            style={{ backgroundColor: BTN_BG }}>
            + 新增記錄
          </button>
        </div>
      </div>
      {assignedFactor && <FactorPanel factor={assignedFactor} />}

      {rows.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg">
          <button onClick={addRow} className="text-green-600 underline">+ 新增第一筆記錄</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                <th className="px-2 py-2.5 text-center w-8">
                  <input type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left w-20">月份</th>
                <th className="px-3 py-2.5 text-left w-28">日期</th>
                <th className="px-3 py-2.5 text-left">設備 / 用途</th>
                <th className="px-3 py-2.5 text-right w-28">用量 ({source.default_unit})</th>
                {hasBioFactor && <th className="px-3 py-2.5 text-right w-24">生質占比 %</th>}
                <th className="px-3 py-2.5 text-left w-28">備註</th>
                <th className="px-3 py-2.5 text-right w-24">CO₂e (t)
                  {hasBioFactor && <span className="block text-[10px] font-normal text-green-200">計入 S1</span>}
                </th>
                {!hasBioFactor && <th className="px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CO₂ (t)</th>}
                <th className="px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CH₄ (t)</th>
                <th className="px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>N₂O (t)</th>
                {hasBioFactor && <th className="px-2 py-2.5 text-right w-24 text-amber-900" style={{ backgroundColor: '#fde68a' }}>生質CO₂ (t)
                  <span className="block text-[10px] font-normal text-amber-700">另計·不入 S1</span>
                </th>}
                <th className="px-3 py-2.5 text-center w-16">明細</th>
                <th className="px-3 py-2.5 text-center w-8">查核</th>
                <th className="px-3 py-2.5 text-center w-8">狀</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const gasResult = assignedFactor
                  ? computeGas(parseFloat(row.activity_value) || 0, assignedFactor, source.default_unit, hasBioFactor, parseFloat(row.meter_number) || 0)
                  : null;
                return (
                <tr key={row.tempKey} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox"
                      checked={selected.has(row.tempKey)}
                      onChange={() => toggleSelect(row.tempKey)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={row.month}
                      onChange={(e) => updateRow(row.tempKey, 'month', parseInt(e.target.value))}
                      className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500">
                      {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" value={row.date_from}
                      onChange={(e) => updateRow(row.tempKey, 'date_from', e.target.value)}
                      className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="text" placeholder="設備名稱或用途" value={row.sub_location}
                      onChange={(e) => updateRow(row.tempKey, 'sub_location', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="any" placeholder={source.default_unit}
                      value={row.activity_value}
                      onChange={(e) => updateRow(row.tempKey, 'activity_value', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  {hasBioFactor && (
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" max="100" step="0.1" placeholder="0"
                        value={row.meter_number}
                        onChange={(e) => updateRow(row.tempKey, 'meter_number', e.target.value)}
                        className="w-full border border-green-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        title="生質燃料占比（0–100），例 B40 填 40"
                      />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input type="text" placeholder="備註" value={row.notes}
                      onChange={(e) => updateRow(row.tempKey, 'notes', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-400 text-xs font-mono">
                    {gasResult?.co2e_t?.toFixed(4) ?? (row.co2e_total != null ? row.co2e_total.toFixed(4) : '—')}
                  </td>
                  {!hasBioFactor && (
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                      {(gasResult?.co2_t ?? row.co2_t)?.toFixed(4) ?? '—'}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {(gasResult?.ch4_t ?? row.ch4_t)?.toFixed(4) ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {(gasResult?.n2o_t ?? row.n2o_t)?.toFixed(4) ?? '—'}
                  </td>
                  {hasBioFactor && (
                    <td className="px-2 py-1.5 text-right text-xs font-mono text-amber-800" style={{ backgroundColor: '#fef3c7' }}>
                      {(gasResult?.biomass_co2_t ?? row.biomass_co2_t)?.toFixed(4) ?? '—'}
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    <LineItemsCell recordId={row.id} count={row.line_items_count}
                      title={`${source.name_zh} ${row.month} 月`} unit={source.default_unit} sourceCode={source.source_code} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => toggleReview(row.tempKey)} disabled={!row.id}
                      title={row.is_reviewed ? '已查核（點擊取消）' : '點擊標記查核完成'}
                      className={`text-base leading-none transition-all ${row.is_reviewed ? 'text-green-500' : 'text-gray-300'} ${!row.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                      {row.is_reviewed ? '✅' : '⬜'}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-center text-xs">
                    {row.saveStatus === 'saving' && '⏳'}
                    {row.saveStatus === 'saved' && '✓'}
                    {row.saveStatus === 'error' && '❌'}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => !row.is_reviewed && deleteRow(row.tempKey)}
                      disabled={row.is_reviewed}
                      className={`text-lg leading-none transition ${row.is_reviewed ? 'text-gray-100 cursor-not-allowed' : 'text-gray-300 hover:text-red-500'}`}>×</button>
                  </td>
                </tr>
              );})}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-sm">
                <td colSpan={4} className="px-3 py-2 text-gray-700">合計</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalVol.toLocaleString(undefined, { maximumFractionDigits: 10 })} {source.default_unit}
                </td>
                {hasBioFactor && <td />}
                <td />
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                </td>
                {!hasBioFactor && <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(totalCo2)}</td>}
                <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(totalCh4)}</td>
                <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(totalN2o)}</td>
                {hasBioFactor && <td className="px-2 py-2 text-right font-mono text-amber-800 text-xs" style={{ backgroundColor: '#fef3c7' }}>{fmtGas(totalBiomassCo2)}</td>}
                <td />
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {hasBioFactor && rows.length > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          CO₂e（計入 S1）= CH₄ × GWP<sub>CH₄</sub> + N₂O × GWP<sub>N₂O</sub>。
          <span className="text-amber-700">生質 CO₂ 屬生質碳循環，另計、不計入 S1。</span>
        </p>
      )}
    </div>
  );
}

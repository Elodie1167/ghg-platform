'use client';

import { useState, useRef, useEffect } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { MONTHS, HEADER_BG, BTN_BG } from './tabTypes';
import type { EmissionSource, ActivityRecord, AssignedFactor } from './page';

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
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

interface LpgRow { barrels: string; kgPerBarrel: string; }

export default function CombustionTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, setActiveTab, assignedFactors,
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
  const fmt = (v: number | null) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—';
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
  source, factory, year, records, assignedFactor,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  assignedFactor?: AssignedFactor;
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

  async function toggleReview(month: number) {
    const id = recordIds[month];
    if (!id) return;
    const newVal = !(reviewed[month] ?? false);
    setReviewed((prev) => ({ ...prev, [month]: newVal }));
    await fetch(`/api/records/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
  }

  const co2eTotal = records.filter((r) => r.co2e_total != null).reduce((s, r) => s + (r.co2e_total ?? 0), 0);

  if (isLPG) {
    const totalKg = MONTHS.reduce((s, m) => {
      const row = lpgData[m] ?? { barrels: '', kgPerBarrel: '' };
      return s + (parseFloat(row.barrels) || 0) * (parseFloat(row.kgPerBarrel) || 0);
    }, 0);

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
                <th className="px-4 py-2 text-right w-28">CO₂e (t)</th>
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
                const computedKg = b > 0 && k > 0 ? (b * k).toFixed(2) : '—';
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
                      <input type="number" min="0" step="0.1" placeholder="kg/桶"
                        value={row.kgPerBarrel}
                        onChange={(e) => onLpgChange(m, 'kgPerBarrel', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-gray-600 text-xs">{computedKg}</td>
                    <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono">
                      {rec?.co2e_total != null ? rec.co2e_total.toFixed(4) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => toggleReview(m)} disabled={!hasId}
                        title={isRev ? '已查核（點擊取消）' : '點擊標記查核完成'}
                        className={`text-base leading-none transition-all ${isRev ? 'text-green-500' : 'text-gray-300'} ${!hasId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                        {isRev ? '✅' : '⬜'}
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
                  {totalKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg
                </td>
                <td className="px-4 py-2 text-right font-mono text-gray-700">
                  {co2eTotal > 0 ? co2eTotal.toFixed(4) + ' t' : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  // Non-LPG monthly table (unchanged)
  const total = Object.values(lv).reduce((s, v) => s + (parseFloat(v) || 0), 0);

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
              <th className="px-4 py-2 text-right w-28">CO₂e (t)</th>
              <th className="px-4 py-2 text-center w-10">查核</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m) => {
              const rec = records.find((r) => r.month === m);
              const val = lv[m] ?? (rec?.activity_value != null ? String(rec.activity_value) : '');
              const hasId = !!recordIds[m];
              const isRev = reviewed[m] ?? false;
              return (
                <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                  <td className="px-4 py-1.5">
                    <input type="number" min="0" step="0.01" placeholder="輸入數量"
                      value={val}
                      onChange={(e) => onChange(m, e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono">
                    {rec?.co2e_total != null ? rec.co2e_total.toFixed(4) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => toggleReview(m)} disabled={!hasId}
                      title={isRev ? '已查核（點擊取消）' : '點擊標記查核完成'}
                      className={`text-base leading-none transition-all ${isRev ? 'text-green-500' : 'text-gray-300'} ${!hasId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                      {isRev ? '✅' : '⬜'}
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
                {total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {source.default_unit}
              </td>
              <td className="px-4 py-2 text-right font-mono text-gray-700">
                {co2eTotal > 0 ? co2eTotal.toFixed(4) + ' t' : '—'}
              </td>
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
  source, factory, year, records, assignedFactor,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  assignedFactor?: AssignedFactor;
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
      is_reviewed: r.is_reviewed ?? false,
      saveStatus: 'idle' as SaveStatus,
    }))
  );

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((p) => [...p, {
      tempKey, id: null,
      month: new Date().getMonth() + 1,
      date_from: '', sub_location: '', activity_value: '', meter_number: '', notes: '',
      co2e_total: null, is_reviewed: false, saveStatus: 'idle',
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

  const totalVol = rows.reduce((s, r) => s + (parseFloat(r.activity_value) || 0), 0);
  const totalCo2e = rows.reduce((s, r) => s + (r.co2e_total ?? 0), 0);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
          {source.is_biomass && <span className="ml-2 text-xs text-green-600">🌿 生質</span>}
          {hasBioFactor && <span className="ml-2 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded">含生質係數</span>}
        </h4>
        <button onClick={addRow}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium hover:opacity-90 transition"
          style={{ backgroundColor: BTN_BG }}>
          + 新增記錄
        </button>
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
                <th className="px-3 py-2.5 text-left w-20">月份</th>
                <th className="px-3 py-2.5 text-left w-28">日期</th>
                <th className="px-3 py-2.5 text-left">設備 / 用途</th>
                <th className="px-3 py-2.5 text-right w-28">用量 ({source.default_unit})</th>
                {hasBioFactor && <th className="px-3 py-2.5 text-right w-24">生質占比 %</th>}
                <th className="px-3 py-2.5 text-left w-28">備註</th>
                <th className="px-3 py-2.5 text-right w-24">CO₂e (t)</th>
                <th className="px-3 py-2.5 text-center w-8">查核</th>
                <th className="px-3 py-2.5 text-center w-8">狀</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.tempKey} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
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
                    <input type="number" min="0" step="0.01" placeholder={source.default_unit}
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
                    {row.co2e_total != null ? row.co2e_total.toFixed(4) : '—'}
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
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-sm">
                <td colSpan={3} className="px-3 py-2 text-gray-700">合計</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalVol.toLocaleString(undefined, { maximumFractionDigits: 2 })} {source.default_unit}
                </td>
                {hasBioFactor && <td />}
                <td />
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

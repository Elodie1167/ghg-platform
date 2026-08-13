'use client';

import { useState, useRef, useEffect } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { MONTHS, HEADER_BG, BTN_BG, computeGas, fmtGas } from './tabTypes';
import type { EmissionSource, ActivityRecord, AssignedFactor } from './page';
import LineItemsCell from './LineItemsCell';

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

const FUEL_SOURCE_CODES = ['1-2A-1', '1-2A-2', '1-2A-4', '1-2A-5', '1-2A-6'];
const CAR_CODES = ['1-2A-1', '1-2A-2', '1-2A-6'];
const FORKLIFT_CODES = ['1-2A-4', '1-2A-5'];

export default function FuelTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, setActiveTab, assignedFactors, onReviewToggle,
}: TabProps) {
  const fuelSources = emissionSources
    .filter((s) => FUEL_SOURCE_CODES.includes(s.source_code) && selectedSourceIds.has(s.id))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  if (fuelSources.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-gray-400">
        <p className="text-base mb-2">尚未設定移動燃燒排放源</p>
        <p className="text-sm">
          請至
          <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">
            基本資訊
          </button>
          勾選公務車或堆高機燃料類型。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">燃料 S1 — 移動燃燒</h2>
        <p className="text-sm text-gray-500 mt-0.5">公務車、堆高機加油記錄，每次加油一筆，輸入停止 1 秒後自動儲存</p>
      </div>
      {fuelSources.map((src) => (
        <FuelSection
          key={src.id}
          source={src}
          factory={factory}
          year={year}
          records={existingRecords.filter((r) => r.emission_source_id === src.id)}
          locationLabel={CAR_CODES.includes(src.source_code) ? '車牌號碼' : '設備名稱'}
          isForklift={FORKLIFT_CODES.includes(src.source_code)}
          assignedFactor={assignedFactors?.find((f) => f.emission_source_id === src.id)}
          onReviewToggle={onReviewToggle}
        />
      ))}
    </div>
  );
}

// ─── 台數統計小元件（年底一次性調查，存 localStorage）─────────────────
function VehicleCountBadge({
  lsKey, label, placeholder,
}: {
  lsKey: string;
  label: string;
  placeholder: string;
}) {
  const [count, setCount] = useState('');
  useEffect(() => {
    setCount(localStorage.getItem(lsKey) ?? '');
  }, [lsKey]);

  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
      {label}
      <input
        type="number"
        min="0"
        step="1"
        value={count}
        placeholder={placeholder}
        onChange={(e) => {
          setCount(e.target.value);
          localStorage.setItem(lsKey, e.target.value);
        }}
        className="w-12 bg-transparent border-none text-center focus:outline-none font-mono text-xs"
        title="年底填寫一次，僅供參考，不影響計算"
      />
      台
    </span>
  );
}

function FuelSection({
  source, factory, year, records, locationLabel, isForklift, assignedFactor, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  locationLabel: string;
  isForklift: boolean;
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

  const lsKeyDiesel = `ghg:vehcount:${factory.id}:${year}:${source.source_code}`;
  const lsKeyElectric = `ghg:vehcount:${factory.id}:${year}:forklift_electric`;

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((prev) => [...prev, {
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
    setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, [field]: value } : r));
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
      year,
      month: row.month,
      activity_value: numVal != null && !isNaN(numVal) ? numVal : null,
      activity_unit: source.default_unit,
      sub_location: row.sub_location || null,
      date_from: row.date_from || null,
      meter_number: row.meter_number || null,
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
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-800">
            {source.name_zh}
            <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
            {source.is_biomass && <span className="ml-2 text-xs text-green-600">🌿 生質</span>}
          </h3>
          {/* 年底台數統計（存 localStorage，不影響 CO₂e） */}
          {isForklift ? (
            <>
              <VehicleCountBadge lsKey={lsKeyDiesel} label="柴油堆高機" placeholder="0" />
              <VehicleCountBadge lsKey={lsKeyElectric} label="電動堆高機" placeholder="0" />
            </>
          ) : (
            <VehicleCountBadge lsKey={lsKeyDiesel} label="車輛" placeholder="0" />
          )}
          <span className="text-xs text-gray-400">（年底填寫）</span>
        </div>
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

      {rows.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg">
          <button onClick={addRow} className="text-green-600 underline">+ 新增第一筆加油記錄</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white sticky top-12 z-10">
                <th className="whitespace-nowrap px-2 py-2.5 text-center w-8">
                  <input type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left w-20">月份</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left w-28">加油日期</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left">{locationLabel}</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right w-28">用量 ({source.default_unit})</th>
                {hasBioFactor && <th className="whitespace-nowrap px-3 py-2.5 text-right w-24">生質占比 %</th>}
                <th className="whitespace-nowrap px-3 py-2.5 text-left w-32">備註（費用等）</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right w-24">CO₂e (t)
                  {hasBioFactor && <span className="block text-[10px] font-normal text-green-200">計入 S1</span>}
                </th>
                {!hasBioFactor && <th className="whitespace-nowrap px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CO₂ (t)</th>}
                <th className="whitespace-nowrap px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>CH₄ (t)</th>
                <th className="whitespace-nowrap px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>N₂O (t)</th>
                {hasBioFactor && <th className="whitespace-nowrap px-2 py-2.5 text-right w-24 text-amber-900" style={{ backgroundColor: '#fde68a' }}>生質CO₂ (t)
                  <span className="block text-[10px] font-normal text-amber-700">另計·不入 S1</span>
                </th>}
                <th className="whitespace-nowrap px-3 py-2.5 text-center w-16">明細</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-center w-8">查核</th>
                <th className="whitespace-nowrap px-3 py-2.5 w-8" />
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
                    <input type="text" placeholder={locationLabel} value={row.sub_location}
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
                      <input type="number" min="0" max="100" step="1" placeholder="0"
                        value={row.meter_number}
                        onChange={(e) => updateRow(row.tempKey, 'meter_number', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input type="text" placeholder="費用、備註…" value={row.notes}
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
                    {fmtGas(gasResult?.ch4_t ?? row.ch4_t)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {fmtGas(gasResult?.n2o_t ?? row.n2o_t)}
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
                    <button
                      onClick={() => toggleReview(row.tempKey)}
                      disabled={!row.id}
                      title={row.is_reviewed ? '已查核（點擊取消）' : '點擊標記查核完成'}
                      className={`text-base leading-none transition-all ${row.is_reviewed ? 'text-green-500' : 'text-gray-300'} ${!row.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}
                    >
                      {row.is_reviewed ? '✅' : '⬜'}
                    </button>
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
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {hasBioFactor && rows.length > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          生質占比 %：混掺生質燃料（如 B40 填 40）用。CO₂e（計入 S1）= 化石 CO₂ + CH₄ × GWP<sub>CH₄</sub> + N₂O × GWP<sub>N₂O</sub>。
          <span className="text-amber-700">生質占比對應的 CO₂ 屬生質碳循環，另計、不計入 S1。</span>
        </p>
      )}
    </div>
  );
}

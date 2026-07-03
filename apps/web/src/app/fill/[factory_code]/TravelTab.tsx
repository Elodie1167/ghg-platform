'use client';

import { useState, useRef, useEffect } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { MONTHS, HEADER_BG, BTN_BG } from './tabTypes';
import type { EmissionSource, ActivityRecord } from './page';

// 3-6-A 飛機, 3-6-B 飯店, 3-6-C 火車
const TRAVEL_CODES = ['3-6-A', '3-6-B', '3-6-C'];
const HOTEL_CODE = '3-6-B';

interface EventRow {
  tempKey: string;
  id: string | null;
  month: number;
  date_from: string;
  sub_location: string;   // 路線 (飛機/火車) 或 旅館城市 (飯店)
  meter_number: string;   // 人次 (飛機/火車)
  activity_value: string; // 距離 km (飛機/火車) 或 房晚 (飯店)
  notes: string;
  co2e_total: number | null;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

export default function TravelTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, setActiveTab,
}: TabProps) {
  const sources = emissionSources
    .filter((s) => TRAVEL_CODES.includes(s.source_code) && selectedSourceIds.has(s.id))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-gray-400">
        <p className="text-base mb-2">尚未設定差旅排放源</p>
        <p className="text-sm">
          請至
          <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">基本資訊</button>
          勾選飛機、火車或住宿。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">差旅 S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">商務出差飛機、火車、住宿記錄，每次出差一筆</p>
      </div>
      {sources.map((src) => (
        <TravelSection
          key={src.id}
          source={src}
          factory={factory}
          year={year}
          records={existingRecords.filter((r) => r.emission_source_id === src.id)}
        />
      ))}
    </div>
  );
}

function TravelSection({
  source, factory, year, records,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
}) {
  const isHotel = source.source_code === HOTEL_CODE;

  const [rows, setRows] = useState<EventRow[]>(() =>
    records.map((r) => ({
      tempKey: r.id, id: r.id, month: r.month,
      date_from: r.date_from ?? '',
      sub_location: r.sub_location ?? '',
      meter_number: r.meter_number != null ? String(r.meter_number) : '',
      activity_value: r.activity_value != null ? String(r.activity_value) : '',
      notes: r.notes ?? '', co2e_total: r.co2e_total,
      is_reviewed: r.is_reviewed ?? false, saveStatus: 'idle' as SaveStatus,
    }))
  );

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((p) => [...p, {
      tempKey, id: null, month: new Date().getMonth() + 1,
      date_from: '', sub_location: '', meter_number: '', activity_value: '',
      notes: '', co2e_total: null, is_reviewed: false, saveStatus: 'idle',
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

    const actNum = row.activity_value !== '' ? parseFloat(row.activity_value) : null;
    const mtrNum = row.meter_number !== '' ? parseFloat(row.meter_number) : null;

    const payload = {
      factory_id: factory.id, emission_source_id: source.id,
      year, month: row.month,
      activity_value: actNum != null && !isNaN(actNum) ? actNum : null,
      activity_unit: source.default_unit,
      meter_number: mtrNum != null && !isNaN(mtrNum) ? mtrNum : null,
      sub_location: row.sub_location || null,
      date_from: row.date_from || null,
      notes: row.notes || null,
    };

    try {
      if (row.id) {
        const res = await fetch(`/api/records/${row.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
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
    if (row.id) { const res = await fetch(`/api/records/${row.id}`, { method: 'DELETE' }); if (!res.ok) return; }
    setRows((p) => p.filter((r) => r.tempKey !== tempKey));
  }

  const totalAct = rows.reduce((s, r) => s + (parseFloat(r.activity_value) || 0), 0);
  const totalCo2e = rows.reduce((s, r) => s + (r.co2e_total ?? 0), 0);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
        </h3>
        <button onClick={addRow}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium hover:opacity-90 transition"
          style={{ backgroundColor: BTN_BG }}>
          + 新增記錄
        </button>
      </div>

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
                <th className="px-3 py-2.5 text-left w-28">出發日期</th>
                <th className="px-3 py-2.5 text-left">{isHotel ? '旅館 / 城市' : '路線（起→訖）'}</th>
                {!isHotel && <th className="px-3 py-2.5 text-right w-20">人次</th>}
                <th className="px-3 py-2.5 text-right w-28">
                  {isHotel ? `房晚 (${source.default_unit})` : `距離 (${source.default_unit})`}
                </th>
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
                      className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="text"
                      placeholder={isHotel ? '台北 / 喜來登' : 'TPE→SHA（來回）'}
                      value={row.sub_location}
                      onChange={(e) => updateRow(row.tempKey, 'sub_location', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  {!isHotel && (
                    <td className="px-2 py-1.5">
                      <input type="number" min="1" step="1" placeholder="人次"
                        value={row.meter_number}
                        onChange={(e) => updateRow(row.tempKey, 'meter_number', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="0.1"
                      placeholder={isHotel ? '房晚' : 'km'}
                      value={row.activity_value}
                      onChange={(e) => updateRow(row.tempKey, 'activity_value', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="text" placeholder="備註" value={row.notes}
                      onChange={(e) => updateRow(row.tempKey, 'notes', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
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
                <td colSpan={isHotel ? 3 : 4} className="px-3 py-2 text-gray-700">合計</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalAct.toLocaleString(undefined, { maximumFractionDigits: 1 })} {source.default_unit}
                </td>
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

'use client';

import { useState, useRef } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG } from './tabTypes';
import type { EmissionSource, ActivityRecord } from './page';

const COMMUTE_CODES_PREFIX = '3-7';

const SOURCE_LABEL_MAP: Record<string, string> = {
  '3-7-A': '混合方式',
  '3-7-B': '汽油汽車',
  '3-7-C': '機車',
  '3-7-D': '公車',
  '3-7-E': '電動腳踏車',
  '3-7-F': '柴油汽車',
  '3-7-G': '捷運',
  '3-7-3': '高鐵',
  '3-7-4': '火車',
  '3-7-5': '電動汽車',
};

interface AnnualRow {
  id: string | null;
  value: string;
  notes: string;
  co2e: number | null;
  status: SaveStatus;
  is_reviewed: boolean;
}

// month=1 用於儲存年度彙總值（DB 限 1-12）
const ANNUAL_MONTH = 1;

export default function CommuteTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, setActiveTab, onReviewToggle,
}: TabProps) {
  const sources = emissionSources
    .filter((s) => s.source_code.startsWith(COMMUTE_CODES_PREFIX) && selectedSourceIds.has(s.id))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-gray-400">
        <p className="text-base mb-2">尚未設定員工通勤排放源</p>
        <p className="text-sm">
          請至
          <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">基本資訊</button>
          勾選通勤交通方式。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">員工通勤 S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">填入全年度員工通勤里程（person-km），自動計算碳排放</p>
      </div>
      <CommuteTable
        sources={sources}
        factory={factory}
        year={year}
        existingRecords={existingRecords}
        onReviewToggle={onReviewToggle}
      />
    </div>
  );
}

function CommuteTable({
  sources, factory, year, existingRecords, onReviewToggle,
}: {
  sources: EmissionSource[];
  factory: TabProps['factory'];
  year: number;
  existingRecords: ActivityRecord[];
  onReviewToggle?: TabProps['onReviewToggle'];
}) {
  const initRows = (): Record<string, AnnualRow> => {
    const map: Record<string, AnnualRow> = {};
    for (const src of sources) {
      const rec = existingRecords.find(
        (r) => r.emission_source_id === src.id && r.month === ANNUAL_MONTH
      );
      map[src.id] = {
        id: rec?.id ?? null,
        value: rec?.activity_value != null ? String(rec.activity_value) : '',
        notes: rec?.notes ?? '',
        co2e: rec?.co2e_total ?? null,
        status: 'idle',
        is_reviewed: rec?.is_reviewed ?? false,
      };
    }
    return map;
  };

  const [rows, setRows] = useState<Record<string, AnnualRow>>(initRows);
  const rowsRef = useRef(rows);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function update(srcId: string, field: 'value' | 'notes', val: string) {
    const next = { ...rowsRef.current, [srcId]: { ...rowsRef.current[srcId], [field]: val } };
    rowsRef.current = next;
    setRows(next);
    if (timers.current[srcId]) clearTimeout(timers.current[srcId]);
    timers.current[srcId] = setTimeout(() => save(srcId), 1000);
  }

  async function save(srcId: string) {
    const row = rowsRef.current[srcId];
    const src = sources.find((s) => s.id === srcId);
    if (!row || !src) return;
    const update1 = { ...rowsRef.current, [srcId]: { ...row, status: 'saving' as SaveStatus } };
    rowsRef.current = update1;
    setRows(update1);

    const numVal = row.value !== '' ? parseFloat(row.value) : null;
    const payload = {
      factory_id: factory.id,
      emission_source_id: srcId,
      year,
      month: ANNUAL_MONTH,
      activity_value: numVal != null && !isNaN(numVal) ? numVal : null,
      activity_unit: src.default_unit,
      notes: row.notes || null,
    };

    try {
      const res = await fetch('/api/records/autosave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      // 首次儲存是用 POST 新增，回應裡的 id 沒有寫回 row.id，之後查核按鈕的
      // disabled={!row?.id} 永遠為 true，勾不了查核，要重新整理頁面才會恢復——
      // 這裡把回應的 id 補回去，不需要重新整理。
      const saved = {
        ...rowsRef.current,
        [srcId]: {
          ...rowsRef.current[srcId],
          id: json?.data?.id ?? rowsRef.current[srcId].id,
          co2e: json?.data?.co2e_total ?? rowsRef.current[srcId].co2e,
          status: 'saved' as SaveStatus,
        },
      };
      rowsRef.current = saved;
      setRows(saved);
      setTimeout(() => {
        const reset = { ...rowsRef.current };
        if (reset[srcId]?.status === 'saved') reset[srcId] = { ...reset[srcId], status: 'idle' };
        rowsRef.current = reset;
        setRows({ ...reset });
      }, 2000);
    } catch {
      const err = { ...rowsRef.current, [srcId]: { ...rowsRef.current[srcId], status: 'error' as SaveStatus } };
      rowsRef.current = err;
      setRows(err);
    }
  }

  // 清空（activity_value→null，後端一併清 co2e）
  async function clearRow(srcId: string) {
    const row = rowsRef.current[srcId];
    const src = sources.find((s) => s.id === srcId);
    if (!row || !src) return;
    const next = { ...rowsRef.current, [srcId]: { ...row, value: '', notes: '', co2e: null, status: 'idle' as SaveStatus } };
    rowsRef.current = next; setRows(next);
    try {
      await fetch('/api/records/autosave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factory_id: factory.id, emission_source_id: srcId, year, month: ANNUAL_MONTH, activity_value: null, activity_unit: src.default_unit, notes: null }),
      });
    } catch { /* 忽略；畫面已清 */ }
  }

  async function toggleReview(srcId: string) {
    const row = rowsRef.current[srcId];
    if (!row?.id) return;
    const newVal = !row.is_reviewed;
    const next = { ...rowsRef.current, [srcId]: { ...row, is_reviewed: newVal } };
    rowsRef.current = next;
    setRows(next);
    await fetch(`/api/records/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    onReviewToggle?.(row.id, newVal);
  }

  const totalPkm = sources.reduce((s, src) => s + (parseFloat(rows[src.id]?.value ?? '') || 0), 0);
  const totalCo2e = sources.reduce((s, src) => s + (rows[src.id]?.co2e ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="whitespace-nowrap px-4 py-3 text-left">通勤方式</th>
            <th className="whitespace-nowrap px-4 py-3 text-right w-48">年度總里程 (person-km)</th>
            <th className="whitespace-nowrap px-4 py-3 text-left w-40">備註</th>
            <th className="whitespace-nowrap px-4 py-3 text-right w-28">CO₂e (t)</th>
            <th className="whitespace-nowrap px-4 py-3 text-center w-16">查核</th>
            <th className="whitespace-nowrap px-4 py-3 text-center w-8" />
          </tr>
        </thead>
        <tbody>
          {sources.map((src, idx) => {
            const row = rows[src.id];
            const label = SOURCE_LABEL_MAP[src.source_code] ?? src.name_zh;
            return (
              <tr key={src.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-800">{label}</div>
                  <div className="text-xs font-mono text-gray-400">{src.source_code}</div>
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number" min="0" step="any"
                    placeholder="填入全年 person-km"
                    value={row?.value ?? ''}
                    onChange={(e) => update(src.id, 'value', e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    placeholder="備註（調查方式、員工人數等）"
                    value={row?.notes ?? ''}
                    onChange={(e) => update(src.id, 'notes', e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-gray-400">
                  {row?.co2e != null ? row.co2e.toFixed(4) : '—'}
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => toggleReview(src.id)}
                    disabled={!row?.id}
                    title={row?.is_reviewed ? '已查核（點擊取消）' : row?.id ? '點擊標記查核' : '請先儲存資料'}
                    className={`text-sm leading-none transition-all shrink-0
                      ${row?.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                      ${!row?.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                    {row?.is_reviewed ? '✅' : '⬜'}
                  </button>
                </td>
                <td className="px-4 py-2 text-center text-xs whitespace-nowrap">
                  <button onClick={() => clearRow(src.id)} disabled={!row?.value && row?.co2e == null}
                    title="清空數值"
                    className={`ml-1 text-sm leading-none transition ${!row?.value && row?.co2e == null ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
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
              {totalPkm > 0 ? totalPkm.toLocaleString(undefined, { maximumFractionDigits: 10 }) + ' person-km' : '—'}
            </td>
            <td />
            <td className="px-4 py-2 text-right font-mono text-gray-700">
              {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
            </td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

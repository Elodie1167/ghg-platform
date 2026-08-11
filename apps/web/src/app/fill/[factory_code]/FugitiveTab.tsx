'use client';

import { useState, useRef, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { MONTHS, HEADER_BG, BTN_BG, fmtGas } from './tabTypes';
import type { EmissionSource, ActivityRecord } from './page';
import LineItemsCell from './LineItemsCell';

class FugitiveErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[FugitiveTab]', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 bg-red-50 border border-red-300 rounded-xl text-sm text-red-800 whitespace-pre-wrap">
          <div className="font-bold mb-2">逸散填報錯誤（請截圖回報）</div>
          <div className="font-mono text-xs">{String(this.state.error)}</div>
          <div className="font-mono text-xs mt-2 text-red-500">{this.state.error.stack}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 1-4B-1 化糞池 → 月度
const MONTHLY_FUGITIVE = ['1-4B-1'];

interface EventRow {
  tempKey: string;
  id: string | null;
  month: number;
  date_from: string;
  sub_location: string;
  activity_value: string;
  unit_count: string;
  notes: string;
  co2e_total: number | null;
  hfc_t: number | null;
  is_reviewed: boolean;
  line_items_count: number;
  saveStatus: SaveStatus;
}

// 滅火器專用 row（1-4C）
interface ExtRow {
  tempKey: string;
  id: string | null;
  month: number;
  date_from: string;
  new_count: string;      // stored in sub_location
  refill_count: string;   // stored in notes
  kg_per_bottle: string;  // stored in meter_number
  co2e_total: number | null;
  is_reviewed: boolean;
  line_items_count: number;
  saveStatus: SaveStatus;
}

function FugitiveTabInner({
  factory, year, emissionSources, selectedSourceIds, existingRecords, setActiveTab, onReviewToggle,
}: TabProps) {
  const sources = emissionSources
    .filter((s) => s.source_code.startsWith('1-4') && selectedSourceIds.has(s.id))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 text-gray-400">
        <p className="text-base mb-2">尚未設定逸散排放源</p>
        <p className="text-sm">
          請至
          <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">基本資訊</button>
          勾選冷媒、滅火器等逸散設備。
        </p>
      </div>
    );
  }

  const monthlySources = sources.filter((s) => MONTHLY_FUGITIVE.includes(s.source_code));
  const extinguisherSources = sources.filter((s) => s.source_code.startsWith('1-4C'));
  const otherEventSources = sources.filter((s) => !MONTHLY_FUGITIVE.includes(s.source_code) && !s.source_code.startsWith('1-4C'));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">逸散排放 S1</h2>
        <p className="text-sm text-gray-500 mt-0.5">冷媒添加、滅火器使用、SF₆ 補充及化糞池廢水</p>
      </div>

      {monthlySources.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">月度計量</h3>
          {monthlySources.map((src) => (
            <SepticSection
              key={src.id}
              source={src}
              factory={factory}
              year={year}
              records={existingRecords.filter((r) => r.emission_source_id === src.id)}
              onReviewToggle={onReviewToggle}
            />
          ))}
        </div>
      )}

      {extinguisherSources.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">滅火器使用記錄</h3>
          {extinguisherSources.map((src) => (
            <ExtinguisherSection
              key={src.id}
              source={src}
              factory={factory}
              year={year}
              records={existingRecords.filter((r) => r.emission_source_id === src.id)}
              onReviewToggle={onReviewToggle}
            />
          ))}
        </div>
      )}

      {otherEventSources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">逐次填充 / 使用記錄</h3>
          {otherEventSources.map((src) => (
            <EventFugitiveSection
              key={src.id}
              source={src}
              factory={factory}
              year={year}
              records={existingRecords.filter((r) => r.emission_source_id === src.id)}
              onReviewToggle={onReviewToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SepticMonthData {
  id: string | null;
  days: string;
  workers: string;
  hours: string;
  co2e: number | null;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

function SepticSection({
  source, factory, year, records, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  onReviewToggle?: TabProps['onReviewToggle'];
}) {
  const [rows, setRows] = useState<SepticMonthData[]>(() =>
    MONTHS.map((m) => {
      const r = records.find((rec) => rec.month === m);
      return {
        id: r?.id ?? null,
        days: r?.meter_number ?? '',
        workers: r?.sub_location ?? '',
        hours: r?.activity_value != null ? String(r.activity_value) : '',
        co2e: r?.co2e_total ?? null,
        is_reviewed: r?.is_reviewed ?? false,
        saveStatus: 'idle' as SaveStatus,
      };
    })
  );
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const timers = useRef<(ReturnType<typeof setTimeout> | null)[]>(MONTHS.map(() => null));

  function updateRow(idx: number, field: 'days' | 'workers' | 'hours', value: string) {
    setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], [field]: value }; return n; });
    if (timers.current[idx]) clearTimeout(timers.current[idx]!);
    timers.current[idx] = setTimeout(() => saveRow(idx), 1000);
  }

  async function saveRow(idx: number) {
    const row = rowsRef.current[idx];
    const month = MONTHS[idx];
    const hoursNum = row.hours !== '' ? parseFloat(row.hours) : null;
    if (row.hours !== '' && (hoursNum === null || isNaN(hoursNum))) return;
    setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], saveStatus: 'saving' }; return n; });
    const payload = {
      factory_id: factory.id, emission_source_id: source.id, year, month,
      activity_value: hoursNum, activity_unit: 'hr',
      meter_number: row.days || null, sub_location: row.workers || null,
    };
    try {
      if (row.id) {
        const res = await fetch(`/api/records/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], co2e: data.data?.co2e_total ?? n[idx].co2e, saveStatus: 'saved' }; return n; });
      } else {
        const res = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], id: data.data.id, co2e: data.data?.co2e_total ?? null, saveStatus: 'saved' }; return n; });
      }
      setTimeout(() => setRows((p) => { const n = [...p]; if (n[idx].saveStatus === 'saved') n[idx] = { ...n[idx], saveStatus: 'idle' }; return n; }), 2000);
    } catch {
      setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], saveStatus: 'error' }; return n; });
    }
  }

  // 清空某月（天數/人數/時數歸空，activity_value→null 後端一併清 co2e）
  async function clearRow(idx: number) {
    const id = rowsRef.current[idx].id;
    setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], days: '', workers: '', hours: '', co2e: null }; return n; });
    if (!id) return;
    try {
      await fetch(`/api/records/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_value: null, sub_location: null, meter_number: null }),
      });
    } catch { /* 忽略；畫面已清 */ }
  }

  async function toggleReview(idx: number) {
    const row = rowsRef.current[idx];
    if (!row.id) return;
    const newVal = !row.is_reviewed;
    setRows((p) => { const n = [...p]; n[idx] = { ...n[idx], is_reviewed: newVal }; return n; });
    await fetch(`/api/records/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    onReviewToggle?.(row.id, newVal);
  }

  // 查核全部：只動尚未查核的月份（已查核的視為鎖定）
  async function reviewAll() {
    const targets = rowsRef.current
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.id && !r.is_reviewed);
    if (targets.length === 0) return;
    await Promise.all(targets.map(({ idx }) => toggleReview(idx)));
  }

  // 刪除全部：清空全部尚未查核的月份，已查核月份保留（需先取消查核才能刪）
  async function clearAll() {
    const targets = rowsRef.current
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.id && !r.is_reviewed && (r.days || r.workers || r.hours));
    if (targets.length === 0) return;
    if (!confirm(`確定要清空 ${targets.length} 個月份的上班天數/人數/總時數？（已查核的月份不受影響）`)) return;
    await Promise.all(targets.map(({ idx }) => clearRow(idx)));
  }

  const totalDays = rows.reduce((s, r) => s + (parseFloat(r.days) || 0), 0);
  const totalHours = rows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);
  const monthsWithWorkers = rows.filter((r) => r.workers !== '' && !isNaN(parseFloat(r.workers)));
  const avgWorkers = monthsWithWorkers.length > 0
    ? monthsWithWorkers.reduce((s, r) => s + parseFloat(r.workers), 0) / monthsWithWorkers.length
    : 0;
  const totalCo2e = rows.reduce((s, r) => s + (r.co2e ?? 0), 0);
  const aveHour = totalDays > 0 && avgWorkers > 0 ? totalHours / avgWorkers / totalDays : 0;
  const proportion = aveHour / 24;
  // 月 → 單據明細筆數（>0 表示該月為多張單據加總，顯示「查看明細」）
  const liCountByMonth: Record<number, number> = {};
  for (const r of records) liCountByMonth[r.month] = r.line_items_count ?? 0;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <h4 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
        </h4>
        <button onClick={reviewAll}
          className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50">
          ✅ 查核全部
        </button>
        <button onClick={clearAll}
          className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50">
          🗑 刪除全部
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
              <th className="px-3 py-2 text-left w-16">月份</th>
              <th className="px-3 py-2 text-right w-28">上班天數</th>
              <th className="px-3 py-2 text-right w-28">上班人數</th>
              <th className="px-3 py-2 text-right w-28">上班總時數</th>
              <th className="px-3 py-2 text-right w-28">CO₂e (t)</th>
              <th className="px-3 py-2 text-center w-16">明細</th>
              <th className="px-3 py-2 text-center w-16">查核</th>
              <th className="px-3 py-2 text-center w-8">狀</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, idx) => {
              const row = rows[idx];
              return (
                <tr key={m} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 font-medium text-gray-700">{m} 月</td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="1" placeholder="天" value={row.days}
                      onChange={(e) => updateRow(idx, 'days', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="1" placeholder="人" value={row.workers}
                      onChange={(e) => updateRow(idx, 'workers', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="any" placeholder="hr" value={row.hours}
                      onChange={(e) => updateRow(idx, 'hours', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-400 text-xs font-mono">
                    {row.co2e != null ? row.co2e.toFixed(4) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <LineItemsCell recordId={row.id} count={liCountByMonth[m] ?? 0}
                      title={`${source.name_zh} ${m} 月`} unit={source.default_unit} sourceCode={source.source_code} />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button
                      onClick={() => toggleReview(idx)}
                      disabled={!row.id}
                      title={row.is_reviewed ? '已查核（點擊取消）' : row.id ? '點擊標記查核' : '請先儲存資料'}
                      className={`text-sm leading-none transition-all shrink-0
                        ${row.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                        ${!row.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                      {row.is_reviewed ? '✅' : '⬜'}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-center text-xs whitespace-nowrap">
                    {row.saveStatus === 'saving' && '⏳'}
                    {row.saveStatus === 'saved' && '✓'}
                    {row.saveStatus === 'error' && '❌'}
                    <button onClick={() => clearRow(idx)} disabled={!row.id}
                      title="清空此月數值"
                      className={`ml-1 text-sm leading-none transition ${!row.id ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
              <td className="px-3 py-2 text-gray-700">年度合計</td>
              <td className="px-3 py-2 text-right font-mono text-gray-700">{totalDays > 0 ? totalDays.toLocaleString() + ' 天' : '—'}</td>
              <td className="px-3 py-2 text-right font-mono text-gray-700">{avgWorkers > 0 ? avgWorkers.toFixed(1) + ' 人均' : '—'}</td>
              <td className="px-3 py-2 text-right font-mono text-gray-700">{totalHours > 0 ? totalHours.toLocaleString(undefined, { maximumFractionDigits: 10 }) + ' hr' : '—'}</td>
              <td className="px-3 py-2 text-right font-mono text-gray-700">{totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}</td>
              <td />
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {totalDays > 0 && avgWorkers > 0 && totalHours > 0 && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-gray-600 space-y-1">
          <div><span className="font-medium">AVE Hour</span> = {totalHours.toFixed(1)} hr ÷ {avgWorkers.toFixed(1)} 人 ÷ {totalDays} 天 = <span className="font-mono font-semibold">{aveHour.toFixed(4)}</span> hr/人/天</div>
          <div><span className="font-medium">日比例</span> = {aveHour.toFixed(4)} ÷ 24 = <span className="font-mono font-semibold">{proportion.toFixed(6)}</span></div>
          <div className="text-gray-400 pt-1">CO₂e = 日比例 × {avgWorkers.toFixed(1)} 人 × {totalDays} 天 × BOD × Bo × MCF × 16/12 × CH₄ GWP</div>
        </div>
      )}
    </div>
  );
}

// ─── 滅火器專用（1-4C）：新購瓶數 + 填充瓶數 + 一瓶kg ────────────────────
function ExtinguisherSection({
  source, factory, year, records, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  onReviewToggle?: (id: string, newVal: boolean) => void;
}) {
  const [rows, setRows] = useState<ExtRow[]>(() =>
    records.map((r) => ({
      tempKey: r.id, id: r.id, month: r.month,
      date_from: r.date_from ?? '',
      new_count: r.sub_location ?? '',
      refill_count: r.notes ?? '',
      kg_per_bottle: r.meter_number ?? '',
      co2e_total: r.co2e_total,
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
    const targets = targetRows().filter((r) => r.id && !r.is_reviewed);
    if (targets.length === 0) { setSelected(new Set()); return; }
    if (!confirm(`確定要刪除 ${targets.length} 筆尚未查核的資料？`)) return;
    await Promise.all(targets.map((r) => deleteRow(r.tempKey)));
    setSelected(new Set());
  }

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((p) => [...p, { tempKey, id: null, month: new Date().getMonth() + 1, date_from: '', new_count: '', refill_count: '', kg_per_bottle: '', co2e_total: null, is_reviewed: false, line_items_count: 0, saveStatus: 'idle' }]);
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

  function updateRow(tempKey: string, field: keyof ExtRow, value: string | number) {
    setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, [field]: value } : r));
    if (timers.current[tempKey]) clearTimeout(timers.current[tempKey]);
    timers.current[tempKey] = setTimeout(() => saveRow(tempKey), 1000);
  }

  async function saveRow(tempKey: string) {
    const row = rowsRef.current.find((r) => r.tempKey === tempKey);
    if (!row) return;
    setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saving' } : r));

    const newC = parseFloat(row.new_count) || 0;
    const refillC = parseFloat(row.refill_count) || 0;
    const kgPerB = parseFloat(row.kg_per_bottle) || 0;
    const totalKg = (newC + refillC) * kgPerB;

    const payload = {
      factory_id: factory.id, emission_source_id: source.id, year, month: row.month,
      activity_value: totalKg > 0 ? totalKg : null,
      activity_unit: source.default_unit,
      sub_location: row.new_count || null,
      notes: row.refill_count || null,
      meter_number: row.kg_per_bottle || null,
      date_from: row.date_from || null,
    };
    try {
      if (row.id) {
        const res = await fetch(`/api/records/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, id: data.data.id } : r));
      }
      setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saved' } : r));
      setTimeout(() => setRows((p) => p.map((r) => r.tempKey === tempKey && r.saveStatus === 'saved' ? { ...r, saveStatus: 'idle' } : r)), 2000);
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

  const totalKg = rows.reduce((s, r) => {
    return s + (parseFloat(r.new_count) + parseFloat(r.refill_count) || 0) * (parseFloat(r.kg_per_bottle) || 0);
  }, 0);
  const totalCo2e = rows.reduce((s, r) => s + (r.co2e_total ?? 0), 0);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
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
            style={{ backgroundColor: BTN_BG }}>+ 新增記錄</button>
        </div>
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
                <th className="px-2 py-2.5 text-center w-8">
                  <input type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left w-20">月份</th>
                <th className="px-3 py-2.5 text-left w-28">日期</th>
                <th className="px-3 py-2.5 text-right w-24">新購 (瓶)</th>
                <th className="px-3 py-2.5 text-right w-24">填充 (瓶)</th>
                <th className="px-3 py-2.5 text-right w-28">一瓶 (kg)</th>
                <th className="px-3 py-2.5 text-right w-28">合計 (kg)</th>
                <th className="px-3 py-2.5 text-right w-24">CO₂e (t)</th>
                <th className="px-3 py-2.5 text-center w-16">明細</th>
                <th className="px-3 py-2.5 text-center w-8">查核</th>
                <th className="px-3 py-2.5 text-center w-8">狀</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const newC = parseFloat(row.new_count) || 0;
                const refillC = parseFloat(row.refill_count) || 0;
                const kgPerB = parseFloat(row.kg_per_bottle) || 0;
                const totalRowKg = (newC + refillC) * kgPerB;
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
                        className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="1" placeholder="0" value={row.new_count}
                        onChange={(e) => updateRow(row.tempKey, 'new_count', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="1" placeholder="0" value={row.refill_count}
                        onChange={(e) => updateRow(row.tempKey, 'refill_count', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="any" placeholder="kg" value={row.kg_per_bottle}
                        onChange={(e) => updateRow(row.tempKey, 'kg_per_bottle', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-600 text-xs font-mono">
                      {totalRowKg > 0 ? totalRowKg.toLocaleString(undefined, { maximumFractionDigits: 10 }) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400 text-xs font-mono">
                      {row.co2e_total != null ? row.co2e_total.toFixed(4) : '—'}
                    </td>
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
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-sm">
                <td colSpan={6} className="px-3 py-2 text-gray-700">合計</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalKg.toLocaleString(undefined, { maximumFractionDigits: 10 })} kg
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function EventFugitiveSection({
  source, factory, year, records, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  onReviewToggle?: (id: string, newVal: boolean) => void;
}) {
  const isSF6 = source.source_code === '1-4D-1';

  const [rows, setRows] = useState<EventRow[]>(() =>
    records.map((r) => {
      const unitCnt = r.meter_number ?? '';
      const unitNum = parseFloat(unitCnt);
      const actVal = isSF6 && unitNum > 0 && r.activity_value != null
        ? String(parseFloat(String(r.activity_value)) / unitNum)
        : r.activity_value != null ? String(r.activity_value) : '';
      return {
        tempKey: r.id, id: r.id, month: r.month,
        date_from: r.date_from ?? '', sub_location: r.sub_location ?? '',
        activity_value: actVal, unit_count: unitCnt,
        notes: r.notes ?? '', co2e_total: r.co2e_total,
        hfc_t: r.hfc_t ?? null,
        is_reviewed: r.is_reviewed ?? false,
        line_items_count: r.line_items_count ?? 0,
        saveStatus: 'idle' as SaveStatus,
      };
    })
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
    const targets = targetRows().filter((r) => r.id && !r.is_reviewed);
    if (targets.length === 0) { setSelected(new Set()); return; }
    if (!confirm(`確定要刪除 ${targets.length} 筆尚未查核的資料？`)) return;
    await Promise.all(targets.map((r) => deleteRow(r.tempKey)));
    setSelected(new Set());
  }

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((p) => [...p, { tempKey, id: null, month: new Date().getMonth() + 1, date_from: '', sub_location: '', activity_value: '', unit_count: '', notes: '', co2e_total: null, hfc_t: null, is_reviewed: false, line_items_count: 0, saveStatus: 'idle' }]);
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
    const fillPerUnit = row.activity_value !== '' ? parseFloat(row.activity_value) : null;
    const unitCnt = row.unit_count !== '' ? parseFloat(row.unit_count) : null;
    const totalVal = isSF6 && fillPerUnit != null && !isNaN(fillPerUnit) && unitCnt != null && !isNaN(unitCnt)
      ? fillPerUnit * unitCnt
      : fillPerUnit != null && !isNaN(fillPerUnit) ? fillPerUnit : null;
    const payload: Record<string, unknown> = {
      factory_id: factory.id, emission_source_id: source.id, year, month: row.month,
      activity_value: totalVal,
      activity_unit: source.default_unit,
      sub_location: row.sub_location || null, date_from: row.date_from || null, notes: row.notes || null,
    };
    if (isSF6) payload.meter_number = row.unit_count || null;
    try {
      if (row.id) {
        const res = await fetch(`/api/records/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, id: data.data.id } : r));
      }
      setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saved' } : r));
      setTimeout(() => setRows((p) => p.map((r) => r.tempKey === tempKey && r.saveStatus === 'saved' ? { ...r, saveStatus: 'idle' } : r)), 2000);
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

  const locPlaceholder = source.source_code.startsWith('1-4A') ? '設備 / 冷媒型號' : '設備名稱';

  const totalVol = isSF6
    ? rows.reduce((s, r) => s + (parseFloat(r.unit_count) || 0) * (parseFloat(r.activity_value) || 0), 0)
    : rows.reduce((s, r) => s + (parseFloat(r.activity_value) || 0), 0);
  const totalCo2e = rows.reduce((s, r) => s + (r.co2e_total ?? 0), 0);
  const totalHfc = rows.reduce((s, r) => s + (r.hfc_t ?? 0), 0);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800">
          {source.name_zh}
          <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
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
            style={{ backgroundColor: BTN_BG }}>+ 新增記錄</button>
        </div>
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
                <th className="px-2 py-2.5 text-center w-8">
                  <input type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left w-20">月份</th>
                <th className="px-3 py-2.5 text-left w-28">日期</th>
                <th className="px-3 py-2.5 text-left">{locPlaceholder}</th>
                {isSF6 && <th className="px-3 py-2.5 text-right w-20">台數</th>}
                <th className="px-3 py-2.5 text-right w-28">{isSF6 ? `每台填充 (${source.default_unit})` : `用量 (${source.default_unit})`}</th>
                <th className="px-3 py-2.5 text-left w-28">備註</th>
                <th className="px-3 py-2.5 text-right w-24">CO₂e (t)</th>
                <th className="px-2 py-2.5 text-right w-20 text-gray-700" style={{ backgroundColor: '#fef9c3' }}>HFCs (t)</th>
                <th className="px-3 py-2.5 text-center w-16">明細</th>
                <th className="px-3 py-2.5 text-center w-8">查核</th>
                <th className="px-3 py-2.5 text-center w-8">狀</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
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
                      className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="text" placeholder={locPlaceholder} value={row.sub_location}
                      onChange={(e) => updateRow(row.tempKey, 'sub_location', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  {isSF6 && (
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="1" placeholder="台"
                        value={row.unit_count}
                        onChange={(e) => updateRow(row.tempKey, 'unit_count', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="any" placeholder={source.default_unit} value={row.activity_value}
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
                  <td className="px-2 py-1.5 text-right text-xs font-mono text-gray-400" style={{ backgroundColor: '#fefce8' }}>
                    {row.hfc_t?.toFixed(4) ?? '—'}
                  </td>
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
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-sm">
                <td colSpan={isSF6 ? 5 : 4} className="px-3 py-2 text-gray-700">合計</td>
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalVol.toLocaleString(undefined, { maximumFractionDigits: 10 })} {source.default_unit}
                </td>
                <td />
                <td className="px-3 py-2 text-right font-mono text-gray-700">
                  {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                </td>
                <td className="px-2 py-2 text-right font-mono text-gray-500 text-xs" style={{ backgroundColor: '#fefce8' }}>{fmtGas(totalHfc)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FugitiveTab(props: TabProps) {
  return (
    <FugitiveErrorBoundary>
      <FugitiveTabInner {...props} />
    </FugitiveErrorBoundary>
  );
}

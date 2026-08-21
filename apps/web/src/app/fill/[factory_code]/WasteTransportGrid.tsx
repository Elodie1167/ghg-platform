'use client';

/**
 * 3-5-T1 廢棄物清運。
 *
 * 使用者只填「處理場所名稱／地址／單程距離」，重量不填 —— 直接接同月的
 * 3-5-W1（一般廢棄物）／3-5-W2（廢布）填報值。一般廢棄物與廢布可能送去
 * 不同地方，所以是兩張各自獨立的 12 個月表。
 *
 * tkm = 重量(mt) × 單程距離(km)，係數與 3-4-A 上下游運輸-陸運共用。
 * 活動數據與 CO₂e 由伺服器（lib/waste-derive.ts）算出後回寫，這裡只顯示。
 */

import { useState, useRef } from 'react';
import type { Factory } from './page';
import { MONTHS, HEADER_BG } from './tabTypes';
import type { WasteApiRecord, SourceValue } from './WasteApiTypes';

const STREAMS = [
  { key: 'general' as const, label: '一般廢棄物', weightCode: '3-5-W1' },
  { key: 'textile' as const, label: '廢布/紡織廢棄物', weightCode: '3-5-W2' },
];

const cell = 'border border-gray-200 px-2 py-1 text-sm whitespace-nowrap';
const input = 'w-full px-1 py-0.5 text-sm border border-gray-200 rounded focus:border-green-600 outline-none';

export default function WasteTransportGrid({
  factory, year, records, sourceValues, roadFactor, onChanged,
}: {
  factory: Factory;
  year: number;
  records: WasteApiRecord[];
  sourceValues: SourceValue[];
  /** 3-4-A 陸運係數 kgCO₂e/tkm，未維護時為 null */
  roadFactor: number | null;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 使用者輸入的即時值（伺服器回寫前先顯示自己打的字）
  const [draft, setDraft] = useState<Record<string, string>>({});
  // 「套用到全年」的來源輸入（不對應任何一個月，純粹是要複製出去的值）
  const [bulk, setBulk] = useState<Record<'general' | 'textile', {
    destination_name: string; destination_address: string; distance_km: string;
  }>>({
    general: { destination_name: '', destination_address: '', distance_km: '' },
    textile: { destination_name: '', destination_address: '', distance_km: '' },
  });
  const [applying, setApplying] = useState<'general' | 'textile' | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<'general' | 'textile' | null>(null);
  const [selected, setSelected] = useState<Record<'general' | 'textile', Set<number>>>({
    general: new Set(), textile: new Set(),
  });

  const recOf = (stream: string, m: number) =>
    records.find((r) => r.source_code === '3-5-T1' && r.month === m
      && (r.sub_location ?? 'general') === stream);

  const weightKgOf = (code: string, m: number) => {
    const row = sourceValues.find((s) => s.source_code === code && s.month === m);
    if (!row || row.value == null) return null;
    return row.unit === 'mt' || row.unit === 'tonne' ? row.value * 1000 : row.value;
  };

  const key = (stream: string, m: number, field: string) => `${stream}-${m}-${field}`;

  function readField(stream: string, m: number, field: 'destination_name' | 'destination_address' | 'distance_km') {
    const k = key(stream, m, field);
    if (k in draft) return draft[k];
    const r = recOf(stream, m);
    const v = r?.[field];
    return v == null ? '' : String(v);
  }

  function onEdit(stream: 'general' | 'textile', m: number, field: string, value: string) {
    const k = key(stream, m, field);
    setDraft((d) => ({ ...d, [k]: value }));
    clearTimeout(timers.current[`${stream}-${m}`]);
    timers.current[`${stream}-${m}`] = setTimeout(() => save(stream, m), 800);
  }

  async function saveOne(
    stream: 'general' | 'textile', m: number,
    values: { destination_name: string; destination_address: string; distance_km: string },
  ): Promise<void> {
    const distRaw = values.distance_km.trim();
    const dist = distRaw === '' ? null : Number(distRaw);
    if (dist != null && (!isFinite(dist) || dist <= 0)) {
      throw new Error(`${m} 月的距離需為大於 0 的數字`);
    }
    const res = await fetch('/api/waste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'transport', factory_id: factory.id, year, month: m, stream,
        destination_name: values.destination_name.trim() || null,
        destination_address: values.destination_address.trim() || null,
        distance_km: dist,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
  }

  async function save(stream: 'general' | 'textile', m: number) {
    setStatus('saving'); setErr(null);
    try {
      await saveOne(stream, m, {
        destination_name: readField(stream, m, 'destination_name'),
        destination_address: readField(stream, m, 'destination_address'),
        distance_km: readField(stream, m, 'distance_km'),
      });
      setStatus('saved');
      onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : '儲存失敗');
    }
  }

  /** 查核 toggle。與其他分頁一致：只有已存在記錄（有 id）才能標記，查核後鎖定輸入。 */
  async function toggleReview(stream: 'general' | 'textile', m: number) {
    const r = recOf(stream, m);
    if (!r) return;
    const k = key(stream, m, 'review');
    const newVal = !r.is_reviewed;
    setReviewBusy(k);
    try {
      const res = await fetch(`/api/records/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_reviewed: newVal }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? '更新查核狀態失敗');
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '更新查核狀態失敗');
      setStatus('error');
    } finally {
      setReviewBusy(null);
    }
  }

  /** 套用到全年：對該流所有「未查核」的月份寫入同一組處理場所/距離 */
  async function applyToAll(stream: 'general' | 'textile') {
    const values = bulk[stream];
    if (!values.destination_name.trim() && !values.destination_address.trim() && !values.distance_km.trim()) {
      setErr('請至少填一項要套用的內容'); setStatus('error'); return;
    }
    const targetMonths = MONTHS.filter((m) => !(recOf(stream, m)?.is_reviewed ?? false));
    if (targetMonths.length === 0) {
      setErr('本年度所有月份都已查核，無法套用'); setStatus('error'); return;
    }
    if (!confirm(`確定要把這組處理場所／距離套用到「${STREAMS.find((s) => s.key === stream)!.label}」共 ${targetMonths.length} 個月（已查核的月份會跳過）？`)) return;

    setApplying(stream); setStatus('saving'); setErr(null);
    try {
      for (const m of targetMonths) {
        await saveOne(stream, m, values);
        // 讓已填的字同時反映在該月的個別欄位，避免使用者以為套用沒生效
        setDraft((d) => ({
          ...d,
          [key(stream, m, 'destination_name')]: values.destination_name,
          [key(stream, m, 'destination_address')]: values.destination_address,
          [key(stream, m, 'distance_km')]: values.distance_km,
        }));
      }
      setStatus('saved');
      onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : '套用失敗');
    } finally {
      setApplying(null);
    }
  }

  /** 對某流「已存在記錄」的月份做全選查核（跳過已查核） */
  async function bulkReview(stream: 'general' | 'textile') {
    const targets = MONTHS.filter((m) => {
      if (selected[stream].size > 0 && !selected[stream].has(m)) return false;
      const r = recOf(stream, m);
      return r && !r.is_reviewed;
    });
    if (targets.length === 0) return;
    setBulkBusy(stream);
    try {
      for (const m of targets) await toggleReview(stream, m);
      setSelected((s) => ({ ...s, [stream]: new Set() }));
    } finally {
      setBulkBusy(null);
    }
  }

  /** 對某流「已存在記錄且已查核」的月份做全選取消查核 */
  async function bulkUnreview(stream: 'general' | 'textile') {
    const targets = MONTHS.filter((m) => {
      if (selected[stream].size > 0 && !selected[stream].has(m)) return false;
      const r = recOf(stream, m);
      return r && r.is_reviewed;
    });
    if (targets.length === 0) return;
    setBulkBusy(stream);
    try {
      for (const m of targets) await toggleReview(stream, m);
      setSelected((s) => ({ ...s, [stream]: new Set() }));
    } finally {
      setBulkBusy(null);
    }
  }

  /** 對某流「已存在記錄且未查核」的月份做全選刪除（已查核者跳過，須先取消查核） */
  async function bulkDelete(stream: 'general' | 'textile') {
    const candidates = MONTHS.filter((m) => selected[stream].size === 0 || selected[stream].has(m));
    const targets = candidates.filter((m) => {
      const r = recOf(stream, m);
      return r && !r.is_reviewed;
    });
    if (targets.length === 0) {
      setErr('所選記錄都已查核或不存在，無法刪除，請先取消查核。'); setStatus('error');
      return;
    }
    if (!confirm(`確定要刪除「${STREAMS.find((s) => s.key === stream)!.label}」共 ${targets.length} 個月的清運記錄？`)) return;
    setBulkBusy(stream); setErr(null);
    try {
      for (const m of targets) {
        const r = recOf(stream, m);
        if (!r) continue;
        const res = await fetch(`/api/records/${r.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${m} 月刪除失敗`);
      }
      setSelected((s) => ({ ...s, [stream]: new Set() }));
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '刪除失敗'); setStatus('error');
    } finally {
      setBulkBusy(null);
    }
  }

  const grandWeightTotal = STREAMS.reduce(
    (s, st) => s + MONTHS.reduce((sm, m) => sm + (weightKgOf(st.weightCode, m) ?? 0), 0), 0,
  );
  const grandTkmTotal = STREAMS.reduce(
    (s, st) => s + MONTHS.reduce((sm, m) => sm + (recOf(st.key, m)?.activity_value ?? 0), 0), 0,
  );
  const grandCo2eTotal = STREAMS.reduce(
    (s, st) => s + MONTHS.reduce((sm, m) => sm + (recOf(st.key, m)?.co2e_total ?? 0), 0), 0,
  );

  return (
    <div className="mb-8 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 text-white flex items-center gap-3 flex-wrap" style={{ backgroundColor: HEADER_BG }}>
        <span className="font-mono text-xs opacity-80">3-5-T1</span>
        <span className="font-semibold text-sm">廢棄物清運</span>
        <span className="text-xs opacity-80">tkm ＝ 廢棄物重量(mt) × 單程距離(km)</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 bg-white/15 rounded px-2.5 py-1">
            <span className="text-xs opacity-90">兩類合計重量</span>
            <strong className="font-mono text-base">{grandWeightTotal > 0 ? grandWeightTotal.toLocaleString() : '—'}</strong>
            <span className="text-xs opacity-90">kg</span>
          </span>
          <span className="flex items-center gap-1.5 bg-white/15 rounded px-2.5 py-1">
            <span className="text-xs opacity-90">合計</span>
            <strong className="font-mono text-base">{grandTkmTotal > 0 ? grandTkmTotal.toLocaleString() : '—'}</strong>
            <span className="text-xs opacity-90">tkm</span>
          </span>
          <span className="flex items-center gap-1.5 bg-white/15 rounded px-2.5 py-1">
            <span className="text-xs opacity-90">合計</span>
            <strong className="font-mono text-base">{grandCo2eTotal > 0 ? grandCo2eTotal.toFixed(4) : '—'}</strong>
            <span className="text-xs opacity-90">tCO₂e</span>
          </span>
          {(status === 'saving' || status === 'saved') && (
            <span className="text-xs">{status === 'saving' ? '儲存中…' : '已儲存'}</span>
          )}
        </span>
      </div>

      <div className="px-4 py-2 bg-blue-50 text-blue-900 text-xs border-b border-blue-200">
        重量<strong>不需填</strong>，自動取同月的 3-5-W1／3-5-W2 填報值；改了廢棄物重量這裡會跟著重算。
        排放係數與「3-4-A 上下游運輸-陸運」共用
        {roadFactor != null
          ? `（目前 ${roadFactor} kgCO₂e/tkm）`
          : '（⚠️ 本廠尚未指派 3-4-A 係數，CO₂e 會留空不計入彙整表）'}。
        距離請以 Google Map 最近路線、交通方式選 car 量測，一律填<strong>單程</strong>。
      </div>

      {err && <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b border-red-200">{err}</div>}

      {STREAMS.map((st) => {
        const streamTotal = MONTHS.reduce((s, m) => s + (recOf(st.key, m)?.co2e_total ?? 0), 0);
        const weightTotal = MONTHS.reduce((s, m) => s + (weightKgOf(st.weightCode, m) ?? 0), 0);
        const tkmTotal = MONTHS.reduce((s, m) => s + (recOf(st.key, m)?.activity_value ?? 0), 0);
        const recordMonths = MONTHS.filter((m) => recOf(st.key, m));
        const allSelected = recordMonths.length > 0 && recordMonths.every((m) => selected[st.key].has(m));
        return (
          <div key={st.key} className="border-b border-gray-200 last:border-b-0">
            <div className="px-4 py-2 bg-gray-100 text-sm font-semibold text-gray-700 flex items-center flex-wrap gap-2">
              {st.label}
              <span className="text-xs font-normal text-gray-500">
                重量來源：{st.weightCode}
              </span>
              <span className="ml-auto text-xs font-normal">
                年度合計 {streamTotal > 0 ? streamTotal.toFixed(4) : '—'} tCO₂e
              </span>
              <button onClick={() => bulkReview(st.key)} disabled={recordMonths.length === 0 || bulkBusy === st.key}
                className="px-3 py-1 rounded text-xs font-medium text-white disabled:opacity-40" style={{ backgroundColor: HEADER_BG }}>
                全選查核
              </button>
              <button onClick={() => bulkUnreview(st.key)} disabled={recordMonths.length === 0 || bulkBusy === st.key}
                className="px-3 py-1 rounded text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                全選取消查核
              </button>
              <button onClick={() => bulkDelete(st.key)} disabled={recordMonths.length === 0 || bulkBusy === st.key}
                className="px-3 py-1 rounded text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40">
                全選刪除
              </button>
            </div>

            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex flex-wrap items-end gap-2">
              <span className="text-xs text-gray-500 mb-1 w-full">
                若全年送同一個處理場所、距離也相同，這裡填一次套用到 12 個月即可，不用逐月填：
              </span>
              <div style={{ minWidth: 150 }}>
                <input className={input} placeholder="處理場所名稱"
                  value={bulk[st.key].destination_name}
                  onChange={(e) => setBulk((b) => ({ ...b, [st.key]: { ...b[st.key], destination_name: e.target.value } }))} />
              </div>
              <div style={{ minWidth: 220 }}>
                <input className={input} placeholder="處理場所地址"
                  value={bulk[st.key].destination_address}
                  onChange={(e) => setBulk((b) => ({ ...b, [st.key]: { ...b[st.key], destination_address: e.target.value } }))} />
              </div>
              <div style={{ minWidth: 110 }}>
                <input className={`${input} text-right`} type="number" step="any" min="0" placeholder="單程距離 km"
                  value={bulk[st.key].distance_km}
                  onChange={(e) => setBulk((b) => ({ ...b, [st.key]: { ...b[st.key], distance_km: e.target.value } }))} />
              </div>
              <button onClick={() => applyToAll(st.key)} disabled={applying === st.key}
                className="px-3 py-1 text-xs rounded text-white disabled:opacity-50" style={{ backgroundColor: HEADER_BG }}>
                {applying === st.key ? '套用中…' : '套用到全年'}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className={`${cell} w-8 text-center`}>
                      <input type="checkbox" checked={allSelected}
                        onChange={(e) => setSelected((s) => ({
                          ...s, [st.key]: e.target.checked ? new Set(recordMonths) : new Set(),
                        }))} />
                    </th>
                    <th className={cell}>月</th>
                    <th className={cell}>重量 kg（自動）</th>
                    <th className={cell} style={{ minWidth: 150 }}>處理場所名稱</th>
                    <th className={cell} style={{ minWidth: 220 }}>處理場所地址</th>
                    <th className={cell} style={{ minWidth: 110 }}>單程距離 km</th>
                    <th className={cell}>活動數據 tkm</th>
                    <th className={cell}>tCO₂e</th>
                    <th className={cell}>查核</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((m) => {
                    const r = recOf(st.key, m);
                    const kg = weightKgOf(st.weightCode, m);
                    const locked = r?.is_reviewed ?? false;
                    return (
                      <tr key={m} className={locked ? 'bg-gray-50' : ''}>
                        <td className={`${cell} text-center`}>
                          {r && (
                            <input type="checkbox" checked={selected[st.key].has(m)}
                              onChange={(e) => setSelected((s) => {
                                const next = new Set(s[st.key]);
                                if (e.target.checked) next.add(m); else next.delete(m);
                                return { ...s, [st.key]: next };
                              })} />
                          )}
                        </td>
                        <td className={`${cell} text-center`}>{m}</td>
                        <td className={`${cell} text-right font-mono text-xs`}>
                          {kg != null ? kg.toLocaleString() : <span className="text-gray-300">未填</span>}
                        </td>
                        <td className={cell}>
                          <input className={input} disabled={locked}
                            value={readField(st.key, m, 'destination_name')}
                            onChange={(e) => onEdit(st.key, m, 'destination_name', e.target.value)} />
                        </td>
                        <td className={cell}>
                          <input className={input} disabled={locked}
                            value={readField(st.key, m, 'destination_address')}
                            onChange={(e) => onEdit(st.key, m, 'destination_address', e.target.value)} />
                        </td>
                        <td className={cell}>
                          <input className={`${input} text-right`} type="number" step="any" min="0" disabled={locked}
                            value={readField(st.key, m, 'distance_km')}
                            onChange={(e) => onEdit(st.key, m, 'distance_km', e.target.value)} />
                        </td>
                        <td className={`${cell} text-right font-mono text-xs`}>
                          {r?.activity_value != null ? r.activity_value.toLocaleString() : '—'}
                        </td>
                        <td className={`${cell} text-right font-mono text-xs`}>
                          {r?.co2e_total != null ? r.co2e_total.toFixed(4) : '—'}
                        </td>
                        <td className={`${cell} text-center`}>
                          <button onClick={() => toggleReview(st.key, m)}
                            disabled={!r || reviewBusy === key(st.key, m, 'review')}
                            title={r?.is_reviewed ? '已查核（點擊取消）' : r ? '點擊標記查核' : '請先儲存資料'}
                            className={`text-sm leading-none transition-all shrink-0
                              ${r?.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                              ${!r ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                            {r?.is_reviewed ? '✅' : '⬜'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-green-50 font-semibold text-sm border-t-2 border-green-400">
                    <td className={cell} colSpan={2}>年度合計</td>
                    <td className={`${cell} text-right font-mono`}>{weightTotal > 0 ? weightTotal.toLocaleString() : '—'}</td>
                    <td className={cell} colSpan={3} />
                    <td className={`${cell} text-right font-mono`}>{tkmTotal > 0 ? tkmTotal.toLocaleString() : '—'}</td>
                    <td className={`${cell} text-right font-mono`}>{streamTotal > 0 ? streamTotal.toFixed(4) : '—'}</td>
                    <td className={cell} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
        必要佐證：① 每月過磅紀錄（同 3-5-W1／W2）　② 清運合約（須載明處理商地址與處理方式）
        ③ Google Map 距離截圖（工廠→處理廠，交通方式選 car）
      </div>
    </div>
  );
}

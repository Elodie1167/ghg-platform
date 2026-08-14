'use client';

/**
 * 3-5-T2 廢水/水肥清運。
 *
 * 與 3-5-T1 不同：重量不是自動接 W1/W2，是使用者逐月填的實際清運量。
 * 但清運商、處理場所、車型等「填報資訊」多數月份不會變，所以同 T1 提供
 * 「填一次套用全年」，使用者只需每月改重量（若有變動）。
 *
 * tkm = 重量(mt) × 單程距離(km) × 趟次，係數為本廠指派的 3-5-T2 排放係數。
 * 活動數據與 CO₂e 由伺服器（lib/waste-derive.ts）算出後回寫，這裡只顯示。
 */

import { useState, useRef } from 'react';
import type { Factory } from './page';
import { MONTHS, HEADER_BG, STICKY_THEAD_TOP } from './tabTypes';
import { WASTE_TYPES_T2, toTonnes } from '@/lib/waste-detail';
import type { WasteApiRecord } from './WasteApiTypes';

const cell = 'border border-gray-200 px-2 py-1 text-sm whitespace-nowrap';
const input = 'w-full px-1 py-0.5 text-sm border border-gray-200 rounded focus:border-green-600 outline-none';

type FieldSet = {
  waste_type: string; contractor_name: string;
  destination_name: string; destination_address: string;
  waste_weight: string; waste_weight_unit: string; density: string;
  distance_km: string; trip_count: string;
};
const FIELD_KEYS = Object.keys({} as FieldSet) as (keyof FieldSet)[];
/** 套用到全年時要複製的欄位：不含重量，重量是每月的實際數據 */
const BULK_KEYS = FIELD_KEYS.filter((k) => k !== 'waste_weight');

function emptyFields(): FieldSet {
  return {
    waste_type: '', contractor_name: '', destination_name: '', destination_address: '',
    waste_weight: '', waste_weight_unit: 'kg', density: '', distance_km: '', trip_count: '',
  };
}

export default function WastewaterTransportGrid({
  factory, year, records, scope3Factor, onChanged,
}: {
  factory: Factory;
  year: number;
  records: WasteApiRecord[];
  scope3Factor: number | null;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [draft, setDraft] = useState<Record<number, Partial<FieldSet>>>({});
  const [bulk, setBulk] = useState<FieldSet>(emptyFields());
  const [applying, setApplying] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const recOf = (m: number) => records.find((r) => r.source_code === '3-5-T2' && r.month === m);

  function readField(m: number, k: keyof FieldSet): string {
    if (draft[m]?.[k] !== undefined) return draft[m]![k]!;
    const r = recOf(m);
    if (!r) return k === 'waste_weight_unit' ? 'kg' : '';
    const map: Record<keyof FieldSet, string | number | null | undefined> = {
      waste_type: r.waste_type, contractor_name: r.contractor_name,
      destination_name: r.destination_name, destination_address: r.destination_address,
      waste_weight: r.waste_weight, waste_weight_unit: r.waste_weight_unit ?? 'kg',
      density: r.density, distance_km: r.distance_km,
      trip_count: r.trip_count,
    };
    const v = map[k];
    return v == null ? (k === 'waste_weight_unit' ? 'kg' : '') : String(v);
  }

  function onEdit(m: number, k: keyof FieldSet, value: string) {
    setDraft((d) => ({ ...d, [m]: { ...d[m], [k]: value } }));
    clearTimeout(timers.current[m]);
    timers.current[m] = setTimeout(() => save(m), 800);
  }

  function currentFields(m: number): FieldSet {
    const out = {} as FieldSet;
    for (const k of FIELD_KEYS) out[k] = readField(m, k);
    return out;
  }

  async function saveOne(m: number, f: FieldSet): Promise<void> {
    const weight = f.waste_weight.trim() === '' ? null : Number(f.waste_weight);
    const distance = f.distance_km.trim() === '' ? null : Number(f.distance_km);
    const density = f.density.trim() === '' ? null : Number(f.density);
    const trips = f.trip_count.trim() === '' ? null : Number(f.trip_count);
    if (weight != null && (!isFinite(weight) || weight <= 0)) throw new Error(`${m} 月的重量需為大於 0 的數字`);
    if (distance != null && (!isFinite(distance) || distance <= 0)) throw new Error(`${m} 月的距離需為大於 0 的數字`);

    const res = await fetch('/api/waste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'transport_t2', factory_id: factory.id, year, month: m,
        waste_type: f.waste_type || null,
        contractor_name: f.contractor_name.trim() || null,
        destination_name: f.destination_name.trim() || null,
        destination_address: f.destination_address.trim() || null,
        waste_weight: weight,
        waste_weight_unit: f.waste_weight_unit || null,
        density,
        distance_km: distance,
        trip_count: trips,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
  }

  async function save(m: number) {
    setStatus('saving'); setErr(null);
    try {
      await saveOne(m, currentFields(m));
      setStatus('saved');
      onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : '儲存失敗');
    }
  }

  async function toggleReview(m: number) {
    const r = recOf(m);
    if (!r) return;
    setReviewBusy(m);
    try {
      const res = await fetch(`/api/records/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_reviewed: !r.is_reviewed }),
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

  /** 套用到全年：對所有「未查核」的月份寫入同一組清運資訊（重量除外，每月各自填） */
  async function applyToAll() {
    if (BULK_KEYS.every((k) => !bulk[k].trim())) {
      setErr('請至少填一項要套用的內容'); setStatus('error'); return;
    }
    const targetMonths = MONTHS.filter((m) => !(recOf(m)?.is_reviewed ?? false));
    if (targetMonths.length === 0) {
      setErr('本年度所有月份都已查核，無法套用'); setStatus('error'); return;
    }
    if (!confirm(`確定要把這組清運資訊套用到共 ${targetMonths.length} 個月（已查核的月份會跳過，重量請自行逐月填）？`)) return;

    setApplying(true); setStatus('saving'); setErr(null);
    try {
      for (const m of targetMonths) {
        const merged = { ...currentFields(m), ...Object.fromEntries(BULK_KEYS.map((k) => [k, bulk[k]])) } as FieldSet;
        await saveOne(m, merged);
        setDraft((d) => ({
          ...d,
          [m]: { ...d[m], ...Object.fromEntries(BULK_KEYS.map((k) => [k, bulk[k]])) },
        }));
      }
      setStatus('saved');
      onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : '套用失敗');
    } finally {
      setApplying(false);
    }
  }

  async function bulkReviewAll() {
    const targets = MONTHS.filter((m) => {
      if (selected.size > 0 && !selected.has(m)) return false;
      const r = recOf(m);
      return r && !r.is_reviewed;
    });
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      for (const m of targets) await toggleReview(m);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDeleteAll() {
    const candidates = MONTHS.filter((m) => selected.size === 0 || selected.has(m));
    const targets = candidates.filter((m) => {
      const r = recOf(m);
      return r && !r.is_reviewed;
    });
    if (targets.length === 0) {
      setErr('所選記錄都已查核或不存在，無法刪除，請先取消查核。'); setStatus('error');
      return;
    }
    if (!confirm(`確定要刪除共 ${targets.length} 個月的廢水/水肥清運記錄？`)) return;
    setBulkBusy(true); setErr(null);
    try {
      for (const m of targets) {
        const r = recOf(m);
        if (!r) continue;
        const res = await fetch(`/api/records/${r.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${m} 月刪除失敗`);
      }
      setSelected(new Set());
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '刪除失敗'); setStatus('error');
    } finally {
      setBulkBusy(false);
    }
  }

  const total = MONTHS.reduce((s, m) => s + (recOf(m)?.co2e_total ?? 0), 0);
  const weightKgTotal = MONTHS.reduce((s, m) => {
    const r = recOf(m);
    if (!r?.waste_weight) return s;
    return s + toTonnes(r.waste_weight, r.waste_weight_unit, r.density) * 1000;
  }, 0);
  const tkmTotal = MONTHS.reduce((s, m) => s + (recOf(m)?.activity_value ?? 0), 0);
  const recordMonths = MONTHS.filter((m) => recOf(m));
  const allSelected = recordMonths.length > 0 && recordMonths.every((m) => selected.has(m));

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-gray-800">
          廢水/水肥清運
          <span className="ml-2 text-xs font-mono text-gray-400">3-5-T2</span>
          <span className="ml-2 text-xs text-gray-400">tkm ＝ 重量(mt) × 單程距離(km) × 趟次</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            年度合計 {total > 0 ? total.toFixed(4) : '—'} tCO₂e
            {status === 'saving' ? '　儲存中…' : status === 'saved' ? '　已儲存' : ''}
          </span>
          <button onClick={bulkReviewAll} disabled={recordMonths.length === 0 || bulkBusy}
            className="px-3 py-1.5 rounded-lg border border-green-700 text-green-700 text-xs font-medium transition hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed">
            全選查核
          </button>
          <button onClick={bulkDeleteAll} disabled={recordMonths.length === 0 || bulkBusy}
            className="px-3 py-1.5 rounded-lg border border-red-400 text-red-500 text-xs font-medium transition hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed">
            全選刪除
          </button>
        </div>
      </div>

      {scope3Factor == null && (
        <div className="mb-2 px-3 py-2 bg-amber-50 text-amber-800 text-xs border border-amber-200 rounded-lg">
          ⚠️ 本廠尚未指派 3-5-T2 的排放係數（kgCO₂e/tkm），資料可以先填，但 CO₂e 會留空不計入彙整表。
        </div>
      )}
      {err && <div className="mb-2 px-3 py-2 bg-red-50 text-red-700 text-xs border border-red-200 rounded-lg">{err}</div>}

      <div className="px-4 py-2 mb-3 bg-gray-50 border border-gray-200 rounded-lg flex flex-wrap items-end gap-2">
        <span className="text-xs text-gray-500 mb-1 w-full">
          若全年送同一個清運商、處理場所、車型也相同，這裡填一次套用到 12 個月即可，不用每個月都填；重量請逐月填實際清運量：
        </span>
        <div style={{ minWidth: 110 }}>
          <select className={input} value={bulk.waste_type}
            onChange={(e) => setBulk((b) => ({ ...b, waste_type: e.target.value }))}>
            <option value="">清運類別</option>
            {WASTE_TYPES_T2.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <input className={input} placeholder="清運商名稱"
            value={bulk.contractor_name}
            onChange={(e) => setBulk((b) => ({ ...b, contractor_name: e.target.value }))} />
        </div>
        <div style={{ minWidth: 150 }}>
          <input className={input} placeholder="處理場所名稱"
            value={bulk.destination_name}
            onChange={(e) => setBulk((b) => ({ ...b, destination_name: e.target.value }))} />
        </div>
        <div style={{ minWidth: 220 }}>
          <input className={input} placeholder="處理場所地址"
            value={bulk.destination_address}
            onChange={(e) => setBulk((b) => ({ ...b, destination_address: e.target.value }))} />
        </div>
        <div style={{ minWidth: 110 }}>
          <input className={`${input} text-right`} type="number" step="any" min="0" placeholder="單程距離 km"
            value={bulk.distance_km}
            onChange={(e) => setBulk((b) => ({ ...b, distance_km: e.target.value }))} />
        </div>
        <div style={{ minWidth: 90 }}>
          <input className={`${input} text-right`} type="number" step="1" min="1" placeholder="趟次"
            value={bulk.trip_count}
            onChange={(e) => setBulk((b) => ({ ...b, trip_count: e.target.value }))} />
        </div>
        <button onClick={applyToAll} disabled={applying}
          className="px-3 py-1 text-xs rounded text-white disabled:opacity-50" style={{ backgroundColor: HEADER_BG }}>
          {applying ? '套用中…' : '套用到全年'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: HEADER_BG }} className={`text-white text-xs sticky ${STICKY_THEAD_TOP} z-10`}>
              <th className={`${cell} w-8 text-center`}>
                <input type="checkbox" checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(recordMonths) : new Set())} />
              </th>
              <th className={cell}>月</th>
              <th className={cell} style={{ minWidth: 90 }}>類別</th>
              <th className={cell} style={{ minWidth: 120 }}>清運商</th>
              <th className={cell} style={{ minWidth: 140 }}>處理場所</th>
              <th className={cell} style={{ minWidth: 90 }}>重量</th>
              <th className={cell} style={{ minWidth: 60 }}>單位</th>
              <th className={cell} style={{ minWidth: 90 }}>單程距離 km</th>
              <th className={cell} style={{ minWidth: 60 }}>趟次</th>
              <th className={cell}>活動數據 tkm</th>
              <th className={cell}>tCO₂e</th>
              <th className={cell}>查核</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m) => {
              const r = recOf(m);
              const locked = r?.is_reviewed ?? false;
              const unit = readField(m, 'waste_weight_unit');
              return (
                <tr key={m} className={locked ? 'bg-gray-50' : ''}>
                  <td className={`${cell} text-center`}>
                    {r && (
                      <input type="checkbox" checked={selected.has(m)}
                        onChange={(e) => setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(m); else next.delete(m);
                          return next;
                        })} />
                    )}
                  </td>
                  <td className={`${cell} text-center`}>{m}</td>
                  <td className={cell}>
                    <select className={input} disabled={locked}
                      value={readField(m, 'waste_type')}
                      onChange={(e) => onEdit(m, 'waste_type', e.target.value)}>
                      <option value="">請選擇</option>
                      {WASTE_TYPES_T2.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <input className={input} disabled={locked}
                      value={readField(m, 'contractor_name')}
                      onChange={(e) => onEdit(m, 'contractor_name', e.target.value)} />
                  </td>
                  <td className={cell}>
                    <input className={input} disabled={locked} placeholder="名稱／地址"
                      value={readField(m, 'destination_name')}
                      onChange={(e) => onEdit(m, 'destination_name', e.target.value)} />
                    <input className={`${input} mt-1`} disabled={locked} placeholder="地址"
                      value={readField(m, 'destination_address')}
                      onChange={(e) => onEdit(m, 'destination_address', e.target.value)} />
                  </td>
                  <td className={cell}>
                    <input className={`${input} text-right`} type="number" step="any" min="0" disabled={locked}
                      value={readField(m, 'waste_weight')}
                      onChange={(e) => onEdit(m, 'waste_weight', e.target.value)} />
                    {unit === 'm3' && (
                      <input className={`${input} mt-1 text-right`} type="number" step="any" min="0" disabled={locked}
                        placeholder="密度 t/m³"
                        value={readField(m, 'density')}
                        onChange={(e) => onEdit(m, 'density', e.target.value)} />
                    )}
                  </td>
                  <td className={cell}>
                    <select className={input} disabled={locked}
                      value={unit}
                      onChange={(e) => onEdit(m, 'waste_weight_unit', e.target.value)}>
                      <option value="kg">kg</option>
                      <option value="mt">mt</option>
                      <option value="m3">m³</option>
                    </select>
                  </td>
                  <td className={cell}>
                    <input className={`${input} text-right`} type="number" step="any" min="0" disabled={locked}
                      value={readField(m, 'distance_km')}
                      onChange={(e) => onEdit(m, 'distance_km', e.target.value)} />
                  </td>
                  <td className={cell}>
                    <input className={`${input} text-right`} type="number" step="1" min="1" placeholder="1" disabled={locked}
                      value={readField(m, 'trip_count')}
                      onChange={(e) => onEdit(m, 'trip_count', e.target.value)} />
                  </td>
                  <td className={`${cell} text-right font-mono text-xs`}>
                    {r?.activity_value != null ? r.activity_value.toLocaleString() : '—'}
                  </td>
                  <td className={`${cell} text-right font-mono text-xs`}>
                    {r?.co2e_total != null ? r.co2e_total.toFixed(4) : '—'}
                  </td>
                  <td className={`${cell} text-center`}>
                    <button onClick={() => toggleReview(m)}
                      disabled={!r || reviewBusy === m}
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
              <td className={cell} colSpan={5}>年度合計</td>
              <td className={`${cell} text-right font-mono`}>{weightKgTotal > 0 ? weightKgTotal.toLocaleString() : '—'}</td>
              <td className={cell}>kg</td>
              <td className={cell} colSpan={2} />
              <td className={`${cell} text-right font-mono`}>{tkmTotal > 0 ? tkmTotal.toLocaleString() : '—'}</td>
              <td className={`${cell} text-right font-mono`}>{total > 0 ? total.toFixed(4) : '—'}</td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
        必要佐證：① 每月過磅紀錄／處理費單據　② 清運合約（須載明處理商地址與處理方式）
        ③ Google Map 距離截圖（工廠→處理廠，交通方式選 car，一律填單程）
      </div>
    </div>
  );
}

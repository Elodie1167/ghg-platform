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

const cell = 'border border-gray-200 px-2 py-1 text-sm';
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

  async function save(stream: 'general' | 'textile', m: number) {
    const distRaw = readField(stream, m, 'distance_km').trim();
    const dist = distRaw === '' ? null : Number(distRaw);
    if (dist != null && (!isFinite(dist) || dist <= 0)) {
      setErr(`${m} 月的距離需為大於 0 的數字`); setStatus('error'); return;
    }
    setStatus('saving'); setErr(null);
    try {
      const res = await fetch('/api/waste', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'transport', factory_id: factory.id, year, month: m, stream,
          destination_name: readField(stream, m, 'destination_name').trim() || null,
          destination_address: readField(stream, m, 'destination_address').trim() || null,
          distance_km: dist,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setStatus('saved');
      onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : '儲存失敗');
    }
  }

  return (
    <div className="mb-8 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 text-white flex items-center gap-3" style={{ backgroundColor: HEADER_BG }}>
        <span className="font-mono text-xs opacity-80">3-5-T1</span>
        <span className="font-semibold text-sm">廢棄物清運</span>
        <span className="text-xs opacity-80">tkm ＝ 廢棄物重量(mt) × 單程距離(km)</span>
        <span className="ml-auto text-xs">
          {status === 'saving' ? '儲存中…' : status === 'saved' ? '已儲存' : ''}
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
        return (
          <div key={st.key} className="border-b border-gray-200 last:border-b-0">
            <div className="px-4 py-2 bg-gray-100 text-sm font-semibold text-gray-700 flex items-center">
              {st.label}
              <span className="ml-2 text-xs font-normal text-gray-500">
                重量來源：{st.weightCode}
              </span>
              <span className="ml-auto text-xs font-normal">
                年度合計 {streamTotal > 0 ? streamTotal.toFixed(4) : '—'} tCO₂e
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className={cell}>月</th>
                    <th className={cell}>重量 kg（自動）</th>
                    <th className={cell} style={{ minWidth: 150 }}>處理場所名稱</th>
                    <th className={cell} style={{ minWidth: 220 }}>處理場所地址</th>
                    <th className={cell} style={{ minWidth: 110 }}>單程距離 km</th>
                    <th className={cell}>活動數據 tkm</th>
                    <th className={cell}>tCO₂e</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((m) => {
                    const r = recOf(st.key, m);
                    const kg = weightKgOf(st.weightCode, m);
                    const locked = r?.is_reviewed ?? false;
                    return (
                      <tr key={m} className={locked ? 'bg-gray-50' : ''}>
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
                      </tr>
                    );
                  })}
                </tbody>
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

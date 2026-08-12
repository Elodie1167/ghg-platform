'use client';

/**
 * 3-5-G 廢水處理，兩種填報方式（切換在「基本資訊」分頁）：
 *
 *   外購水量推估 ESTIMATED —— 全自動：廢水量 = 同月 3-1-E 採購水資源 × 廢水產生係數（預設 80%）。
 *                              使用者不填任何數字，改採購水這裡就跟著變。
 *   廠內實測 MEASURED    —— 逐月填 m³，也可用 Excel 範本一次匯入。
 */

import { useRef, useState } from 'react';
import type { Factory } from './page';
import { MONTHS, HEADER_BG, BTN_BG } from './tabTypes';
import { WASTEWATER_TYPES, TREATMENT_MODES } from '@/lib/waste-detail';
import type { WasteApiRecord, SourceValue, WasteApiSettings } from './WasteApiTypes';

const cell = 'border border-gray-200 px-2 py-1 text-sm';
const input = 'w-full px-1 py-0.5 text-sm border border-gray-200 rounded focus:border-green-600 outline-none';

export default function WastewaterGrid({
  factory, year, records, sourceValues, settings, scope3Factor, onChanged,
}: {
  factory: Factory;
  year: number;
  records: WasteApiRecord[];
  sourceValues: SourceValue[];
  settings: WasteApiSettings;
  scope3Factor: number | null;
  onChanged: () => void;
}) {
  const isMeasured = settings.wastewater_input_mode === 'MEASURED';
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [meta, setMeta] = useState({
    wastewater_type: records.find((r) => r.wastewater_type)?.wastewater_type ?? '',
    treatment_mode: records.find((r) => r.treatment_mode)?.treatment_mode ?? '',
    treatment_facility: records.find((r) => r.treatment_facility)?.treatment_facility ?? '',
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<number | null>(null);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const recOf = (m: number) => records.find((r) => r.source_code === '3-5-G' && r.month === m);
  const waterOf = (m: number) => sourceValues.find((s) => s.source_code === '3-1-E' && s.month === m)?.value ?? null;
  const total = MONTHS.reduce((s, m) => s + (recOf(m)?.co2e_total ?? 0), 0);

  function readVol(m: number) {
    if (m in draft) return draft[m];
    const v = recOf(m)?.measured_volume_m3 ?? recOf(m)?.activity_value;
    return v == null ? '' : String(v);
  }

  function onEdit(m: number, v: string) {
    setDraft((d) => ({ ...d, [m]: v }));
    clearTimeout(timers.current[m]);
    timers.current[m] = setTimeout(() => saveMonth(m), 800);
  }

  async function saveMonth(m: number) {
    const raw = readVol(m).trim();
    const vol = raw === '' ? null : Number(raw);
    if (vol != null && (!isFinite(vol) || vol < 0)) {
      setErr(`${m} 月的廢水量需為非負數字`); setStatus('error'); return;
    }
    setStatus('saving'); setErr(null);
    try {
      const res = await fetch('/api/waste', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'wastewater_measured', factory_id: factory.id, year, month: m,
          volume_m3: vol,
          wastewater_type: meta.wastewater_type || null,
          treatment_mode: meta.treatment_mode || null,
          treatment_facility: meta.treatment_facility || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setStatus('saved'); onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error'); setErr(e instanceof Error ? e.message : '儲存失敗');
    }
  }

  async function recompute() {
    setStatus('saving'); setErr(null);
    try {
      const res = await fetch('/api/waste', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'recompute', factory_id: factory.id, year, target: 'wastewater' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? '重算失敗');
      setStatus('saved'); onChanged();
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e) {
      setStatus('error'); setErr(e instanceof Error ? e.message : '重算失敗');
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

  async function onImport(file: File) {
    setImporting(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('factory_id', factory.id);
      fd.append('year', String(year));
      const res = await fetch('/api/waste/import', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setDraft({});
      onChanged();
      alert(`匯入完成：${j.data.imported} 個月`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '匯入失敗');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="mb-8 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 text-white flex items-center gap-3" style={{ backgroundColor: HEADER_BG }}>
        <span className="font-mono text-xs opacity-80">3-5-G</span>
        <span className="font-semibold text-sm">廢水處理</span>
        <span className="text-xs opacity-80">活動數據單位：m³</span>
        <span className="ml-auto text-xs">
          年度合計 {total > 0 ? total.toFixed(4) : '—'} tCO₂e
          {status === 'saving' && '　儲存中…'}
          {status === 'saved' && '　已儲存'}
        </span>
      </div>

      <div className="px-4 py-2 bg-blue-50 text-blue-900 text-xs border-b border-blue-200 flex items-center gap-2 flex-wrap">
        <span>
          本廠採用：<strong>{isMeasured ? '廠內實測（有廢水流量計）' : `外購水量推估 × ${(settings.discharge_ratio * 100).toFixed(0)}%`}</strong>
          {!isMeasured && <span>　係數依據：{settings.ratio_basis}</span>}
        </span>
        <span className="text-blue-700">
          切換方式請至「基本資訊」分頁{settings.is_default && '｜本廠尚未設定，目前套用集團預設'}
        </span>
        {!isMeasured && (
          <button onClick={recompute} className="ml-auto px-2 py-0.5 rounded border border-blue-300 text-blue-800">
            依採購水重新計算
          </button>
        )}
      </div>

      {scope3Factor == null && (
        <div className="px-4 py-2 bg-amber-50 text-amber-800 text-xs border-b border-amber-200">
          ⚠️ 本廠尚未指派 3-5-G 的排放係數（kgCO₂e/m³），廢水量可以先進來，但 CO₂e 會留空不計入彙整表。
        </div>
      )}
      {err && <div className="px-4 py-2 bg-red-50 text-red-700 text-xs border-b border-red-200">{err}</div>}

      {/* 共用欄位：一年填一次，寫進當年度每一筆記錄 */}
      <div className="p-4 bg-gray-50 border-b border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">廢水類別</label>
          <select className={input} value={meta.wastewater_type}
            onChange={(e) => setMeta({ ...meta, wastewater_type: e.target.value })}>
            <option value="">請選擇</option>
            {WASTEWATER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">處理方式</label>
          <select className={input} value={meta.treatment_mode}
            onChange={(e) => setMeta({ ...meta, treatment_mode: e.target.value })}>
            <option value="">請選擇</option>
            {TREATMENT_MODES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">處理單位名稱</label>
          <input className={input} placeholder="例：內湖污水處理廠"
            value={meta.treatment_facility}
            onChange={(e) => setMeta({ ...meta, treatment_facility: e.target.value })} />
        </div>
        {meta.treatment_mode === '廠內自設污水處理設施' && (
          <div className="md:col-span-3 px-3 py-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200">
            ⚠️ 廠內自設污水處理設施若有沼氣（CH₄）逸散，屬<strong>範疇一逸散排放</strong>，
            不可填在這裡，請另於逸散分頁填報。
          </div>
        )}
      </div>

      {isMeasured && (
        <div className="px-4 py-2 bg-white border-b border-gray-200 flex items-center gap-3 text-xs">
          <a href={`/api/waste/import?year=${year}&factory_id=${factory.id}`}
            className="px-3 py-1 rounded border border-gray-300 text-gray-700">
            下載 Excel 範本
          </a>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="px-3 py-1 rounded text-white disabled:opacity-50" style={{ backgroundColor: BTN_BG }}>
            {importing ? '匯入中…' : '匯入填好的 Excel'}
          </button>
          <span className="text-gray-500">匯入會覆蓋範本中有填數字的月份，空白月份不動。</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className={cell}>月</th>
              {isMeasured ? (
                <th className={cell} style={{ minWidth: 140 }}>廢水量 m³（實測）</th>
              ) : (
                <>
                  <th className={cell}>採購水 m³（3-1-E）</th>
                  <th className={cell}>× 廢水產生係數</th>
                </>
              )}
              <th className={cell}>活動數據 m³</th>
              <th className={cell}>tCO₂e</th>
              <th className={cell}>查核</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m) => {
              const r = recOf(m);
              const locked = r?.is_reviewed ?? false;
              return (
                <tr key={m} className={locked ? 'bg-gray-50' : ''}>
                  <td className={`${cell} text-center`}>{m}</td>
                  {isMeasured ? (
                    <td className={cell}>
                      <input className={`${input} text-right`} type="number" step="any" min="0" disabled={locked}
                        value={readVol(m)} onChange={(e) => onEdit(m, e.target.value)} />
                    </td>
                  ) : (
                    <>
                      <td className={`${cell} text-right font-mono text-xs`}>
                        {waterOf(m) != null ? waterOf(m)!.toLocaleString() : <span className="text-gray-300">未填</span>}
                      </td>
                      <td className={`${cell} text-right font-mono text-xs`}>
                        {(settings.discharge_ratio * 100).toFixed(0)}%
                      </td>
                    </>
                  )}
                  <td className={`${cell} text-right font-mono text-xs`}>
                    {r?.activity_value != null ? r.activity_value.toLocaleString() : '—'}
                  </td>
                  <td className={`${cell} text-right font-mono text-xs`}>
                    {r?.co2e_total != null ? r.co2e_total.toFixed(4) : '—'}
                  </td>
                  <td className={`${cell} text-center`}>
                    <button onClick={() => toggleReview(m)} disabled={!r || reviewBusy === m}
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
        </table>
      </div>

      <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
        必要佐證：{isMeasured
          ? '流量計月報表　或　污水處理費單據（須裁切至該填報期間）'
          : '自來水／地下水費單（須裁切至該填報期間），即 3-1-E 採購水資源的佐證'}
      </div>
    </div>
  );
}

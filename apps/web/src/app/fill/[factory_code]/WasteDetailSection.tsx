'use client';

/**
 * 3-5 廢棄物清運（3-5-T1）／廢水/水肥清運（3-5-T2）／廢水處理（3-5-G）填報。
 *
 * 與同分頁的 3-5-W1/W2 不同：這三個源一個月可有多筆（多個清運商、多個處理場所），
 * 且每筆都有查證要看的明細（清運商、處理場所地址、距離、車型…），
 * 所以做成「一列一筆記錄」的表格，而不是 W1/W2 那種一格一個月的數值格。
 *
 * 活動數據（tkm / m³）為唯讀，由 lib/waste-detail.ts 的 deriveActivityValue 推導，
 * 前端只做預覽，實際值以伺服器重算為準（同一支函式，不會走鐘）。
 */

import { useState } from 'react';
import type { EmissionSource, ActivityRecord, Factory, FactorySettings } from './page';
import {
  type WasteDetail, deriveActivityValue, validateWasteDetail, isWasteTransport,
  WASTE_TYPES_T1, WASTE_TYPES_T2, VEHICLE_TYPES_T1, VEHICLE_TYPES_T2,
  WASTEWATER_TYPES, TREATMENT_MODES,
} from '@/lib/waste-detail';
import { MONTHS, HEADER_BG, BTN_BG } from './tabTypes';

interface Props {
  factory: Factory;
  year: number;
  source: EmissionSource;
  records: ActivityRecord[];
  factorySettings: FactorySettings;
  scope3Factor: number | null;
  onChanged: () => void;
}

type Draft = WasteDetail & { month: number };

function emptyDraft(source: EmissionSource, s: FactorySettings): Draft {
  if (isWasteTransport(source.source_code)) {
    return { month: 1, waste_weight_unit: 'kg', trip_count: 1 };
  }
  return {
    month: 1,
    input_mode: s.wastewater_input_mode,
    discharge_ratio: s.wastewater_input_mode === 'ESTIMATED' ? s.discharge_ratio : null,
    ratio_basis: s.wastewater_input_mode === 'ESTIMATED' ? s.ratio_basis : null,
  };
}

const inputCls = 'w-full border border-gray-300 rounded px-2 py-1 text-sm';
const labelCls = 'block text-xs text-gray-600 mb-0.5';

export default function WasteDetailSection({
  factory, year, source, records, factorySettings, scope3Factor, onChanged,
}: Props) {
  const isTransport = isWasteTransport(source.source_code);
  const isT2 = source.source_code === '3-5-T2';
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(source, factorySettings));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

  const derived = deriveActivityValue(source.source_code, draft);
  const previewCo2e = derived && scope3Factor != null
    ? (derived.value * scope3Factor) / 1000
    : null;

  function loadForEdit(r: ActivityRecord) {
    setEditingId(r.id);
    setDraft({ month: r.month, ...(r.waste_detail ?? {}) });
    setErr(null);
  }

  function reset() {
    setEditingId(null);
    setDraft(emptyDraft(source, factorySettings));
    setErr(null);
  }

  async function save() {
    const errs = validateWasteDetail(source.source_code, draft);
    if (errs.length) { setErr(errs.join('；')); return; }
    const { month, ...detail } = draft;

    setBusy(true); setErr(null);
    try {
      const res = editingId
        ? await fetch(`/api/records/${editingId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month, waste_detail: detail }),
          })
        : await fetch('/api/records', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              factory_id: factory.id, emission_source_id: source.id, year, month,
              // activity_value / activity_unit 由伺服器依明細推導，這裡送的值會被覆蓋，
              // 但 schema 需要 activity_unit，故帶預設單位
              activity_unit: source.default_unit,
              waste_detail: detail,
            }),
          });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      reset();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: ActivityRecord) {
    if (r.is_reviewed) { alert('已查核的記錄無法刪除，請先取消查核。'); return; }
    if (!confirm(`確定刪除 ${r.month} 月這筆記錄？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? '刪除失敗');
      if (editingId === r.id) reset();
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗');
    } finally { setBusy(false); }
  }

  const sorted = [...records].sort((a, b) => a.month - b.month);
  const totalCo2e = sorted.reduce((s, r) => s + (r.co2e_total ?? 0), 0);

  return (
    <div className="mb-8 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 text-white flex items-center gap-3" style={{ backgroundColor: HEADER_BG }}>
        <span className="font-mono text-xs opacity-80">{source.source_code}</span>
        <span className="font-semibold text-sm">{source.name_zh}</span>
        <span className="text-xs opacity-80">
          活動數據單位：{isTransport ? 'tkm（延噸公里）' : 'm³'}
        </span>
        <span className="ml-auto text-xs">
          年度合計 {totalCo2e > 0 ? totalCo2e.toFixed(4) : '—'} tCO₂e
        </span>
      </div>

      {scope3Factor == null && (
        <div className="px-4 py-2 bg-amber-50 text-amber-800 text-xs border-b border-amber-200">
          ⚠️ 本廠尚未維護 {source.source_code} 的排放係數（{isTransport ? 'kgCO₂e/tkm' : 'kgCO₂e/m³'}），
          資料可以先填，但 CO₂e 會留空不計入彙整表。請永續發展部至「排放係數維護」補上後重算。
        </div>
      )}

      {!isTransport && (
        <div className="px-4 py-2 bg-blue-50 text-blue-900 text-xs border-b border-blue-200">
          本廠採用：
          <strong className="mx-1">
            {factorySettings.wastewater_input_mode === 'MEASURED'
              ? '廠內實測（有廢水流量計）'
              : `外購水量推估 × ${(factorySettings.discharge_ratio * 100).toFixed(0)}%`}
          </strong>
          {factorySettings.wastewater_input_mode === 'ESTIMATED' && (
            <span>（係數依據：{factorySettings.ratio_basis}）</span>
          )}
          <span className="ml-2 text-blue-700">
            此設定由 admin 於「工廠基本資訊設定」維護，填報端不可切換
            {factorySettings.is_default && '｜本廠尚未設定，目前套用集團預設值'}
          </span>
        </div>
      )}

      {/* ── 填報表單 ── */}
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="text-xs font-semibold text-gray-700 mb-2">
          {editingId ? '編輯記錄' : '新增一筆'}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>月份 *</label>
            <select className={inputCls} value={draft.month}
              onChange={(e) => set('month', Number(e.target.value))}>
              {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
            </select>
          </div>

          {isTransport ? (
            <>
              <div>
                <label className={labelCls}>{isT2 ? '清運類別' : '廢棄物類別'} *</label>
                <select className={inputCls} value={draft.waste_type ?? ''}
                  onChange={(e) => set('waste_type', e.target.value || null)}>
                  <option value="">請選擇</option>
                  {(isT2 ? WASTE_TYPES_T2 : WASTE_TYPES_T1).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {draft.waste_type === '其他' && (
                <div>
                  <label className={labelCls}>其他類別說明 *</label>
                  <input className={inputCls} value={draft.waste_type_other ?? ''}
                    onChange={(e) => set('waste_type_other', e.target.value || null)} />
                </div>
              )}
              <div>
                <label className={labelCls}>清運商名稱 *</label>
                <input className={inputCls} value={draft.contractor_name ?? ''}
                  onChange={(e) => set('contractor_name', e.target.value || null)} />
              </div>
              <div>
                <label className={labelCls}>處理場所名稱 *</label>
                <input className={inputCls} placeholder="焚化廠／掩埋場／回收商"
                  value={draft.destination_name ?? ''}
                  onChange={(e) => set('destination_name', e.target.value || null)} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>處理場所地址 *（供 Google Map 量距離）</label>
                <input className={inputCls} value={draft.destination_address ?? ''}
                  onChange={(e) => set('destination_address', e.target.value || null)} />
              </div>
              <div>
                <label className={labelCls}>清運重量 *</label>
                <input className={inputCls} type="number" step="any" min="0"
                  value={draft.waste_weight ?? ''}
                  onChange={(e) => set('waste_weight', num(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>重量單位 *</label>
                <select className={inputCls} value={draft.waste_weight_unit ?? ''}
                  onChange={(e) => set('waste_weight_unit', (e.target.value || null) as Draft['waste_weight_unit'])}>
                  <option value="kg">kg</option>
                  <option value="mt">mt（公噸）</option>
                  {isT2 && <option value="m3">m³（需填密度）</option>}
                </select>
              </div>
              {draft.waste_weight_unit === 'm3' && (
                <div>
                  <label className={labelCls}>密度 t/m³ *</label>
                  <input className={inputCls} type="number" step="any" min="0" placeholder="1.0"
                    value={draft.density ?? ''}
                    onChange={(e) => set('density', num(e.target.value))} />
                </div>
              )}
              <div>
                <label className={labelCls}>單程運輸距離 km *</label>
                <input className={inputCls} type="number" step="any" min="0"
                  value={draft.distance_km ?? ''}
                  onChange={(e) => set('distance_km', num(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>清運趟次</label>
                <input className={inputCls} type="number" step="1" min="1" placeholder="1"
                  value={draft.trip_count ?? ''}
                  onChange={(e) => set('trip_count', num(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>運輸車型 *</label>
                <select className={inputCls} value={draft.vehicle_type ?? ''}
                  onChange={(e) => set('vehicle_type', e.target.value || null)}>
                  <option value="">請選擇</option>
                  {(isT2 ? VEHICLE_TYPES_T2 : VEHICLE_TYPES_T1).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls}>廢水類別 *</label>
                <select className={inputCls} value={draft.wastewater_type ?? ''}
                  onChange={(e) => set('wastewater_type', e.target.value || null)}>
                  <option value="">請選擇</option>
                  {WASTEWATER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>處理方式 *</label>
                <select className={inputCls} value={draft.treatment_mode ?? ''}
                  onChange={(e) => set('treatment_mode', e.target.value || null)}>
                  <option value="">請選擇</option>
                  {TREATMENT_MODES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>處理單位名稱 *</label>
                <input className={inputCls} placeholder="例：內湖污水處理廠"
                  value={draft.treatment_facility ?? ''}
                  onChange={(e) => set('treatment_facility', e.target.value || null)} />
              </div>
              {draft.input_mode === 'MEASURED' ? (
                <div>
                  <label className={labelCls}>廢水量（實測）m³ *</label>
                  <input className={inputCls} type="number" step="any" min="0"
                    value={draft.measured_volume_m3 ?? ''}
                    onChange={(e) => set('measured_volume_m3', num(e.target.value))} />
                </div>
              ) : (
                <div>
                  <label className={labelCls}>外購水量 m³ *</label>
                  <input className={inputCls} type="number" step="any" min="0"
                    placeholder="自來水／地下水當月用水量"
                    value={draft.water_intake_m3 ?? ''}
                    onChange={(e) => set('water_intake_m3', num(e.target.value))} />
                </div>
              )}
            </>
          )}
        </div>

        {draft.treatment_mode === '廠內自設污水處理設施' && (
          <div className="mt-3 px-3 py-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200">
            ⚠️ 廠內自設污水處理設施若有沼氣（CH₄）逸散，屬<strong>範疇一逸散排放</strong>，
            不可填在這裡，請另於逸散分頁填報。
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <div className="text-sm">
            <span className="text-gray-500 mr-1">活動數據（唯讀）：</span>
            <span className="font-mono font-semibold">
              {derived ? `${derived.value} ${derived.unit === 'tonne-km' ? 'tkm' : 'm³'}` : '—'}
            </span>
            {isTransport && (
              <span className="text-xs text-gray-400 ml-2">＝ 重量(mt) × 單程距離(km) × 趟次</span>
            )}
            {!isTransport && draft.input_mode === 'ESTIMATED' && (
              <span className="text-xs text-gray-400 ml-2">
                ＝ 外購水量 × {((draft.discharge_ratio ?? 0) * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="text-sm">
            <span className="text-gray-500 mr-1">預估 CO₂e：</span>
            <span className="font-mono font-semibold">
              {previewCo2e != null ? `${previewCo2e.toFixed(4)} tCO₂e` : '—'}
            </span>
          </div>
          <div className="ml-auto flex gap-2">
            {editingId && (
              <button onClick={reset} disabled={busy}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600">
                取消
              </button>
            )}
            <button onClick={save} disabled={busy}
              className="px-4 py-1.5 text-sm rounded text-white disabled:opacity-50"
              style={{ backgroundColor: BTN_BG }}>
              {busy ? '儲存中…' : editingId ? '更新' : '新增'}
            </button>
          </div>
        </div>

        {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      </div>

      {/* ── 已填報記錄 ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              <th className="px-2 py-1.5 text-left">月</th>
              {isTransport ? (
                <>
                  <th className="px-2 py-1.5 text-left">類別</th>
                  <th className="px-2 py-1.5 text-left">清運商</th>
                  <th className="px-2 py-1.5 text-left">處理場所</th>
                  <th className="px-2 py-1.5 text-right">重量</th>
                  <th className="px-2 py-1.5 text-right">距離 km</th>
                  <th className="px-2 py-1.5 text-right">趟次</th>
                  <th className="px-2 py-1.5 text-left">車型</th>
                </>
              ) : (
                <>
                  <th className="px-2 py-1.5 text-left">廢水類別</th>
                  <th className="px-2 py-1.5 text-left">處理方式</th>
                  <th className="px-2 py-1.5 text-left">處理單位</th>
                  <th className="px-2 py-1.5 text-left">填報方式</th>
                  <th className="px-2 py-1.5 text-right">來源數值 m³</th>
                  <th className="px-2 py-1.5 text-right">係數</th>
                </>
              )}
              <th className="px-2 py-1.5 text-right">活動數據</th>
              <th className="px-2 py-1.5 text-right">tCO₂e</th>
              <th className="px-2 py-1.5 text-center">查核</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-gray-400">尚無填報記錄</td></tr>
            )}
            {sorted.map((r) => {
              const d = r.waste_detail ?? {};
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-2 py-1.5">{r.month}</td>
                  {isTransport ? (
                    <>
                      <td className="px-2 py-1.5">{d.waste_type === '其他' ? d.waste_type_other : d.waste_type}</td>
                      <td className="px-2 py-1.5">{d.contractor_name}</td>
                      <td className="px-2 py-1.5" title={d.destination_address ?? ''}>{d.destination_name}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {d.waste_weight} {d.waste_weight_unit === 'm3' ? 'm³' : d.waste_weight_unit}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{d.distance_km}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{d.trip_count ?? 1}</td>
                      <td className="px-2 py-1.5">{d.vehicle_type}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5">{d.wastewater_type}</td>
                      <td className="px-2 py-1.5">{d.treatment_mode}</td>
                      <td className="px-2 py-1.5">{d.treatment_facility}</td>
                      <td className="px-2 py-1.5">{d.input_mode === 'MEASURED' ? '廠內實測' : '外購水量推估'}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {d.input_mode === 'MEASURED' ? d.measured_volume_m3 : d.water_intake_m3}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {d.discharge_ratio != null ? `${(d.discharge_ratio * 100).toFixed(0)}%` : '—'}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-right font-mono">{r.activity_value ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {r.co2e_total != null ? r.co2e_total.toFixed(4) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-center">{r.is_reviewed ? '✓' : ''}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => loadForEdit(r)} disabled={r.is_reviewed}
                      className="text-green-700 hover:underline disabled:text-gray-300 mr-2">編輯</button>
                    <button onClick={() => remove(r)} disabled={r.is_reviewed}
                      className="text-red-600 hover:underline disabled:text-gray-300">刪除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
        必要佐證：{isTransport
          ? '① 每月過磅紀錄　② 清運合約（載明處理商地址與處理方式）　③ Google Map 距離截圖（交通方式選 car）'
          : (factorySettings.wastewater_input_mode === 'MEASURED'
              ? '流量計月報表　或　污水處理費單據（須裁切至該填報期間）'
              : '自來水／地下水費單（須裁切至該填報期間）')}
        {isTransport && <>｜距離一律以<strong>單程</strong>認定</>}
      </div>
    </div>
  );
}

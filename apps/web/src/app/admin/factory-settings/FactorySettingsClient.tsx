'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_DISCHARGE_RATIO } from '@/lib/waste-detail';

export interface SettingRow {
  factory_id: string;
  factory_code: string;
  name_zh: string;
  country_code: string;
  wastewater_input_mode: 'MEASURED' | 'ESTIMATED';
  has_flow_meter: boolean;
  discharge_ratio: number;
  ratio_basis: string;
  ratio_override_reason: string | null;
  effective_year: number | null;
  is_default: boolean;
  wastewater_record_count: number;
}

const HEADER_BG = '#0C3D2E';

export default function FactorySettingsClient({
  year, rows, canEdit,
}: { year: number; rows: SettingRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const unset = rows.filter((r) => r.is_default).length;

  async function save() {
    if (!editing) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/admin/factory-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: editing.factory_id,
          effective_year: year,
          wastewater_input_mode: editing.wastewater_input_mode,
          has_flow_meter: editing.has_flow_meter,
          discharge_ratio: editing.discharge_ratio,
          ratio_basis: editing.ratio_basis,
          ratio_override_reason: editing.ratio_override_reason,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setMsg(j.notice ?? '已儲存');
      setEditing(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '儲存失敗');
    } finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <h1 className="text-xl font-semibold text-gray-800">工廠基本資訊設定　{year} 年度</h1>
      <p className="text-sm text-gray-500 mt-1">
        廢水量統計方式決定 3-5-G 廢水處理怎麼填。填報時由此帶入並鎖定，工廠端不可自行切換
        —— 這就是規格文件「同年度不可混用兩種方式」的實作方式。
      </p>
      <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        ⚠️ 集團預設廢水產生係數 100%，即外購水量推估法直接視外購水量為廢水量，不再打折。
        個別廠若有實際比例依據，可在下方「設定」覆寫並填理由。
      </p>

      {unset > 0 && (
        <p className="text-sm text-gray-600 mt-3">
          尚有 <strong>{unset}</strong> 廠未設定（顯示為集團預設值：外購水量推估，直接等同外購水量）。
        </p>
      )}
      {msg && <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</p>}

      <table className="w-full mt-4 text-sm border border-gray-200 rounded overflow-hidden">
        <thead className="text-white" style={{ backgroundColor: HEADER_BG }}>
          <tr>
            <th className="px-3 py-2 text-left">廠別</th>
            <th className="px-3 py-2 text-left">廢水量統計方式</th>
            <th className="px-3 py-2 text-right">廢水產生係數</th>
            <th className="px-3 py-2 text-left">係數依據</th>
            <th className="px-3 py-2 text-center">本年度已填</th>
            <th className="px-3 py-2 text-center">狀態</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.factory_id} className="border-t border-gray-100">
              <td className="px-3 py-2">
                <span className="font-mono text-xs text-gray-500 mr-2">{r.factory_code}</span>
                {r.name_zh}
              </td>
              <td className="px-3 py-2">
                {r.wastewater_input_mode === 'MEASURED' ? '廠內實測（有廢水流量計）' : '外購水量推估'}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.wastewater_input_mode === 'ESTIMATED' ? `${(r.discharge_ratio * 100).toFixed(0)}%` : '—'}
              </td>
              <td className="px-3 py-2 text-xs text-gray-600">
                {r.wastewater_input_mode === 'ESTIMATED' ? r.ratio_basis : '—'}
                {r.ratio_override_reason && (
                  <div className="text-amber-700 mt-0.5">覆寫理由：{r.ratio_override_reason}</div>
                )}
              </td>
              <td className="px-3 py-2 text-center font-mono">{r.wastewater_record_count || '—'}</td>
              <td className="px-3 py-2 text-center text-xs">
                {r.is_default
                  ? <span className="text-gray-400">未設定</span>
                  : <span className="text-green-700">{r.effective_year} 起生效</span>}
              </td>
              <td className="px-3 py-2 text-right">
                {canEdit && (
                  <button onClick={() => { setEditing({ ...r }); setMsg(null); setErr(null); }}
                    className="text-green-700 hover:underline text-xs">設定</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 w-full max-w-md">
            <h2 className="font-semibold text-gray-800">
              {editing.factory_code} {editing.name_zh}　{year} 年度
            </h2>

            <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={editing.wastewater_input_mode === 'MEASURED'}
                  onChange={() => setEditing({ ...editing, wastewater_input_mode: 'MEASURED', has_flow_meter: true })} />
                廠內實測（有廢水流量計）
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={editing.wastewater_input_mode === 'ESTIMATED'}
                  onChange={() => setEditing({ ...editing, wastewater_input_mode: 'ESTIMATED' })} />
                外購水量推估
              </label>
            </div>

            {editing.wastewater_input_mode === 'ESTIMATED' && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">廢水產生係數（0–1，預設 1.00 即等同外購水量）</label>
                  <input type="number" step="0.01" min="0.01" max="1"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    value={editing.discharge_ratio}
                    onChange={(e) => setEditing({ ...editing, discharge_ratio: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-0.5">係數引用依據</label>
                  <input className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    value={editing.ratio_basis}
                    onChange={(e) => setEditing({ ...editing, ratio_basis: e.target.value })} />
                </div>
                {editing.discharge_ratio !== DEFAULT_DISCHARGE_RATIO && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">覆寫理由 *（不等於預設 100% 時必填）</label>
                    <input className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      value={editing.ratio_override_reason ?? ''}
                      onChange={(e) => setEditing({ ...editing, ratio_override_reason: e.target.value })} />
                  </div>
                )}
              </div>
            )}

            {editing.wastewater_record_count > 0 && (
              <p className="mt-4 text-xs text-amber-700">
                本年度已有 {editing.wastewater_record_count} 筆廢水處理記錄。變更設定<strong>不會</strong>回頭
                改動既有記錄（已填報的是快照），若方式改變需請該廠重新填報或確認。
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600">取消</button>
              <button onClick={save} disabled={busy}
                className="px-4 py-1.5 text-sm rounded text-white disabled:opacity-50"
                style={{ backgroundColor: HEADER_BG }}>
                {busy ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

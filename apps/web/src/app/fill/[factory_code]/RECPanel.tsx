'use client';

import { useState, useEffect, useRef } from 'react';

const GEN_TYPES = ['太陽能', '風能', '水力', '生質能', '地熱', '海洋能', '其他'];

interface RecRow {
  tempKey: string;
  id: string | null;
  month: number;
  rec_mwh: string;  // MWh for display; ×1000 when saving to DB as rec_kwh
  generation_type: string;
  certificate_no: string;
  notes: string;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}

interface Props {
  factoryId: string;
  year: number;
  /** total electricity consumed (kWh) from bill rows — 市電＋太陽能合計 */
  totalElecKwh: number;
  /** grid emission factor (tCO₂e / MWh) — 地域別用 */
  gridFactor: number | null;
  /** 市場別用係數：中國為市場剩餘係數，其餘國別退回電網係數（未傳則退回 gridFactor） */
  marketFactor?: number | null;
}

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];

export default function RECPanel({ factoryId, year, totalElecKwh, gridFactor, marketFactor }: Props) {
  const mktFactor = marketFactor ?? gridFactor;
  const [rows, setRows] = useState<RecRow[]>([]);
  const [loading, setLoading] = useState(true);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(`/api/rec-certificates?factory_id=${factoryId}&year=${year}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setRows(
          (data ?? []).map((r: {
            id: string; month: number; rec_kwh: number;
            generation_type: string | null; certificate_no: string | null; notes: string | null;
          }) => ({
            tempKey: r.id,
            id: r.id,
            month: r.month,
            rec_mwh: String(r.rec_kwh / 1000),
            generation_type: r.generation_type ?? '',
            certificate_no: r.certificate_no ?? '',
            notes: r.notes ?? '',
            saveStatus: 'idle' as const,
          })),
        );
      })
      .finally(() => setLoading(false));
  }, [factoryId, year]);

  function addRow() {
    const tempKey = `new-${Date.now()}`;
    setRows((prev) => [...prev, {
      tempKey, id: null,
      month: new Date().getMonth() + 1,
      rec_mwh: '', generation_type: '太陽能',
      certificate_no: '', notes: '',
      saveStatus: 'idle',
    }]);
  }

  function updateRow(tempKey: string, field: keyof RecRow, value: string | number) {
    setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, [field]: value } : r));
    if (timers.current[tempKey]) clearTimeout(timers.current[tempKey]);
    timers.current[tempKey] = setTimeout(() => saveRow(tempKey), 1000);
  }

  async function saveRow(tempKey: string) {
    const row = rowsRef.current.find((r) => r.tempKey === tempKey);
    if (!row) return;
    const mwh = parseFloat(row.rec_mwh);
    if (isNaN(mwh) || mwh <= 0) return;

    setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saving' } : r));

    const payload = {
      factory_id: factoryId,
      year,
      month: row.month,
      rec_kwh: mwh * 1000,
      generation_type: row.generation_type || null,
      certificate_no: row.certificate_no || null,
      notes: row.notes || null,
    };

    try {
      let savedId = row.id;
      if (row.id) {
        const res = await fetch(`/api/rec-certificates/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const res = await fetch('/api/rec-certificates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        savedId = data.data.id;
        setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, id: savedId } : r));
      }
      setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saved' } : r));
      setTimeout(() => setRows((prev) => prev.map((r) =>
        r.tempKey === tempKey && r.saveStatus === 'saved' ? { ...r, saveStatus: 'idle' } : r
      )), 2000);
    } catch {
      setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'error' } : r));
    }
  }

  async function deleteRow(tempKey: string) {
    const row = rowsRef.current.find((r) => r.tempKey === tempKey);
    if (!row) return;
    if (row.id) {
      const res = await fetch(`/api/rec-certificates/${row.id}`, { method: 'DELETE' });
      if (!res.ok) return;
    }
    setRows((prev) => prev.filter((r) => r.tempKey !== tempKey));
  }

  // ── calculations ──
  const totalRecMwh = rows.reduce((s, r) => s + (parseFloat(r.rec_mwh) || 0), 0);
  const totalRecKwh = totalRecMwh * 1000;

  // 係數單位為 tCO₂e/MWh，活動數據為 kWh → 先 ÷1000 轉 MWh 再乘係數
  // 地域別一律用電網係數；市場別＝max(0,合計電量−iREC)÷1000×市場係數（中國為剩餘係數）
  const s2Loc  = gridFactor != null ? totalElecKwh / 1000 * gridFactor : null;
  const s2Mkt  = mktFactor != null
    ? Math.max(0, (totalElecKwh - totalRecKwh) / 1000 * mktFactor)
    : null;
  const deducted = s2Loc != null && s2Mkt != null ? s2Loc - s2Mkt : null;

  if (loading) {
    return <div className="mt-6 text-sm text-gray-400 text-center py-4">載入 iREC 資料…</div>;
  }

  return (
    <div className="mt-8 border border-blue-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-b border-blue-200">
        <div>
          <h3 className="font-semibold text-blue-900 text-sm">
            iREC 可再生能源憑證 — {year} 年
          </h3>
          <p className="text-xs text-blue-500 mt-0.5">
            購入 iREC 可抵扣 S2 市場排放量
          </p>
        </div>
        <button
          onClick={addRow}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium bg-blue-700 hover:bg-blue-600 transition"
        >
          + 新增憑證
        </button>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm bg-white">
          <p className="mb-3">尚無 iREC 購入記錄</p>
          <button
            onClick={addRow}
            className="px-4 py-1.5 rounded-lg text-white text-xs bg-blue-700 hover:bg-blue-600 transition"
          >
            + 新增第一筆
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-700 text-white text-xs sticky top-12 z-10">
                <th className="whitespace-nowrap px-3 py-2 text-left w-20">月份</th>
                <th className="whitespace-nowrap px-3 py-2 text-left w-28">發電類型</th>
                <th className="whitespace-nowrap px-3 py-2 text-right w-32">購入量 (MWh)</th>
                <th className="whitespace-nowrap px-3 py-2 text-left">憑證號碼</th>
                <th className="whitespace-nowrap px-3 py-2 text-left">備註</th>
                <th className="whitespace-nowrap px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                  <tr key={row.tempKey} className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}>
                    <td className="px-2 py-1.5">
                      <select
                        value={row.month}
                        onChange={(e) => updateRow(row.tempKey, 'month', parseInt(e.target.value))}
                        className="w-full border border-gray-300 rounded px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={row.generation_type}
                        onChange={(e) => updateRow(row.tempKey, 'generation_type', e.target.value)}
                        className="w-full border border-gray-300 rounded px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {GEN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number" min="0" step="any" placeholder="MWh"
                        value={row.rec_mwh}
                        onChange={(e) => updateRow(row.tempKey, 'rec_mwh', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text" placeholder="I-REC-XXXX"
                        value={row.certificate_no}
                        onChange={(e) => updateRow(row.tempKey, 'certificate_no', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => updateRow(row.tempKey, 'notes', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => deleteRow(row.tempKey)}
                        className="text-gray-300 hover:text-red-500 transition text-lg leading-none"
                        title="刪除"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-semibold text-xs border-t border-blue-200">
                <td colSpan={2} className="px-3 py-2 text-blue-800">合計</td>
                <td className="px-3 py-2 text-right font-mono text-blue-800">
                  {totalRecMwh.toLocaleString(undefined, { maximumFractionDigits: 10 })} MWh
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* CO₂e summary */}
      <div className="bg-blue-50/50 border-t border-blue-200 px-4 py-3">
        <div className="text-xs font-semibold text-blue-800 mb-2">碳排放量計算</div>
        {gridFactor == null ? (
          <p className="text-xs text-amber-600">尚未設定電力係數，無法計算 CO₂e</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs sm:grid-cols-4">
            <div>
              <div className="text-gray-500">用電量（地域）</div>
              <div className="font-mono font-semibold text-gray-800">
                {totalElecKwh.toLocaleString(undefined, { maximumFractionDigits: 10 })} kWh
              </div>
            </div>
            <div>
              <div className="text-gray-500">S2 地域 CO₂e</div>
              <div className="font-mono font-semibold text-gray-800">
                {s2Loc != null ? s2Loc.toFixed(4) + ' t' : '—'}
              </div>
            </div>
            <div>
              <div className="text-gray-500">iREC 抵扣量</div>
              <div className="font-mono font-semibold text-green-700">
                {deducted != null && deducted > 0 ? '−' + deducted.toFixed(4) + ' t' : '—'}
              </div>
            </div>
            <div>
              <div className="text-gray-500">S2 市場 CO₂e</div>
              <div className="font-mono font-bold text-blue-800">
                {s2Mkt != null ? s2Mkt.toFixed(4) + ' t' : '—'}
              </div>
            </div>
          </div>
        )}
        {gridFactor != null && (
          <p className="text-xs text-gray-400 mt-2">
            用電量＝市電＋太陽能合計 ｜ 電網係數：{gridFactor} tCO₂e/MWh
            {mktFactor != null && mktFactor !== gridFactor && `｜ 市場剩餘係數：${mktFactor} tCO₂e/MWh`}
            <br />
            S2 地域 = 合計電量(kWh) ÷ 1000 × 電網係數 ｜
            S2 市場 = max(0, (合計電量 − iREC 購入量) ÷ 1000 × {mktFactor != null && mktFactor !== gridFactor ? '市場剩餘係數' : '電網係數'})
          </p>
        )}
      </div>
    </div>
  );
}

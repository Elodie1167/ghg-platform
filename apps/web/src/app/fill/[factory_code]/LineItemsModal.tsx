'use client';

import { useState, useEffect, useCallback } from 'react';

interface LineItem {
  id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  quantity: number | null;
  unit: string | null;
  erp_ref: string | null;
  note: string | null;
  carbon_content_pct?: number | null;
}

interface Draft {
  invoice_no: string;
  invoice_date: string;
  quantity: string;
  unit: string;
  erp_ref: string;
  note: string;
  carbon_content_pct: string;
}

const emptyDraft = (unit: string): Draft => ({
  invoice_no: '', invoice_date: '', quantity: '', unit, erp_ref: '', note: '', carbon_content_pct: '',
});

/**
 * 單據明細 modal：顯示某 activity_record 的所有單據、自動加總，
 * 可新增/修改/刪除，變動後由後端回算月加總 + CO₂e。稽核下鑽用。
 */
export default function LineItemsModal({
  recordId, title, unit, readOnly, refLabel = '發票號', showCarbonPct, onClose, onChanged,
}: {
  recordId: string;
  title: string;
  unit: string;
  readOnly?: boolean;
  refLabel?: string;
  showCarbonPct?: boolean;
  onClose: () => void;
  onChanged?: (activityValue: number) => void;
}) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docDraft, setDocDraft] = useState('');
  const [docEditing, setDocEditing] = useState(false);
  const [docSaving, setDocSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft(unit));
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/records/${recordId}/line-items`)
      .then((r) => r.json())
      .then((body) => {
        setItems(Array.isArray(body.data) ? body.data : []);
        setDocUrl(body.source_doc_url ?? null);
        setDocDraft(body.source_doc_url ?? '');
      })
      .finally(() => setLoading(false));
  }, [recordId]);

  useEffect(() => { load(); }, [load]);

  async function saveDocUrl() {
    setDocSaving(true);
    try {
      const v = docDraft.trim() || null;
      const res = await fetch(`/api/records/${recordId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_doc_url: v }),
      });
      if (res.ok) { setDocUrl(v); setDocEditing(false); }
    } finally { setDocSaving(false); }
  }

  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  async function addItem() {
    const q = draft.quantity === '' ? null : Number(draft.quantity);
    if (q === null || isNaN(q)) return;
    const pct = draft.carbon_content_pct === '' ? null : Number(draft.carbon_content_pct);
    if (pct !== null && isNaN(pct)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/line-items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_no: draft.invoice_no || null,
          invoice_date: draft.invoice_date || null,
          quantity: q,
          unit: draft.unit || unit,
          erp_ref: draft.erp_ref || null,
          note: draft.note || null,
          carbon_content_pct: pct,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setDraft(emptyDraft(unit));
        load();
        if (onChanged && body.activity_value != null) onChanged(Number(body.activity_value));
      }
    } finally { setBusy(false); }
  }

  async function updatePct(item: LineItem, value: string) {
    const pct = value === '' ? null : Number(value);
    if (pct !== null && isNaN(pct)) return;
    if (pct === (item.carbon_content_pct ?? null)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/line-items`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          invoice_no: item.invoice_no,
          invoice_date: item.invoice_date,
          quantity: item.quantity,
          unit: item.unit,
          erp_ref: item.erp_ref,
          note: item.note,
          carbon_content_pct: pct,
        }),
      });
      const body = await res.json();
      if (res.ok) {
        load();
        if (onChanged && body.activity_value != null) onChanged(Number(body.activity_value));
      }
    } finally { setBusy(false); }
  }

  async function delItem(itemId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/records/${recordId}/line-items?item_id=${itemId}`, { method: 'DELETE' });
      const body = await res.json();
      if (res.ok) {
        load();
        if (onChanged && body.activity_value != null) onChanged(Number(body.activity_value));
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">單據明細 — {title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">月加總 = 所有單據用量自動加總；此即稽核時「數字如何組成」的依據</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="px-5 pt-3">
          {docUrl && !docEditing ? (
            <>
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <span className="text-sm shrink-0">📂 公檔發票資料夾：</span>
                <code className="text-xs text-blue-800 break-all flex-1">{docUrl}</code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(docUrl); }}
                  className="shrink-0 text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                >複製路徑</button>
                <button
                  type="button"
                  onClick={() => setDocEditing(true)}
                  className="shrink-0 text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-100"
                >編輯</button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                瀏覽器無法直接開啟網路磁碟機資料夾（安全限制）；請複製路徑後貼到「檔案總管」網址列開啟，即可一次檢視該月所有發票正本。
              </p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <span className="text-sm shrink-0 pt-1.5">📂 公檔發票資料夾：</span>
                <input
                  type="text"
                  value={docDraft}
                  onChange={(e) => setDocDraft(e.target.value)}
                  placeholder="貼上公檔資料夾路徑，例如 \\nt_pdc\永續發展部\...\發票"
                  className="flex-1 text-xs border border-blue-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  type="button"
                  onClick={saveDocUrl}
                  disabled={docSaving}
                  className="shrink-0 text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >{docSaving ? '儲存中…' : '儲存路徑'}</button>
                {docUrl && (
                  <button
                    type="button"
                    onClick={() => { setDocDraft(docUrl ?? ''); setDocEditing(false); }}
                    className="shrink-0 text-xs px-2 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >取消</button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                ERP 匯入不含公檔連結；於此填入該月發票所在的公檔資料夾路徑並儲存後，即可用「複製路徑」貼到檔案總管一次開啟整月發票。
              </p>
            </>
          )}
        </div>

        <div className="p-5">
          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">載入中…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs">
                    <th className="whitespace-nowrap px-3 py-2 text-left">單據號碼</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left">單據日期</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">用量</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left">單位</th>
                    {showCarbonPct && <th className="whitespace-nowrap px-3 py-2 text-right">含碳量(%)</th>}
                    <th className="whitespace-nowrap px-3 py-2 text-left">{refLabel}</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left">備註</th>
                    {!readOnly && <th className="whitespace-nowrap px-3 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">{it.invoice_no ?? '—'}</td>
                      <td className="px-3 py-1.5">{it.invoice_date ? String(it.invoice_date).slice(0, 10) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{it.quantity != null ? Number(it.quantity).toLocaleString(undefined, { maximumFractionDigits: 10 }) : '—'}</td>
                      <td className="px-3 py-1.5">{it.unit ?? '—'}</td>
                      {showCarbonPct && (
                        <td className="px-3 py-1.5 text-right">
                          {readOnly ? (
                            <span className="font-mono">{it.carbon_content_pct != null ? Number(it.carbon_content_pct) : '—'}</span>
                          ) : (
                            <input
                              type="number" min="0" max="100" step="0.001" placeholder="例：0.08"
                              key={`${it.id}-${it.carbon_content_pct ?? ''}`}
                              defaultValue={it.carbon_content_pct ?? ''}
                              onBlur={(e) => updatePct(it, e.target.value)}
                              disabled={busy}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-gray-500">{it.erp_ref ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{it.note ?? '—'}</td>
                      {!readOnly && (
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={() => delItem(it.id)} disabled={busy}
                            className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={6 + (showCarbonPct ? 1 : 0) + (readOnly ? 0 : 1)} className="px-3 py-6 text-center text-gray-400">尚無單據明細</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-green-50 font-semibold border-t border-gray-200">
                    <td className="px-3 py-2" colSpan={2}>合計（= 月加總）</td>
                    <td className="px-3 py-2 text-right font-mono text-green-800">{total.toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })}</td>
                    <td className="px-3 py-2">{unit}</td>
                    {showCarbonPct && <td className="px-3 py-2 text-right text-gray-400 text-xs">各筆不同</td>}
                    <td colSpan={(readOnly ? 2 : 3)} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!readOnly && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-semibold text-gray-600 mb-2">新增單據</p>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <input placeholder="單據號碼" value={draft.invoice_no} onChange={(e) => setDraft((d) => ({ ...d, invoice_no: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                <input type="date" value={draft.invoice_date} onChange={(e) => setDraft((d) => ({ ...d, invoice_date: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                <input type="number" placeholder="用量" value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm text-right" />
                <input placeholder="單位" value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                {showCarbonPct && (
                  <input type="number" min="0" max="100" step="0.001" placeholder="含碳量(%)" value={draft.carbon_content_pct} onChange={(e) => setDraft((d) => ({ ...d, carbon_content_pct: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm text-right" />
                )}
                <input placeholder={refLabel} value={draft.erp_ref} onChange={(e) => setDraft((d) => ({ ...d, erp_ref: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
                <input placeholder="備註" value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <button onClick={addItem} disabled={busy || draft.quantity === ''}
                className="mt-2 px-4 py-1.5 rounded-lg text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#0C3D2E' }}>+ 新增單據</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
}

interface Draft {
  invoice_no: string;
  invoice_date: string;
  quantity: string;
  unit: string;
  erp_ref: string;
  note: string;
}

const emptyDraft = (unit: string): Draft => ({
  invoice_no: '', invoice_date: '', quantity: '', unit, erp_ref: '', note: '',
});

/**
 * 單據明細 modal：顯示某 activity_record 的所有單據、自動加總，
 * 可新增/修改/刪除，變動後由後端回算月加總 + CO₂e。稽核下鑽用。
 */
export default function LineItemsModal({
  recordId, title, unit, readOnly, onClose, onChanged,
}: {
  recordId: string;
  title: string;
  unit: string;
  readOnly?: boolean;
  onClose: () => void;
  onChanged?: (activityValue: number) => void;
}) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft(unit));
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/records/${recordId}/line-items`)
      .then((r) => r.json())
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [recordId]);

  useEffect(() => { load(); }, [load]);

  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  async function addItem() {
    const q = draft.quantity === '' ? null : Number(draft.quantity);
    if (q === null || isNaN(q)) return;
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

        <div className="p-5">
          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">載入中…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs">
                    <th className="px-3 py-2 text-left">單據號碼</th>
                    <th className="px-3 py-2 text-left">單據日期</th>
                    <th className="px-3 py-2 text-right">用量</th>
                    <th className="px-3 py-2 text-left">單位</th>
                    <th className="px-3 py-2 text-left">ERP 參照</th>
                    <th className="px-3 py-2 text-left">備註</th>
                    {!readOnly && <th className="px-3 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">{it.invoice_no ?? '—'}</td>
                      <td className="px-3 py-1.5">{it.invoice_date ? String(it.invoice_date).slice(0, 10) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{it.quantity != null ? Number(it.quantity).toLocaleString() : '—'}</td>
                      <td className="px-3 py-1.5">{it.unit ?? '—'}</td>
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
                    <tr><td colSpan={readOnly ? 6 : 7} className="px-3 py-6 text-center text-gray-400">尚無單據明細</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-green-50 font-semibold border-t border-gray-200">
                    <td className="px-3 py-2" colSpan={2}>合計（= 月加總）</td>
                    <td className="px-3 py-2 text-right font-mono text-green-800">{total.toLocaleString()}</td>
                    <td className="px-3 py-2">{unit}</td>
                    <td colSpan={readOnly ? 2 : 3} />
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
                <input placeholder="ERP 參照" value={draft.erp_ref} onChange={(e) => setDraft((d) => ({ ...d, erp_ref: e.target.value }))} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
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

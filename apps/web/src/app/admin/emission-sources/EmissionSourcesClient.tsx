'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminEmissionSource } from './page';

const HEADER_BG = '#0C3D2E';

const emptyForm = {
  source_code: '', name_zh: '', name_en: '', scope: 1, category: '',
  is_biomass: false, default_unit: '', substance: '', notes: '',
};

export default function EmissionSourcesClient({ sources }: { sources: AdminEmissionSource[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name_zh: '', name_en: '', category: '', default_unit: '', notes: '' });

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? '操作失敗'); return false; }
      setMsg(json.warning ?? '已儲存');
      router.refresh();
      return true;
    } catch {
      setErr('連線失敗，請重試');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const ok = await call('/api/admin/emission-sources', {
      method: 'POST',
      body: JSON.stringify({
        source_code: form.source_code.trim(),
        name_zh: form.name_zh.trim(),
        name_en: form.name_en.trim() || null,
        scope: form.scope,
        category: form.category.trim() || null,
        is_biomass: form.is_biomass,
        default_unit: form.default_unit.trim() || null,
        substance: form.substance.trim() || null,
        notes: form.notes.trim() || null,
      }),
    });
    if (ok) { setAdding(false); setForm(emptyForm); }
  }

  function startEdit(s: AdminEmissionSource) {
    setEditingId(s.id);
    setEditForm({
      name_zh: s.name_zh, name_en: s.name_en ?? '', category: s.category ?? '',
      default_unit: s.default_unit ?? '', notes: s.notes ?? '',
    });
  }

  async function saveEdit(id: string) {
    const ok = await call(`/api/admin/emission-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name_zh: editForm.name_zh.trim(),
        name_en: editForm.name_en.trim() || null,
        category: editForm.category.trim() || null,
        default_unit: editForm.default_unit.trim() || null,
        notes: editForm.notes.trim() || null,
      }),
    });
    if (ok) setEditingId(null);
  }

  async function toggleActive(s: AdminEmissionSource) {
    const next = !s.is_active;
    if (!next && !confirm(
      `確定停用 ${s.source_code}（${s.name_zh}）？\n\n`
      + '停用後：不再出現在各廠填報頁。\n'
      + '歷史記錄仍可重算，隨時可重新啟用（各廠原有勾選設定不會被改動）。',
    )) return;
    await call(`/api/admin/emission-sources/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        is_active: next,
        deprecated_at: next ? null : new Date().toISOString().slice(0, 10),
      }),
    });
  }

  async function remove(s: AdminEmissionSource) {
    if (!confirm(`確定刪除 ${s.source_code}（${s.name_zh}）？此操作不可復原。`)) return;
    await call(`/api/admin/emission-sources/${s.id}`, { method: 'DELETE' });
  }

  const byScope = [1, 2, 3].map((scope) => ({
    scope,
    rows: sources.filter((s) => s.scope === scope),
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-4">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">排放源設定</h1>
          <p className="text-green-300 text-sm">
            在這裡新增或停用排放源，不需要改程式碼。新增後請到「係數設定」建立對應排放係數，
            否則各廠填報後算出來會是 0；各廠是否要用這個排放源，由各廠自己在填報頁勾選。
          </p>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 md:px-10 py-6">
        {(msg || err) && (
          <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            err ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-green-50 border border-green-200 text-green-800'}`}>
            {err || msg}
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">共 {sources.length} 個排放源</p>
          <button type="button" onClick={() => setAdding((v) => !v)} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: HEADER_BG }}>
            {adding ? '取消' : '+ 新增排放源'}
          </button>
        </div>

        {adding && (
          <div className="mb-5 bg-white rounded-xl border border-gray-200 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="排放源代碼 *" hint="例：1-1A-1，建立後不可修改">
                <input value={form.source_code}
                  onChange={(e) => setForm({ ...form, source_code: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm font-mono" />
              </Field>
              <Field label="中文名稱 *">
                <input value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm" />
              </Field>
              <Field label="英文名稱">
                <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm" />
              </Field>
              <Field label="範疇 *" hint="建立後不可修改">
                <select value={form.scope} onChange={(e) => setForm({ ...form, scope: Number(e.target.value) })}
                  className="w-full border rounded px-2 py-1 text-sm">
                  <option value={1}>範疇一</option>
                  <option value={2}>範疇二</option>
                  <option value={3}>範疇三</option>
                </select>
              </Field>
              <Field label="分類" hint="例：固定燃燒／移動燃燒／逸散／電力">
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm" />
              </Field>
              <Field label="預設單位" hint="例：kWh／L／kg">
                <input value={form.default_unit} onChange={(e) => setForm({ ...form, default_unit: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm" />
              </Field>
              <Field label="物質" hint="冷媒／滅火器用，例：R134a">
                <input value={form.substance} onChange={(e) => setForm({ ...form, substance: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm" />
              </Field>
              <label className="flex items-center gap-1.5 text-sm pb-1 self-end">
                <input type="checkbox" checked={form.is_biomass}
                  onChange={(e) => setForm({ ...form, is_biomass: e.target.checked })} />
                生質燃料（CO₂ 獨立揭露，建立後不可修改）
              </label>
              <div className="col-span-2 md:col-span-4">
                <Field label="備註">
                  <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm" />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button type="button" onClick={create}
                disabled={busy || !form.source_code.trim() || !form.name_zh.trim()}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{ backgroundColor: HEADER_BG }}>
                建立
              </button>
              <span className="text-xs text-gray-500">
                建立後記得到「係數設定」新增排放係數，否則填報後算出來是 0。
              </span>
            </div>
          </div>
        )}

        {byScope.map(({ scope, rows }) => rows.length > 0 && (
          <div key={scope} className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-5">
            <div className="px-3 py-2 bg-gray-50 text-sm font-medium text-gray-700">範疇{scope}</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 border-t border-gray-100">
                <tr>
                  <Th>代碼</Th><Th>名稱</Th><Th>分類</Th><Th>單位</Th>
                  <Th className="text-right">填報記錄</Th><Th className="text-right">係數</Th>
                  <Th>狀態</Th><Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const editing = editingId === s.id;
                  return (
                    <tr key={s.id} className={`border-t border-gray-100 ${s.is_active ? '' : 'bg-gray-50 text-gray-400'}`}>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {s.source_code}
                        {s.is_biomass && <span className="ml-1 text-[10px] text-green-600 bg-green-50 px-1 rounded">生質</span>}
                      </td>
                      {editing ? (
                        <>
                          <td className="px-3 py-2">
                            <input value={editForm.name_zh} onChange={(e) => setEditForm({ ...editForm, name_zh: e.target.value })}
                              className="w-full border rounded px-1.5 py-0.5 text-sm" />
                          </td>
                          <td className="px-3 py-2">
                            <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                              className="w-full border rounded px-1.5 py-0.5 text-sm" />
                          </td>
                          <td className="px-3 py-2">
                            <input value={editForm.default_unit} onChange={(e) => setEditForm({ ...editForm, default_unit: e.target.value })}
                              className="w-full border rounded px-1.5 py-0.5 text-sm" />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2">
                            {s.name_zh}
                            {s.name_en && s.name_en !== s.name_zh && (
                              <span className="text-xs text-gray-400 ml-1">{s.name_en}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{s.category || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{s.default_unit || '—'}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums">{s.record_count || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.factor_count || '—'}</td>
                      <td className="px-3 py-2">
                        {s.is_active
                          ? <span className="text-green-700 text-xs">啟用中</span>
                          : <span className="text-xs">已停用{s.deprecated_at ? ` ${s.deprecated_at.slice(0, 10)}` : ''}</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {editing ? (
                          <>
                            <button type="button" onClick={() => saveEdit(s.id)} disabled={busy}
                              className="text-xs px-2 py-1 rounded text-white disabled:opacity-40"
                              style={{ backgroundColor: HEADER_BG }}>
                              儲存
                            </button>
                            <button type="button" onClick={() => setEditingId(null)} disabled={busy}
                              className="ml-1 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(s)} disabled={busy}
                              className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">
                              編輯
                            </button>
                            <button type="button" onClick={() => toggleActive(s)} disabled={busy}
                              className="ml-1 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">
                              {s.is_active ? '停用' : '啟用'}
                            </button>
                            {s.record_count === 0 && s.factor_count === 0 && (
                              <button type="button" onClick={() => remove(s)} disabled={busy}
                                className="ml-1 text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                                刪除
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </main>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className}`}>{children}</th>;
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}

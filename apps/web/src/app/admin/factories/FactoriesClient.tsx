'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminCountry, AdminCsrAlias, AdminFactory } from './page';

const HEADER_BG = '#0C3D2E';

type Tab = 'factories' | 'countries' | 'aliases';

export default function FactoriesClient({ factories, countries, aliases }: {
  factories: AdminFactory[];
  countries: AdminCountry[];
  aliases: AdminCsrAlias[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('factories');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-[1920px] mx-auto px-6 md:px-10 py-4">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">工廠與產區設定</h1>
          <p className="text-green-300 text-sm">
            在這裡新增或停用工廠、調整顯示順序、維護 CSR 廠名對照。改完立即反映到首頁、
            集團碳排彙整表與減碳績效追蹤，不需要改程式碼。
          </p>
          <div className="mt-3 flex gap-2 text-xs">
            {([['factories', `工廠（${factories.length}）`],
              ['countries', `產區（${countries.length}）`],
              ['aliases', `CSR 廠名對照（${aliases.length}）`]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  tab === k ? 'bg-white text-[#0C3D2E]' : 'bg-white/10 hover:bg-white/20'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto px-6 md:px-10 py-6">
        {(msg || err) && (
          <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            err ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-green-50 border border-green-200 text-green-800'}`}>
            {err || msg}
          </div>
        )}

        {tab === 'factories' && (
          <FactoriesTab factories={factories} countries={countries} call={call} busy={busy} />
        )}
        {tab === 'countries' && <CountriesTab countries={countries} call={call} busy={busy} />}
        {tab === 'aliases' && (
          <AliasesTab aliases={aliases} factories={factories} call={call} busy={busy} />
        )}
      </main>
    </div>
  );
}

type Caller = (url: string, init: RequestInit) => Promise<boolean>;

// ── 工廠 ───────────────────────────────────────────────────────
function FactoriesTab({ factories, countries, call, busy }: {
  factories: AdminFactory[]; countries: AdminCountry[]; call: Caller; busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    factory_code: '', name_zh: '', name_en: '',
    country_code: countries[0]?.country_code ?? '', region: '',
  });

  async function create() {
    const ok = await call('/api/admin/factories', {
      method: 'POST',
      body: JSON.stringify({
        factory_code: form.factory_code.trim().toUpperCase(),
        name_zh: form.name_zh.trim(),
        name_en: form.name_en.trim() || null,
        country_code: form.country_code,
        region: form.region.trim() || null,
      }),
    });
    if (ok) {
      setAdding(false);
      setForm({ ...form, factory_code: '', name_zh: '', name_en: '', region: '' });
    }
  }

  async function toggleActive(f: AdminFactory) {
    const next = !f.is_active;
    if (next === false && !confirm(
      `確定停用 ${f.factory_code}？\n\n`
      + '停用後：不再出現在填報入口與異常檢查。\n'
      + '歷史年度的彙整表與報表仍會照常列出這個廠（已盤查年度不回溯變動）。',
    )) return;
    await call(`/api/admin/factories/${f.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        is_active: next,
        closed_at: next ? null : new Date().toISOString().slice(0, 10),
      }),
    });
  }

  async function move(f: AdminFactory, dir: -1 | 1) {
    const sameCountry = factories.filter((x) => x.country_code === f.country_code);
    const i = sameCountry.findIndex((x) => x.id === f.id);
    const j = i + dir;
    if (j < 0 || j >= sameCountry.length) return;
    const other = sameCountry[j];
    await call('/api/admin/factories/reorder', {
      method: 'PUT',
      body: JSON.stringify({
        items: [
          { id: f.id, display_order: other.display_order },
          { id: other.id, display_order: f.display_order },
        ],
      }),
    });
  }

  async function remove(f: AdminFactory) {
    if (!confirm(`確定刪除 ${f.factory_code}？此操作不可復原。\n（有填報記錄的廠會被系統擋下，請改用停用）`)) return;
    await call(`/api/admin/factories/${f.id}`, { method: 'DELETE' });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          順序即為所有頁面的欄位順序。<b>移除工廠請優先用「停用」</b>——
          歷史盤查數字會完整保留，只是不再出現在填報入口。
        </p>
        <button type="button" onClick={() => setAdding((v) => !v)} disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: HEADER_BG }}>
          {adding ? '取消' : '+ 新增工廠'}
        </button>
      </div>

      {adding && (
        <div className="mb-5 bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="廠代碼 *" hint="大寫英數與底線，建立後不可修改">
              <input value={form.factory_code} placeholder="TWN_XXX"
                onChange={(e) => setForm({ ...form, factory_code: e.target.value.toUpperCase() })}
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
            <Field label="產區 *">
              <select value={form.country_code}
                onChange={(e) => setForm({ ...form, country_code: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm">
                {countries.map((c) => (
                  <option key={c.country_code} value={c.country_code}>
                    {c.name_zh}（{c.country_code}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="地區備註">
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm" />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={create}
              disabled={busy || !form.factory_code || !form.name_zh || !form.country_code}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: HEADER_BG }}>
              建立
            </button>
            <span className="text-xs text-gray-500">
              建立後記得到「係數設定」確認該廠適用的排放係數，否則填報會算出 0。
            </span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <Th>順序</Th><Th>廠代碼</Th><Th>名稱</Th><Th>產區</Th>
              <Th className="text-right">填報記錄</Th><Th className="text-right">iREC</Th>
              <Th>狀態</Th><Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {factories.map((f, i) => {
              const newCountry = i === 0 || factories[i - 1].country_code !== f.country_code;
              return (
                <tr key={f.id} className={`border-t border-gray-100 ${f.is_active ? '' : 'bg-gray-50 text-gray-400'}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button type="button" onClick={() => move(f, -1)} disabled={busy}
                      className="px-1 text-gray-400 hover:text-gray-900 disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => move(f, 1)} disabled={busy}
                      className="px-1 text-gray-400 hover:text-gray-900 disabled:opacity-30">↓</button>
                    <span className="ml-1 text-xs text-gray-300">{f.display_order}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{f.factory_code}</td>
                  <td className="px-3 py-2">
                    {f.name_zh}
                    {f.name_en && f.name_en !== f.name_zh && (
                      <span className="text-xs text-gray-400 ml-1">{f.name_en}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {newCountry
                      ? <span className="font-medium">{f.country_name}</span>
                      : <span className="text-gray-300">〃</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.record_count || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.rec_count || '—'}</td>
                  <td className="px-3 py-2">
                    {f.is_active
                      ? <span className="text-green-700 text-xs">啟用中</span>
                      : <span className="text-xs">已停用{f.closed_at ? ` ${f.closed_at.slice(0, 10)}` : ''}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button type="button" onClick={() => toggleActive(f)} disabled={busy}
                      className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">
                      {f.is_active ? '停用' : '啟用'}
                    </button>
                    {f.record_count === 0 && f.rec_count === 0 && (
                      <button type="button" onClick={() => remove(f)} disabled={busy}
                        className="ml-1 text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── 產區 ───────────────────────────────────────────────────────
function CountriesTab({ countries, call, busy }: {
  countries: AdminCountry[]; call: Caller; busy: boolean;
}) {
  const [form, setForm] = useState({ country_code: '', name_zh: '', name_en: '' });

  return (
    <>
      <p className="text-sm text-gray-500 mb-4">
        產區順序決定首頁、集團碳排彙整表、減碳績效追蹤三處的排列，三個頁面共用這一份。
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr><Th>順序</Th><Th>代碼</Th><Th>名稱</Th><Th className="text-right">廠數</Th><Th>操作</Th></tr>
          </thead>
          <tbody>
            {countries.map((c, i) => (
              <tr key={c.country_code} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <input type="number" defaultValue={c.display_order} disabled={busy}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== c.display_order) {
                        call('/api/admin/countries', {
                          method: 'POST',
                          body: JSON.stringify({
                            country_code: c.country_code, name_zh: c.name_zh, display_order: v,
                          }),
                        });
                      }
                    }}
                    className="w-16 border rounded px-1 py-0.5 text-xs" />
                  <span className="ml-2 text-xs text-gray-300">第 {i + 1} 位</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{c.country_code}</td>
                <td className="px-3 py-2">{c.name_zh}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.factory_count}</td>
                <td className="px-3 py-2">
                  {c.factory_count === 0 && (
                    <button type="button" disabled={busy}
                      onClick={() => call(`/api/admin/countries?country_code=${c.country_code}`, { method: 'DELETE' })}
                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                      刪除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-medium mb-3">新增產區</div>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="代碼 *"><input value={form.country_code} placeholder="THA"
            onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })}
            className="border rounded px-2 py-1 text-sm font-mono w-24" /></Field>
          <Field label="中文名 *"><input value={form.name_zh}
            onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-32" /></Field>
          <Field label="英文名"><input value={form.name_en}
            onChange={(e) => setForm({ ...form, name_en: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-40" /></Field>
          <button type="button" disabled={busy || !form.country_code || !form.name_zh}
            onClick={async () => {
              const ok = await call('/api/admin/countries', {
                method: 'POST',
                body: JSON.stringify({
                  country_code: form.country_code, name_zh: form.name_zh,
                  name_en: form.name_en || null,
                }),
              });
              if (ok) setForm({ country_code: '', name_zh: '', name_en: '' });
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: HEADER_BG }}>
            新增
          </button>
        </div>
      </div>
    </>
  );
}

// ── CSR 廠名對照 ───────────────────────────────────────────────
function AliasesTab({ aliases, factories, call, busy }: {
  aliases: AdminCsrAlias[]; factories: AdminFactory[]; call: Caller; busy: boolean;
}) {
  const [form, setForm] = useState({
    csr_country: '', csr_factory: '', factory_code: '', is_ignored: false, note: '',
  });

  return (
    <>
      <p className="text-sm text-gray-500 mb-4">
        匯入 CSR 明細表時，用「產區｜廠名」對到平台廠代碼。多個 CSR 廠可對到同一個平台廠（合併廠會加總）。
        匯入後若出現「查無設定」的警告，把那組名稱複製到下方新增即可；本來就不該匯入的（已關廠、樣品中心）
        請勾選<b>刻意略過</b>，系統就不會再提醒。
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr><Th>CSR 產區</Th><Th>CSR 廠名</Th><Th>對應平台廠</Th><Th>備註</Th><Th>操作</Th></tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.id} className={`border-t border-gray-100 ${a.is_ignored ? 'text-gray-400' : ''}`}>
                <td className="px-3 py-2 font-mono text-xs">{a.csr_country}</td>
                <td className="px-3 py-2">{a.csr_factory}</td>
                <td className="px-3 py-2">
                  {a.is_ignored
                    ? <span className="text-xs">刻意略過</span>
                    : <>
                      <span className="font-mono text-xs">{a.factory_code}</span>
                      <span className="text-gray-500 ml-1">{a.factory_name}</span>
                    </>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{a.note}</td>
                <td className="px-3 py-2">
                  <button type="button" disabled={busy}
                    onClick={() => call(`/api/admin/csr-aliases?id=${a.id}`, { method: 'DELETE' })}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-medium mb-3">新增對照</div>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="CSR 產區 *"><input value={form.csr_country} placeholder="Taiwan"
            onChange={(e) => setForm({ ...form, csr_country: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-28" /></Field>
          <Field label="CSR 廠名 *"><input value={form.csr_factory} placeholder="Chiayi"
            onChange={(e) => setForm({ ...form, csr_factory: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-36" /></Field>
          <Field label="對應平台廠">
            <select value={form.factory_code} disabled={form.is_ignored}
              onChange={(e) => setForm({ ...form, factory_code: e.target.value })}
              className="border rounded px-2 py-1 text-sm w-48 disabled:bg-gray-100">
              <option value="">請選擇</option>
              {factories.map((f) => (
                <option key={f.id} value={f.factory_code}>{f.factory_code} {f.name_zh}</option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-1.5 text-sm pb-1">
            <input type="checkbox" checked={form.is_ignored}
              onChange={(e) => setForm({ ...form, is_ignored: e.target.checked, factory_code: '' })} />
            刻意略過
          </label>
          <Field label="備註"><input value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-40" /></Field>
          <button type="button"
            disabled={busy || !form.csr_country || !form.csr_factory || (!form.is_ignored && !form.factory_code)}
            onClick={async () => {
              const ok = await call('/api/admin/csr-aliases', {
                method: 'POST',
                body: JSON.stringify({
                  csr_country: form.csr_country.trim(),
                  csr_factory: form.csr_factory.trim(),
                  factory_code: form.factory_code || null,
                  is_ignored: form.is_ignored,
                  note: form.note || null,
                }),
              });
              if (ok) setForm({ csr_country: '', csr_factory: '', factory_code: '', is_ignored: false, note: '' });
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: HEADER_BG }}>
            新增
          </button>
        </div>
      </div>
    </>
  );
}

// ── 小元件 ─────────────────────────────────────────────────────
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

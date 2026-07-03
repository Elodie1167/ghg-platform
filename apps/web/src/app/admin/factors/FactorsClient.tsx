'use client';

import { useState, useCallback } from 'react';

const HEADER_BG = '#0C3D2E';

export interface FactorRow {
  id: string;
  emission_source_id: string;
  source_code: string;
  source_name_zh: string;
  scope: number;
  category: string;
  country_code: string;
  year: number;
  factor_co2: number | null;
  factor_ch4: number | null;
  factor_n2o: number | null;
  factor_substance: number | null;
  grid_emission_factor: number | null;
  market_residual_factor: number | null;
  scope3_factor: number | null;
  source_reference: string | null;
  assigned_factory_ids: string[];
}

interface Factory {
  id: string;
  factory_code: string;
  name_zh: string;
  country_code: string;
}

interface EmissionSource {
  id: string;
  source_code: string;
  name_zh: string;
  scope: number;
  category: string;
}

interface Props {
  initialFactors: FactorRow[];
  factories: Factory[];
  emissionSources: EmissionSource[];
}

type FactorDraft = Omit<FactorRow, 'id' | 'emission_source_id' | 'source_code' | 'source_name_zh' | 'scope' | 'category' | 'assigned_factory_ids'>;

function numStr(v: number | null): string {
  return v != null ? String(v) : '';
}

function strNum(s: string): number | null {
  const n = parseFloat(s);
  return s === '' || isNaN(n) ? null : n;
}

export default function FactorsClient({ initialFactors, factories, emissionSources }: Props) {
  const [factors, setFactors] = useState<FactorRow[]>(initialFactors);
  const [scopeFilter, setScopeFilter] = useState<number | null>(null);
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FactorDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const [assignFactorId, setAssignFactorId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addSource, setAddSource] = useState('');
  const [addCountry, setAddCountry] = useState('TWN');
  const [addYear, setAddYear] = useState(2025);

  const availableYears = Array.from(new Set(factors.map((f) => f.year))).sort((a, b) => b - a);

  const filtered = factors.filter((f) => {
    if (scopeFilter !== null && f.scope !== scopeFilter) return false;
    if (yearFilter !== null && f.year !== yearFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!f.source_code.toLowerCase().includes(q) && !f.source_name_zh.includes(q) && !f.country_code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function startEdit(f: FactorRow) {
    setEditingId(f.id);
    setDraft({
      country_code: f.country_code,
      year: f.year,
      factor_co2: f.factor_co2,
      factor_ch4: f.factor_ch4,
      factor_n2o: f.factor_n2o,
      factor_substance: f.factor_substance,
      grid_emission_factor: f.grid_emission_factor,
      market_residual_factor: f.market_residual_factor,
      scope3_factor: f.scope3_factor,
      source_reference: f.source_reference,
    });
  }

  async function saveEdit(id: string) {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/factors/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFactors((prev) => prev.map((f) => f.id === id ? { ...f, ...data.data } : f));
      setEditingId(null); setDraft(null);
    } catch {
      alert('儲存失敗，請重試');
    } finally {
      setSaving(false);
    }
  }

  function deleteFactor(id: string) {
    if (!confirm('確定刪除此係數？相關廠區指定也會一併刪除。')) return;
    fetch(`/api/admin/factors/${id}`, { method: 'DELETE' }).then((res) => {
      if (res.ok) setFactors((prev) => prev.filter((f) => f.id !== id));
    });
  }

  function openAssign(factorId: string) {
    const f = factors.find((x) => x.id === factorId);
    if (!f) return;
    setAssignFactorId(factorId);
    setPendingIds(new Set(f.assigned_factory_ids));
  }

  function toggleFactory(factoryId: string) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(factoryId)) next.delete(factoryId);
      else next.add(factoryId);
      return next;
    });
  }

  function selectAllFactories() {
    setPendingIds(new Set(factories.map((f) => f.id)));
  }

  function clearAllFactories() {
    setPendingIds(new Set());
  }

  async function saveAssignments() {
    if (!assignFactorId) return;
    setAssignSaving(true);
    try {
      const res = await fetch(`/api/admin/factors/${assignFactorId}/assignments`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factory_ids: Array.from(pendingIds) }),
      });
      if (!res.ok) throw new Error();
      const ids = Array.from(pendingIds);
      setFactors((prev) => prev.map((f) => f.id === assignFactorId ? { ...f, assigned_factory_ids: ids } : f));
      setAssignFactorId(null);
    } catch {
      alert('儲存廠區指定失敗');
    } finally {
      setAssignSaving(false);
    }
  }

  async function addFactor() {
    if (!addSource) { alert('請選擇排放源'); return; }
    const res = await fetch('/api/admin/factors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emission_source_id: addSource, country_code: addCountry, year: addYear }),
    });
    if (!res.ok) { alert('新增失敗（此排放源/國家/年度組合可能已存在）'); return; }
    const data = await res.json();
    const src = emissionSources.find((s) => s.id === addSource);
    if (src) {
      setFactors((prev) => [{
        ...data.data,
        source_code: src.source_code, source_name_zh: src.name_zh,
        scope: src.scope, category: src.category, assigned_factory_ids: [],
      }, ...prev]);
    }
    setShowAddForm(false); setAddSource('');
  }

  const countryCounts = useCallback((factoryIds: string[]) => {
    const countrySet = new Set(factories.filter((f) => factoryIds.includes(f.id)).map((f) => f.country_code));
    return { count: factoryIds.length, countries: Array.from(countrySet).join('/') };
  }, [factories]);

  const groupedByCountry = factories.reduce((acc, f) => {
    if (!acc[f.country_code]) acc[f.country_code] = [];
    acc[f.country_code].push(f);
    return acc;
  }, {} as Record<string, Factory[]>);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頁頭 */}
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">排放係數管理</h1>
            <p className="text-xs text-green-200 mt-0.5">管理各排放源的排放係數，並指定適用廠區</p>
          </div>
          <a href="/" className="text-green-200 hover:text-white text-sm underline">← 返回填報</a>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6">
        {/* 篩選列 */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[null, 1, 2, 3].map((s) => (
              <button key={String(s)} onClick={() => setScopeFilter(s)}
                className={`px-4 py-1.5 font-medium transition ${scopeFilter === s ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                style={scopeFilter === s ? { backgroundColor: HEADER_BG } : {}}>
                {s === null ? '全部' : `S${s}`}
              </button>
            ))}
          </div>

          <select value={yearFilter ?? ''} onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">全部年度</option>
            {availableYears.map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>

          <input type="text" placeholder="搜尋排放源代碼或名稱…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white w-56 focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          <div className="ml-auto">
            <button onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-1.5 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
              style={{ backgroundColor: HEADER_BG }}>
              + 新增係數
            </button>
          </div>
        </div>

        {/* 新增表單 */}
        {showAddForm && (
          <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">排放源</label>
              <select value={addSource} onChange={(e) => setAddSource(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[240px]">
                <option value="">請選擇排放源</option>
                {[1, 2, 3].map((scope) => (
                  <optgroup key={scope} label={`S${scope}`}>
                    {emissionSources.filter((s) => s.scope === scope).map((s) => (
                      <option key={s.id} value={s.id}>{s.source_code} {s.name_zh}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">國家代碼</label>
              <input type="text" value={addCountry} onChange={(e) => setAddCountry(e.target.value.toUpperCase())}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-24" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">年度</label>
              <input type="number" min="2020" max="2100" value={addYear} onChange={(e) => setAddYear(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-24" />
            </div>
            <button onClick={addFactor}
              className="px-4 py-1.5 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
              style={{ backgroundColor: HEADER_BG }}>確認新增</button>
            <button onClick={() => setShowAddForm(false)} className="px-4 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 transition">取消</button>
          </div>
        )}

        {/* 主表格 */}
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm bg-white">
          <table className="border-collapse text-xs" style={{ minWidth: '1400px' }}>
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                <th className="px-3 py-3 text-left w-24">S</th>
                <th className="px-3 py-3 text-left w-28">代碼</th>
                <th className="px-3 py-3 text-left w-36">排放源名稱</th>
                <th className="px-3 py-3 text-center w-16">國家</th>
                <th className="px-3 py-3 text-center w-16">年度</th>
                <th className="px-3 py-3 text-right w-24">CO₂</th>
                <th className="px-3 py-3 text-right w-24">CH₄</th>
                <th className="px-3 py-3 text-right w-24">N₂O</th>
                <th className="px-3 py-3 text-right w-24">物質/HFCs</th>
                <th className="px-3 py-3 text-right w-28">電網EF</th>
                <th className="px-3 py-3 text-right w-28">市場剩餘</th>
                <th className="px-3 py-3 text-right w-24">S3係數</th>
                <th className="px-3 py-3 text-left w-40">係數來源</th>
                <th className="px-3 py-3 text-center w-32">適用廠區</th>
                <th className="px-3 py-3 text-center w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-gray-400">
                    {factors.length === 0 ? '尚無係數資料，點擊「+ 新增係數」建立' : '篩選結果為空'}
                  </td>
                </tr>
              ) : filtered.map((f, idx) => {
                const isEditing = editingId === f.id;
                const { count, countries } = countryCounts(f.assigned_factory_ids);

                return (
                  <tr key={f.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-mono text-gray-400">S{f.scope}</td>
                    <td className="px-3 py-2 font-mono text-gray-700 font-medium">{f.source_code}</td>
                    <td className="px-3 py-2 text-gray-800">{f.source_name_zh}</td>

                    {/* 國家 */}
                    <td className="px-3 py-2 text-center">
                      {isEditing
                        ? <input value={draft!.country_code} onChange={(e) => setDraft((d) => d && { ...d, country_code: e.target.value.toUpperCase() })}
                            className="w-14 border border-gray-300 rounded px-1 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-green-500 text-xs" />
                        : <span className="font-mono">{f.country_code}</span>}
                    </td>

                    {/* 年度 */}
                    <td className="px-3 py-2 text-center">
                      {isEditing
                        ? <input type="number" value={draft!.year} onChange={(e) => setDraft((d) => d && { ...d, year: Number(e.target.value) })}
                            className="w-16 border border-gray-300 rounded px-1 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-green-500 text-xs" />
                        : f.year}
                    </td>

                    {/* 係數欄位 — 6 個 */}
                    {(['factor_co2', 'factor_ch4', 'factor_n2o', 'factor_substance', 'grid_emission_factor', 'market_residual_factor', 'scope3_factor'] as const).map((field) => (
                      <td key={field} className="px-3 py-2 text-right font-mono">
                        {isEditing
                          ? <input type="number" step="any"
                              value={numStr(draft![field] as number | null)}
                              onChange={(e) => setDraft((d) => d && { ...d, [field]: strNum(e.target.value) })}
                              className="w-24 border border-gray-300 rounded px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-green-500 text-xs" />
                          : <span className={f[field] != null ? 'text-gray-800' : 'text-gray-300'}>
                              {f[field] != null ? Number(f[field]).toFixed(6) : '—'}
                            </span>}
                      </td>
                    ))}

                    {/* 來源 */}
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input value={draft!.source_reference ?? ''} onChange={(e) => setDraft((d) => d && { ...d, source_reference: e.target.value || null })}
                            className="w-full border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-green-500 text-xs" />
                        : <span className="text-gray-600 text-xs">{f.source_reference ?? '—'}</span>}
                    </td>

                    {/* 廠區 */}
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => openAssign(f.id)}
                        className={`px-2 py-1 rounded-full text-xs font-medium transition ${count > 0 ? 'text-green-700 bg-green-50 hover:bg-green-100' : 'text-gray-400 bg-gray-100 hover:bg-gray-200'}`}>
                        {count > 0 ? `${count} 廠${countries ? ` (${countries})` : ''}` : '未指定'}
                      </button>
                    </td>

                    {/* 操作 */}
                    <td className="px-3 py-2 text-center">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(f.id)} disabled={saving}
                            className="px-2 py-1 rounded text-white text-xs hover:opacity-90 transition" style={{ backgroundColor: HEADER_BG }}>
                            {saving ? '…' : '儲存'}
                          </button>
                          <button onClick={() => { setEditingId(null); setDraft(null); }}
                            className="px-2 py-1 rounded border border-gray-300 text-xs hover:bg-gray-50 transition">取消</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => startEdit(f)}
                            className="px-2 py-1 rounded text-white text-xs hover:opacity-90 transition" style={{ backgroundColor: HEADER_BG }}>編輯</button>
                          <button onClick={() => deleteFactor(f.id)}
                            className="px-2 py-1 rounded border border-red-200 text-red-500 text-xs hover:bg-red-50 transition">刪除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">共 {filtered.length} 筆係數（全部 {factors.length} 筆）</p>
      </div>

      {/* 廠區指定面板 */}
      {assignFactorId && (() => {
        const f = factors.find((x) => x.id === assignFactorId);
        if (!f) return null;
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-800">廠區指定</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {f.source_code} {f.source_name_zh} — {f.country_code} {f.year}
                  </p>
                </div>
                <button onClick={() => setAssignFactorId(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              <div className="px-5 py-3 border-b border-gray-100 flex gap-3 items-center">
                <span className="text-xs text-gray-500">已選 {pendingIds.size} / {factories.length} 廠</span>
                <button onClick={selectAllFactories}
                  className="px-3 py-1 rounded-full text-xs font-medium text-white hover:opacity-90 transition" style={{ backgroundColor: HEADER_BG }}>
                  適用全部廠區
                </button>
                <button onClick={clearAllFactories}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-gray-300 hover:bg-gray-50 transition">清除全選</button>
              </div>

              <div className="overflow-y-auto flex-1 px-5 py-4">
                {Object.entries(groupedByCountry).map(([cc, facs]) => (
                  <div key={cc} className="mb-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{cc}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {facs.map((fac) => (
                        <label key={fac.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${pendingIds.has(fac.id) ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input type="checkbox" checked={pendingIds.has(fac.id)} onChange={() => toggleFactory(fac.id)}
                            className="accent-green-600" />
                          <span className="text-xs">
                            <span className="font-mono font-medium text-gray-700">{fac.factory_code}</span>
                            <span className="text-gray-400 ml-1">{fac.name_zh}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-5 py-4 border-t border-gray-100 flex gap-3 justify-end">
                <button onClick={() => setAssignFactorId(null)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 transition">取消</button>
                <button onClick={saveAssignments} disabled={assignSaving}
                  className="px-6 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition" style={{ backgroundColor: HEADER_BG }}>
                  {assignSaving ? '儲存中…' : '確認儲存'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

}

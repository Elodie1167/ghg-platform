'use client';

import { useState } from 'react';

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
  ncv: number | null;
  ncv_unit: string | null;
  density: number | null;
  density_unit: string | null;
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


export default function FactorsClient({ initialFactors, factories, emissionSources }: Props) {
  const [factors, setFactors] = useState<FactorRow[]>(initialFactors);
  const [scopeFilter, setScopeFilter] = useState<number | null>(null);
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [addSource, setAddSource] = useState('');
  const [addCountry, setAddCountry] = useState('TWN');
  const [addYear, setAddYear] = useState(2025);

  const [showCopyForm, setShowCopyForm] = useState(false);
  const [copyFromYear, setCopyFromYear] = useState(2025);
  const [copyToYear, setCopyToYear] = useState(2026);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');

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

  function deleteFactor(id: string) {
    if (!confirm('確定刪除此係數？相關廠區指定也會一併刪除。')) return;
    fetch(`/api/admin/factors/${id}`, { method: 'DELETE' }).then((res) => {
      if (res.ok) setFactors((prev) => prev.filter((f) => f.id !== id));
    });
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
        scope: src.scope, category: src.category,
        ncv: null, ncv_unit: null, density: null, density_unit: null,
        assigned_factory_ids: [],
      }, ...prev]);
    }
    setShowAddForm(false); setAddSource('');
  }

  async function copyYear() {
    if (copyFromYear >= copyToYear) { setCopyMsg('❌ 來源年度必須早於目標年度'); return; }
    const confirmed = window.confirm(
      `確定要將 ${copyFromYear} 年的所有係數複製到 ${copyToYear} 年？\n已存在的係數不會被覆蓋。`,
    );
    if (!confirmed) return;
    setCopying(true); setCopyMsg('');
    try {
      const res = await fetch('/api/admin/factors/copy-year', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_year: copyFromYear, to_year: copyToYear }),
      });
      const data = await res.json();
      if (!res.ok) { setCopyMsg(`❌ ${data.error}`); return; }
      const { copied, skipped } = data.data as { copied: number; skipped: number; from_year: number; to_year: number };
      setCopyMsg(`✅ 成功複製 ${copied} 筆，跳過已存在 ${skipped} 筆。請重新整理頁面查看 ${copyToYear} 年係數。`);
    } catch {
      setCopyMsg('❌ 發生錯誤，請重試');
    } finally {
      setCopying(false);
    }
  }

  async function copySingleFactor(f: FactorRow) {
    const toYear = f.year + 1;
    if (!confirm(`確定將「${f.source_code} ${f.source_name_zh}（${f.country_code}）」的 ${f.year} 年係數複製到 ${toYear} 年？`)) return;
    const res = await fetch(`/api/admin/factors/${f.id}/copy-to-next-year`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(`❌ ${data.error}`); return; }
    setFactors((prev) => [data.data as FactorRow, ...prev]);
  }

  function factoryCount(ids: string[]) {
    const countryCodes = new Set(factories.filter((f) => ids.includes(f.id)).map((f) => f.country_code));
    return { count: ids.length, label: ids.length > 0 ? `${ids.length} 廠 (${Array.from(countryCodes).join('/')})` : '未指定' };
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[1920px] mx-auto px-6 md:px-10 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">排放係數管理</h1>
            <p className="text-xs text-green-200 mt-0.5">點擊「細部設定」進入各排放源的係數詳細設定與廠區指定</p>
          </div>
          <a href="/" className="text-green-200 hover:text-white text-sm underline">← 返回填報</a>
        </div>
      </div>

      <div className="max-w-[1920px] mx-auto px-6 md:px-10 py-6">
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

          <div className="ml-auto flex gap-2">
            <a
              href={`/api/reports/factors${yearFilter != null ? `?year=${yearFilter}` : ''}`}
              className="px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition border flex items-center"
              style={{ borderColor: HEADER_BG, color: HEADER_BG }}
              title="匯出排放係數管理表（表4-2 範疇1及2、表4-3 範疇3）Excel"
            >
              ⬇ 匯出係數表{yearFilter != null ? `（${yearFilter}）` : ''}
            </a>
            <button onClick={() => { setShowCopyForm(!showCopyForm); setShowAddForm(false); }}
              className="px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition border"
              style={{ borderColor: HEADER_BG, color: HEADER_BG }}>
              複製係數到下一年
            </button>
            <button onClick={() => { setShowAddForm(!showAddForm); setShowCopyForm(false); }}
              className="px-4 py-1.5 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
              style={{ backgroundColor: HEADER_BG }}>
              + 新增係數
            </button>
          </div>
        </div>

        {/* 複製年度表單 */}
        {showCopyForm && (
          <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200 shadow-sm">
            <p className="text-sm font-semibold text-amber-800 mb-3">
              一鍵複製排放係數到新年度（已存在的係數不會被覆蓋）
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">來源年度</label>
                <input type="number" min="2020" max="2099" value={copyFromYear}
                  onChange={(e) => setCopyFromYear(Number(e.target.value))}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-24" />
              </div>
              <span className="text-gray-500 mb-1.5">→</span>
              <div>
                <label className="block text-xs text-gray-500 mb-1">目標年度</label>
                <input type="number" min="2021" max="2100" value={copyToYear}
                  onChange={(e) => setCopyToYear(Number(e.target.value))}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-24" />
              </div>
              <button onClick={copyYear} disabled={copying}
                className="px-4 py-1.5 rounded-lg text-white text-sm font-medium transition disabled:opacity-50"
                style={{ backgroundColor: '#b45309' }}>
                {copying ? '複製中…' : '確認複製'}
              </button>
              <button onClick={() => { setShowCopyForm(false); setCopyMsg(''); }}
                className="px-4 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 transition">
                取消
              </button>
            </div>
            {copyMsg && <p className="text-sm mt-3 text-gray-700">{copyMsg}</p>}
          </div>
        )}

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
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white text-xs">
                <th className="px-3 py-3 text-left w-12">S</th>
                <th className="px-3 py-3 text-left w-32">代碼</th>
                <th className="px-3 py-3 text-left">排放源名稱</th>
                <th className="px-3 py-3 text-center w-16">年度</th>
                <th className="px-3 py-3 text-center w-36">適用廠區</th>
                <th className="px-3 py-3 text-center w-56">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                    {factors.length === 0 ? '尚無係數資料，點擊「+ 新增係數」建立' : '篩選結果為空'}
                  </td>
                </tr>
              ) : filtered.map((f, idx) => {
                const { label } = factoryCount(f.assigned_factory_ids);
                const hasAssigned = f.assigned_factory_ids.length > 0;
                return (
                  <tr key={f.id} className={`border-b border-gray-100 hover:bg-green-50/30 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <td className="px-3 py-3 font-mono text-gray-400 text-xs">S{f.scope}</td>
                    <td className="px-3 py-3 font-mono text-gray-700 font-medium text-xs">{f.source_code}</td>
                    <td className="px-3 py-3 text-gray-800 text-xs">
                      {f.source_name_zh}
                      <span className="ml-1.5 font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{f.country_code}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-gray-600">{f.year}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${hasAssigned ? 'text-green-700 bg-green-50' : 'text-gray-400 bg-gray-100'}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        <a href={`/admin/factors/${f.id}`}
                          className="px-3 py-1 rounded text-white text-xs font-medium hover:opacity-90 transition"
                          style={{ backgroundColor: HEADER_BG }}>
                          細部設定
                        </a>
                        <button onClick={() => copySingleFactor(f)}
                          className="px-3 py-1 rounded border text-xs hover:bg-gray-50 transition"
                          style={{ borderColor: HEADER_BG, color: HEADER_BG }}
                          title={`複製這筆到 ${f.year + 1} 年`}>
                          複製到隔年
                        </button>
                        <button onClick={() => deleteFactor(f.id)}
                          className="px-3 py-1 rounded border border-red-200 text-red-500 text-xs hover:bg-red-50 transition">
                          刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">共 {filtered.length} 筆係數（全部 {factors.length} 筆）</p>
      </div>
    </div>
  );
}

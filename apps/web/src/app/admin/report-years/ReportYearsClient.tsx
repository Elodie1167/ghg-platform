'use client';

import { useState } from 'react';

const HEADER_BG = '#0C3D2E';

export interface ReportYearRow {
  year: number;
  is_active: boolean;
}

interface Props {
  initialYears: ReportYearRow[];
}

export default function ReportYearsClient({ initialYears }: Props) {
  const [years, setYears] = useState<ReportYearRow[]>(initialYears);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newYear, setNewYear] = useState<number>(
    (initialYears.length ? Math.max(...initialYears.map((y) => y.year)) : new Date().getFullYear()) + 1,
  );
  const [error, setError] = useState('');

  async function refresh() {
    const res = await fetch('/api/admin/report-years');
    const { data } = await res.json();
    if (Array.isArray(data)) setYears(data as ReportYearRow[]);
  }

  async function toggleActive(y: ReportYearRow) {
    const next = !y.is_active;
    if (!next && !confirm(
      `確定停用 ${y.year} 年？\n\n`
      + '停用後：不再出現在首頁與填報頁的年度選單。\n'
      + '已有的 ' + y.year + ' 年填報記錄與報表不受影響（不會被刪除或隱藏）。',
    )) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/report-years/${y.year}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '更新失敗'); return; }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addYear() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/report-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: newYear }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '新增失敗'); return; }
      setAdding(false);
      await refresh();
      setNewYear(newYear + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">盤查年度設定</h1>
            <p className="text-xs text-green-200 mt-0.5">
              在這裡新增或停用可填報的盤查年度。停用後不再出現在首頁與填報頁的年度選單，
              但既有該年度的填報記錄與報表照常保留。
            </p>
          </div>
          <a href="/" className="text-green-200 hover:text-white text-sm underline">← 返回首頁</a>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            新增年度後不需要改任何程式碼，首頁與填報頁的年度選單會立即出現該年度。
          </p>
          <button type="button" onClick={() => setAdding((v) => !v)} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: HEADER_BG }}>
            {adding ? '取消' : '+ 新增年度'}
          </button>
        </div>

        {adding && (
          <div className="mb-5 bg-white rounded-xl border border-gray-200 p-4 flex items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">年度</label>
              <input type="number" min="2000" max="2100" value={newYear}
                onChange={(e) => setNewYear(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-28" />
            </div>
            <button onClick={addYear} disabled={busy}
              className="px-4 py-1.5 rounded-lg text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              style={{ backgroundColor: HEADER_BG }}>
              確認新增
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white text-xs">
                <th className="px-4 py-3 text-left w-32">年度</th>
                <th className="px-4 py-3 text-left">狀態</th>
                <th className="px-4 py-3 text-center w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {years.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-gray-400 text-sm">
                    尚無年度資料，點擊「+ 新增年度」建立
                  </td>
                </tr>
              ) : years.map((y, idx) => (
                <tr key={y.year} className={`border-t border-gray-100 ${y.is_active ? '' : 'bg-gray-50 text-gray-400'} ${idx % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                  <td className="px-4 py-3 font-mono font-medium">{y.year} 年</td>
                  <td className="px-4 py-3">
                    {y.is_active
                      ? <span className="text-green-700 text-xs">啟用中</span>
                      : <span className="text-xs">已停用</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button type="button" onClick={() => toggleActive(y)} disabled={busy}
                      className="px-3 py-1 rounded border text-xs hover:bg-gray-50 transition disabled:opacity-50"
                      style={{ borderColor: HEADER_BG, color: HEADER_BG }}>
                      {y.is_active ? '停用' : '啟用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">共 {years.length} 個年度</p>
      </div>
    </div>
  );
}

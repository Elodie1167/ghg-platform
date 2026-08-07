'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AnnualMetric } from './page';

const HEADER_BG = '#0C3D2E';
const YEARS = [2023, 2024, 2025, 2026, 2027];

export default function DashboardClient({
  year, annualMetrics,
}: {
  year: number;
  annualMetrics: AnnualMetric[];
}) {
  const router = useRouter();
  const cur = annualMetrics.find((m) => m.year === year);
  const [stdUnits, setStdUnits] = useState(cur?.standard_units != null ? String(cur.standard_units) : '');
  const [revenue, setRevenue] = useState(cur?.revenue_thousands != null ? String(cur.revenue_thousands) : '');
  const [saveMsg, setSaveMsg] = useState('');

  async function saveMetrics() {
    setSaveMsg('儲存中…');
    try {
      const res = await fetch('/api/annual-metrics', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          standard_units: stdUnits === '' ? null : Number(stdUnits),
          revenue_thousands: revenue === '' ? null : Number(revenue),
        }),
      });
      if (!res.ok) throw new Error();
      setSaveMsg('✅ 已儲存');
      router.refresh();
      setTimeout(() => setSaveMsg(''), 2500);
    } catch { setSaveMsg('❌ 儲存失敗'); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
            <h1 className="text-xl font-bold mt-0.5">年度指標維護</h1>
            <p className="text-green-300 text-sm">標打產能／營業額｜圖表已搬至減碳績效儀表板</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/reduction" className="text-green-300 text-sm hover:underline">→ 減碳績效儀表板</a>
            <a href="/summary" className="text-green-300 text-sm hover:underline">明細彙整表 →</a>
            <span className="text-green-300 text-sm">年度</span>
            <select value={year} onChange={(e) => router.push(`/dashboard?year=${e.target.value}`)}
              className="bg-white/10 text-white border border-white/30 rounded-lg px-3 py-1.5 text-sm">
              {YEARS.map((y) => <option key={y} value={y} className="text-black">{y} 年</option>)}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-8">
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-1">{year} 年度指標（供排放強度計算）</h2>
          <p className="text-xs text-gray-400 mb-4">填入全集團當年度數值；排放強度 = (S1 + S2 市場) × 1000 ÷ 分母。1 標打 = 12 件。</p>
          <div className="flex flex-wrap items-end gap-5">
            <div>
              <label className="block text-xs text-gray-500 mb-1">標打產能（標打）</label>
              <input type="number" min="0" step="any" value={stdUnits} onChange={(e) => setStdUnits(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-52 focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">營業額（新臺幣千元）</label>
              <input type="number" min="0" step="any" value={revenue} onChange={(e) => setRevenue(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-52 focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <button onClick={saveMetrics}
              className="px-5 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
              style={{ backgroundColor: HEADER_BG }}>儲存</button>
            {saveMsg && <span className="text-xs text-gray-600">{saveMsg}</span>}
          </div>
        </section>
      </main>
    </div>
  );
}

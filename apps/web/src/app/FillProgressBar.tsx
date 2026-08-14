'use client';

import { useState } from 'react';
import type { FactoryFillProgress } from '@/lib/fill-progress';

function barColor(percent: number) {
  if (percent >= 100) return '#16a34a'; // 綠：完成
  if (percent > 0) return '#f59e0b'; // 琥珀：進行中
  return '#d1d5db'; // 灰：尚未開始
}

/** 廠卡片內嵌的填報進度條，hover 顯示缺項明細。 */
export default function FillProgressBar({ progress }: { progress: FactoryFillProgress }) {
  const [showDetail, setShowDetail] = useState(false);
  const { filled, required, percent, missing } = progress;

  return (
    <div
      className="relative mt-2"
      onMouseEnter={() => setShowDetail(true)}
      onMouseLeave={() => setShowDetail(false)}
    >
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-400">填報進度</span>
        <span className="font-mono font-semibold" style={{ color: barColor(percent) }}>
          {percent}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percent}%`, backgroundColor: barColor(percent) }}
        />
      </div>

      {showDetail && missing.length > 0 && (
        <div className="absolute z-30 left-0 top-full mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-3 text-xs text-gray-600">
          <div className="font-semibold text-gray-700 mb-1">還缺 {missing.length} 個排放源：</div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {missing.map((m) => (
              <li key={m.source_code}>
                {m.source_name}（{m.months.length} 月未填）
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

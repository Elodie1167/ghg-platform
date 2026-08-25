'use client';

import { useState } from 'react';
import type { FactoryFillProgress, MonthStatus } from '@/lib/fill-progress';

function barColor(percent: number) {
  if (percent >= 100) return '#16a34a'; // 綠：完成
  if (percent > 0) return '#f59e0b'; // 琥珀：進行中
  return '#d1d5db'; // 灰：尚未開始
}

function monthColor(status: MonthStatus) {
  switch (status) {
    case 'reviewed':
      return '#16a34a'; // 綠：已確認
    case 'filled':
      return '#f59e0b'; // 琥珀：已填未確認
    case 'partial':
      return '#fde68a'; // 淺琥珀：部分排放源已填
    case 'empty':
    default:
      return '#d1d5db'; // 灰：未填
  }
}

const MONTH_LABEL: Record<MonthStatus, string> = {
  reviewed: '已確認',
  filled: '已填未確認',
  partial: '部分已填',
  empty: '未填',
};

/** 廠卡片內嵌的填報進度：12格月份燈號 + 已確認百分比，hover 顯示缺項明細。 */
export default function FillProgressBar({ progress }: { progress: FactoryFillProgress }) {
  const [showDetail, setShowDetail] = useState(false);
  const { filled, reviewed, required, percent, monthlyStatus, missing } = progress;

  return (
    <div
      className="relative mt-2"
      onMouseEnter={() => setShowDetail(true)}
      onMouseLeave={() => setShowDetail(false)}
    >
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-400">填報進度（已確認）</span>
        <span className="font-mono font-semibold" style={{ color: barColor(percent) }}>
          {percent}%
        </span>
      </div>

      <div className="flex gap-0.5">
        {monthlyStatus.map((status, i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-sm"
            style={{ backgroundColor: monthColor(status) }}
            title={`${i + 1}月：${MONTH_LABEL[status]}`}
          />
        ))}
      </div>

      {showDetail && (
        <div className="absolute z-30 left-0 top-full mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-3 text-xs text-gray-600">
          <div className="text-gray-500 mb-2">
            已確認 {reviewed} / 已填 {filled} / 應填 {required}
          </div>
          {missing.length > 0 ? (
            <>
              <div className="font-semibold text-gray-700 mb-1">還缺 {missing.length} 個排放源：</div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {missing.map((m) => (
                  <li key={m.source_code}>
                    {m.source_name}
                    {m.months.length > 0 ? `（${m.months.length} 月未填）` : '（年度未填或未確認）'}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-gray-500">排放源皆已填，等待確認中。</div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

export interface HBarSegment {
  key: string;
  color: string;
  value: number;
}

export interface HBarRow {
  label: string;
  segments: HBarSegment[]; // 可堆疊（例如各產區依 S1/S2/S3 分段）
}

/** 水平堆疊長條圖，用於各產區排放當量 */
export default function HBarChart({ rows, unit }: { rows: HBarRow[]; unit?: string }) {
  const totals = rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0));
  const max = Math.max(1, ...totals);

  if (rows.length === 0) return <p className="text-sm text-gray-400 py-10 text-center">尚無資料可繪圖。</p>;

  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        const total = totals[i];
        return (
          <div key={r.label} className="flex items-center gap-3 text-xs">
            <div className="w-16 shrink-0 text-gray-700 font-medium text-right">{r.label}</div>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden flex">
              {r.segments.map((s) => (
                s.value > 0 && (
                  <div key={s.key} style={{ width: `${(s.value / max) * 100}%`, backgroundColor: s.color }} />
                )
              ))}
            </div>
            <div className="w-24 shrink-0 font-mono text-gray-700 text-right">
              {Math.round(total).toLocaleString()}{unit ? ` ${unit}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** 純手刻 SVG 甜甜圈圖，用於範疇占比 */
export default function DonutChart({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const size = 200, r = 80, cx = size / 2, cy = size / 2, strokeW = 34;
  const circumference = 2 * Math.PI * r;

  if (total <= 0) {
    return <p className="text-sm text-gray-400 py-10 text-center">尚無資料可繪圖。</p>;
  }

  let offsetAcc = 0;
  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="範疇占比甜甜圈圖">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {slices.filter((s) => s.value > 0).map((s, i) => {
            const frac = s.value / total;
            const dash = frac * circumference;
            const gap = circumference - dash;
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={strokeW}
                strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-offsetAcc} />
            );
            offsetAcc += dash;
            return el;
          })}
        </g>
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill="#0C3D2E">
          {Math.round(total).toLocaleString()}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#9ca3af">{centerLabel ?? 'tCO₂e'}</text>
      </svg>
      <div className="space-y-1.5 text-xs">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span style={{ backgroundColor: s.color }} className="inline-block w-3 h-3 rounded-sm" />
            <span className="text-gray-600">{s.label}</span>
            <span className="font-mono text-gray-800">{total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0'}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

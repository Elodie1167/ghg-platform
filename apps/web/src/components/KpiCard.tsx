import { HEADER_BG } from './theme';

/** 提自 reduction 頁原 Kpi，加上 disabled 狀態（給僅集團層級可算的指標用） */
export default function KpiCard({
  title, value, unit, sub, accent, valueClassName, disabled, disabledReason,
}: {
  title: string; value: string; unit?: string; sub?: string; accent?: boolean;
  valueClassName?: string; disabled?: boolean; disabledReason?: string;
}) {
  if (disabled) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <div className="text-xs text-gray-400">{title}</div>
        <div className="mt-1 text-lg font-semibold text-gray-400">—</div>
        <div className="text-[11px] text-gray-400 mt-1.5">{disabledReason ?? '目前篩選條件無法計算'}</div>
      </div>
    );
  }
  return (
    <div className={`rounded-xl border shadow-sm p-5 ${accent ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold font-mono ${valueClassName ?? ''}`}
          style={valueClassName ? undefined : { color: HEADER_BG }}>{value}</span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-gray-400 mt-1.5">{sub}</div>}
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG, MONTHS } from './tabTypes';
import type { ActivityRecord, EmissionSource, AssignedFactor } from './page';
import LineItemsCell from './LineItemsCell';

const FABRIC_CODE = '3-1-A';
const WATER_CODE = '3-1-E'; // 外購水（採購水資源）

const DERIVED_MAP: Record<string, string> = {
  '3-1-B': '線料',
  '3-1-C': '紙箱',
  '3-1-D': '塑料袋',
};

// DB month constraint 1-12；用 month=1 存年度彙總值
const ANNUAL_MONTH = 1;

function derivedTonTotal(existingRecords: ActivityRecord[], itemLabel: string): number {
  // Sum across all upstream records matching the item: new TW-/FC- prefixed format + legacy bare label
  return existingRecords
    .filter((r) => {
      if (!r.source_code?.startsWith('3-4')) return false;
      const sl = r.sub_location ?? '';
      return sl === itemLabel || sl === `TW-${itemLabel}` || sl === `FC-${itemLabel}`;
    })
    .reduce((s, r) => s + (r.meter_number != null ? Number(r.meter_number) : 0), 0);
}

interface AnnualRow {
  id: string | null;
  value: string;
  notes: string;
  co2e: number | null;
  is_reviewed: boolean;
  status: SaveStatus;
}

interface PurchaseTabProps extends TabProps {
  upstreamTons?: Record<string, number>;
}

export default function PurchaseTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, upstreamTons, assignedFactors, onReviewToggle,
}: PurchaseTabProps) {
  // 布料（3-1-A）：is_always_active，不需在 BasicTab 勾選，直接顯示
  const fabricSource = emissionSources.find(
    (s) => s.source_code === FABRIC_CODE,
  ) ?? null;

  // 線料/紙箱/塑料袋（3-1-B/C/D）：重量自動帶入，不需在 BasicTab 勾選
  const derivedSources = emissionSources
    .filter((s) => s.source_code in DERIVED_MAP)
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  // 外購水（3-1-E）：年度用水量 × 係數 → CO₂e
  const waterSource = emissionSources.find((s) => s.source_code === WATER_CODE) ?? null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">採購商品 S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">填入年度彙總數值；布料 CO₂e 直接來自 Higg MSI Excel，其他由上游運輸重量帶入</p>
      </div>

      {fabricSource && (
        <FabricRow
          key={fabricSource.id}
          sourceId={fabricSource.id}
          sourceName={fabricSource.name_zh}
          sourceCode={fabricSource.source_code}
          factory={factory}
          year={year}
          existingRec={existingRecords.find(
            (r) => r.emission_source_id === fabricSource.id && r.month === ANNUAL_MONTH
          ) ?? null}
          onReviewToggle={onReviewToggle}
        />
      )}

      {derivedSources.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            線料 / 紙箱 / 塑料袋（重量自動來自上游運輸年度合計）
          </h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                  <th className="px-4 py-2.5 text-left">採購品項</th>
                  <th className="px-4 py-2.5 text-right w-40">年度採購重量 (ton)</th>
                  <th className="px-4 py-2.5 text-right w-32">CO₂e (t)</th>
                  <th className="px-4 py-2.5 text-center w-16">查核</th>
                </tr>
              </thead>
              <tbody>
                {derivedSources.map((src, idx) => {
                  const label = DERIVED_MAP[src.source_code];
                  const ton = upstreamTons?.[label] ?? derivedTonTotal(existingRecords, label);
                  return (
                    <DerivedRow
                      key={src.id}
                      idx={idx}
                      source={src}
                      ton={ton}
                      factory={factory}
                      year={year}
                      existingRec={existingRecords.find(
                        (r) => r.emission_source_id === src.id && r.month === ANNUAL_MONTH
                      ) ?? null}
                      onReviewToggle={onReviewToggle}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {waterSource && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            外購水（每月用水量 × 係數）
          </h3>
          <WaterMonthly
            source={waterSource}
            factory={factory}
            year={year}
            records={existingRecords.filter((r) => r.emission_source_id === waterSource.id)}
            assignedFactor={assignedFactors?.find((f) => f.emission_source_id === waterSource.id)}
            onReviewToggle={onReviewToggle}
          />
          <p className="text-xs text-gray-400 mt-2">
            逐月填入用水量（或以 ERP 範本匯入，多筆單據會自動加總；點「明細」查看單據），
            CO₂e 由「外購水」係數自動計算。需先於
            <a href="/admin/factors" className="underline mx-0.5">係數設定</a>
            建立並指派 3-1-E 的排放係數（範疇三，kg CO₂e/m³）。
          </p>
        </div>
      )}
    </div>
  );
}

// 外購水（3-1-E）逐月用水量表：版面比照其他月度來源（電力／固定燃燒），
// 每月一列用量，多筆單據以「明細」下鑽；CO₂e = 用量 × scope3_factor ÷ 1000 即時計算。
function WaterMonthly({
  source, factory, year, records, assignedFactor, onReviewToggle,
}: {
  source: EmissionSource;
  factory: TabProps['factory'];
  year: number;
  records: ActivityRecord[];
  assignedFactor?: AssignedFactor;
  onReviewToggle?: (id: string, newVal: boolean) => void;
}) {
  const unit = source.default_unit ?? 'm3';
  const scope3 = assignedFactor?.scope3_factor ?? null;
  // 範疇三：CO₂e(t) = 用量 × scope3_factor(kg/單位) ÷ 1000
  const rowCo2e = (v: number): number | null =>
    scope3 != null && v > 0 ? parseFloat((v * Number(scope3) / 1000).toFixed(4)) : null;

  const [lv, setLv] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const r of records) init[r.month] = r.activity_value != null ? String(r.activity_value) : '';
    return init;
  });
  const lvRef = useRef(lv);
  const [recordIds, setRecordIds] = useState<Record<number, string | null>>(() => {
    const init: Record<number, string | null> = {};
    for (const r of records) init[r.month] = r.id;
    return init;
  });
  const [reviewed, setReviewed] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    for (const r of records) init[r.month] = r.is_reviewed ?? false;
    return init;
  });
  const [status, setStatus] = useState<SaveStatus>('idle');
  const tmr = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggleSelect(month: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === MONTHS.length ? new Set() : new Set(MONTHS)));
  }

  function targetMonths() {
    return selected.size > 0 ? MONTHS.filter((m) => selected.has(m)) : MONTHS;
  }

  async function bulkReview() {
    const targets = targetMonths().filter((m) => !!recordIds[m] && !(reviewed[m] ?? false));
    await Promise.all(targets.map((m) => toggleReview(m)));
    setSelected(new Set());
  }

  async function bulkClear() {
    const candidates = targetMonths();
    const targets = candidates.filter((m) => !!recordIds[m] && !(reviewed[m] ?? false));
    if (targets.length === 0) {
      if (candidates.some((m) => reviewed[m])) {
        alert('所選月份都已查核，無法清空，請先取消查核再清空。');
      }
      setSelected(new Set());
      return;
    }
    if (!confirm(`確定要清空 ${targets.length} 個尚未查核月份的數值？`)) return;
    await Promise.all(targets.map((m) => clearMonth(m)));
    setSelected(new Set());
  }

  // 月 → 單據明細筆數（>0 表該月為多張單據加總，顯示「查看明細」）
  const liCountByMonth: Record<number, number> = {};
  for (const r of records) liCountByMonth[r.month] = r.line_items_count ?? 0;

  function onChange(month: number, val: string) {
    const next = { ...lvRef.current, [month]: val };
    lvRef.current = next;
    setLv(next);
    if (tmr.current) clearTimeout(tmr.current);
    tmr.current = setTimeout(async () => {
      const v = lvRef.current[month];
      const num = v === '' ? null : parseFloat(v);
      if (v !== '' && (num === null || isNaN(num))) return;
      setStatus('saving');
      try {
        const res = await fetch('/api/records/autosave', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            factory_id: factory.id, emission_source_id: source.id, year, month,
            activity_value: num, activity_unit: unit,
          }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setRecordIds((prev) => ({ ...prev, [month]: data.data.id }));
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } catch { setStatus('error'); }
    }, 1000);
  }

  // 清空某月（activity_value→null，後端一併清 co2e）
  async function clearMonth(month: number) {
    const id = recordIds[month];
    const next = { ...lvRef.current, [month]: '' };
    lvRef.current = next; setLv(next);
    if (!id) return;
    setStatus('saving');
    try {
      const res = await fetch(`/api/records/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_value: null }),
      });
      if (!res.ok) throw new Error();
      setStatus('saved'); setTimeout(() => setStatus('idle'), 2000);
    } catch { setStatus('error'); }
  }

  async function toggleReview(month: number) {
    const id = recordIds[month];
    if (!id) return;
    const newVal = !(reviewed[month] ?? false);
    setReviewed((prev) => ({ ...prev, [month]: newVal }));
    await fetch(`/api/records/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    if (onReviewToggle) onReviewToggle(id, newVal);
  }

  const total = MONTHS.reduce((s, m) => s + (parseFloat(lv[m] ?? '') || 0), 0);
  const totalCo2e = rowCo2e(total) ?? 0;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          {status !== 'idle' && (
            <span className={`text-xs ${status === 'saving' ? 'text-yellow-500' : status === 'saved' ? 'text-green-600' : 'text-red-500'}`}>
              {status === 'saving' ? '⏳ 儲存中' : status === 'saved' ? '✅ 已儲存' : '❌ 失敗'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={bulkReview}
            className="px-3 py-1.5 rounded-lg border border-green-700 text-green-700 text-xs font-medium transition hover:bg-green-50">
            全選查核
          </button>
          <button onClick={bulkClear}
            className="px-3 py-1.5 rounded-lg border border-red-400 text-red-500 text-xs font-medium transition hover:bg-red-50">
            全選清空
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
              <th className="px-2 py-2 text-center w-8">
                <input type="checkbox"
                  checked={selected.size === MONTHS.length}
                  onChange={toggleSelectAll} />
              </th>
              <th className="px-4 py-2 text-left w-16">月份</th>
              <th className="px-4 py-2 text-right w-44">用水量 ({unit})</th>
              <th className="px-4 py-2 text-right w-28">CO₂e (t)</th>
              <th className="px-3 py-2 text-center w-16">明細</th>
              <th className="px-4 py-2 text-center w-16">查核</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m) => {
              const rec = records.find((r) => r.month === m);
              const val = lv[m] ?? (rec?.activity_value != null ? String(rec.activity_value) : '');
              const hasId = !!recordIds[m];
              const isRev = reviewed[m] ?? false;
              const co2e = rowCo2e(parseFloat(val) || 0);
              return (
                <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={selected.has(m)} onChange={() => toggleSelect(m)} />
                  </td>
                  <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                  <td className="px-4 py-1.5">
                    <input type="number" min="0" step="any" placeholder="輸入用水量"
                      value={val}
                      onChange={(e) => onChange(m, e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </td>
                  <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono">
                    {co2e?.toFixed(4) ?? ((parseFloat(val) || 0) > 0 && rec?.co2e_total != null ? rec.co2e_total.toFixed(4) : '—')}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <LineItemsCell recordId={recordIds[m] ?? null} count={liCountByMonth[m] ?? 0}
                      title={`${source.name_zh} ${m} 月`} unit={unit} sourceCode={source.source_code} />
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <button onClick={() => toggleReview(m)} disabled={!hasId}
                      title={isRev ? '已查核（點擊取消）' : '點擊標記查核完成'}
                      className={`text-base leading-none transition-all ${isRev ? 'text-green-500' : 'text-gray-300'} ${!hasId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                      {isRev ? '✅' : '⬜'}
                    </button>
                    <button onClick={() => clearMonth(m)} disabled={!hasId || isRev}
                      title={isRev ? '已查核不可清空，請先取消查核' : '清空此月數值'}
                      className={`ml-1.5 text-sm leading-none transition ${!hasId || isRev ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
              <td />
              <td className="px-4 py-2 text-gray-700">合計</td>
              <td className="px-4 py-2 text-right font-mono text-gray-700">
                {total.toLocaleString(undefined, { maximumFractionDigits: 10 })} {unit}
              </td>
              <td className="px-4 py-2 text-right font-mono text-gray-700">
                {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// 線料/紙箱/塑料袋（3-1-B/C/D）：重量唯讀來自上游運輸，重量變動時自動同步 activity_value
// 觸發後端依已指派的 scope3_factor 計算 CO₂e（需先於 /admin/factors 指派該廠係數）。
function DerivedRow({
  idx, source, ton, factory, year, existingRec, onReviewToggle,
}: {
  idx: number;
  source: EmissionSource;
  ton: number;
  factory: TabProps['factory'];
  year: number;
  existingRec: ActivityRecord | null;
  onReviewToggle?: TabProps['onReviewToggle'];
}) {
  const [recordId, setRecordId] = useState<string | null>(existingRec?.id ?? null);
  const [co2e, setCo2e] = useState<number | null>(existingRec?.co2e_total ?? null);
  const [isReviewed, setIsReviewed] = useState<boolean>(existingRec?.is_reviewed ?? false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const savedTonRef = useRef<number | null>(existingRec?.activity_value ?? null);
  const recordIdRef = useRef(recordId);
  useEffect(() => { recordIdRef.current = recordId; }, [recordId]);
  // 序列化儲存：避免 ton 短時間內連續變動時，前一筆還沒回應（尚無 id）
  // 下一筆又送出，兩者都判定「無 id」各自 POST，造成同一排放源重複建立紀錄。
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // 重量與上次存檔一致就不重複寫入（避免每次渲染都打 API）
    if (savedTonRef.current === ton) return;
    savedTonRef.current = ton;
    if (ton <= 0 && !recordIdRef.current) return; // 從未存過且無重量，不建立空紀錄

    const runSave = async () => {
      // 係數（UK Government）單位為 kg CO2e/公噸，故直接存「公噸」數值，
      // activity_unit 用不在 UNIT_CONV 換算表裡的字串，避免被誤乘 1000 轉成公斤。
      const payload = {
        factory_id: factory.id,
        emission_source_id: source.id,
        year,
        month: ANNUAL_MONTH,
        activity_value: ton > 0 ? ton : null,
        activity_unit: 'tonne-material',
      };
      setStatus('saving');
      try {
        const url = recordIdRef.current ? `/api/records/${recordIdRef.current}` : '/api/records';
        const res = await fetch(url, {
          method: recordIdRef.current ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        recordIdRef.current = data.data.id;
        setRecordId(data.data.id);
        setCo2e(data.data.co2e_total ?? null);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
      }
    };
    saveChainRef.current = saveChainRef.current.then(runSave, runSave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ton]);

  async function toggleReview() {
    if (!recordId) return;
    const newVal = !isReviewed;
    setIsReviewed(newVal);
    await fetch(`/api/records/${recordId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    onReviewToggle?.(recordId, newVal);
  }

  return (
    <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className="px-4 py-2">
        <div className="font-medium text-gray-800">{source.name_zh}</div>
        <div className="text-xs font-mono text-gray-400">{source.source_code}</div>
        <div className="text-xs text-gray-400 mt-0.5">重量由上游運輸帶入（唯讀）</div>
      </td>
      <td className="px-4 py-2 text-right font-mono text-gray-700">
        {ton > 0 ? ton.toLocaleString(undefined, { maximumFractionDigits: 10 }) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-2 text-right font-mono text-gray-700 text-xs">
        {status === 'saving' && '⏳ '}
        {co2e != null ? co2e.toFixed(4) : (ton > 0
          ? <span className="text-amber-600" title="需先於 /admin/factors 指派此排放源的範疇三係數">尚未指派係數</span>
          : '—')}
      </td>
      <td className="px-4 py-2 text-center">
        <button onClick={toggleReview} disabled={!recordId}
          title={isReviewed ? '已查核（點擊取消）' : recordId ? '點擊標記查核' : '請先有重量資料'}
          className={`text-sm leading-none transition-all shrink-0
            ${isReviewed ? 'text-green-500' : 'text-gray-300'}
            ${!recordId ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
          {isReviewed ? '✅' : '⬜'}
        </button>
      </td>
    </tr>
  );
}

function FabricRow({
  sourceId, sourceName, sourceCode, factory, year, existingRec, onReviewToggle,
}: {
  sourceId: string;
  sourceName: string;
  sourceCode: string;
  factory: TabProps['factory'];
  year: number;
  existingRec: ActivityRecord | null;
  onReviewToggle?: TabProps['onReviewToggle'];
}) {
  const [row, setRow] = useState<AnnualRow>({
    id: existingRec?.id ?? null,
    value: existingRec?.activity_value != null ? String(existingRec.activity_value) : '',
    notes: existingRec?.notes ?? '',
    co2e: existingRec?.co2e_total ?? null,
    is_reviewed: existingRec?.is_reviewed ?? false,
    status: 'idle',
  });
  const rowRef = useRef(row);
  const tmr = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(field: 'value' | 'notes', val: string) {
    const next = { ...rowRef.current, [field]: val };
    rowRef.current = next;
    setRow(next);
    if (tmr.current) clearTimeout(tmr.current);
    tmr.current = setTimeout(async () => {
      const r = rowRef.current;
      const numVal = r.value !== '' ? parseFloat(r.value) : null;
      if (r.value !== '' && (numVal === null || isNaN(numVal))) return;
      const saving = { ...rowRef.current, status: 'saving' as SaveStatus };
      rowRef.current = saving;
      setRow(saving);
      try {
        const res = await fetch('/api/records/autosave', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            factory_id: factory.id, emission_source_id: sourceId, year, month: ANNUAL_MONTH,
            activity_value: numVal, activity_unit: 'tCO2e', notes: r.notes || null,
          }),
        });
        if (!res.ok) throw new Error();
        const saved = { ...rowRef.current, status: 'saved' as SaveStatus };
        rowRef.current = saved;
        setRow(saved);
        setTimeout(() => {
          const reset = { ...rowRef.current, status: 'idle' as SaveStatus };
          rowRef.current = reset;
          setRow(reset);
        }, 2000);
      } catch {
        const err = { ...rowRef.current, status: 'error' as SaveStatus };
        rowRef.current = err;
        setRow(err);
      }
    }, 1000);
  }

  async function clearRow() {
    const id = rowRef.current.id;
    const cleared = { ...rowRef.current, value: '', notes: '', co2e: null };
    rowRef.current = cleared; setRow(cleared);
    if (!id) return;
    try {
      await fetch(`/api/records/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_value: null, notes: null }),
      });
    } catch { /* 忽略；畫面已清 */ }
  }

  async function toggleReview() {
    const id = rowRef.current.id;
    if (!id) return;
    const newVal = !rowRef.current.is_reviewed;
    const next = { ...rowRef.current, is_reviewed: newVal };
    rowRef.current = next; setRow(next);
    await fetch(`/api/records/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    onReviewToggle?.(id, newVal);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 max-w-2xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="px-4 py-2.5 text-left">採購品項</th>
            <th className="px-4 py-2.5 text-right w-48">年度 CO₂e 總量 (tCO₂e)</th>
            <th className="px-4 py-2.5 text-left w-44">備註</th>
            <th className="px-4 py-2.5 text-center w-16">查核</th>
            <th className="px-4 py-2.5 text-center w-8">狀</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-white">
            <td className="px-4 py-2">
              <div className="font-medium text-gray-800">{sourceName}</div>
              <div className="text-xs font-mono text-gray-400">{sourceCode}</div>
              <div className="text-xs text-blue-600 mt-0.5">來自 Higg MSI Excel 計算結果</div>
            </td>
            <td className="px-4 py-2">
              <input
                type="number" min="0" step="0.0001"
                placeholder="從 Higg MSI Excel 填入"
                value={row.value}
                onChange={(e) => onChange('value', e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </td>
            <td className="px-4 py-2">
              <input
                type="text" placeholder="備註"
                value={row.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </td>
            <td className="px-4 py-2 text-center">
              <button onClick={toggleReview} disabled={!row.id}
                title={row.is_reviewed ? '已查核（點擊取消）' : row.id ? '點擊標記查核' : '請先儲存資料'}
                className={`text-sm leading-none transition-all shrink-0
                  ${row.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                  ${!row.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                {row.is_reviewed ? '✅' : '⬜'}
              </button>
            </td>
            <td className="px-4 py-2 text-center text-xs whitespace-nowrap">
              {row.status === 'saving' && '⏳'}
              {row.status === 'saved' && '✅'}
              {row.status === 'error' && '❌'}
              <button onClick={clearRow} disabled={!row.id}
                title="清空數值"
                className={`ml-1 text-sm leading-none transition ${!row.id ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                ✕
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

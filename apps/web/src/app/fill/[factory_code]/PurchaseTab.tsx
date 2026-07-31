'use client';

import { useState, useRef } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG } from './tabTypes';
import type { ActivityRecord } from './page';
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
  status: SaveStatus;
}

interface PurchaseTabProps extends TabProps {
  upstreamTons?: Record<string, number>;
}

export default function PurchaseTab({
  factory, year, emissionSources, selectedSourceIds, existingRecords, upstreamTons,
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
                </tr>
              </thead>
              <tbody>
                {derivedSources.map((src, idx) => {
                  const label = DERIVED_MAP[src.source_code];
                  const ton = upstreamTons?.[label] ?? derivedTonTotal(existingRecords, label);
                  return (
                    <tr key={src.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800">{src.name_zh}</div>
                        <div className="text-xs font-mono text-gray-400">{src.source_code}</div>
                        <div className="text-xs text-gray-400 mt-0.5">重量由上游運輸帶入（唯讀）</div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">
                        {ton > 0 ? ton.toLocaleString(undefined, { maximumFractionDigits: 10 }) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">計算引擎建置中</td>
                    </tr>
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
            外購水（年度用水量 × 係數）
          </h3>
          <WaterRow
            sourceId={waterSource.id}
            sourceName={waterSource.name_zh}
            sourceCode={waterSource.source_code}
            unit={waterSource.default_unit ?? 'm3'}
            factory={factory}
            year={year}
            existingRec={existingRecords.find(
              (r) => r.emission_source_id === waterSource.id && r.month === ANNUAL_MONTH
            ) ?? null}
            lineItemsCount={existingRecords.find(
              (r) => r.emission_source_id === waterSource.id && r.month === ANNUAL_MONTH
            )?.line_items_count ?? 0}
          />
          <p className="text-xs text-gray-400 mt-2">
            填年度總用水量，CO₂e 由「外購水」係數自動計算。需先於
            <a href="/admin/factors" className="underline mx-0.5">係數設定</a>
            建立並指派 3-1-E 的排放係數（範疇三，kg CO₂e/m³）。
          </p>
        </div>
      )}
    </div>
  );
}

function WaterRow({
  sourceId, sourceName, sourceCode, unit, factory, year, existingRec, lineItemsCount,
}: {
  sourceId: string;
  sourceName: string;
  sourceCode: string;
  unit: string;
  factory: TabProps['factory'];
  year: number;
  existingRec: ActivityRecord | null;
  lineItemsCount: number;
}) {
  const [row, setRow] = useState<AnnualRow>({
    id: existingRec?.id ?? null,
    value: existingRec?.activity_value != null ? String(existingRec.activity_value) : '',
    notes: existingRec?.notes ?? '',
    co2e: existingRec?.co2e_total ?? null,
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
      rowRef.current = saving; setRow(saving);
      try {
        const res = await fetch('/api/records/autosave', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            factory_id: factory.id, emission_source_id: sourceId, year, month: ANNUAL_MONTH,
            activity_value: numVal, activity_unit: unit, notes: r.notes || null,
          }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const saved = {
          ...rowRef.current,
          id: data.data?.id ?? rowRef.current.id,
          co2e: data.data?.co2e_total ?? null,
          status: 'saved' as SaveStatus,
        };
        rowRef.current = saved; setRow(saved);
        setTimeout(() => {
          const reset = { ...rowRef.current, status: 'idle' as SaveStatus };
          rowRef.current = reset; setRow(reset);
        }, 2000);
      } catch {
        const err = { ...rowRef.current, status: 'error' as SaveStatus };
        rowRef.current = err; setRow(err);
      }
    }, 1000);
  }

  // 清空（activity_value→null，後端一併清 co2e）
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

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 max-w-2xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="px-4 py-2.5 text-left">採購品項</th>
            <th className="px-4 py-2.5 text-right w-44">年度用水量 ({unit})</th>
            <th className="px-4 py-2.5 text-right w-28">CO₂e (t)</th>
            <th className="px-4 py-2.5 text-left w-40">備註</th>
            <th className="px-4 py-2.5 text-center w-16">明細</th>
            <th className="px-4 py-2.5 text-center w-8">狀</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-white">
            <td className="px-4 py-2">
              <div className="font-medium text-gray-800">{sourceName}</div>
              <div className="text-xs font-mono text-gray-400">{sourceCode}</div>
            </td>
            <td className="px-4 py-2">
              <input
                type="number" min="0" step="any" placeholder={`年度總用水量 (${unit})`}
                value={row.value}
                onChange={(e) => onChange('value', e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </td>
            <td className="px-4 py-2 text-right font-mono text-gray-600 text-xs">
              {row.co2e != null ? row.co2e.toFixed(4) : '—'}
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
              <LineItemsCell recordId={row.id} count={lineItemsCount}
                title={`${sourceName} 年度`} unit={unit} sourceCode={sourceCode} />
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

function FabricRow({
  sourceId, sourceName, sourceCode, factory, year, existingRec,
}: {
  sourceId: string;
  sourceName: string;
  sourceCode: string;
  factory: TabProps['factory'];
  year: number;
  existingRec: ActivityRecord | null;
}) {
  const [row, setRow] = useState<AnnualRow>({
    id: existingRec?.id ?? null,
    value: existingRec?.activity_value != null ? String(existingRec.activity_value) : '',
    notes: existingRec?.notes ?? '',
    co2e: existingRec?.co2e_total ?? null,
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

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 max-w-2xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
            <th className="px-4 py-2.5 text-left">採購品項</th>
            <th className="px-4 py-2.5 text-right w-48">年度 CO₂e 總量 (tCO₂e)</th>
            <th className="px-4 py-2.5 text-left w-44">備註</th>
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

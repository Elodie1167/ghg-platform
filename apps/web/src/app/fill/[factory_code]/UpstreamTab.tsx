'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG } from './tabTypes';
import type { EmissionSource, ActivityRecord } from './page';

const ITEMS = ['布料', '線料', '紙箱', '塑料袋'] as const;
type ItemCode = typeof ITEMS[number];

const SUPPLY_TYPES = [
  { key: 'TW', label: '台灣供貨' },
  { key: 'FC', label: '工廠供貨' },
] as const;
type SupplyType = typeof SUPPLY_TYPES[number]['key'];

const TRANSPORT_CODES = ['3-4-A', '3-4-B', '3-4-C'] as const;
const TRANSPORT_LABEL: Record<string, string> = {
  '3-4-A': '陸運',
  '3-4-B': '海運',
  '3-4-C': '空運',
};

const ANNUAL_MONTH = 1;

interface CellState {
  id: string | null;
  value: string;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}
const EMPTY_CELL: CellState = { id: null, value: '', is_reviewed: false, saveStatus: 'idle' };

// TKM key: `${sourceId}-${supply}`（依運輸方式加總，不分品項）
// 重量 key: `${supply}-${item}`（依品項加總，不分運輸方式）
type CellKey = string;

interface UpstreamTabProps extends TabProps {
  onTonsChange?: (tons: Record<string, number>) => void;
}

export default function UpstreamTab({
  factory, year, emissionSources, existingRecords, onTonsChange, onReviewToggle,
}: UpstreamTabProps) {
  const transportSources = emissionSources
    .filter((s) => TRANSPORT_CODES.includes(s.source_code as typeof TRANSPORT_CODES[number]))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));
  // 重量與運輸方式無關，固定掛在排序後第一個運輸排放源下（僅供資料庫外鍵用途，不影響計算）
  const weightAnchorSourceId = transportSources[0]?.id ?? null;

  const initCells = useCallback((): { tkm: Map<CellKey, CellState>; weight: Map<CellKey, CellState> } => {
    const tkm = new Map<CellKey, CellState>();
    const weight = new Map<CellKey, CellState>();
    for (const r of existingRecords) {
      if (!r.source_code?.startsWith('3-4')) continue;
      if (r.month !== ANNUAL_MONTH) continue;
      const sl = r.sub_location ?? '';

      // 新格式：TKM 彙總列，sub_location 直接是 "TW" / "FC"
      if (sl === 'TW' || sl === 'FC') {
        tkm.set(`${r.emission_source_id}-${sl}`, {
          id: r.id,
          value: r.activity_value != null ? String(r.activity_value) : '',
          is_reviewed: r.is_reviewed ?? false,
          saveStatus: 'idle',
        });
        continue;
      }

      // 新格式／舊格式：重量列，sub_location 為 "TW-布料" / "FC-布料"，舊資料可能無前綴
      let supply: SupplyType | null = null;
      let itemCode: ItemCode | null = null;
      if (sl.startsWith('TW-')) { supply = 'TW'; itemCode = sl.slice(3) as ItemCode; }
      else if (sl.startsWith('FC-')) { supply = 'FC'; itemCode = sl.slice(3) as ItemCode; }
      else if (ITEMS.includes(sl as ItemCode)) { supply = 'TW'; itemCode = sl as ItemCode; }
      if (!supply || !itemCode || !ITEMS.includes(itemCode)) continue;

      const key = `${supply}-${itemCode}`;
      const existing = weight.get(key);
      const tonNum = r.meter_number != null ? parseFloat(r.meter_number) : 0;
      if (existing) {
        // 舊資料可能拆在多個運輸方式列下：加總顯示，但只保留一筆作為儲存目標（優先選錨點排放源那一筆）
        const preferThis = r.emission_source_id === weightAnchorSourceId && existing.id !== r.id;
        weight.set(key, {
          id: preferThis || !existing.id ? r.id : existing.id,
          value: String((parseFloat(existing.value) || 0) + (isNaN(tonNum) ? 0 : tonNum)),
          is_reviewed: existing.is_reviewed || (r.is_reviewed ?? false),
          saveStatus: 'idle',
        });
      } else {
        weight.set(key, {
          id: r.id,
          value: r.meter_number != null ? String(r.meter_number) : '',
          is_reviewed: r.is_reviewed ?? false,
          saveStatus: 'idle',
        });
      }
    }
    return { tkm, weight };
  }, [existingRecords, weightAnchorSourceId]);

  const [{ tkm: tkmCells, weight: weightCells }, setCellState] = useState(initCells);
  const tkmRef = useRef(tkmCells);
  const weightRef = useRef(weightCells);
  useEffect(() => { tkmRef.current = tkmCells; }, [tkmCells]);
  useEffect(() => { weightRef.current = weightCells; }, [weightCells]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getTkmCell(sourceId: string, supply: SupplyType): CellState {
    return tkmRef.current.get(`${sourceId}-${supply}`) ?? EMPTY_CELL;
  }
  function getWeightCell(supply: SupplyType, item: ItemCode): CellState {
    return weightRef.current.get(`${supply}-${item}`) ?? EMPTY_CELL;
  }

  function updateTkm(sourceId: string, supply: SupplyType, value: string) {
    const key = `${sourceId}-${supply}`;
    const prev = tkmRef.current.get(key) ?? EMPTY_CELL;
    const next = new Map(tkmRef.current);
    next.set(key, { ...prev, value, saveStatus: 'saving' });
    tkmRef.current = next;
    setCellState((s) => ({ ...s, tkm: next }));
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => saveTkm(sourceId, supply), 1000);
  }

  function updateWeight(supply: SupplyType, item: ItemCode, value: string) {
    const key = `${supply}-${item}`;
    const prev = weightRef.current.get(key) ?? EMPTY_CELL;
    const next = new Map(weightRef.current);
    next.set(key, { ...prev, value, saveStatus: 'saving' });
    weightRef.current = next;
    setCellState((s) => ({ ...s, weight: next }));
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => saveWeight(supply, item), 1000);
  }

  async function saveTkm(sourceId: string, supply: SupplyType) {
    const key = `${sourceId}-${supply}`;
    const cell = tkmRef.current.get(key);
    if (!cell) return;
    const num = cell.value !== '' ? parseFloat(cell.value) : null;

    const payload = {
      factory_id: factory.id,
      emission_source_id: sourceId,
      year,
      month: ANNUAL_MONTH,
      activity_value: num != null && !isNaN(num) ? num : null,
      activity_unit: 'tonne-km',
      sub_location: supply,
      meter_number: null,
    };

    try {
      if (cell.id) {
        const res = await fetch(`/api/records/${cell.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const nextMap = new Map(tkmRef.current);
        const cur = nextMap.get(key);
        if (cur) nextMap.set(key, { ...cur, id: data.data.id });
        tkmRef.current = nextMap;
        setCellState((s) => ({ ...s, tkm: nextMap }));
      }
      markSaved(key, 'tkm');
    } catch {
      markError(key, 'tkm');
    }
  }

  async function saveWeight(supply: SupplyType, item: ItemCode) {
    const key = `${supply}-${item}`;
    const cell = weightRef.current.get(key);
    if (!cell || !weightAnchorSourceId) return;
    const num = cell.value !== '' ? parseFloat(cell.value) : null;

    const payload = {
      factory_id: factory.id,
      emission_source_id: weightAnchorSourceId,
      year,
      month: ANNUAL_MONTH,
      activity_value: null,
      activity_unit: 'ton',
      sub_location: `${supply}-${item}`,
      meter_number: num != null && !isNaN(num) ? String(num) : null,
    };

    try {
      if (cell.id) {
        const res = await fetch(`/api/records/${cell.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const nextMap = new Map(weightRef.current);
        const cur = nextMap.get(key);
        if (cur) nextMap.set(key, { ...cur, id: data.data.id });
        weightRef.current = nextMap;
        setCellState((s) => ({ ...s, weight: nextMap }));
      }
      markSaved(key, 'weight');
      onTonsChange?.(computeItemTotals());
    } catch {
      markError(key, 'weight');
    }
  }

  function markSaved(key: string, which: 'tkm' | 'weight') {
    const ref = which === 'tkm' ? tkmRef : weightRef;
    const saved = new Map(ref.current);
    const cur = saved.get(key);
    if (cur) saved.set(key, { ...cur, saveStatus: 'saved' });
    ref.current = saved;
    setCellState((s) => ({ ...s, [which]: saved }));
    setTimeout(() => {
      const reset = new Map(ref.current);
      const c = reset.get(key);
      if (c && c.saveStatus === 'saved') reset.set(key, { ...c, saveStatus: 'idle' });
      ref.current = reset;
      setCellState((s) => ({ ...s, [which]: reset }));
    }, 2000);
  }

  function markError(key: string, which: 'tkm' | 'weight') {
    const ref = which === 'tkm' ? tkmRef : weightRef;
    const err = new Map(ref.current);
    const c = err.get(key);
    if (c) err.set(key, { ...c, saveStatus: 'error' });
    ref.current = err;
    setCellState((s) => ({ ...s, [which]: err }));
  }

  async function toggleTkmReview(sourceId: string, supply: SupplyType) {
    const key = `${sourceId}-${supply}`;
    const cell = tkmRef.current.get(key);
    if (!cell?.id) return;
    const newVal = !cell.is_reviewed;
    const next = new Map(tkmRef.current);
    next.set(key, { ...cell, is_reviewed: newVal });
    tkmRef.current = next;
    setCellState((s) => ({ ...s, tkm: next }));
    await fetch(`/api/records/${cell.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    onReviewToggle?.(cell.id, newVal);
  }

  async function toggleWeightReview(supply: SupplyType, item: ItemCode) {
    const key = `${supply}-${item}`;
    const cell = weightRef.current.get(key);
    if (!cell?.id) return;
    const newVal = !cell.is_reviewed;
    const next = new Map(weightRef.current);
    next.set(key, { ...cell, is_reviewed: newVal });
    weightRef.current = next;
    setCellState((s) => ({ ...s, weight: next }));
    await fetch(`/api/records/${cell.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    onReviewToggle?.(cell.id, newVal);
  }

  function computeItemTotals(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const item of ITEMS) {
      let total = 0;
      for (const { key: supply } of SUPPLY_TYPES) {
        total += parseFloat(getWeightCell(supply, item).value) || 0;
      }
      totals[item] = total;
    }
    return totals;
  }

  if (transportSources.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">排放源資料讀取中…</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">上游運輸（進口）S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          運輸方式（陸/海/空）僅填年度 TKM 加總；採購重量依品項另計，不分運輸方式。重量合計會自動帶入「採購商品」頁籤。（下游運輸另有頁籤，係數共用）
        </p>
      </div>

      {SUPPLY_TYPES.map(({ key: supply, label: supplyLabel }) => (
        <div key={supply} className="mb-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-white text-xs"
              style={{ backgroundColor: supply === 'TW' ? '#0C3D2E' : '#1a5c44' }}>
              {supplyLabel}
            </span>
          </h3>

          <div className="overflow-x-auto rounded-lg border border-gray-200 mb-3">
            <table className="text-sm border-collapse" style={{ minWidth: '360px' }}>
              <thead>
                <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                  <th className="px-4 py-2.5 text-left w-20">運輸方式</th>
                  <th className="px-2 py-2.5 text-right w-28">TKM 年度合計</th>
                  <th className="px-2 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody>
                {transportSources.map((src, si) => {
                  const cell = getTkmCell(src.id, supply);
                  const hasSaved = cell.id !== null;
                  return (
                    <tr key={src.id} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap text-xs">
                        {TRANSPORT_LABEL[src.source_code]}
                        <span className="block font-mono text-gray-400">{src.source_code}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 items-center justify-end">
                          <input
                            type="number" min="0" step="any" placeholder="TKM"
                            value={cell.value}
                            onChange={(e) => updateTkm(src.id, supply, e.target.value)}
                            className="w-28 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 items-center justify-center">
                          <button
                            onClick={() => toggleTkmReview(src.id, supply)}
                            disabled={!hasSaved}
                            title={cell.is_reviewed ? '已查核（點擊取消）' : hasSaved ? '點擊標記查核' : '請先儲存資料'}
                            className={`text-sm leading-none transition-all shrink-0
                              ${cell.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                              ${!hasSaved ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                            {cell.is_reviewed ? '✅' : '⬜'}
                          </button>
                          <span className="text-xs w-4 text-center shrink-0">
                            {cell.saveStatus === 'saving' && '⏳'}
                            {cell.saveStatus === 'saved' && '✓'}
                            {cell.saveStatus === 'error' && '❌'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="text-sm border-collapse" style={{ minWidth: '360px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1a5c44' }} className="text-white">
                  <th className="px-4 py-2.5 text-left w-20">品項</th>
                  <th className="px-2 py-2.5 text-right w-28">重量(ton) 年度合計</th>
                  <th className="px-2 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody>
                {ITEMS.map((item, ii) => {
                  const cell = getWeightCell(supply, item);
                  const hasSaved = cell.id !== null;
                  return (
                    <tr key={item} className={ii % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap text-xs">{item}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 items-center justify-end">
                          <input
                            type="number" min="0" step="any" placeholder="ton"
                            value={cell.value}
                            onChange={(e) => updateWeight(supply, item, e.target.value)}
                            className="w-28 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 items-center justify-center">
                          <button
                            onClick={() => toggleWeightReview(supply, item)}
                            disabled={!hasSaved}
                            title={cell.is_reviewed ? '已查核（點擊取消）' : hasSaved ? '點擊標記查核' : '請先儲存資料'}
                            className={`text-sm leading-none transition-all shrink-0
                              ${cell.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                              ${!hasSaved ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                            {cell.is_reviewed ? '✅' : '⬜'}
                          </button>
                          <span className="text-xs w-4 text-center shrink-0">
                            {cell.saveStatus === 'saving' && '⏳'}
                            {cell.saveStatus === 'saved' && '✓'}
                            {cell.saveStatus === 'error' && '❌'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="mt-2 p-4 bg-green-50 rounded-lg border border-green-200">
        <p className="text-xs font-semibold text-gray-700 mb-2">各品項年度重量合計（台供 + 廠供）→ 帶入採購商品</p>
        <div className="flex flex-wrap gap-4">
          {ITEMS.map((item) => {
            const total = SUPPLY_TYPES.reduce(
              (s, { key: supply }) => s + (parseFloat(getWeightCell(supply, item).value) || 0), 0,
            );
            return (
              <div key={item} className="text-xs">
                <span className="text-gray-500">{item}：</span>
                <span className="font-mono font-semibold text-green-800">
                  {total > 0 ? total.toLocaleString(undefined, { maximumFractionDigits: 10 }) + ' ton' : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

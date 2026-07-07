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
  tkm: string;
  ton: string;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

// Key: `${source_id}-${supply_type}-${item}`  e.g. "uuid-TW-布料"
type CellKey = string;

function computeItemTons(cells: Map<CellKey, CellState>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of ITEMS) {
    let total = 0;
    for (const [key, cell] of cells) {
      if (key.endsWith(`-TW-${item}`) || key.endsWith(`-FC-${item}`)) {
        total += parseFloat(cell.ton) || 0;
      }
    }
    totals[item] = total;
  }
  return totals;
}

interface UpstreamTabProps extends TabProps {
  onTonsChange?: (tons: Record<string, number>) => void;
}

export default function UpstreamTab({
  factory, year, emissionSources, existingRecords, onTonsChange,
}: UpstreamTabProps) {
  const transportSources = emissionSources
    .filter((s) => TRANSPORT_CODES.includes(s.source_code as typeof TRANSPORT_CODES[number]))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  const initCells = useCallback((): Map<CellKey, CellState> => {
    const map = new Map<CellKey, CellState>();
    for (const r of existingRecords) {
      if (!r.source_code?.startsWith('3-4')) continue;
      if (r.month !== ANNUAL_MONTH) continue;
      const sl = r.sub_location ?? '';
      // Accept both new "TW-布料" format and legacy "布料" format
      let supply: SupplyType | null = null;
      let itemCode: ItemCode | null = null;
      if (sl.startsWith('TW-')) {
        supply = 'TW';
        itemCode = sl.slice(3) as ItemCode;
      } else if (sl.startsWith('FC-')) {
        supply = 'FC';
        itemCode = sl.slice(3) as ItemCode;
      } else if (ITEMS.includes(sl as ItemCode)) {
        // Legacy records without prefix → treat as TW
        supply = 'TW';
        itemCode = sl as ItemCode;
      }
      if (!supply || !itemCode || !ITEMS.includes(itemCode)) continue;
      const key = `${r.emission_source_id}-${supply}-${itemCode}`;
      map.set(key, {
        id: r.id,
        tkm: r.activity_value != null ? String(r.activity_value) : '',
        ton: r.meter_number != null ? String(r.meter_number) : '',
        is_reviewed: r.is_reviewed ?? false,
        saveStatus: 'idle',
      });
    }
    return map;
  }, [existingRecords]);

  const [cells, setCells] = useState<Map<CellKey, CellState>>(initCells);
  const cellsRef = useRef(cells);
  useEffect(() => { cellsRef.current = cells; }, [cells]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getCell(sourceId: string, supply: SupplyType, item: ItemCode): CellState {
    return cells.get(`${sourceId}-${supply}-${item}`) ?? {
      id: null, tkm: '', ton: '', is_reviewed: false, saveStatus: 'idle',
    };
  }

  function updateCell(
    sourceId: string, supply: SupplyType, item: ItemCode,
    field: 'tkm' | 'ton', value: string,
  ) {
    const key = `${sourceId}-${supply}-${item}`;
    const prev = cellsRef.current.get(key) ?? { id: null, tkm: '', ton: '', is_reviewed: false, saveStatus: 'idle' };
    const next = new Map(cellsRef.current);
    next.set(key, { ...prev, [field]: value, saveStatus: 'saving' });
    cellsRef.current = next;
    setCells(next);
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => saveCell(sourceId, supply, item), 1000);
  }

  async function saveCell(sourceId: string, supply: SupplyType, item: ItemCode) {
    const key = `${sourceId}-${supply}-${item}`;
    const cell = cellsRef.current.get(key);
    if (!cell) return;

    const tkmNum = cell.tkm !== '' ? parseFloat(cell.tkm) : null;
    const tonNum = cell.ton !== '' ? parseFloat(cell.ton) : null;

    const payload = {
      factory_id: factory.id,
      emission_source_id: sourceId,
      year,
      month: ANNUAL_MONTH,
      activity_value: tkmNum != null && !isNaN(tkmNum) ? tkmNum : null,
      activity_unit: 'tonne-km',
      sub_location: `${supply}-${item}`,
      // meter_number must be a string per API schema
      meter_number: tonNum != null && !isNaN(tonNum) ? String(tonNum) : null,
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
        const nextMap = new Map(cellsRef.current);
        const cur = nextMap.get(key);
        if (cur) nextMap.set(key, { ...cur, id: data.data.id });
        cellsRef.current = nextMap;
        setCells(nextMap);
      }
      const saved = new Map(cellsRef.current);
      const cur = saved.get(key);
      if (cur) saved.set(key, { ...cur, saveStatus: 'saved' });
      cellsRef.current = saved;
      setCells(saved);
      onTonsChange?.(computeItemTons(saved));
      setTimeout(() => {
        const reset = new Map(cellsRef.current);
        const c = reset.get(key);
        if (c && c.saveStatus === 'saved') reset.set(key, { ...c, saveStatus: 'idle' });
        cellsRef.current = reset;
        setCells(reset);
      }, 2000);
    } catch {
      const err = new Map(cellsRef.current);
      const c = err.get(key);
      if (c) err.set(key, { ...c, saveStatus: 'error' });
      cellsRef.current = err;
      setCells(err);
    }
  }

  async function toggleReview(sourceId: string, supply: SupplyType, item: ItemCode) {
    const key = `${sourceId}-${supply}-${item}`;
    const cell = cellsRef.current.get(key);
    if (!cell?.id) return;
    const newVal = !cell.is_reviewed;
    const next = new Map(cellsRef.current);
    next.set(key, { ...cell, is_reviewed: newVal });
    cellsRef.current = next;
    setCells(next);
    await fetch(`/api/records/${cell.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
  }

  // Totals per item across all supply types and transport modes
  function itemTonTotal(item: ItemCode): number {
    let total = 0;
    for (const src of transportSources) {
      for (const { key: supply } of SUPPLY_TYPES) {
        total += parseFloat(getCell(src.id, supply, item).ton) || 0;
      }
    }
    return total;
  }

  if (transportSources.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">排放源資料讀取中…</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">上游運輸（進口）S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          填入年度 TKM 與採購總重量。重量合計會自動帶入「採購商品」頁籤。
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

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="text-sm border-collapse" style={{ minWidth: '860px' }}>
              <thead>
                <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                  <th className="px-4 py-2.5 text-left w-20">運輸方式</th>
                  {ITEMS.map((item) => (
                    <th key={item} className="px-2 py-2.5 text-center" colSpan={2}>{item}</th>
                  ))}
                </tr>
                <tr style={{ backgroundColor: '#1a5c44' }} className="text-white text-xs">
                  <th className="px-4 py-2" />
                  {ITEMS.map((item) => (
                    <th key={item} className="px-2 py-2" colSpan={2}>
                      <div className="flex gap-1 justify-center">
                        <span className="w-24 text-right">TKM</span>
                        <span className="w-20 text-right">重量(ton)</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transportSources.map((src, si) => (
                  <tr key={src.id} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap text-xs">
                      {TRANSPORT_LABEL[src.source_code]}
                      <span className="block font-mono text-gray-400">{src.source_code}</span>
                    </td>
                    {ITEMS.map((item) => {
                      const cell = getCell(src.id, supply, item);
                      const hasSaved = cell.id !== null;
                      return (
                        <td key={item} className="px-2 py-1.5" colSpan={2}>
                          <div className="flex gap-1 items-center">
                            <input
                              type="number" min="0" step="0.01" placeholder="TKM"
                              value={cell.tkm}
                              onChange={(e) => updateCell(src.id, supply, item, 'tkm', e.target.value)}
                              className="w-24 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <input
                              type="number" min="0" step="0.01" placeholder="ton"
                              value={cell.ton}
                              onChange={(e) => updateCell(src.id, supply, item, 'ton', e.target.value)}
                              className="w-20 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            {/* review toggle — only enabled once record is saved */}
                            <button
                              onClick={() => toggleReview(src.id, supply, item)}
                              disabled={!hasSaved}
                              title={cell.is_reviewed ? '已查核（點擊取消）' : hasSaved ? '點擊標記查核' : '請先儲存資料'}
                              className={`text-sm leading-none transition-all shrink-0
                                ${cell.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                                ${!hasSaved ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                              {cell.is_reviewed ? '✅' : '⬜'}
                            </button>
                            {/* save status indicator */}
                            <span className="text-xs w-4 text-center shrink-0">
                              {cell.saveStatus === 'saving' && '⏳'}
                              {cell.saveStatus === 'saved' && '✓'}
                              {cell.saveStatus === 'error' && '❌'}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-xs">
                  <td className="px-4 py-2 text-gray-700">小計</td>
                  {ITEMS.map((item) => {
                    const tkmTotal = transportSources.reduce(
                      (s, src) => s + (parseFloat(getCell(src.id, supply, item).tkm) || 0), 0,
                    );
                    const tonTotal = transportSources.reduce(
                      (s, src) => s + (parseFloat(getCell(src.id, supply, item).ton) || 0), 0,
                    );
                    return (
                      <td key={item} className="px-2 py-2 font-mono text-gray-700" colSpan={2}>
                        <div className="flex gap-1">
                          <span className="w-24 text-right">
                            {tkmTotal > 0 ? tkmTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                          </span>
                          <span className="w-20 text-right">
                            {tonTotal > 0 ? tonTotal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}

      {/* Cross-supply total — feeds into PurchaseTab */}
      <div className="mt-2 p-4 bg-green-50 rounded-lg border border-green-200">
        <p className="text-xs font-semibold text-gray-700 mb-2">各品項年度重量合計（台供 + 廠供）→ 帶入採購商品</p>
        <div className="flex flex-wrap gap-4">
          {ITEMS.map((item) => {
            const total = itemTonTotal(item);
            return (
              <div key={item} className="text-xs">
                <span className="text-gray-500">{item}：</span>
                <span className="font-mono font-semibold text-green-800">
                  {total > 0 ? total.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ton' : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

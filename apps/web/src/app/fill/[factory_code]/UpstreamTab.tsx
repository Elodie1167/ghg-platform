'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG } from './tabTypes';
import type { EmissionSource, ActivityRecord } from './page';

const ITEMS = ['布料', '線料', '紙箱', '塑料袋'] as const;
type ItemCode = typeof ITEMS[number];

const TRANSPORT_CODES = ['3-4-A', '3-4-B', '3-4-C'] as const;
const TRANSPORT_LABEL: Record<string, string> = {
  '3-4-A': '陸運',
  '3-4-B': '海運',
  '3-4-C': '空運',
};

// DB month constraint 1-12；用 month=1 存年度彙總值
const ANNUAL_MONTH = 1;

interface CellState {
  id: string | null;
  tkm: string;      // activity_value: tonne-km (年度總量)
  ton: string;      // meter_number: ton (年度總重)
  saveStatus: SaveStatus;
}

type CellKey = string; // `${source_id}-${item_code}`

export default function UpstreamTab({
  factory, year, emissionSources, existingRecords,
}: TabProps) {
  const transportSources = emissionSources
    .filter((s) => TRANSPORT_CODES.includes(s.source_code as typeof TRANSPORT_CODES[number]))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  const initCells = useCallback((): Map<CellKey, CellState> => {
    const map = new Map<CellKey, CellState>();
    for (const r of existingRecords) {
      if (!r.source_code?.startsWith('3-4')) continue;
      const itemCode = r.sub_location as ItemCode | null;
      if (!itemCode || !ITEMS.includes(itemCode as ItemCode)) continue;
      // Only load the annual record (month=1)
      if (r.month !== ANNUAL_MONTH) continue;
      const key = `${r.emission_source_id}-${itemCode}`;
      map.set(key, {
        id: r.id,
        tkm: r.activity_value != null ? String(r.activity_value) : '',
        ton: r.meter_number != null ? String(r.meter_number) : '',
        saveStatus: 'idle',
      });
    }
    return map;
  }, [existingRecords]);

  const [cells, setCells] = useState<Map<CellKey, CellState>>(initCells);
  const cellsRef = useRef(cells);
  useEffect(() => { cellsRef.current = cells; }, [cells]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getCell(sourceId: string, item: ItemCode): CellState {
    return cells.get(`${sourceId}-${item}`) ?? { id: null, tkm: '', ton: '', saveStatus: 'idle' };
  }

  function updateCell(sourceId: string, item: ItemCode, field: 'tkm' | 'ton', value: string) {
    const key = `${sourceId}-${item}`;
    const prev = cellsRef.current.get(key) ?? { id: null, tkm: '', ton: '', saveStatus: 'idle' };
    const next = new Map(cellsRef.current);
    next.set(key, { ...prev, [field]: value, saveStatus: 'saving' });
    cellsRef.current = next;
    setCells(next);
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => saveCell(sourceId, item), 1000);
  }

  async function saveCell(sourceId: string, item: ItemCode) {
    const key = `${sourceId}-${item}`;
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
      sub_location: item,
      meter_number: tonNum != null && !isNaN(tonNum) ? tonNum : null,
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

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">上游運輸 S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          填入年度總 TKM（Tonne-Kilometer）與採購總重量，數值請從自備 Excel 計算後填入。
          重量欄將自動帶入「採購商品」頁籤。
        </p>
      </div>

      {transportSources.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">排放源資料讀取中…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="text-sm border-collapse" style={{ minWidth: '900px' }}>
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                <th className="px-4 py-3 text-left w-24">運輸方式</th>
                {ITEMS.map((item) => (
                  <th key={item} className="px-2 py-3 text-center" colSpan={2}>
                    {item}
                  </th>
                ))}
                <th className="px-3 py-3 text-center w-8">狀</th>
              </tr>
              <tr style={{ backgroundColor: '#1a5c44' }} className="text-white text-xs">
                <th className="px-4 py-2" />
                {ITEMS.map((item) => (
                  <th key={item} className="px-2 py-2" colSpan={2}>
                    <div className="flex gap-1 justify-center">
                      <span className="w-28 text-right">年度 TKM</span>
                      <span className="w-24 text-right">年度重量 (ton)</span>
                    </div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {transportSources.map((src, si) => {
                const anyStatus = ITEMS.map((item) => getCell(src.id, item).saveStatus)
                  .find((s) => s !== 'idle') ?? 'idle';
                return (
                  <tr key={src.id} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">
                      {TRANSPORT_LABEL[src.source_code]}
                      <span className="block text-xs font-mono text-gray-400">{src.source_code}</span>
                    </td>
                    {ITEMS.map((item) => {
                      const cell = getCell(src.id, item);
                      return (
                        <td key={item} className="px-2 py-1.5" colSpan={2}>
                          <div className="flex gap-1">
                            <input
                              type="number" min="0" step="0.01" placeholder="TKM"
                              value={cell.tkm}
                              onChange={(e) => updateCell(src.id, item, 'tkm', e.target.value)}
                              className="w-28 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <input
                              type="number" min="0" step="0.01" placeholder="ton"
                              value={cell.ton}
                              onChange={(e) => updateCell(src.id, item, 'ton', e.target.value)}
                              className="w-24 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center text-xs">
                      {anyStatus === 'saving' && '⏳'}
                      {anyStatus === 'saved' && '✅'}
                      {anyStatus === 'error' && '❌'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-xs">
                <td className="px-4 py-2 text-gray-700">年度合計</td>
                {ITEMS.map((item) => {
                  const tkmTotal = transportSources.reduce(
                    (s, src) => s + (parseFloat(getCell(src.id, item).tkm) || 0), 0
                  );
                  const tonTotal = transportSources.reduce(
                    (s, src) => s + (parseFloat(getCell(src.id, item).ton) || 0), 0
                  );
                  return (
                    <td key={item} className="px-2 py-2 font-mono text-gray-700" colSpan={2}>
                      <div className="flex gap-1">
                        <span className="w-28 text-right">
                          {tkmTotal > 0 ? tkmTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                        </span>
                        <span className="w-24 text-right">
                          {tonTotal > 0 ? tonTotal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                        </span>
                      </div>
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

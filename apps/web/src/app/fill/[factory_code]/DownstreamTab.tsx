'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG } from './tabTypes';

// 3-9-A: 陸運, 3-9-B: 空運, 3-9-C: 海運
const ALL_TRANSPORT_CODES = ['3-9-A', '3-9-B', '3-9-C'] as const;
const FOB_TRANSPORT_CODES = ['3-9-A'] as const;

const TRANSPORT_LABEL: Record<string, string> = {
  '3-9-A': '陸運',
  '3-9-B': '空運',
  '3-9-C': '海運',
};

type TradeTerm = 'FOB_FCA' | 'DDP';
const ANNUAL_MONTH = 1;

interface CellState {
  id: string | null;
  tkm: string;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

function lsKey(factoryId: string, year: number, suffix: string) {
  return `ghg:downstream:${factoryId}:${year}:${suffix}`;
}

export default function DownstreamTab({
  factory, year, emissionSources, existingRecords, onReviewToggle,
}: TabProps) {
  const allSources = emissionSources
    .filter((s) => ALL_TRANSPORT_CODES.includes(s.source_code as typeof ALL_TRANSPORT_CODES[number]))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  const [tradeTerm, setTradeTerm] = useState<TradeTerm>(() => {
    if (typeof window === 'undefined') return 'FOB_FCA';
    return (localStorage.getItem(lsKey(factory.id, year, 'trade_term')) as TradeTerm) ?? 'FOB_FCA';
  });

  const [notes, setNotes] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(lsKey(factory.id, year, 'notes')) ?? '';
  });

  function handleTradeTermChange(t: TradeTerm) {
    setTradeTerm(t);
    localStorage.setItem(lsKey(factory.id, year, 'trade_term'), t);
  }

  function handleNotesChange(val: string) {
    setNotes(val);
    localStorage.setItem(lsKey(factory.id, year, 'notes'), val);
  }

  const visibleSources = tradeTerm === 'FOB_FCA'
    ? allSources.filter((s) => (FOB_TRANSPORT_CODES as readonly string[]).includes(s.source_code))
    : allSources;

  // Each source has one cell (no per-customer split)
  const initCells = useCallback((): Map<string, CellState> => {
    const map = new Map<string, CellState>();
    for (const r of existingRecords) {
      if (!r.source_code?.startsWith('3-9')) continue;
      if (r.month !== ANNUAL_MONTH) continue;
      // Use the record with sub_location=null; if not found, use first record per source
      const existing = map.get(r.emission_source_id);
      if (!existing || r.sub_location === null) {
        map.set(r.emission_source_id, {
          id: r.id,
          tkm: r.activity_value != null ? String(r.activity_value) : '',
          is_reviewed: r.is_reviewed ?? false,
          saveStatus: 'idle',
        });
      }
    }
    return map;
  }, [existingRecords]);

  const [cells, setCells] = useState<Map<string, CellState>>(initCells);
  const cellsRef = useRef(cells);
  useEffect(() => { cellsRef.current = cells; }, [cells]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getCell(sourceId: string): CellState {
    return cells.get(sourceId) ?? { id: null, tkm: '', is_reviewed: false, saveStatus: 'idle' };
  }

  function updateCell(sourceId: string, value: string) {
    const prev = cellsRef.current.get(sourceId) ?? { id: null, tkm: '', is_reviewed: false, saveStatus: 'idle' };
    const next = new Map(cellsRef.current);
    next.set(sourceId, { ...prev, tkm: value, saveStatus: 'saving' });
    cellsRef.current = next;
    setCells(next);
    if (timers.current[sourceId]) clearTimeout(timers.current[sourceId]);
    timers.current[sourceId] = setTimeout(() => saveCell(sourceId), 1000);
  }

  async function saveCell(sourceId: string) {
    const cell = cellsRef.current.get(sourceId);
    if (!cell) return;
    const tkmNum = cell.tkm !== '' ? parseFloat(cell.tkm) : null;
    const payload = {
      factory_id: factory.id,
      emission_source_id: sourceId,
      year,
      month: ANNUAL_MONTH,
      activity_value: tkmNum != null && !isNaN(tkmNum) ? tkmNum : null,
      activity_unit: 'tonne-km',
      sub_location: null,
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
        const cur = nextMap.get(sourceId);
        if (cur) nextMap.set(sourceId, { ...cur, id: data.data.id });
        cellsRef.current = nextMap;
        setCells(nextMap);
      }
      const saved = new Map(cellsRef.current);
      const cur = saved.get(sourceId);
      if (cur) saved.set(sourceId, { ...cur, saveStatus: 'saved' });
      cellsRef.current = saved;
      setCells(saved);
      setTimeout(() => {
        const reset = new Map(cellsRef.current);
        const c = reset.get(sourceId);
        if (c && c.saveStatus === 'saved') reset.set(sourceId, { ...c, saveStatus: 'idle' });
        cellsRef.current = reset;
        setCells(reset);
      }, 2000);
    } catch {
      const err = new Map(cellsRef.current);
      const c = err.get(sourceId);
      if (c) err.set(sourceId, { ...c, saveStatus: 'error' });
      cellsRef.current = err;
      setCells(err);
    }
  }

  async function toggleReview(sourceId: string) {
    const cell = cellsRef.current.get(sourceId);
    if (!cell?.id) return;
    const newVal = !cell.is_reviewed;
    const next = new Map(cellsRef.current);
    next.set(sourceId, { ...cell, is_reviewed: newVal });
    cellsRef.current = next;
    setCells(next);
    await fetch(`/api/records/${cell.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: newVal }),
    });
    if (onReviewToggle && cell.id) onReviewToggle(cell.id, newVal);
  }

  // 清空（activity_value→null，後端一併清 co2e）
  async function clearCell(sourceId: string) {
    const cell = cellsRef.current.get(sourceId);
    if (!cell) return;
    const next = new Map(cellsRef.current);
    next.set(sourceId, { ...cell, tkm: '', saveStatus: 'idle' });
    cellsRef.current = next; setCells(next);
    if (!cell.id) return;
    try {
      await fetch(`/api/records/${cell.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_value: null }),
      });
    } catch { /* 忽略；畫面已清 */ }
  }

  const grandTotal = visibleSources.reduce(
    (s, src) => s + (parseFloat(getCell(src.id).tkm) || 0), 0,
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">下游運輸（出口）S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">填入全年度 TKM；依 Trade Term 決定運輸模式</p>
      </div>

      {/* Trade Term selector */}
      <div className="mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
        <p className="text-xs font-semibold text-gray-600 mb-3">交貨條件 (Trade Term)</p>
        <div className="flex gap-3">
          {([['FOB_FCA', 'FOB / FCA', '工廠/港口交貨，客人自行安排出口運輸（只計陸運）'],
             ['DDP', 'DDP', '含到府運輸，需分別填入海/陸/空 TKM']] as const).map(([val, label, desc]) => (
            <button
              key={val}
              onClick={() => handleTradeTermChange(val as TradeTerm)}
              className={`flex-1 px-4 py-3 rounded-lg border-2 text-left transition
                ${tradeTerm === val
                  ? 'border-green-500 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
              <div className="font-semibold text-sm">{label}</div>
              <div className="text-xs mt-0.5 text-gray-500">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* TKM fill table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 mb-6">
        <table className="text-sm border-collapse w-full">
          <thead>
            <tr style={{ backgroundColor: HEADER_BG }} className="text-white text-xs">
              <th className="px-4 py-2.5 text-left w-28">運輸方式</th>
              <th className="px-4 py-2.5 text-left">年度 TKM（公噸‧公里）</th>
              <th className="px-3 py-2.5 text-center w-16">查核</th>
              <th className="px-3 py-2.5 text-center w-12">狀態</th>
            </tr>
          </thead>
          <tbody>
            {visibleSources.map((src, si) => {
              const cell = getCell(src.id);
              return (
                <tr key={src.id} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2.5 font-medium text-gray-800 text-sm whitespace-nowrap">
                    {TRANSPORT_LABEL[src.source_code]}
                    <span className="block font-mono text-gray-400 text-xs">{src.source_code}</span>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number" min="0" step="any" placeholder="輸入 TKM"
                      value={cell.tkm}
                      onChange={(e) => updateCell(src.id, e.target.value)}
                      className="w-56 border border-gray-300 rounded px-3 py-1.5 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => toggleReview(src.id)}
                      disabled={!cell.id}
                      title={cell.is_reviewed ? '已查核（點擊取消）' : cell.id ? '點擊標記查核' : '請先輸入 TKM 待自動儲存'}
                      className={`text-base leading-none transition-all
                        ${cell.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                        ${!cell.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                      {cell.is_reviewed ? '✅' : '⬜'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-gray-400 whitespace-nowrap">
                    {cell.saveStatus === 'saving' && '⏳'}
                    {cell.saveStatus === 'saved' && '✓'}
                    {cell.saveStatus === 'error' && '❌'}
                    <button onClick={() => clearCell(src.id)} disabled={!cell.id || cell.is_reviewed}
                      title={cell.is_reviewed ? '已查核不可清空，請先取消查核' : '清空此列數值'}
                      className={`ml-1 text-sm leading-none transition ${!cell.id || cell.is_reviewed ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-xs">
              <td className="px-4 py-2 text-gray-700">合計</td>
              <td className="px-4 py-2 font-mono text-gray-700">
                {grandTotal > 0 ? grandTotal.toLocaleString(undefined, { maximumFractionDigits: 10 }) + ' TKM' : '—'}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Single notes field */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <label className="block text-xs font-semibold text-gray-600 mb-2">備註</label>
        <textarea
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder={tradeTerm === 'DDP'
            ? '例：陸運－工廠→港口；海運－高雄→Rotterdam；空運－桃園→JFK…'
            : '例：FOB 高雄港，客人安排後段運輸…'}
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
        />
      </div>
    </div>
  );
}

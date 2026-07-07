'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TabProps, SaveStatus } from './tabTypes';
import { HEADER_BG } from './tabTypes';

// 3-9-A: 陸運, 3-9-B: 空運, 3-9-C: 海運
const ALL_TRANSPORT_CODES = ['3-9-A', '3-9-B', '3-9-C'] as const;
const FOB_TRANSPORT_CODES = ['3-9-A'] as const;  // FOB/FCA: 陸運 only

const TRANSPORT_LABEL: Record<string, string> = {
  '3-9-A': '陸運',
  '3-9-B': '空運',
  '3-9-C': '海運',
};

type TradeTerm = 'FOB_FCA' | 'DDP';
const ANNUAL_MONTH = 1;

const CUSTOMERS = ['SMART CLOTHING', 'PVH', 'GAP', 'HM', 'ZARA', 'LULULEMON', 'OTHER'] as const;
type Customer = typeof CUSTOMERS[number];

interface CellState {
  id: string | null;
  tkm: string;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

type CellKey = string; // `${source_id}-${customer}`

function lsKey(factoryId: string, year: number, suffix: string) {
  return `ghg:downstream:${factoryId}:${year}:${suffix}`;
}

export default function DownstreamTab({
  factory, year, emissionSources, existingRecords,
}: TabProps) {
  const allSources = emissionSources
    .filter((s) => ALL_TRANSPORT_CODES.includes(s.source_code as typeof ALL_TRANSPORT_CODES[number]))
    .sort((a, b) => a.source_code.localeCompare(b.source_code));

  // Trade term — persisted in localStorage
  const [tradeTerm, setTradeTerm] = useState<TradeTerm>(() => {
    if (typeof window === 'undefined') return 'FOB_FCA';
    return (localStorage.getItem(lsKey(factory.id, year, 'trade_term')) as TradeTerm) ?? 'FOB_FCA';
  });

  // DDP descriptions — one per customer
  const [ddpDesc, setDdpDesc] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(lsKey(factory.id, year, 'ddp_desc')) ?? '{}');
    } catch { return {}; }
  });

  function handleTradeTermChange(t: TradeTerm) {
    setTradeTerm(t);
    localStorage.setItem(lsKey(factory.id, year, 'trade_term'), t);
  }

  function handleDdpDescChange(customer: string, val: string) {
    const next = { ...ddpDesc, [customer]: val };
    setDdpDesc(next);
    localStorage.setItem(lsKey(factory.id, year, 'ddp_desc'), JSON.stringify(next));
  }

  const visibleSources = tradeTerm === 'FOB_FCA'
    ? allSources.filter((s) => (FOB_TRANSPORT_CODES as readonly string[]).includes(s.source_code))
    : allSources;

  const initCells = useCallback((): Map<CellKey, CellState> => {
    const map = new Map<CellKey, CellState>();
    for (const r of existingRecords) {
      if (!r.source_code?.startsWith('3-9')) continue;
      if (r.month !== ANNUAL_MONTH) continue;
      const customer = r.sub_location ?? 'OTHER';
      const key = `${r.emission_source_id}-${customer}`;
      map.set(key, {
        id: r.id,
        tkm: r.activity_value != null ? String(r.activity_value) : '',
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

  function getCell(sourceId: string, customer: string): CellState {
    return cells.get(`${sourceId}-${customer}`) ?? {
      id: null, tkm: '', is_reviewed: false, saveStatus: 'idle',
    };
  }

  function updateCell(sourceId: string, customer: string, value: string) {
    const key = `${sourceId}-${customer}`;
    const prev = cellsRef.current.get(key) ?? { id: null, tkm: '', is_reviewed: false, saveStatus: 'idle' };
    const next = new Map(cellsRef.current);
    next.set(key, { ...prev, tkm: value, saveStatus: 'saving' });
    cellsRef.current = next;
    setCells(next);
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => saveCell(sourceId, customer), 1000);
  }

  async function saveCell(sourceId: string, customer: string) {
    const key = `${sourceId}-${customer}`;
    const cell = cellsRef.current.get(key);
    if (!cell) return;

    const tkmNum = cell.tkm !== '' ? parseFloat(cell.tkm) : null;
    const payload = {
      factory_id: factory.id,
      emission_source_id: sourceId,
      year,
      month: ANNUAL_MONTH,
      activity_value: tkmNum != null && !isNaN(tkmNum) ? tkmNum : null,
      activity_unit: 'tonne-km',
      sub_location: customer,
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

  async function toggleReview(sourceId: string, customer: string) {
    const key = `${sourceId}-${customer}`;
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

  const customers = tradeTerm === 'DDP' ? CUSTOMERS : ['合計'] as const;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-800">下游運輸（出口）S3</h2>
        <p className="text-sm text-gray-500 mt-0.5">填入年度 TKM；依 Trade Term 決定運輸模式</p>
      </div>

      {/* Trade Term selector */}
      <div className="mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
        <p className="text-xs font-semibold text-gray-600 mb-3">交貨條件 (Trade Term)</p>
        <div className="flex gap-3">
          {([['FOB_FCA', 'FOB / FCA', '工廠/港口交貨，客人自行安排出口運輸'],
             ['DDP', 'DDP', '含到府運輸，需填海/陸/空各段 TKM']] as const).map(([val, label, desc]) => (
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

      {/* DDP description fields */}
      {tradeTerm === 'DDP' && (
        <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
          <p className="text-xs font-semibold text-amber-800 mb-3">
            DDP 路線說明（記錄各客戶的運輸路徑）
          </p>
          <div className="space-y-3">
            {CUSTOMERS.map((customer) => (
              <div key={customer} className="flex items-start gap-3">
                <span className="text-xs font-medium text-gray-700 w-28 pt-2 shrink-0">{customer}</span>
                <textarea
                  value={ddpDesc[customer] ?? ''}
                  onChange={(e) => handleDdpDescChange(customer, e.target.value)}
                  placeholder={`例：先海運至基隆港，再拉車送至${customer}倉庫…`}
                  rows={2}
                  className="flex-1 border border-amber-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TKM fill table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="text-sm border-collapse w-full">
          <thead>
            <tr style={{ backgroundColor: HEADER_BG }} className="text-white text-xs">
              <th className="px-4 py-2.5 text-left w-24">運輸方式</th>
              {customers.map((c) => (
                <th key={c} className="px-3 py-2.5 text-center">{c}</th>
              ))}
              <th className="px-3 py-2.5 text-center w-16">年度小計</th>
            </tr>
          </thead>
          <tbody>
            {visibleSources.map((src, si) => {
              const rowTotal = customers.reduce(
                (s, c) => s + (parseFloat(getCell(src.id, c).tkm) || 0), 0,
              );
              return (
                <tr key={src.id} className={si % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 font-medium text-gray-800 text-xs whitespace-nowrap">
                    {TRANSPORT_LABEL[src.source_code]}
                    <span className="block font-mono text-gray-400">{src.source_code}</span>
                  </td>
                  {customers.map((customer) => {
                    const cell = getCell(src.id, customer);
                    return (
                      <td key={customer} className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number" min="0" step="0.01" placeholder="TKM"
                            value={cell.tkm}
                            onChange={(e) => updateCell(src.id, customer, e.target.value)}
                            className="w-24 border border-gray-300 rounded px-1.5 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                          />
                          <button
                            onClick={() => toggleReview(src.id, customer)}
                            disabled={!cell.id}
                            title={cell.is_reviewed ? '已查核' : cell.id ? '點擊查核' : '請先儲存'}
                            className={`text-sm leading-none transition-all shrink-0
                              ${cell.is_reviewed ? 'text-green-500' : 'text-gray-300'}
                              ${!cell.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                            {cell.is_reviewed ? '✅' : '⬜'}
                          </button>
                          <span className="text-xs w-3 shrink-0">
                            {cell.saveStatus === 'saving' && '⏳'}
                            {cell.saveStatus === 'saved' && '✓'}
                            {cell.saveStatus === 'error' && '❌'}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center font-mono text-xs text-gray-700">
                    {rowTotal > 0 ? rowTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-xs">
              <td className="px-4 py-2 text-gray-700">合計</td>
              {customers.map((c) => {
                const colTotal = visibleSources.reduce(
                  (s, src) => s + (parseFloat(getCell(src.id, c).tkm) || 0), 0,
                );
                return (
                  <td key={c} className="px-3 py-2 text-center font-mono text-gray-700">
                    {colTotal > 0 ? colTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-center font-mono text-gray-700">
                {(() => {
                  const grand = visibleSources.reduce((s, src) =>
                    s + customers.reduce((ss, c) => ss + (parseFloat(getCell(src.id, c).tkm) || 0), 0), 0,
                  );
                  return grand > 0 ? grand.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

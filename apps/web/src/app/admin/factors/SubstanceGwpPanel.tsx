'use client';

import { useEffect, useRef, useState } from 'react';

const HEADER_BG = '#0C3D2E';

export const OPEN_GWP_PANEL_EVENT = 'ghg:open-gwp-panel';

export interface SubstanceGwpRow {
  substance: string;
  gwp: number;
  note: string | null;
  updated_at: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function SubstanceGwpPanel({ initialRows }: { initialRows: SubstanceGwpRow[] }) {
  const [rows, setRows] = useState<SubstanceGwpRow[]>(initialRows);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialRows.map((r) => [r.substance, String(r.gwp)])),
  );
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 由頁面上其他地方的「設定 GWP」按鈕觸發：展開面板、捲動過去、短暫高亮提示位置
  useEffect(() => {
    function handleOpen() {
      setOpen(true);
      requestAnimationFrame(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      setHighlight(true);
      setTimeout(() => setHighlight(false), 1800);
    }
    window.addEventListener(OPEN_GWP_PANEL_EVENT, handleOpen);
    // 支援直接用網址 #substance-gwp-panel 連進來（例如從填報頁的逸散分頁連過來）
    if (window.location.hash === '#substance-gwp-panel') handleOpen();
    return () => window.removeEventListener(OPEN_GWP_PANEL_EVENT, handleOpen);
  }, []);

  async function save(substance: string) {
    const raw = drafts[substance];
    const gwp = parseFloat(raw);
    if (isNaN(gwp)) return;
    setStatus((s) => ({ ...s, [substance]: 'saving' }));
    try {
      const res = await fetch('/api/admin/substance-gwp', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ substance, gwp }),
      });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      setRows((p) => p.map((r) => (r.substance === substance ? data : r)));
      setStatus((s) => ({ ...s, [substance]: 'saved' }));
      setTimeout(() => setStatus((s) => (s[substance] === 'saved' ? { ...s, [substance]: 'idle' } : s)), 2000);
    } catch {
      setStatus((s) => ({ ...s, [substance]: 'error' }));
    }
  }

  return (
    <div
      id="substance-gwp-panel"
      ref={panelRef}
      className={`mb-6 rounded-xl border bg-white overflow-hidden transition-shadow ${
        highlight ? 'border-amber-400 ring-4 ring-amber-200' : 'border-gray-200'
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-semibold text-gray-800">
          冷媒 / 滅火器 / SF6 GWP 對照表
          <span className="ml-2 text-xs font-normal text-gray-400">
            套用在「洩漏質量比例（factor_substance）」計算路徑，改這裡不用重新部署
          </span>
        </span>
        <span className="text-gray-400">{open ? '收合 ▲' : '展開 ▼'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                <th className="whitespace-nowrap px-3 py-2 text-left">物質</th>
                <th className="whitespace-nowrap px-3 py-2 text-right w-40">GWP</th>
                <th className="whitespace-nowrap px-3 py-2 text-left">備註</th>
                <th className="whitespace-nowrap px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.substance} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.substance}</td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" step="any"
                      value={drafts[r.substance] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.substance]: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{r.note}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => save(r.substance)}
                      disabled={status[r.substance] === 'saving'}
                      className="px-2 py-1 rounded text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                      style={{ backgroundColor: BTN_BG }}
                    >
                      {status[r.substance] === 'saving' ? '儲存中…' : status[r.substance] === 'saved' ? '已儲存 ✓' : '儲存'}
                    </button>
                    {status[r.substance] === 'error' && <div className="text-xs text-red-500 mt-1">失敗</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const BTN_BG = '#0C3D2E';

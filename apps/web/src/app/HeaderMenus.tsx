'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return ref;
}

interface Props {
  currentYear: number;
}

const itemClass = 'block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 whitespace-nowrap';

/** 首頁 header 的「設定」「文件下載」兩個下拉選單，收攏原本一排散開的按鈕。 */
export default function HeaderMenus({ currentYear }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const settingsRef = useOutsideClose(() => setSettingsOpen(false));
  const downloadRef = useOutsideClose(() => setDownloadOpen(false));

  return (
    <>
      <div ref={settingsRef} className="relative">
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
        >
          設定 ▾
        </button>
        {settingsOpen && (
          <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
            <Link href="/admin/factories" className={itemClass} onClick={() => setSettingsOpen(false)}>工廠設定</Link>
            <Link href="/admin/factors" className={itemClass} onClick={() => setSettingsOpen(false)}>係數設定</Link>
            <Link href="/admin/emission-sources" className={itemClass} onClick={() => setSettingsOpen(false)}>排放源設定</Link>
            <Link href="/admin/report-years" className={itemClass} onClick={() => setSettingsOpen(false)}>年度設定</Link>
            <Link href="/admin/verification" className={itemClass} onClick={() => setSettingsOpen(false)}>查證封存</Link>
          </div>
        )}
      </div>

      <div ref={downloadRef} className="relative">
        <button
          type="button"
          onClick={() => setDownloadOpen((v) => !v)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-green-500 text-white hover:bg-green-400 transition"
        >
          文件下載 ▾
        </button>
        {downloadOpen && (
          <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
            <a href={`/api/reports/report?year=${currentYear}`} className={itemClass} onClick={() => setDownloadOpen(false)}>
              報告書（{currentYear}）↓
            </a>
            <a href={`/api/reports/inventory?year=${currentYear}`} className={itemClass} onClick={() => setDownloadOpen(false)}>
              集團碳排彙整表（{currentYear}）↓
            </a>
            <a href={`/api/reports/factors?year=${currentYear}`} className={itemClass} onClick={() => setDownloadOpen(false)}>
              係數表（{currentYear}）↓
            </a>
          </div>
        )}
      </div>
    </>
  );
}

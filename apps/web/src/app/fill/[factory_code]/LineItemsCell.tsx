'use client';

import { useState } from 'react';
import LineItemsModal from './LineItemsModal';
import { refLabel } from '@/lib/ref-label';

/**
 * 表格內「查看明細」儲存格（自帶 modal 開闔狀態）。
 * 僅在該紀錄確實有單據明細（count > 0，即上傳內容經後續加總）時顯示按鈕，
 * 逐筆事件型排放源（無明細）則顯示 —，符合「只有加總型才需要查看明細」。
 */
export default function LineItemsCell({
  recordId, count, title, unit, sourceCode,
}: {
  recordId: string | null;
  count: number;
  title: string;
  unit: string;
  sourceCode?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!recordId || !count || count <= 0) {
    return <span className="text-gray-300 text-xs">—</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-blue-600 hover:text-blue-800 text-xs underline"
        title={`查看 ${count} 筆單據明細`}
      >
        查看 ({count})
      </button>
      {open && (
        <LineItemsModal
          recordId={recordId}
          title={title}
          unit={unit}
          refLabel={refLabel(sourceCode)}
          readOnly
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

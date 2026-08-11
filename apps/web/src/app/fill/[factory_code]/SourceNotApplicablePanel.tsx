'use client';

/**
 * 「本廠本年度無此排放」標記。
 *
 * 查證單位要看到「已鑑別、本年度為 0」。沒有填報記錄代表不了這件事——
 * 沒記錄也可能只是漏填。勾了就免逐月填報，但必須寫理由。
 * 例：3-5-T2 廢水/水肥清運 2025 年全集團為 0（廢水全數納管由污水下水道處理）。
 */

import { useState } from 'react';
import type { EmissionSource, Factory, SourceApplicability } from './page';

export default function SourceNotApplicablePanel({
  factory, year, source, initial, onChanged,
}: {
  factory: Factory;
  year: number;
  source: EmissionSource;
  initial: SourceApplicability | undefined;
  onChanged: () => void;
}) {
  const [checked, setChecked] = useState(initial?.not_applicable ?? false);
  const [reason, setReason] = useState(initial?.na_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: boolean, nextReason: string) {
    setBusy(true); setErr(null); setSaved(false);
    try {
      const res = await fetch('/api/factory-applicability', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: factory.id, emission_source_id: source.id, year,
          not_applicable: next, na_reason: nextReason,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setSaved(true);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '儲存失敗');
      setChecked(!next); // 回捲，畫面不要領先於伺服器
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            setChecked(next);
            if (!next) save(false, ''); // 取消勾選不需理由，直接存
          }} />
        <span>
          本廠 {year} 年度<strong>無</strong>「{source.source_code} {source.name_zh}」之排放
        </span>
      </label>

      {checked && (
        <div className="mt-2 flex items-start gap-2">
          <input
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="請填理由，供查證調閱（例：廢水全數納管，由污水下水道處理，無外運）"
            value={reason} onChange={(e) => setReason(e.target.value)} />
          <button onClick={() => save(true, reason)} disabled={busy || !reason.trim()}
            className="px-3 py-1 text-sm rounded bg-gray-700 text-white disabled:opacity-40">
            {busy ? '儲存中…' : '儲存'}
          </button>
        </div>
      )}

      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
      {saved && !err && <div className="mt-1 text-xs text-green-700">已儲存</div>}
    </div>
  );
}

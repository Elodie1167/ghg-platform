'use client';

import { useMemo, useState } from 'react';

const HEADER_BG = '#0C3D2E';

interface Evidence {
  id: string; display_alias: string; blob_url: string; version: number;
  source_label: string; uploaded_at: string;
}

interface Route {
  id: string;
  origin: string;
  destination_type: 'port' | 'factory';
  destination_port: string | null;
  mode: 'Sea' | 'Air' | 'Land';
  distance_km: string;
  source: string | null;
  entered_at: string | null;
  last_verified_date: string | null;
  note: string | null;
  status: 'active' | 'inactive';
  destination_factory_code: string | null;
  destination_factory_name: string | null;
  entered_by_name: string | null;
  entered_by_email: string | null;
  evidence: Evidence[];
}

function destinationLabel(r: Route): string {
  if (r.destination_type === 'factory') {
    return `${r.destination_factory_code ?? ''} ${r.destination_factory_name ?? ''}`.trim() || '（工廠未知）';
  }
  return r.destination_port ?? '（港口未知）';
}

const MODE_LABEL: Record<Route['mode'], string> = { Sea: '海運', Air: '空運', Land: '陸運' };

export default function TransportRoutesClient({ initialRoutes }: { initialRoutes: Route[] }) {
  const [routes, setRoutes] = useState(initialRoutes);
  const [keyword, setKeyword] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | Route['mode']>('all');
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function handleUpload(routeId: string, file: File) {
    setUploadingId(routeId);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/transport/routes/${routeId}/evidence`, { method: 'POST', body });
      const json = await res.json();
      if (!res.ok || json.error) { alert(json.error ?? '上傳失敗'); return; }
      setRoutes((prev) => prev.map((r) => r.id === routeId
        ? {
            ...r,
            evidence: [...r.evidence, {
              id: json.data.id, display_alias: json.data.display_alias,
              blob_url: `/api/transport/evidence/${json.data.id}`,
              version: r.evidence.length + 1, source_label: '', uploaded_at: new Date().toISOString(),
            }],
          }
        : r));
    } catch {
      alert('網路錯誤，請稍後再試');
    } finally {
      setUploadingId(null);
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return routes.filter((r) => {
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false;
      if (!kw) return true;
      const hay = `${r.origin} ${destinationLabel(r)}`.toLowerCase();
      return hay.includes(kw);
    });
  }, [routes, keyword, modeFilter]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[1400px] mx-auto">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">上游運輸｜路線主檔查詢</h1>
          <p className="text-xs text-green-200 mt-0.5">
            共 {routes.length} 條已建立路線 · 查已有距離/佐證，缺的路線請到「資料覆核中心」補值
          </p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋起點或迄點，例如「香港」「Ho Chi Minh」「胡志明」"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['all', 'Sea', 'Air', 'Land'] as const).map((m) => (
              <button key={m} onClick={() => setModeFilter(m)}
                className={`px-4 py-1.5 font-medium transition ${modeFilter === m ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                style={modeFilter === m ? { backgroundColor: HEADER_BG } : {}}>
                {m === 'all' ? '全部運輸方式' : MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <a href="/admin/transport-review" className="ml-auto text-sm text-blue-600 hover:underline">
            前往資料覆核中心（補缺值）→
          </a>
        </div>

        {routes.length === 0 && (
          <div className="text-center text-gray-400 py-16 text-sm">
            目前還沒有任何路線資料。歷史種子資料尚未匯入，或請到「資料覆核中心」開始補值。
          </div>
        )}

        {routes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: HEADER_BG }} className="text-white text-xs">
                  <th className="px-3 py-3 text-left">起點</th>
                  <th className="px-3 py-3 text-left">迄點</th>
                  <th className="px-3 py-3 text-center w-20">方式</th>
                  <th className="px-3 py-3 text-right w-24">距離(km)</th>
                  <th className="px-3 py-3 text-left">來源</th>
                  <th className="px-3 py-3 text-left">佐證</th>
                  <th className="px-3 py-3 text-left">補建人/時間</th>
                  <th className="px-3 py-3 text-center w-20">狀態</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">{r.origin}</td>
                    <td className="px-3 py-2">{destinationLabel(r)}</td>
                    <td className="px-3 py-2 text-center">{MODE_LABEL[r.mode]}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.distance_km).toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{r.source ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.evidence.map((ev) => (
                        <a key={ev.id} href={ev.blob_url} target="_blank" rel="noreferrer"
                          className="text-blue-600 hover:underline block">
                          {ev.display_alias}{ev.version > 1 ? ` (v${ev.version})` : ''}
                        </a>
                      ))}
                      <label className="text-gray-400 hover:text-blue-600 cursor-pointer inline-block mt-0.5">
                        {uploadingId === r.id ? '上傳中…' : (r.evidence.length === 0 ? '無 · 上傳佐證' : '+ 上傳佐證')}
                        <input type="file" accept="image/*,.pdf" className="hidden"
                          disabled={uploadingId === r.id}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(r.id, f); e.target.value = ''; }} />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {r.entered_by_name ?? r.entered_by_email ?? '—'}
                      {r.entered_at && <div>{new Date(r.entered_at).toLocaleDateString('zh-TW')}</div>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.status === 'active' ? '啟用' : '停用'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center text-gray-400 py-10 text-sm">沒有符合搜尋條件的路線</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

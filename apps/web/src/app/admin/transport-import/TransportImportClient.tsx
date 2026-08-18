'use client';

import { useRef, useState } from 'react';

const HEADER_BG = '#0C3D2E';

interface Factory { id: string; factory_code: string; name_zh: string; }

interface ImportResult {
  replacedCount: number;
  imported: number;
  skippedOtherFactory: number;
  skippedOutOfScope: number;
  missingDistance: number;
  pendingReview: number;
  distinctMissingRoutes: number;
  parseErrors: string[];
}

export default function TransportImportClient({ factories }: { factories: Factory[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [factoryId, setFactoryId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    const file = fileRef.current?.files?.[0] ?? null;
    if (!factoryId) { setErrorMsg('請選擇工廠'); return; }
    if (!file) { setErrorMsg('請選擇檔案'); return; }

    setStatus('uploading');
    const body = new FormData();
    body.append('factory_id', factoryId);
    body.append('year', String(year));
    body.append('file', file);
    try {
      const res = await fetch('/api/transport/import-erp', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok || json.error) {
        setStatus('error');
        setErrorMsg(json.error ?? `上傳失敗（HTTP ${res.status}）`);
        return;
      }
      setResult(json.data);
      setStatus('success');
    } catch {
      setStatus('error');
      setErrorMsg('網路錯誤，請稍後再試');
    }
  }

  function handleReset() {
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[900px] mx-auto">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">上游運輸｜ERP 匯入</h1>
          <p className="text-xs text-green-200 mt-0.5">
            上傳「台供主副料及廠供主副料」Excel 檔，系統會自動找「主料／台供副料／廠供副料」三個分頁計算運輸碳排
          </p>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-4 py-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          {status === 'idle' || status === 'uploading' || status === 'error' ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                同一份檔案會依「工廠裸碼」（例如 Consignee 欄的 IND-GLD 或 FACTORY 欄的 GLD）自動過濾出屬於所選工廠的列，
                其他廠的列會被略過（不影響已選工廠外的資料）。重新匯入同一廠同一年度會整批取代舊資料，不會疊加重複。
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">工廠</label>
                  <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">— 選擇工廠 —</option>
                    {factories.map((f) => (
                      <option key={f.id} value={f.id}>{f.factory_code}　{f.name_zh}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">盤查年度</label>
                  <input type="number" min="2020" max="2100" value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">ERP 匯出檔（.xlsx / .xls）</label>
                <input ref={fileRef} type="file" accept=".xlsx,.xls"
                  className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100 border border-gray-300 rounded-lg cursor-pointer" />
              </div>

              {errorMsg && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <button type="submit" disabled={status === 'uploading'}
                style={{ backgroundColor: HEADER_BG }}
                className="w-full text-white font-medium py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition text-sm">
                {status === 'uploading' ? '匯入中，檔案較大可能需要 1-2 分鐘…' : '開始匯入'}
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="text-center py-2">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="text-xl font-bold text-gray-800">匯入完成</h3>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-green-700">{result?.imported ?? 0}</div>
                  <div className="text-sm text-green-600 mt-1">成功算出 TKM/CO2e</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-amber-700">{result?.missingDistance ?? 0}</div>
                  <div className="text-sm text-amber-600 mt-1">缺距離（{result?.distinctMissingRoutes ?? 0} 條路線）</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-gray-500">{result?.pendingReview ?? 0}</div>
                  <div className="text-sm text-gray-400 mt-1">待人工複查</div>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                本廠本年度略過 {result?.skippedOtherFactory ?? 0} 列（其他工廠）、
                {result?.skippedOutOfScope ?? 0} 列（非計算範圍或超出年度）
                {(result?.replacedCount ?? 0) > 0 && `；已取代舊資料 ${result?.replacedCount} 筆`}
              </p>

              {result && result.parseErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-medium text-red-700 mb-2">部分分頁解析失敗：</p>
                  <ul className="text-xs text-red-600 space-y-1 list-disc list-inside">
                    {result.parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={handleReset}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg hover:bg-gray-50 transition text-sm">
                  再次匯入
                </button>
                {(result?.missingDistance ?? 0) > 0 && (
                  <a href="/admin/transport-review"
                    style={{ backgroundColor: HEADER_BG }}
                    className="flex-1 text-center text-white font-medium py-2.5 rounded-lg hover:opacity-90 transition text-sm">
                    前往資料覆核中心補值 →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

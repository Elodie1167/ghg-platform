'use client';

import { useRef, useState, useEffect } from 'react';
import type { Factory } from './page';

interface Props {
  factory: Factory;
  year: number;
  onClose: () => void;
}

type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function ImportModal({ factory, year, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 單據明細範本：選排放源 → 下載對應範本
  const [sources, setSources] = useState<{ source_code: string; name_zh: string }[]>([]);
  const [tplSource, setTplSource] = useState('');
  useEffect(() => {
    fetch('/api/emission-sources')
      .then((r) => r.json())
      .then(({ data }) => { if (Array.isArray(data)) setSources(data); })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErrorMsg('請選擇一個 .xlsx 檔案');
      return;
    }

    if (!file.name.endsWith('.xlsx')) {
      setErrorMsg('僅接受 .xlsx 格式的 Excel 檔案');
      return;
    }

    setStatus('uploading');
    setResult(null);
    setErrorMsg('');

    const formData = new FormData();
    formData.append('factory_id', factory.id);
    formData.append('year', String(year));
    formData.append('file', file);

    try {
      const res = await fetch('/api/records/import', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        setStatus('error');
        setErrorMsg(json.error ?? `上傳失敗（HTTP ${res.status}）`);
        return;
      }

      setStatus('success');
      setResult(json.data);
    } catch (err) {
      console.error('[ImportModal]', err);
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
    /* 遮罩層 */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal 卡片 */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div
          style={{ backgroundColor: '#0C3D2E' }}
          className="px-6 py-4 text-white flex items-center justify-between"
        >
          <div>
            <h2 className="text-lg font-bold">批次匯入 Excel</h2>
            <p className="text-green-300 text-sm">
              {factory.name_zh}（{factory.factory_code}）｜ {year} 年
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-green-200 hover:text-white text-2xl leading-none"
            aria-label="關閉"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {status !== 'success' ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 說明 */}
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                請上傳依照標準格式製作的 .xlsx 填報範本。系統將自動解析各 Sheet
                的資料並寫入資料庫（重複月份將覆蓋更新）。
                <br />
                <span className="text-xs text-green-700">
                  單據級明細請放在「<b>單據明細</b>」分頁，每列一張單，欄位順序：
                  月份｜排放源代碼｜單據號碼｜單據日期｜用量｜單位｜ERP參照｜備註｜公檔連結。
                  系統會依「排放源×月」自動加總為月用量並計算 CO₂e，供稽核下鑽核對。
                </span>
              </div>

              {/* 步驟一：選排放源下載單據明細範本 */}
              <div className="border border-gray-200 rounded-lg px-4 py-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">① 下載單據明細範本（選排放源）</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={tplSource} onChange={(e) => setTplSource(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[220px]">
                    <option value="">— 選擇排放源 —</option>
                    {sources.map((s) => (
                      <option key={s.source_code} value={s.source_code}>{s.source_code}　{s.name_zh}</option>
                    ))}
                  </select>
                  <a
                    href={tplSource ? `/api/records/import/template?source_code=${encodeURIComponent(tplSource)}&year=${year}` : undefined}
                    onClick={(e) => { if (!tplSource) e.preventDefault(); }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition ${tplSource ? 'hover:opacity-90' : 'opacity-40 cursor-not-allowed'}`}
                    style={{ backgroundColor: '#0C3D2E' }}
                  >
                    下載範本
                  </a>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">下載後填入各單據（或貼上 GPT 辨識結果），再於下方上傳。</p>
              </div>

              {/* 工廠 & 年度（唯讀顯示） */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">工廠</label>
                  <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-sm text-gray-700">
                    {factory.name_zh}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">盤查年度</label>
                  <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-sm text-gray-700">
                    {year} 年
                  </div>
                </div>
              </div>

              {/* 檔案上傳 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  選擇 Excel 檔案
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="block w-full text-sm text-gray-700
                             file:mr-4 file:py-2 file:px-4
                             file:rounded-lg file:border-0
                             file:text-sm file:font-medium
                             file:bg-green-50 file:text-green-700
                             hover:file:bg-green-100 transition
                             border border-gray-300 rounded-lg cursor-pointer"
                />
              </div>

              {/* 錯誤訊息 */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              {/* 按鈕 */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium
                             py-2.5 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={status === 'uploading'}
                  style={{ backgroundColor: '#0C3D2E' }}
                  className="flex-1 text-white font-medium py-2.5 rounded-lg
                             hover:opacity-90 disabled:opacity-50 transition text-sm"
                >
                  {status === 'uploading' ? '上傳中…' : '開始匯入'}
                </button>
              </div>
            </form>
          ) : (
            /* 成功結果畫面 */
            <div className="space-y-5">
              <div className="text-center py-4">
                <div className="text-5xl mb-3">✅</div>
                <h3 className="text-xl font-bold text-gray-800">匯入完成</h3>
              </div>

              {/* 統計 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-green-700">{result?.imported}</div>
                  <div className="text-sm text-green-600 mt-1">已匯入筆數</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-gray-500">{result?.skipped}</div>
                  <div className="text-sm text-gray-400 mt-1">略過筆數</div>
                </div>
              </div>

              {/* 錯誤清單 */}
              {result?.errors && result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-medium text-red-700 mb-2">
                    以下資料匯入失敗（共 {result.errors.length} 筆）：
                  </p>
                  <ul className="text-xs text-red-600 space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 按鈕 */}
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium
                             py-2.5 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  再次匯入
                </button>
                <button
                  onClick={() => {
                    onClose();
                    window.location.reload();
                  }}
                  style={{ backgroundColor: '#0C3D2E' }}
                  className="flex-1 text-white font-medium py-2.5 rounded-lg
                             hover:opacity-90 transition text-sm"
                >
                  完成，重新整理頁面
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

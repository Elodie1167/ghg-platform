'use client';

import { useRef, useState, useEffect } from 'react';
import type { Factory } from './page';

interface Props {
  factory: Factory;
  year: number;
  onClose: () => void;
  onImported?: () => void;
}

type ImportStatus = 'idle' | 'uploading' | 'success' | 'error';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  lineItemsImported?: number;
  notice?: string;
}

export default function ImportModal({ factory, year, onClose, onImported }: Props) {
  const erpFileRef = useRef<HTMLInputElement>(null);
  const tplFileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 選排放源 → 下載對應範本 / 指定 ERP 匯入目標源
  const [sources, setSources] = useState<{ source_code: string; name_zh: string }[]>([]);
  const [tplSource, setTplSource] = useState('');
  const [docUrl, setDocUrl] = useState(''); // 公檔連結（選填，供稽核一次開整月發票）
  useEffect(() => {
    fetch('/api/emission-sources')
      .then((r) => r.json())
      .then(({ data }) => { if (Array.isArray(data)) setSources(data); })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    const erpFile = erpFileRef.current?.files?.[0] ?? null;
    const tplFile = tplFileRef.current?.files?.[0] ?? null;

    // 自動偵測：哪一邊有檔案就用哪一邊
    if (erpFile && tplFile) {
      setErrorMsg('偵測到兩個檔案，請只保留一種（ERP 匯出檔 或 範本格式檔）。');
      return;
    }
    if (!erpFile && !tplFile) {
      setErrorMsg('請選擇一個檔案：ERP 匯出檔 或 範本格式檔。');
      return;
    }

    setStatus('uploading');
    setResult(null);

    try {
      if (erpFile) {
        // ── ERP 原生匯出檔 ──
        if (!tplSource) {
          setStatus('idle');
          setErrorMsg('使用 ERP 匯出檔時，請先於上方選擇排放源。');
          return;
        }
        const body = new FormData();
        body.append('factory_id', factory.id);
        body.append('year', String(year));
        body.append('source_code', tplSource);
        body.append('file', erpFile);
        if (docUrl.trim()) body.append('source_doc_url', docUrl.trim());
        const res = await fetch('/api/records/import-erp', { method: 'POST', body });
        const j = await res.json();
        if (!res.ok || j.error) {
          setStatus('error');
          setErrorMsg(j.error ?? `上傳失敗（HTTP ${res.status}）`);
          return;
        }
        const months: number[] = j.data.months ?? [];
        const skipped: number = j.data.skipped ?? 0;
        const noticeParts: string[] = [];
        if (months.length) {
          noticeParts.push(`已依 Year-Month 匯入月份：${months.join('、')} 月`);
          if (j.data.sourceEnabled) noticeParts.push('已自動為本廠啟用此排放源分頁');
        }
        if (skipped > 0 && months.length === 0) {
          noticeParts.push(`⚠ 全部 ${skipped} 列被略過，未匯入任何月份。最常見原因是檔案內的年份與所選盤查年度（${year} 年）不符，請確認年度或改選對應年度。`);
        } else if (skipped > 0) {
          noticeParts.push(`略過 ${skipped} 列（年份非 ${year} 年、或用量為空/0）。`);
        }
        setResult({
          imported: months.length,
          lineItemsImported: j.data.lineItemsImported ?? 0,
          skipped,
          errors: [],
          notice: noticeParts.length ? noticeParts.join('\n') : undefined,
        });
        setStatus('success');
        return;
      }

      // ── 範本格式檔 ──
      if (!tplFile!.name.endsWith('.xlsx')) {
        setStatus('idle');
        setErrorMsg('範本格式檔僅接受 .xlsx。');
        return;
      }
      const formData = new FormData();
      formData.append('factory_id', factory.id);
      formData.append('year', String(year));
      formData.append('file', tplFile!);
      if (docUrl.trim()) formData.append('source_doc_url', docUrl.trim());
      const res = await fetch('/api/records/import', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok || json.error) {
        setStatus('error');
        setErrorMsg(json.error ?? `上傳失敗（HTTP ${res.status}）`);
        return;
      }
      setResult(json.data);
      setStatus('success');
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
    if (erpFileRef.current) erpFileRef.current.value = '';
    if (tplFileRef.current) tplFileRef.current.value = '';
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
              {/* 簡短說明 */}
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                請選擇 ERP 匯出之單據上傳或是下載範本進行上傳。
              </div>

              {/* ① 選排放源（＋下載範本） */}
              <div className="border border-gray-200 rounded-lg px-4 py-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">① 選擇排放源</p>
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
                  <a
                    href={`/api/records/import/template/all?factory_code=${encodeURIComponent(factory.factory_code)}&year=${year}`}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-green-700 text-green-800 hover:bg-green-50 transition"
                  >
                    下載所有適用範本
                  </a>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">使用 ERP 匯出檔時，此排放源即為匯入目標源；使用範本時可先下載對應排放源範本，或一次下載本廠所有適用排放源範本（zip）。</p>
              </div>

              {/* ② 工廠 & 年度（唯讀顯示，置於選排放源下方） */}
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

              {/* 公檔連結（選填） */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">公檔發票資料夾路徑（選填）</label>
                <input
                  type="text"
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  placeholder="\\nt_pdc\永續發展部\...\發票（供稽核一次開整月發票）"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              {/* ③ 兩種上傳方式：擇一 */}
              <div className="space-y-3">
                <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-indigo-700 mb-2">方式 A：上傳 ERP 匯出檔（.tsv / .csv / .xlsx）</p>
                  <input ref={erpFileRef} type="file" accept=".tsv,.csv,.xlsx"
                    className="block w-full text-xs text-gray-700 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 border border-gray-300 rounded-lg cursor-pointer" />
                </div>

                <div className="text-center text-xs text-gray-400">— 或 —</div>

                <div className="border border-green-200 bg-green-50/40 rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-green-700 mb-2">方式 B：上傳範本格式檔（.xlsx，上方下載的範本填好後）</p>
                  <input ref={tplFileRef} type="file" accept=".xlsx"
                    className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100 border border-gray-300 rounded-lg cursor-pointer" />
                </div>
              </div>

              {/* 錯誤訊息 */}
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              {/* 按鈕：單一開始匯入，自動偵測 */}
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
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-green-700">{result?.imported ?? 0}</div>
                  <div className="text-sm text-green-600 mt-1">月加總匯入</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-blue-700">{result?.lineItemsImported ?? 0}</div>
                  <div className="text-sm text-blue-600 mt-1">單據明細筆數</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-gray-500">{result?.skipped ?? 0}</div>
                  <div className="text-sm text-gray-400 mt-1">略過筆數</div>
                </div>
              </div>

              {/* 提示 */}
              {result?.notice && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 whitespace-pre-line">
                  {result.notice}
                </div>
              )}

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
                    onImported?.(); // 就地重載本頁資料，停在目前排放源分頁（不整頁 reload、不跳回基本設定）
                    onClose();
                  }}
                  style={{ backgroundColor: '#0C3D2E' }}
                  className="flex-1 text-white font-medium py-2.5 rounded-lg
                             hover:opacity-90 transition text-sm"
                >
                  完成，更新此頁
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

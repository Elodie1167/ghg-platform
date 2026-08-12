'use client';

import { useRef, useState, useEffect } from 'react';
import type { Factory } from './page';

interface Props {
  factory: Factory;
  year: number;
  onClose: () => void;
  onImported?: () => void;
}

// idle → previewing → previewed（等使用者選模式確認）→ committing → success
type ImportStatus = 'idle' | 'previewing' | 'previewed' | 'committing' | 'success' | 'error';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  lineItemsImported?: number;
  notice?: string;
}

interface FixedDiff {
  source_code: string;
  month: number;
  status: 'new' | 'update' | 'same';
  old_value: number | null;
  old_unit: string | null;
  is_reviewed: boolean;
  new_value: number | null;
  new_unit: string;
}

interface LineItemDiff {
  source_code: string;
  month: number;
  is_reviewed: boolean;
  existing_count: number;
  existing_sum: number;
  existing_unit: string | null;
  incoming_count: number;
  incoming_sum: number;
  incoming_unit: string;
  possible_duplicates: number;
}

interface PreviewResult {
  hasFixedRows: boolean;
  hasLineItems: boolean;
  fixedDiffs: FixedDiff[];
  lineItemDiffs: LineItemDiff[];
  errors: string[];
  notice?: string;
}

type FixedMode = 'add_only' | 'add_update';
type LineItemMode = 'full_month' | 'supplement';

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export default function ImportModal({ factory, year, onClose, onImported }: Props) {
  const erpFileRef = useRef<HTMLInputElement>(null);
  const tplFileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 使用者對本次匯入的模式選擇（設計文件 §4.2）；預覽拿到後才顯示對應的選項
  const [fixedMode, setFixedMode] = useState<FixedMode>('add_only');
  const [lineItemMode, setLineItemMode] = useState<LineItemMode>('full_month');

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

  // ── 方式 A（ERP 原生檔）維持原本行為：無預覽步驟，直接送 ──
  async function handleErpSubmit(erpFile: File) {
    if (!tplSource) {
      setStatus('idle');
      setErrorMsg('使用 ERP 匯出檔時，請先於上方選擇排放源。');
      return;
    }
    setStatus('committing');
    const body = new FormData();
    body.append('factory_id', factory.id);
    body.append('year', String(year));
    body.append('source_code', tplSource);
    body.append('file', erpFile);
    if (docUrl.trim()) body.append('source_doc_url', docUrl.trim());
    try {
      const res = await fetch('/api/records/import-erp', { method: 'POST', body });
      const j = await res.json();
      if (!res.ok || j.error) {
        setStatus('error');
        setErrorMsg(j.error ?? `上傳失敗（HTTP ${res.status}）`);
        return;
      }
      const months: number[] = j.data.months ?? [];
      const skippedN: number = j.data.skipped ?? 0;
      const noticeParts: string[] = [];
      if (months.length) {
        noticeParts.push(`已依 Year-Month 匯入月份：${months.join('、')} 月`);
        if (j.data.sourceEnabled) noticeParts.push('已自動為本廠啟用此排放源分頁');
      }
      if (skippedN > 0 && months.length === 0) {
        noticeParts.push(`⚠ 全部 ${skippedN} 列被略過，未匯入任何月份。最常見原因是檔案內的年份與所選盤查年度（${year} 年）不符，請確認年度或改選對應年度。`);
      } else if (skippedN > 0) {
        noticeParts.push(`略過 ${skippedN} 列（年份非 ${year} 年、或用量為空/0）。`);
      }
      setResult({
        imported: months.length,
        lineItemsImported: j.data.lineItemsImported ?? 0,
        skipped: skippedN,
        errors: [],
        notice: noticeParts.length ? noticeParts.join('\n') : undefined,
      });
      setStatus('success');
    } catch (err) {
      console.error('[ImportModal ERP]', err);
      setStatus('error');
      setErrorMsg('網路錯誤，請稍後再試');
    }
  }

  // ── 方式 B（範本檔）Step 1：先預覽，不寫入任何東西 ──
  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    const erpFile = erpFileRef.current?.files?.[0] ?? null;
    const tplFile = tplFileRef.current?.files?.[0] ?? null;

    if (erpFile && tplFile) {
      setErrorMsg('偵測到兩個檔案，請只保留一種（ERP 匯出檔 或 範本格式檔）。');
      return;
    }
    if (!erpFile && !tplFile) {
      setErrorMsg('請選擇一個檔案：ERP 匯出檔 或 範本格式檔。');
      return;
    }
    if (erpFile) {
      await handleErpSubmit(erpFile);
      return;
    }
    if (!tplFile!.name.endsWith('.xlsx')) {
      setErrorMsg('範本格式檔僅接受 .xlsx。');
      return;
    }

    setStatus('previewing');
    try {
      const formData = new FormData();
      formData.append('factory_id', factory.id);
      formData.append('year', String(year));
      formData.append('file', tplFile!);
      formData.append('phase', 'preview');
      const res = await fetch('/api/records/import', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok || json.error) {
        setStatus('error');
        setErrorMsg(json.error ?? `預覽失敗（HTTP ${res.status}）`);
        return;
      }
      setPreview(json.data);
      setStatus('previewed');
    } catch (err) {
      console.error('[ImportModal preview]', err);
      setStatus('error');
      setErrorMsg('網路錯誤，請稍後再試');
    }
  }

  // ── Step 2：使用者看過差異、選好模式後才真正送出 ──
  async function handleCommit() {
    const tplFile = tplFileRef.current?.files?.[0];
    if (!tplFile) {
      setStatus('error');
      setErrorMsg('找不到原始檔案，請重新選擇檔案再試一次。');
      return;
    }
    setStatus('committing');
    setErrorMsg('');
    try {
      const formData = new FormData();
      formData.append('factory_id', factory.id);
      formData.append('year', String(year));
      formData.append('file', tplFile);
      formData.append('phase', 'commit');
      if (preview?.hasFixedRows) formData.append('fixed_mode', fixedMode);
      if (preview?.hasLineItems) formData.append('line_item_mode', lineItemMode);
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
      console.error('[ImportModal commit]', err);
      setStatus('error');
      setErrorMsg('網路錯誤，請稍後再試');
    }
  }

  function handleReset() {
    setStatus('idle');
    setResult(null);
    setPreview(null);
    setErrorMsg('');
    setFixedMode('add_only');
    setLineItemMode('full_month');
    if (erpFileRef.current) erpFileRef.current.value = '';
    if (tplFileRef.current) tplFileRef.current.value = '';
  }

  const reviewedFixedCount = preview?.fixedDiffs.filter((d) => d.is_reviewed && d.status !== 'same').length ?? 0;
  const reviewedLineCount = preview?.lineItemDiffs.filter((d) => d.is_reviewed).length ?? 0;
  const changingFixed = preview?.fixedDiffs.filter((d) => d.status !== 'same') ?? [];

  return (
    /* 遮罩層 */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal 卡片 */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div
          style={{ backgroundColor: '#0C3D2E' }}
          className="px-6 py-4 text-white flex items-center justify-between shrink-0"
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
        <div className="px-6 py-6 overflow-y-auto">
          {status === 'idle' || status === 'previewing' || status === 'error' ? (
            <form onSubmit={handlePreview} className="space-y-5">
              {/* 簡短說明 */}
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
                請選擇 ERP 匯出之單據上傳或是下載範本進行上傳。範本格式檔會先預覽將發生的變化，確認後才會真正寫入。
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
                  disabled={status === 'previewing'}
                  style={{ backgroundColor: '#0C3D2E' }}
                  className="flex-1 text-white font-medium py-2.5 rounded-lg
                             hover:opacity-90 disabled:opacity-50 transition text-sm"
                >
                  {status === 'previewing' ? '檢查中…' : '下一步：預覽差異'}
                </button>
              </div>
            </form>
          ) : status === 'previewed' ? (
            /* ── 預覽畫面：看過差異、選模式再確認 ── */
            <div className="space-y-5">
              <h3 className="text-base font-bold text-gray-800">確認匯入內容</h3>

              {preview?.errors && preview.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-medium text-red-700 mb-1">以下內容無法辨識：</p>
                  <ul className="text-xs text-red-600 space-y-1 list-disc list-inside">
                    {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              {preview?.notice && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                  {preview.notice}
                </div>
              )}

              {/* 固定分頁（月加總）差異 */}
              {preview && preview.hasFixedRows && (
                <div className="border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-gray-700 mb-2">
                    月加總資料（{changingFixed.length} 個月份將有變化）
                    {reviewedFixedCount > 0 && (
                      <span className="ml-2 text-amber-700">⚠ 其中 {reviewedFixedCount} 個月份已查核</span>
                    )}
                  </p>

                  <div className="max-h-40 overflow-y-auto border border-gray-100 rounded mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1">排放源</th>
                          <th className="text-left px-2 py-1">月份</th>
                          <th className="text-left px-2 py-1">狀態</th>
                          <th className="text-right px-2 py-1">舊值</th>
                          <th className="text-right px-2 py-1">新值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.fixedDiffs.filter((d) => d.status !== 'same').map((d, i) => (
                          <tr key={i} className={d.is_reviewed ? 'bg-amber-50' : ''}>
                            <td className="px-2 py-1">{d.source_code}</td>
                            <td className="px-2 py-1">{d.month} 月</td>
                            <td className="px-2 py-1">
                              {d.status === 'new' ? '🟢 新增' : '🟡 更新'}
                              {d.is_reviewed && ' ⚠已查核'}
                            </td>
                            <td className="px-2 py-1 text-right">{fmtNum(d.old_value)}</td>
                            <td className="px-2 py-1 text-right">{fmtNum(d.new_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs font-medium text-gray-600 mb-1.5">匯入模式</p>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="fixedMode" className="mt-0.5" checked={fixedMode === 'add_only'}
                        onChange={() => setFixedMode('add_only')} />
                      <span><strong>僅新增</strong>（預設）——只寫尚無資料的月份，已有資料一律略過，不覆蓋</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="fixedMode" className="mt-0.5" checked={fixedMode === 'add_update'}
                        onChange={() => setFixedMode('add_update')} />
                      <span><strong>新增 + 更新</strong>——已有資料的月份會被上表列出的新值覆蓋{reviewedFixedCount > 0 && '，包含已查核的月份'}</span>
                    </label>
                  </div>
                </div>
              )}

              {/* 單據明細差異 */}
              {preview && preview.hasLineItems && (
                <div className="border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-gray-700 mb-2">
                    單據明細（{preview.lineItemDiffs.length} 組排放源×月份）
                    {reviewedLineCount > 0 && (
                      <span className="ml-2 text-amber-700">⚠ 其中 {reviewedLineCount} 組已查核</span>
                    )}
                  </p>

                  <div className="max-h-40 overflow-y-auto border border-gray-100 rounded mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1">排放源</th>
                          <th className="text-left px-2 py-1">月份</th>
                          <th className="text-right px-2 py-1">現有</th>
                          <th className="text-right px-2 py-1">本次上傳</th>
                          <th className="text-left px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.lineItemDiffs.map((d, i) => (
                          <tr key={i} className={d.is_reviewed ? 'bg-amber-50' : ''}>
                            <td className="px-2 py-1">{d.source_code}</td>
                            <td className="px-2 py-1">{d.month} 月</td>
                            <td className="px-2 py-1 text-right">{d.existing_count} 筆 / {fmtNum(d.existing_sum)}</td>
                            <td className="px-2 py-1 text-right">{d.incoming_count} 筆 / {fmtNum(d.incoming_sum)}</td>
                            <td className="px-2 py-1">
                              {d.is_reviewed && <span className="text-amber-700">⚠已查核</span>}
                              {d.possible_duplicates > 0 && (
                                <span className="text-orange-600 ml-1">🟠可能重複{d.possible_duplicates}筆</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs font-medium text-gray-600 mb-1.5">匯入模式</p>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="lineItemMode" className="mt-0.5" checked={lineItemMode === 'full_month'}
                        onChange={() => setLineItemMode('full_month')} />
                      <span>
                        <strong>整月完整檔</strong>（預設）——這批就是該月完整明細，
                        {preview.lineItemDiffs.some((d) => d.existing_count > 0) && (
                          <>將<span className="text-red-600 font-medium">刪除現有明細後重新寫入</span>，</>
                        )}
                        以本次上傳為準
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="lineItemMode" className="mt-0.5" checked={lineItemMode === 'supplement'}
                        onChange={() => setLineItemMode('supplement')} />
                      <span><strong>補單</strong>——保留現有明細，只新增這批（例如漏了幾張單要補進去）</span>
                    </label>
                  </div>
                </div>
              )}

              {(reviewedFixedCount > 0 || reviewedLineCount > 0) && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  ⚠ 本次匯入會影響已查核的資料。若確認送出，這些月份的查核狀態會被清除，需要重新查核才會納入彙總與報告書。
                </div>
              )}

              {errorMsg && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium
                             py-2.5 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  返回重選
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={!preview?.hasFixedRows && !preview?.hasLineItems}
                  style={{ backgroundColor: (reviewedFixedCount > 0 || reviewedLineCount > 0) ? '#b91c1c' : '#0C3D2E' }}
                  className="flex-1 text-white font-medium py-2.5 rounded-lg
                             hover:opacity-90 disabled:opacity-50 transition text-sm"
                >
                  {(reviewedFixedCount > 0 || reviewedLineCount > 0) ? '確認覆蓋並匯入' : '確認匯入'}
                </button>
              </div>
            </div>
          ) : status === 'committing' ? (
            <div className="py-12 text-center text-gray-500 text-sm">寫入中…</div>
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

'use client';

import { Fragment, useState } from 'react';

const HEADER_BG = '#0C3D2E';

export interface AnomalyFlag {
  id: string;
  rule_code: string;
  severity: 'blocking' | 'advisory';
  factory_code: string;
  factory_name_zh: string | null;
  year: number;
  month: number;
  subject_key: string;
  record_id: string | null;
  status: 'open' | 'confirmed_ok' | 'resolved';
  detail: Record<string, unknown>;
  note: string | null;
  first_seen_at: string;
  last_checked_at: string;
  resolved_at: string | null;
}

interface Factory {
  factory_code: string;
  name_zh: string;
}

interface Props {
  initialFlags: AnomalyFlag[];
  factories: Factory[];
}

const RULE_LABELS: Record<string, string> = {
  GOV_CSR_GHG_MISMATCH: '清冊 vs CSR 落差',
  DATA_NOT_YET_FILED: '清冊尚未填報',
  DATA_MISSING_MONTH: '缺月填報',
  LOGIC_REC_EXCEED: 'iREC 超過購電量',
  LOGIC_BIOMASS_CO2: '生質 CO2 缺揭露',
  LOGIC_NEGATIVE_TOTAL: 'CO2e 為負值',
  LOGIC_MISSING_FACTOR: '缺排放係數',
  TREND_MONTH_SPIKE: '月變動異常（±30%）',
  TREND_YOY_CHANGE: '年變動異常（±30%）',
  TREND_ZERO_AFTER_ACTIVE: '突然歸零',
  GOV_DUPLICATE_ENTRY: '疑似重複輸入',
  MISSING_ROUTE_DISTANCE: '上游運輸缺距離待補',
};

function ruleLabel(code: string): string {
  return RULE_LABELS[code] ?? code;
}

function formatMonth(month: number): string {
  return month === 0 ? '全年' : `${month} 月`;
}

export default function AnomalyClient({ initialFlags, factories }: Props) {
  const [flags, setFlags] = useState<AnomalyFlag[]>(initialFlags);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'blocking' | 'advisory'>('all');
  const [factoryFilter, setFactoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'confirmed_ok' | 'all'>('open');
  const [ruleFilter, setRuleFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runYear, setRunYear] = useState(new Date().getFullYear());
  const [runMsg, setRunMsg] = useState('');

  const availableYears = Array.from(new Set(flags.map((f) => f.year))).sort((a, b) => b - a);
  const availableRuleCodes = Array.from(new Set(flags.map((f) => f.rule_code))).sort();

  const filtered = flags.filter((f) => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (factoryFilter && f.factory_code !== factoryFilter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (ruleFilter && f.rule_code !== ruleFilter) return false;
    return true;
  });

  const blockingOpenCount = flags.filter((f) => f.severity === 'blocking' && f.status === 'open').length;
  const advisoryOpenCount = flags.filter((f) => f.severity === 'advisory' && f.status === 'open').length;

  async function updateStatus(id: string, status: AnomalyFlag['status'], note?: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/anomaly/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      });
      if (!res.ok) { alert('更新失敗'); return; }
      const data = await res.json();
      setFlags((prev) => prev.map((f) => f.id === id ? { ...f, status: data.data.status, note: data.data.note } : f));
      setExpandedId(null);
      setNoteDraft('');
    } finally {
      setSavingId(null);
    }
  }

  async function runRules() {
    setRunning(true);
    setRunMsg('');
    try {
      const res = await fetch('/api/admin/anomaly/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: runYear }),
      });
      const data = await res.json();
      if (!res.ok) { setRunMsg(`❌ ${data.error}`); return; }
      const total = (data.data.rules as { flagCount: number }[]).reduce((sum, r) => sum + r.flagCount, 0);
      setRunMsg(`✅ 已重跑 ${runYear} 年，共 ${total} 筆異常（含尚未確認與已存在）。請重新整理頁面查看最新清單。`);
    } catch {
      setRunMsg('❌ 發生錯誤，請重試');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[1920px] mx-auto px-6 md:px-10 flex items-center justify-between flex-wrap gap-3">
          <div>
            <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
            <h1 className="text-xl font-bold mt-0.5">異常清單</h1>
            <p className="text-xs text-green-200 mt-0.5">
              阻斷級 {blockingOpenCount} 筆待處理 · 提示級 {advisoryOpenCount} 筆待確認
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[10px] text-green-200 mb-1">重跑年度</label>
              <input type="number" min="2020" max="2100" value={runYear}
                onChange={(e) => setRunYear(Number(e.target.value))}
                className="border border-white/30 bg-white/10 rounded px-2 py-1.5 text-sm w-24 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50" />
            </div>
            <button onClick={runRules} disabled={running}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-white/95 hover:bg-white transition disabled:opacity-50"
              style={{ color: HEADER_BG }}>
              {running ? '執行中…' : '↻ 立即重跑規則'}
            </button>
          </div>
        </div>
        {runMsg && <p className="max-w-[1920px] mx-auto px-6 md:px-10 text-xs mt-2 text-amber-200">{runMsg}</p>}
      </div>

      <div className="max-w-[1920px] mx-auto px-6 md:px-10 py-6">
        {/* 篩選列 */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['all', 'blocking', 'advisory'] as const).map((s) => (
              <button key={s} onClick={() => setSeverityFilter(s)}
                className={`px-4 py-1.5 font-medium transition ${severityFilter === s ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                style={severityFilter === s ? { backgroundColor: HEADER_BG } : {}}>
                {s === 'all' ? '全部嚴重度' : s === 'blocking' ? '阻斷級' : '提示級'}
              </button>
            ))}
          </div>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="open">待處理</option>
            <option value="confirmed_ok">已確認無誤</option>
            <option value="all">全部狀態</option>
          </select>

          <select value={factoryFilter} onChange={(e) => setFactoryFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">全部廠別</option>
            {factories.map((f) => <option key={f.factory_code} value={f.factory_code}>{f.factory_code} {f.name_zh}</option>)}
          </select>

          <select value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">全部規則</option>
            {availableRuleCodes.map((code) => <option key={code} value={code}>{ruleLabel(code)}</option>)}
          </select>

          {availableYears.length > 1 && (
            <span className="text-xs text-gray-400">年度：{availableYears.join('、')}</span>
          )}
        </div>

        {/* 主表格 */}
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white text-xs">
                <th className="px-3 py-3 text-left w-20">嚴重度</th>
                <th className="px-3 py-3 text-left">規則</th>
                <th className="px-3 py-3 text-left w-32">廠別</th>
                <th className="px-3 py-3 text-center w-24">年月</th>
                <th className="px-3 py-3 text-left">說明</th>
                <th className="px-3 py-3 text-center w-24">狀態</th>
                <th className="px-3 py-3 text-center w-48">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                    {flags.length === 0 ? '目前無異常記錄' : '篩選結果為空'}
                  </td>
                </tr>
              ) : filtered.map((f, idx) => {
                const message = typeof f.detail?.message === 'string' ? f.detail.message : '';
                const isExpanded = expandedId === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr className={`border-b border-gray-100 hover:bg-green-50/30 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="px-3 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.severity === 'blocking' ? 'text-red-700 bg-red-50' : 'text-amber-700 bg-amber-50'}`}>
                          {f.severity === 'blocking' ? '阻斷' : '提示'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-800 text-xs">
                        {ruleLabel(f.rule_code)}
                        {f.subject_key && <span className="ml-1.5 font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{f.subject_key}</span>}
                      </td>
                      <td className="px-3 py-3 font-mono text-gray-700 text-xs">
                        {f.factory_code}
                        {f.factory_name_zh && <div className="text-gray-400 font-sans text-[10px]">{f.factory_name_zh}</div>}
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-gray-600">{f.year} / {formatMonth(f.month)}</td>
                      <td className="px-3 py-3 text-gray-700 text-xs">{message}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          f.status === 'open' ? 'text-gray-500 bg-gray-100'
                          : f.status === 'confirmed_ok' ? 'text-green-700 bg-green-50'
                          : 'text-gray-400 bg-gray-50'
                        }`}>
                          {f.status === 'open' ? '待處理' : f.status === 'confirmed_ok' ? '已確認' : '已解決'}
                        </span>
                        {f.note && <div className="text-[10px] text-gray-400 mt-1 max-w-[140px] truncate" title={f.note}>{f.note}</div>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex gap-1.5 justify-center">
                          <button onClick={() => setExpandedId(isExpanded ? null : f.id)}
                            className="px-3 py-1 rounded border border-gray-200 text-gray-500 text-xs hover:bg-gray-50 transition">
                            詳情
                          </button>
                          {f.status !== 'confirmed_ok' && (
                            <button onClick={() => { setExpandedId(f.id); setNoteDraft(f.note ?? ''); }}
                              disabled={savingId === f.id}
                              className="px-3 py-1 rounded text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
                              style={{ backgroundColor: HEADER_BG }}>
                              確認無誤
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="flex flex-wrap gap-6 items-start">
                            <pre className="text-[11px] bg-white border border-gray-200 rounded p-3 max-w-md overflow-x-auto">
                              {JSON.stringify(f.detail, null, 2)}
                            </pre>
                            <div className="flex-1 min-w-[240px]">
                              <label className="block text-xs text-gray-500 mb-1">註記（確認無誤時填寫原因）</label>
                              <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                                rows={2}
                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500" />
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => updateStatus(f.id, 'confirmed_ok', noteDraft)}
                                  disabled={savingId === f.id}
                                  className="px-3 py-1.5 rounded text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
                                  style={{ backgroundColor: HEADER_BG }}>
                                  標記已確認無誤
                                </button>
                                {f.status !== 'open' && (
                                  <button onClick={() => updateStatus(f.id, 'open', noteDraft)}
                                    disabled={savingId === f.id}
                                    className="px-3 py-1.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-100 transition disabled:opacity-50">
                                    重新開啟
                                  </button>
                                )}
                                <p className="text-[10px] text-gray-400 self-center ml-1">
                                  首次發現 {new Date(f.first_seen_at).toLocaleDateString('zh-TW')}，最後檢查 {new Date(f.last_checked_at).toLocaleDateString('zh-TW')}
                                </p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3">共 {filtered.length} 筆（全部 {flags.length} 筆，僅顯示未解決）</p>
        <p className="text-xs text-gray-400 mt-1">
          ⚠️ 本清單為 AI 規則偵測結果，僅供人工複核參考，數字結論仍需 ESG／查證單位確認後才可對外引用。
        </p>
      </div>
    </div>
  );
}

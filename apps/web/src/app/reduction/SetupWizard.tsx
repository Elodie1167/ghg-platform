'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IREC_KWH_PER_CERT, type ReductionSource, type RecSource } from '@/lib/reduction-types';
import { countryLabelsOf, orderCountryCodes, type CountryMeta } from '@/lib/registry-types';

// =============================================================
// /reduction 設定引導（進頁先跳出，選完才計算並呈現結果）
//   步驟一：資料來源（CSR 可直接上傳明細表）／iREC 來源／係數年度
//   步驟二：資料月份區間（CSR 依產量自動偵測到幾月）＋手動 iREC 張數微調
//   完成 → 帶 ready=1 導回 /reduction，由 server 計算並呈現
//
// ⚠️ 產出屬 ESG 揭露性質，需永續發展部確認，不下最終結論。
// =============================================================

const HEADER_BG = '#0C3D2E';
const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
// 產區順序與標籤由 server 以 countries prop 傳入（DB 名冊），不再在此硬編碼

type Factory = { factory_code: string; name_zh: string; country_code: string };

type Detected = {
  minMonth: number | null; maxMonth: number | null;
  monthCount: number; hasAnnualLump: boolean; hasData: boolean;
};

export default function SetupWizard({ defaultYear, defaultFactorYear, countries }: {
  defaultYear: number; defaultFactorYear: number;
  /** 產區順序與標籤，來自 DB 名冊 */
  countries: CountryMeta[];
}) {
  const router = useRouter();
  const countryLabels = countryLabelsOf(countries);
  const [step, setStep] = useState<1 | 2>(1);

  // 步驟一
  const [source, setSource] = useState<ReductionSource>('csr');
  const [year, setYear] = useState(defaultYear);
  const [recSource, setRecSource] = useState<RecSource>('platform');
  const [factorYear, setFactorYear] = useState(defaultFactorYear);

  // 上傳 CSR
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  // 步驟二
  const [loadingNext, setLoadingNext] = useState(false);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [monthFrom, setMonthFrom] = useState(1);
  const [monthTo, setMonthTo] = useState(12);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [certs, setCerts] = useState<Record<string, string>>({});
  const [prevManual, setPrevManual] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadMsg('上傳解析中…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('year', String(year));
      const res = await fetch('/api/reduction/import-csr', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? '匯入失敗');
      const { energyRows, prodRows, warnings } = json.data;
      setUploadMsg(`✅ 已匯入 ${year} 年：能源 ${energyRows} 筆、產能 ${prodRows} 筆${warnings?.length ? `（${warnings.length} 項提醒）` : ''}`);
    } catch (e2) {
      setUploadMsg(`❌ ${e2 instanceof Error ? e2.message : '匯入失敗'}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // 步驟一 → 步驟二：偵測月份 +（手填時）帶入平台目前 iREC 量
  async function goStep2() {
    setLoadingNext(true); setErr('');
    try {
      const monthsReq = fetch(`/api/reduction/data-months?year=${year}&source=${source}`).then((r) => r.json());
      const needIrec = source === 'csr' && recSource === 'manual';
      const [monthsRes, factRes, recRes, manualRes] = await Promise.all([
        monthsReq,
        needIrec ? fetch('/api/factories').then((r) => r.json()) : Promise.resolve(null),
        needIrec ? fetch(`/api/rec-certificates?year=${year}`).then((r) => r.json()) : Promise.resolve(null),
        needIrec ? fetch(`/api/csr-rec?year=${year}`).then((r) => r.json()) : Promise.resolve(null),
      ]);

      const d: Detected = monthsRes?.data ?? { minMonth: null, maxMonth: null, monthCount: 0, hasAnnualLump: false, hasData: false };
      setDetected(d);
      // 依指示：CSR 產量填到幾月，區間就抓到那個月
      setMonthFrom(d.minMonth ?? 1);
      setMonthTo(d.maxMonth ?? 12);

      if (needIrec) {
        const facs = ((factRes?.data ?? []) as Factory[]);
        setFactories(facs);
        // 手填預設帶入 GHG 平台該年已登錄 iREC 量（可改）
        const platformKwh = new Map<string, number>();
        for (const row of (recRes?.data ?? []) as Array<{ factory_code: string; rec_kwh: number }>) {
          platformKwh.set(row.factory_code, (platformKwh.get(row.factory_code) || 0) + (Number(row.rec_kwh) || 0));
        }
        const saved: Record<string, number> = {};
        for (const row of (manualRes?.data ?? []) as Array<{ factory_code: string; certs: number }>) {
          if (Number(row.certs) > 0) saved[row.factory_code] = Number(row.certs);
        }
        setPrevManual(saved);
        setCerts(Object.fromEntries(facs.map((f) => {
          const c = (platformKwh.get(f.factory_code) || 0) / IREC_KWH_PER_CERT;
          return [f.factory_code, c ? String(Math.round(c * 100) / 100) : ''];
        })));
      }
      setStep(2);
    } catch {
      setErr('讀取設定資料失敗，請重試。');
    } finally {
      setLoadingNext(false);
    }
  }

  async function finish() {
    setSubmitting(true); setErr('');
    try {
      if (source === 'csr' && recSource === 'manual') {
        for (const f of factories) {
          const raw = certs[f.factory_code];
          const c = raw === '' || raw == null ? 0 : Number(raw);
          if (isNaN(c)) continue;
          await fetch('/api/csr-rec', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year, factory_code: f.factory_code, certs: c }),
          });
        }
      }
      const [mf, mt] = monthFrom <= monthTo ? [monthFrom, monthTo] : [monthTo, monthFrom];
      const params = new URLSearchParams({
        ready: '1', source, year: String(year),
        monthFrom: String(mf), monthTo: String(mt),
        recSource: source === 'platform' ? 'platform' : recSource,
        factorYear: String(factorYear),
      });
      router.push(`/reduction?${params.toString()}`);
    } catch {
      setErr('儲存手動 iREC 失敗，請重試。');
      setSubmitting(false);
    }
  }

  const byCC = new Map<string, Factory[]>();
  for (const f of factories) {
    if (!byCC.has(f.country_code)) byCC.set(f.country_code, []);
    byCC.get(f.country_code)!.push(f);
  }
  const regions = orderCountryCodes(byCC.keys(), countries);
  const hasPrevManual = Object.keys(prevManual).length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-4">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">減碳績效追蹤</h1>
          <p className="text-green-300 text-sm">S1/S2（地域·市場）· 減碳 KPI · 綠電占比 · 2020–2050 減碳路徑</p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
          {/* 步驟指示 */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <StepDot n={1} active={step === 1} done={step > 1} label="資料來源設定" />
            <div className="flex-1 h-px bg-gray-200" />
            <StepDot n={2} active={step === 2} done={false} label="資料月份與 iREC" />
          </div>

          <div className="p-6 space-y-6">
            {step === 1 ? (
              <>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">請先確認資料來源</h2>
                  <p className="text-xs text-gray-500 mt-1">選定後才會進行計算並呈現結果，避免看到未確認條件的數字。</p>
                </div>

                {/* 資料來源 */}
                <Field label="① 資料來源" hint="CSR 匯出＝以 CSR 能源明細表為準；GHG 平台＝以平台填報記錄為準">
                  <div className="flex flex-wrap items-center gap-3">
                    <Choice active={source === 'csr'} onClick={() => setSource('csr')} title="CSR 匯出" desc="CSR 能源明細表" />
                    <Choice active={source === 'platform'} onClick={() => { setSource('platform'); setRecSource('platform'); }} title="GHG 平台" desc="平台填報記錄" />
                    {source === 'csr' && (
                      <span className="flex items-center gap-2">
                        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onUpload} />
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                          className="px-3 py-2 rounded-lg text-xs font-medium text-white transition disabled:opacity-60"
                          style={{ backgroundColor: '#b45309' }}>
                          {uploading ? '匯入中…' : `⬆ 上傳 CSR 能源明細表（覆寫 ${year} 年）`}
                        </button>
                      </span>
                    )}
                  </div>
                  {uploadMsg && <p className="text-[11px] text-gray-600 mt-2">{uploadMsg}</p>}
                </Field>

                {/* 年度 */}
                <Field label="② 資料年度">
                  <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Field>

                {/* iREC 來源 */}
                {source === 'csr' && (
                  <Field label="③ iREC 來源" hint="手動輸入會先帶入 GHG 平台目前登錄量，可自行修改（下一步調整）">
                    <div className="flex flex-wrap items-center gap-3">
                      <Choice active={recSource === 'platform'} onClick={() => setRecSource('platform')}
                        title="GHG 平台帶入" desc="讀平台 iREC 憑證" />
                      <Choice active={recSource === 'manual'} onClick={() => setRecSource('manual')}
                        title="手動輸入" desc="先帶平台量再調整" />
                    </div>
                  </Field>
                )}

                {/* 係數年度 */}
                <Field label={`${source === 'csr' ? '④' : '③'} 排放係數年度`} hint={`預設為現在時間的前一年（${defaultFactorYear}）`}>
                  <select value={factorYear} onChange={(e) => setFactorYear(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {rangeYears(2020, Math.max(year, defaultFactorYear)).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Field>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">確認資料月份區間</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    {detected?.hasData
                      ? `已自動偵測 ${year} 年${source === 'csr' ? ' CSR ' : '平台'}產量資料落在 ${detected.minMonth}–${detected.maxMonth} 月（共 ${detected.monthCount} 個月），可自行調整。`
                      : `查無 ${year} 年產量資料，已預設 1–12 月；強度分母可能為 0，請確認是否已上傳／填報。`}
                  </p>
                </div>

                {detected?.hasAnnualLump && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                    ⚠️ 該年另有「整年合計（月=0）」的產量資料，月份區間偵測不含該筆，計算時仍會計入。
                  </div>
                )}

                <Field label="資料月份區間">
                  <div className="flex items-center gap-2">
                    <select value={monthFrom} onChange={(e) => setMonthFrom(Number(e.target.value))}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                      {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
                    </select>
                    <span className="text-gray-400">–</span>
                    <select value={monthTo} onChange={(e) => setMonthTo(Number(e.target.value))}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                      {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
                    </select>
                    <span className="text-xs text-gray-500 ml-1">
                      共 {Math.abs(monthTo - monthFrom) + 1} 個月 ｜ iREC 將按 ÷12×{Math.abs(monthTo - monthFrom) + 1} 攤提
                    </span>
                  </div>
                </Field>

                {source === 'csr' && recSource === 'manual' && (
                  <Field label="手動 iREC（各廠張數，1 張 = 1 MWh）"
                    hint={`已帶入 GHG 平台 ${year} 年登錄量，可直接修改；此為全年採購量，計算時依所選月份攤提`}>
                    {hasPrevManual && (
                      <button type="button"
                        onClick={() => setCerts((p) => ({ ...p, ...Object.fromEntries(Object.entries(prevManual).map(([k, v]) => [k, String(v)])) }))}
                        className="mb-2 px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition">
                        ↩ 沿用上次手填值
                      </button>
                    )}
                    <div className="divide-y divide-gray-100 border-t border-gray-100 max-h-72 overflow-y-auto">
                      {regions.map((cc) => (
                        <div key={cc} className="flex flex-wrap items-center gap-2 py-2.5">
                          <div className="w-16 shrink-0 text-sm font-bold text-gray-700">{countryLabels[cc] ?? cc}</div>
                          {byCC.get(cc)!.map((f) => (
                            <label key={f.factory_code} title={f.name_zh}
                              className="flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 px-2.5 py-1.5">
                              <span className="text-xs text-gray-600 font-mono whitespace-nowrap">{f.factory_code}</span>
                              <input type="number" min="0" step="any" value={certs[f.factory_code] ?? ''}
                                onChange={(e) => setCerts((p) => ({ ...p, [f.factory_code]: e.target.value }))}
                                className="border border-gray-300 rounded px-2 py-0.5 text-sm font-mono w-20 focus:outline-none focus:ring-2 focus:ring-green-500" />
                              <span className="text-xs text-gray-400">張</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </Field>
                )}
              </>
            )}

            {err && <p className="text-xs text-red-600">{err}</p>}

            <div className="text-[11px] leading-relaxed bg-amber-400/15 border border-amber-300/40 rounded-lg px-3 py-2 text-amber-800">
              ⚠️ AI 試算，基準值與減碳% 需<b>永續發展部確認</b>，非最終結論。
            </div>
          </div>

          {/* 底部操作 */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            {step === 2 ? (
              <button type="button" onClick={() => setStep(1)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-100 transition">
                ← 上一步
              </button>
            ) : <span />}
            {step === 1 ? (
              <button type="button" onClick={goStep2} disabled={loadingNext}
                className="px-5 py-2 rounded-lg text-white text-sm font-medium transition disabled:opacity-60"
                style={{ backgroundColor: HEADER_BG }}>
                {loadingNext ? '偵測資料中…' : '下一步：確認資料月份 →'}
              </button>
            ) : (
              <button type="button" onClick={finish} disabled={submitting}
                className="px-5 py-2 rounded-lg text-white text-sm font-medium transition disabled:opacity-60"
                style={{ backgroundColor: HEADER_BG }}>
                {submitting ? '計算中…' : '✓ 開始計算減碳績效'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
        style={{ backgroundColor: active || done ? HEADER_BG : '#cbd5e1' }}>
        {done ? '✓' : n}
      </span>
      <span className={`text-xs ${active ? 'font-bold text-gray-800' : 'text-gray-400'}`}>{label}</span>
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-bold text-gray-800">{label}</div>
      {hint && <p className="text-[11px] text-gray-500 mt-0.5 mb-2">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

function Choice({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left rounded-xl border px-4 py-2.5 transition ${active ? 'border-transparent text-white shadow' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
      style={active ? { backgroundColor: HEADER_BG } : undefined}>
      <div className="text-sm font-bold">{title}</div>
      <div className={`text-[11px] ${active ? 'text-green-200' : 'text-gray-400'}`}>{desc}</div>
    </button>
  );
}

function rangeYears(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

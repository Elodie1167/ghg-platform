'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PeriodRow {
  id: string;
  factory_id: string;
  year: number;
  status: 'open' | 'verified';
  verifier_org: string | null;
  verified_date: string | null;
  frozen_by: string | null;
  frozen_by_name: string | null;
  frozen_at: string | null;
  data_hash: string | null;
  current_version: number;
}

interface Row {
  factory_id: string;
  factory_code: string;
  name_zh: string;
  period: PeriodRow | null;
}

const HEADER_BG = '#0C3D2E';

export default function VerificationClient({
  year, rows, canFreeze,
}: { year: number; rows: Row[]; canFreeze: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Row | null>(null);
  const [verifierOrg, setVerifierOrg] = useState('');
  const [verifiedDate, setVerifiedDate] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, string>>({});

  function changeYear(y: number) {
    router.push(`/admin/verification?year=${y}`);
  }

  async function freeze() {
    if (!target) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/verification-periods', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: target.factory_id, year,
          verifier_org: verifierOrg || null,
          verified_date: verifiedDate || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setMsg(`已封存 ${target.factory_code} ${year} 年度（版本 ${j.data.version}）`);
      setTarget(null);
      setConfirmText('');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '封存失敗');
    } finally { setBusy(false); }
  }

  async function unfreeze(periodId: string, factoryCode: string) {
    if (!confirm(`確定要解封 ${factoryCode} ${year} 年度嗎？\n快照與雜湊會保留，只是解除主表的寫入阻擋。`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/verification-periods/${periodId}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setMsg(`已解封 ${factoryCode} ${year} 年度`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '解封失敗');
    } finally { setBusy(false); }
  }

  async function verify(periodId: string, factoryCode: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/verification-periods/${periodId}/verify`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setVerifyResult((prev) => ({
        ...prev,
        [periodId]: j.data.match ? '✅ 雜湊比對一致，快照未被篡改' : '❌ 雜湊不符！快照內容與封存時不一致',
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '驗證失敗');
    } finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <h1 className="text-xl font-semibold text-gray-800">第三方查證封存</h1>
      <p className="text-sm text-gray-500 mt-1">
        以廠別 × 年度為單位。封存後該年度主表不可再寫入，對外揭露一律讀封存快照。
        <strong className="text-amber-700">封存為不可逆操作</strong>，請於查證單位完成查證後才執行。
      </p>

      <div className="mt-4 flex items-center gap-2">
        <label className="text-sm text-gray-600">年度</label>
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm"
          value={year}
          onChange={(e) => changeYear(parseInt(e.target.value, 10))}
        >
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {msg && <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</p>}

      <table className="w-full mt-4 text-sm border border-gray-200 rounded overflow-hidden">
        <thead className="text-white" style={{ backgroundColor: HEADER_BG }}>
          <tr>
            <th className="px-3 py-2 text-left">廠別</th>
            <th className="px-3 py-2 text-center">狀態</th>
            <th className="px-3 py-2 text-left">查證機構 / 完成日</th>
            <th className="px-3 py-2 text-left">封存人 / 時間</th>
            <th className="px-3 py-2 text-left">SHA-256</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.period;
            const verified = p?.status === 'verified';
            return (
              <tr key={r.factory_id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-gray-500 mr-2">{r.factory_code}</span>
                  {r.name_zh}
                </td>
                <td className="px-3 py-2 text-center">
                  {verified
                    ? <span className="text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5 text-xs">已封存 v{p?.current_version}</span>
                    : <span className="text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-0.5 text-xs">未封存</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {p?.verifier_org ?? '—'}{p?.verified_date ? `　${p.verified_date}` : ''}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {p?.frozen_by_name ?? '—'}
                  {p?.frozen_at ? <div>{new Date(p.frozen_at).toLocaleString('zh-TW')}</div> : null}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-500 break-all max-w-[220px]">
                  {p?.data_hash ?? '—'}
                  {verified && verifyResult[p!.id] && (
                    <div className="mt-1 text-xs text-gray-800">{verifyResult[p!.id]}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {verified ? (
                    <>
                      <button
                        className="text-xs text-blue-700 hover:underline mr-3"
                        disabled={busy}
                        onClick={() => verify(p!.id, r.factory_code)}
                      >
                        驗證雜湊
                      </button>
                      {canFreeze && (
                        <button
                          className="text-xs text-red-700 hover:underline"
                          disabled={busy}
                          onClick={() => unfreeze(p!.id, r.factory_code)}
                        >
                          解封
                        </button>
                      )}
                    </>
                  ) : (
                    canFreeze && (
                      <button
                        className="text-xs text-white rounded px-3 py-1"
                        style={{ backgroundColor: HEADER_BG }}
                        disabled={busy}
                        onClick={() => { setTarget(r); setVerifierOrg(''); setVerifiedDate(''); setConfirmText(''); }}
                      >
                        執行封存
                      </button>
                    )
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {target && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-800">
              封存 {target.factory_code} {year} 年度
            </h2>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
              封存後本年度資料無法再修改，且無法撤回快照（只能解除阻擋，快照本身不可刪除）。
              請確認查證單位已完成查證。
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm text-gray-600 block mb-1">查證機構</label>
                <input
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  value={verifierOrg}
                  onChange={(e) => setVerifierOrg(e.target.value)}
                  placeholder="例如 BSI、SGS"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">查證完成日</label>
                <input
                  type="date"
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  value={verifiedDate}
                  onChange={(e) => setVerifiedDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 block mb-1">
                  請輸入「<span className="font-mono">封存</span>」以確認
                </label>
                <input
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="text-sm text-gray-600 px-3 py-1.5 rounded border border-gray-300"
                onClick={() => setTarget(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="text-sm text-white px-3 py-1.5 rounded disabled:opacity-50"
                style={{ backgroundColor: HEADER_BG }}
                disabled={busy || confirmText !== '封存'}
                onClick={freeze}
              >
                確認封存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

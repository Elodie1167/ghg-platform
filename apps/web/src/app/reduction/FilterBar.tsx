'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { COUNTRY_LABELS, type ScopeKey, type Basis } from '@/lib/reduction-types';

const HEADER_BG = '#0C3D2E';

export interface FactoryOption { factory_code: string; name_zh: string; country_code: string }

export default function FilterBar({
  factories, source, yearFrom, yearTo, scopes, basis, countryCode, factoryCode,
}: {
  factories: FactoryOption[];
  source: 'csr' | 'platform';
  yearFrom: number;
  yearTo: number;
  scopes: ScopeKey[];
  basis: Basis;
  countryCode: string; // '' = 全部
  factoryCode: string; // '' = 全部
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function patch(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === '') params.delete(k); else params.set(k, v);
    }
    router.push(`/reduction?${params.toString()}`);
  }

  const countries = [...new Set(factories.map((f) => f.country_code))];
  const factoryOptions = countryCode
    ? factories.filter((f) => f.country_code === countryCode)
    : factories;

  const yearOptions = Array.from({ length: 2028 - 2020 + 1 }, (_, i) => 2020 + i);

  function toggleScope(s: ScopeKey) {
    const has = scopes.includes(s);
    const next = has ? scopes.filter((x) => x !== s) : [...scopes, s];
    if (next.length === 0) return; // 至少保留一個範疇
    patch({ scopes: next.join(',') });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 bg-white/10 rounded-xl px-3 py-2 text-xs">
      <label className="flex items-center gap-1.5 text-green-200">
        產區
        <select value={countryCode} onChange={(e) => patch({ country: e.target.value, factory: '' })}
          className="bg-white/10 text-white border border-white/30 rounded px-2 py-1">
          <option className="text-black" value="">全部</option>
          {countries.map((c) => <option key={c} className="text-black" value={c}>{COUNTRY_LABELS[c] ?? c}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-green-200">
        工廠
        <select value={factoryCode} onChange={(e) => {
          const fc = e.target.value;
          const fac = factories.find((f) => f.factory_code === fc);
          patch({ factory: fc, country: fac ? fac.country_code : countryCode });
        }}
          className="bg-white/10 text-white border border-white/30 rounded px-2 py-1">
          <option className="text-black" value="">全部</option>
          {factoryOptions.map((f) => <option key={f.factory_code} className="text-black" value={f.factory_code}>{f.name_zh}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-green-200">
        年度
        <select value={yearFrom} onChange={(e) => patch({ yearFrom: e.target.value })}
          className="bg-white/10 text-white border border-white/30 rounded px-2 py-1">
          {yearOptions.map((y) => <option key={y} className="text-black" value={y}>{y}</option>)}
        </select>
        –
        <select value={yearTo} onChange={(e) => patch({ year: e.target.value })}
          className="bg-white/10 text-white border border-white/30 rounded px-2 py-1">
          {yearOptions.map((y) => <option key={y} className="text-black" value={y}>{y}</option>)}
        </select>
      </label>

      <span className="flex items-center gap-1 text-green-200">
        範疇
        {([1, 2, 3] as ScopeKey[]).map((s) => {
          const disabled = s === 3 && source === 'csr';
          const active = scopes.includes(s);
          return (
            <button key={s} type="button" disabled={disabled} title={disabled ? 'CSR 匯入未涵蓋範疇三' : undefined}
              onClick={() => toggleScope(s)}
              className={`px-2 py-1 rounded border text-xs transition ${
                disabled ? 'opacity-30 cursor-not-allowed border-white/20 text-white/50'
                : active ? 'bg-white border-white' : 'border-white/30 text-white'
              }`}
              style={active && !disabled ? { color: HEADER_BG } : undefined}>
              S{s}
            </button>
          );
        })}
      </span>

      <label className="flex items-center gap-1.5 text-green-200">
        基準（僅影響 S2）
        <span className="inline-flex rounded-lg overflow-hidden border border-white/30">
          {(['market', 'location'] as Basis[]).map((b) => (
            <button key={b} type="button" onClick={() => patch({ basis: b })}
              className="px-2.5 py-1 text-xs transition"
              style={basis === b ? { backgroundColor: '#fff', color: HEADER_BG } : { color: '#fff' }}>
              {b === 'market' ? '市場別' : '地域別'}
            </button>
          ))}
        </span>
      </label>

      <button type="button" onClick={() => patch({ country: '', factory: '', scopes: '1,2,3', basis: 'market' })}
        className="ml-auto px-2.5 py-1 rounded border border-white/30 text-white/80 hover:bg-white/10">
        重設
      </button>
    </div>
  );
}

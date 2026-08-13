import Link from 'next/link';
import { getCountries, getFactories, orderCountryCodes } from '@/lib/factory-registry';
import type { RegistryFactory } from '@/lib/registry-types';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // 名冊已排好序（產區順序 → 廠順序），停用的廠不出現在填報入口
  const [factories, countryList] = await Promise.all([getFactories(), getCountries()]);
  const countryLabels: Record<string, string> = {};
  for (const c of countryList) countryLabels[c.country_code] = c.name_zh;

  const grouped = new Map<string, RegistryFactory[]>();
  for (const f of factories) {
    if (!grouped.has(f.country_code)) grouped.set(f.country_code, []);
    grouped.get(f.country_code)!.push(f);
  }

  const countries = orderCountryCodes(grouped.keys(), countryList);

  const currentYear = new Date().getFullYear();

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ backgroundColor: '#0C3D2E' }} className="text-white shadow-lg">
        <div className="max-w-[1920px] mx-auto px-6 md:px-10 py-5 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">GHG 碳盤查平台</h1>
            <p className="text-green-300 text-sm mt-1">
              聚陽實業 — 永續發展部 ｜ 盤查年度：{currentYear} 年
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/factories"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
            >
              工廠設定 →
            </Link>
            <Link
              href="/admin/factors"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
            >
              係數設定 →
            </Link>
            <Link
              href="/summary"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
            >
              集團碳排彙整表 →
            </Link>
            <Link
              href="/reduction"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
            >
              減碳績效追蹤 →
            </Link>
            <Link
              href="/admin/verification"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
            >
              查證封存 →
            </Link>
            <span className="text-green-300 text-sm">共 {factories.length} 個廠別</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto px-6 md:px-10 py-8">
        <p className="text-gray-500 text-sm mb-6">
          選擇廠別進入填報頁面。各廠連結可直接分享給負責同仁。
        </p>

        {countries.map((cc) => {
          const facs = grouped.get(cc) ?? [];
          return (
            <section key={cc} className="mb-8">
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="inline-block px-3 py-1 rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: '#0C3D2E' }}
                >
                  {cc}
                </span>
                <h2 className="text-base font-semibold text-gray-700">
                  {countryLabels[cc] ?? cc}
                </h2>
                <span className="text-xs text-gray-400">{facs.length} 廠</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                {facs.map((f) => (
                  <Link
                    key={f.id}
                    href={`/fill/${f.factory_code}`}
                    className="block bg-white rounded-xl border border-gray-200 hover:border-green-400 hover:shadow-md transition-all p-4 group"
                  >
                    <div className="text-xs font-mono mb-1 text-gray-400">
                      {f.factory_code}
                    </div>
                    <div className="font-semibold text-gray-900 text-sm leading-snug">
                      {f.name_zh}
                    </div>
                    {f.name_en && f.name_en !== f.name_zh && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{f.name_en}</div>
                    )}
                    <div className="mt-3 text-xs text-gray-300 group-hover:text-green-500 transition flex items-center gap-1">
                      <span>開始填報</span>
                      <span>→</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="text-center text-xs text-gray-400 py-6 border-t border-gray-100 mt-4">
        GHG 碳盤查系統 ｜ 資料僅供內部使用，請妥善保管填報連結
      </footer>
    </div>
  );
}
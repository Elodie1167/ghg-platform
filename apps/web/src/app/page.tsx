import { query } from '@/lib/db';
import Link from 'next/link';

interface Factory {
  id: string;
  factory_code: string;
  name_zh: string;
  name_en: string;
  country_code: string;
  region: string | null;
}

const COUNTRY_LABELS: Record<string, string> = {
  TWN: '台灣',
  CHN: '中國',
  NVN: '越南',
  CAB: '柬埔寨',
  SLV: '薩爾瓦多',
  BGD: '孟加拉',
  IND: '印尼',
};

const COUNTRY_ORDER = ['TWN', 'CHN', 'NVN', 'CAB', 'SLV', 'BGD', 'IND'];

export default async function Home() {
  const result = await query(
    `SELECT id, factory_code, name_zh, name_en, country_code, region
     FROM factories
     ORDER BY country_code ASC, factory_code ASC`,
  );
  const factories: Factory[] = result.rows;

  const grouped = new Map<string, Factory[]>();
  for (const f of factories) {
    if (!grouped.has(f.country_code)) grouped.set(f.country_code, []);
    grouped.get(f.country_code)!.push(f);
  }

  const countries = [...grouped.keys()].sort((a, b) => {
    const ia = COUNTRY_ORDER.indexOf(a);
    const ib = COUNTRY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const currentYear = new Date().getFullYear();

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ backgroundColor: '#0C3D2E' }} className="text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">GHG 碳盤查平台</h1>
            <p className="text-green-300 text-sm mt-1">
              聚陽實業 — 永續發展部 ｜ 盤查年度：{currentYear} 年
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/summary"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white border border-white/30 hover:bg-white/10 transition"
            >
              集團碳排彙整表 →
            </Link>
            <span className="text-green-300 text-sm">共 {factories.length} 個廠別</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
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
                  {COUNTRY_LABELS[cc] ?? cc}
                </h2>
                <span className="text-xs text-gray-400">{facs.length} 廠</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
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
                    {f.name_en && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{f.name_en}</div>
                    )}
                    {f.region && (
                      <div className="text-xs text-green-600 mt-2 font-medium">{f.region}</div>
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

export const dynamic = 'force-dynamic';
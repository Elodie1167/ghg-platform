// 導覽時立即顯示的載入畫面（Suspense fallback）：
// /reduction 為伺服器動態頁、需查詢/計算，加此檔可讓點擊後「即時跳轉」再載入資料。
export default function Loading() {
  const HEADER_BG = '#0C3D2E';
  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: HEADER_BG }} className="text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-4">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">減碳績效追蹤</h1>
          <p className="text-green-300 text-sm">載入中…</p>
        </div>
      </header>
      <main className="max-w-[1600px] mx-auto px-6 md:px-10 py-6 space-y-6">
        <div className="flex items-center gap-3 text-gray-500 text-sm">
          <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-[#0C3D2E] rounded-full animate-spin" />
          正在計算各廠碳排與減碳績效…
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
              <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
              <div className="h-7 w-28 bg-gray-100 rounded mt-3 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${90 - i * 8}%` }} />
          ))}
        </div>
      </main>
    </div>
  );
}

// 內網產能 API（capacity-api.php）— 提供月度標打產能，取代 annual_metrics 年度比例分攤。
// 規格：C:\Users\elodiecheng\Desktop\Claude\溫盤\產能API 參數.txt
// 無需驗證（內網服務）。若需覆寫網址，設定環境變數 CAPACITY_API_BASE。

const CAPACITY_API_BASE =
  process.env.CAPACITY_API_BASE || 'http://192.168.6.100:8080/productionoutput/php/capacity-api.php';

type CapacityApiResponse = {
  ok: boolean;
  total?: { plan?: number; actual?: number };
};

/** 取指定年月區間、全產區、實打（actual）標打量加總。查無資料或連線失敗回傳 null。 */
export async function fetchActualCapacity(
  year: number,
  monthFrom: number,
  monthTo: number,
): Promise<number | null> {
  const params = new URLSearchParams({
    year: String(year),
    month_from: String(monthFrom).padStart(2, '0'),
    month_to: String(monthTo).padStart(2, '0'),
    area: 'ALL',
    items: 'actual',
  });
  try {
    const res = await fetch(`${CAPACITY_API_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as CapacityApiResponse;
    if (!json.ok) return null;
    const actual = Number(json.total?.actual);
    return Number.isFinite(actual) && actual > 0 ? actual : null;
  } catch {
    return null;
  }
}

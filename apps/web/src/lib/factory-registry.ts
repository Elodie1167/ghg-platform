import { query } from '@/lib/db';
import { countryLabelsOf } from '@/lib/registry-types';
import type { CountryMeta, RegistryFactory } from '@/lib/registry-types';

// 純函式在 registry-types.ts（client 也用得到），這裡轉出方便 server 端沿用同一個 import
export { countryLabelsOf, orderCountryCodes } from '@/lib/registry-types';

// =============================================================
// 工廠 / 國家「名冊」— 順序與標籤的單一事實來源（server only）
//
// 這一層存在的理由：在 V32 之前，工廠順序（FACTORY_ORDER）與國家標籤
// （COUNTRY_LABELS）硬編碼在 6 個檔案裡，且彼此不一致 —— 首頁、彙整表、
// 減量頁各有一套產區順序。新增一個廠必須手改多處，漏一處彙整表就會漏廠。
//
// 現在順序與標籤都來自 factories.display_order / countries.display_order，
// 由 /admin/factories 維護。任何需要「排好序的工廠清單」或「國家中文名」
// 的地方，一律走這裡，不要再在檔案裡自己寫常數。
//
// client component 不呼叫本檔（會把 pg 拉進 bundle）；
// 一律由 server component 取好後當 props 傳下去，型別見 registry-types.ts。
// =============================================================

/** 產區排序 → 廠排序 → 代碼。未設定 display_order 者（999）自然落到最後。 */
const ORDER_BY = `ORDER BY COALESCE(c.display_order, 999), f.display_order, f.factory_code`;

export interface FactoryRegistryOptions {
  /** true 時連同已停用（is_active = false）的廠一起回傳。預設 false。 */
  includeInactive?: boolean;
  /**
   * 指定年度時，已停用但「該年度有填報資料」的廠仍會回傳。
   * 歷史年度的彙整表不該因為之後關廠就少一欄 —— 已盤查年度不回溯變動。
   */
  year?: number;
}

/**
 * 取得排好序的工廠清單。
 * 回傳順序即為畫面與匯出應採用的順序，呼叫端不需要再排一次。
 */
export async function getFactories(opts: FactoryRegistryOptions = {}): Promise<RegistryFactory[]> {
  const { includeInactive = false, year } = opts;

  let where = '';
  const params: unknown[] = [];
  if (!includeInactive) {
    if (year != null) {
      params.push(year);
      where = `WHERE f.is_active OR EXISTS (
                 SELECT 1 FROM activity_records ar
                  WHERE ar.factory_id = f.id AND ar.year = $1)`;
    } else {
      where = `WHERE f.is_active`;
    }
  }

  const res = await query(
    `SELECT f.id, f.factory_code, f.name_zh, f.name_en, f.country_code, f.region,
            f.display_order, f.is_active, f.closed_at,
            COALESCE(c.name_zh, f.country_code) AS country_name
       FROM factories f
       LEFT JOIN countries c ON c.country_code = f.country_code
       ${where}
       ${ORDER_BY}`,
    params,
  );
  return res.rows;
}

/** 取得國家清單（依 display_order）。 */
export async function getCountries(): Promise<CountryMeta[]> {
  const res = await query(
    `SELECT country_code, name_zh, name_en, display_order
       FROM countries WHERE is_active ORDER BY display_order, country_code`,
  );
  return res.rows;
}

/**
 * 取得 country_code → 中文名 的對照，供畫面顯示產區標籤。
 * 查無對照時呼叫端請自行 fallback 回 country_code（`labels[cc] ?? cc`）。
 */
export async function getCountryLabels(): Promise<Record<string, string>> {
  return countryLabelsOf(await getCountries());
}

// =============================================================
// 工廠 / 國家名冊的共用型別。
// 這個檔案刻意不 import 任何 DB 相關模組，讓 client component
// 可以安全 `import type`，而不會把 pg 拉進瀏覽器 bundle。
// 實際查詢在 lib/factory-registry.ts（server only）。
// =============================================================

export interface RegistryFactory {
  id: string;
  factory_code: string;
  name_zh: string;
  name_en: string | null;
  country_code: string;
  region: string | null;
  display_order: number;
  is_active: boolean;
  closed_at: string | null;
  /** countries.name_zh，查無對照時退回 country_code */
  country_name: string;
}

export interface CountryMeta {
  country_code: string;
  name_zh: string;
  name_en: string | null;
  display_order: number;
}

// ── 純函式（無 DB 依賴，client component 可直接用）──────────────

/** country_code → 中文名。查無對照請 fallback 回代碼（`labels[cc] ?? cc`）。 */
export function countryLabelsOf(countries: CountryMeta[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of countries) map[c.country_code] = c.name_zh;
  return map;
}

/** 依 countries 的順序排序一組 country_code；未知國別排最後。 */
export function orderCountryCodes(codes: Iterable<string>, countries: CountryMeta[]): string[] {
  const rank = new Map(countries.map((c, i) => [c.country_code, i]));
  return [...codes].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || a.localeCompare(b));
}

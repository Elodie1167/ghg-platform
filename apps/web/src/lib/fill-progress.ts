import { query } from '@/lib/db';

// =============================================================
// 首頁「填報進度」— 每廠 × 該年度的完成率
//
// 進度 = 已填月數 ÷ 應填月數。
// 應填 = 該廠適用的排放源（全集團啟用中 且 (全廠必填 或 該廠 source_config 有勾選)）× 12 個月，
// 口徑與 lib/anomaly/rules/dataMissingMonth.ts 一致（「一個排放源對某廠適用」的判斷邏輯相同），
// 差別是這裡涵蓋該廠全部適用排放源，不只異常規則關注的 4 個必填源。
// =============================================================

export interface FactoryFillProgress {
  factory_code: string;
  filled: number;
  required: number;
  percent: number; // 0-100，required 為 0 時視為 100（無需填報）
  missing: { source_code: string; source_name: string; months: number[] }[];
}

export async function getFillProgress(year: number): Promise<Map<string, FactoryFillProgress>> {
  const factoryRows = await query(
    `SELECT factory_code, source_config FROM factories WHERE is_active`,
  );

  const sourceRows = await query(
    `SELECT id, source_code, name_zh, is_always_active FROM emission_sources WHERE is_active`,
  );

  const existingRows = await query(
    `SELECT f.factory_code, es.source_code, ar.month
     FROM activity_records ar
     JOIN factories f ON f.id = ar.factory_id
     JOIN emission_sources es ON es.id = ar.emission_source_id
     WHERE ar.year = $1
     GROUP BY f.factory_code, es.source_code, ar.month`,
    [year],
  );
  const existingSet = new Set(
    existingRows.rows.map((r) => `${r.factory_code}|${r.source_code}|${r.month}`),
  );

  const result = new Map<string, FactoryFillProgress>();

  for (const frow of factoryRows.rows) {
    const config = frow.source_config ?? {};
    const selectedIds: string[] = Array.isArray(config.selected_ids) ? config.selected_ids : [];

    const applicable = sourceRows.rows.filter(
      (s) => s.is_always_active || selectedIds.includes(s.id),
    );

    let filled = 0;
    const missing: FactoryFillProgress['missing'] = [];

    for (const source of applicable) {
      const missingMonths: number[] = [];
      for (let month = 1; month <= 12; month++) {
        if (existingSet.has(`${frow.factory_code}|${source.source_code}|${month}`)) {
          filled++;
        } else {
          missingMonths.push(month);
        }
      }
      if (missingMonths.length > 0) {
        missing.push({ source_code: source.source_code, source_name: source.name_zh, months: missingMonths });
      }
    }

    const required = applicable.length * 12;
    const percent = required === 0 ? 100 : Math.round((filled / required) * 100);

    result.set(frow.factory_code, { factory_code: frow.factory_code, filled, required, percent, missing });
  }

  return result;
}

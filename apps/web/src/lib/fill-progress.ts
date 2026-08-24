import { query } from '@/lib/db';

// =============================================================
// 首頁「填報進度」— 每廠 × 該年度的完成率
//
// 「填了」與「確認過」是兩件事：is_reviewed 是既有的永續部內部檢核欄位
// （V1__initial_schema.sql），本統計借用它區分「已填未確認」與「已確認」，
// 不是查證封存（verification_periods，那是整年一次性硬凍結）。
//
// 進度% = 已確認月數 ÷ 應填月數，不是已填月數 ÷ 應填月數。
// 應填 = 該廠適用的排放源（全集團啟用中 且 (全廠必填 或 該廠 source_config 有勾選)）× 12 個月，
// 口徑與 lib/anomaly/rules/dataMissingMonth.ts 一致（「一個排放源對某廠適用」的判斷邏輯相同），
// 差別是這裡涵蓋該廠全部適用排放源，不只異常規則關注的 4 個必填源。
//
// 首頁不逐排放源列出，而是把「(排放源, 月)」再摺一層成「每月狀態」：
// 一個月只有在該廠「所有應填排放源」都確認過，該月才算 reviewed，
// 因為對永續部而言，一個月只要還有一個源沒確認，那個月就還不能算過關。
// =============================================================

export type MonthStatus = 'empty' | 'partial' | 'filled' | 'reviewed';

export interface FactoryFillProgress {
  factory_code: string;
  filled: number;
  reviewed: number;
  required: number;
  percent: number; // 0-100，以「已確認」計，required 為 0 時視為 100（無需填報）
  monthlyStatus: MonthStatus[]; // index 0 = 1月 ... index 11 = 12月
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
    `SELECT f.factory_code, es.source_code, ar.month, bool_and(ar.is_reviewed) AS all_reviewed
     FROM activity_records ar
     JOIN factories f ON f.id = ar.factory_id
     JOIN emission_sources es ON es.id = ar.emission_source_id
     WHERE ar.year = $1
     GROUP BY f.factory_code, es.source_code, ar.month`,
    [year],
  );
  const filledSet = new Set(
    existingRows.rows.map((r) => `${r.factory_code}|${r.source_code}|${r.month}`),
  );
  const reviewedSet = new Set(
    existingRows.rows.filter((r) => r.all_reviewed).map((r) => `${r.factory_code}|${r.source_code}|${r.month}`),
  );

  const result = new Map<string, FactoryFillProgress>();

  for (const frow of factoryRows.rows) {
    const config = frow.source_config ?? {};
    const selectedIds: string[] = Array.isArray(config.selected_ids) ? config.selected_ids : [];

    const applicable = sourceRows.rows.filter(
      (s) => s.is_always_active || selectedIds.includes(s.id),
    );

    let filled = 0;
    let reviewed = 0;
    const missing: FactoryFillProgress['missing'] = [];

    for (const source of applicable) {
      const missingMonths: number[] = [];
      for (let month = 1; month <= 12; month++) {
        const key = `${frow.factory_code}|${source.source_code}|${month}`;
        if (filledSet.has(key)) {
          filled++;
          if (reviewedSet.has(key)) reviewed++;
        } else {
          missingMonths.push(month);
        }
      }
      if (missingMonths.length > 0) {
        missing.push({ source_code: source.source_code, source_name: source.name_zh, months: missingMonths });
      }
    }

    const monthlyStatus: MonthStatus[] = [];
    for (let month = 1; month <= 12; month++) {
      const filledCount = applicable.filter((s) =>
        filledSet.has(`${frow.factory_code}|${s.source_code}|${month}`),
      ).length;
      const reviewedCount = applicable.filter((s) =>
        reviewedSet.has(`${frow.factory_code}|${s.source_code}|${month}`),
      ).length;

      if (applicable.length === 0 || filledCount === applicable.length) {
        monthlyStatus.push(reviewedCount === applicable.length ? 'reviewed' : 'filled');
      } else if (filledCount === 0) {
        monthlyStatus.push('empty');
      } else {
        monthlyStatus.push('partial');
      }
    }

    const required = applicable.length * 12;
    const percent = required === 0 ? 100 : Math.round((reviewed / required) * 100);

    result.set(frow.factory_code, {
      factory_code: frow.factory_code,
      filled,
      reviewed,
      required,
      percent,
      monthlyStatus,
      missing,
    });
  }

  return result;
}

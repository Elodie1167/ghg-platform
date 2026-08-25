import { query } from '@/lib/db';

// =============================================================
// 首頁「填報進度」— 每廠 × 該年度的完成率
//
// 「填了」與「確認過」是兩件事：is_reviewed 是既有的永續部內部檢核欄位
// （V1__initial_schema.sql），本統計借用它區分「已填未確認」與「已確認」，
// 不是查證封存（verification_periods，那是整年一次性硬凍結）。
//
// 「每月都要填」也只對少數排放源成立。V62 加了 emission_sources.fill_frequency：
//   monthly → 外購電力／公務車汽油／公務車柴油，12 個月都要填才算填滿
//   annual  → 其餘排放源（含 3-1-A~E 年度彙總、冷媒逸散/滅火器/SF6等事件觸發），
//             全年只要出現「1 筆已確認」就算完成，不強求逐月都有資料
// 兩類的必要量分開累加成 required，避免 annual 源永遠卡在「缺11個月」。
//
// 首頁的 12 格月份燈號只反映 monthly 類（電力/汽油/柴油），因為那是唯一
// 真的能逐月比對進度的排放源；annual 類只影響總百分比與 hover 明細，
// 不然「一年填一次」的源會讓其他 11 個月的燈號永遠卡在「部分已填」。
// =============================================================

export type MonthStatus = 'empty' | 'partial' | 'filled' | 'reviewed';

export interface FactoryFillProgress {
  factory_code: string;
  filled: number;
  reviewed: number;
  required: number;
  percent: number; // 0-100，以「已確認」計，required 為 0 時視為 100（無需填報）
  monthlyStatus: MonthStatus[]; // index 0 = 1月 ... index 11 = 12月，只計 monthly 類排放源
  missing: { source_code: string; source_name: string; months: number[] }[]; // months 為空陣列代表 annual 類「全年未填」
}

export async function getFillProgress(year: number): Promise<Map<string, FactoryFillProgress>> {
  const factoryRows = await query(
    `SELECT factory_code, source_config FROM factories WHERE is_active`,
  );

  const sourceRows = await query(
    `SELECT id, source_code, name_zh, is_always_active, fill_frequency FROM emission_sources WHERE is_active`,
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
  const filledMonthsBySource = new Map<string, number[]>(); // `${factory_code}|${source_code}` -> months with any record
  for (const r of existingRows.rows) {
    const k = `${r.factory_code}|${r.source_code}`;
    if (!filledMonthsBySource.has(k)) filledMonthsBySource.set(k, []);
    filledMonthsBySource.get(k)!.push(r.month);
  }

  const result = new Map<string, FactoryFillProgress>();

  for (const frow of factoryRows.rows) {
    const config = frow.source_config ?? {};
    const selectedIds: string[] = Array.isArray(config.selected_ids) ? config.selected_ids : [];

    const applicable = sourceRows.rows.filter(
      (s) => s.is_always_active || selectedIds.includes(s.id),
    );
    const monthlySources = applicable.filter((s) => s.fill_frequency === 'monthly');
    const annualSources = applicable.filter((s) => s.fill_frequency !== 'monthly');

    let filled = 0;
    let reviewed = 0;
    const missing: FactoryFillProgress['missing'] = [];

    for (const source of monthlySources) {
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

    for (const source of annualSources) {
      const months = filledMonthsBySource.get(`${frow.factory_code}|${source.source_code}`) ?? [];
      if (months.length > 0) {
        filled++;
        const anyReviewed = months.some((m) =>
          reviewedSet.has(`${frow.factory_code}|${source.source_code}|${m}`),
        );
        if (anyReviewed) reviewed++;
        else missing.push({ source_code: source.source_code, source_name: source.name_zh, months: [] });
      } else {
        missing.push({ source_code: source.source_code, source_name: source.name_zh, months: [] });
      }
    }

    const monthlyStatus: MonthStatus[] = [];
    for (let month = 1; month <= 12; month++) {
      const filledCount = monthlySources.filter((s) =>
        filledSet.has(`${frow.factory_code}|${s.source_code}|${month}`),
      ).length;
      const reviewedCount = monthlySources.filter((s) =>
        reviewedSet.has(`${frow.factory_code}|${s.source_code}|${month}`),
      ).length;

      if (monthlySources.length === 0 || filledCount === monthlySources.length) {
        monthlyStatus.push(reviewedCount === monthlySources.length ? 'reviewed' : 'filled');
      } else if (filledCount === 0) {
        monthlyStatus.push('empty');
      } else {
        monthlyStatus.push('partial');
      }
    }

    const required = monthlySources.length * 12 + annualSources.length;
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

import { query } from '@/lib/db';

// =============================================================
// 盤查年度清單 — 單一事實來源（server only，見 V49__report_years.sql）
//
// 首頁與填報頁的年度下拉選單都改查這裡，不要再寫 REPORT_YEARS 常數。
// 新增/停用年度由 /admin/report-years 維護，不需要改程式碼重新部署。
// =============================================================

export interface ReportYearRow {
  year: number;
  is_active: boolean;
}

/** 取得目前啟用的盤查年度（供填報端年度選單使用），由小到大排序。 */
export async function getActiveReportYears(): Promise<number[]> {
  const res = await query(
    `SELECT year FROM report_years WHERE is_active ORDER BY year ASC`,
  );
  return res.rows.map((r) => r.year);
}

/** 取得所有盤查年度（含已停用），供 /admin/report-years 管理頁使用。 */
export async function getAllReportYears(): Promise<ReportYearRow[]> {
  const res = await query(
    `SELECT year, is_active FROM report_years ORDER BY year ASC`,
  );
  return res.rows;
}

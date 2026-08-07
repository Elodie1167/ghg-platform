import { query } from '@/lib/db';
import type { Rule, Flag, RuleContext } from '../types';

// GOV_CSR_GHG_MISMATCH — 清冊 vs CSR 一致性比對（規格 二）
//
// 業務容許誤差 0，技術誤差值 3%：|清冊 - CSR| / CSR > 3% 才觸發。
// 比對 bucket 定義見 csr_ghg_category_map（2026-08-07 定案，5 個生效 bucket，廢棄物暫緩）。
// 一律排除 is_biomass 排放源（CSR 匯入端不含生質燃料，納入會產生假異常）。
// 清冊側不限 is_reviewed（全部記錄都算，detail 標註未審查筆數）；
// 該廠該月清冊完全無資料時，改發較輕的 DATA_NOT_YET_FILED，不發 MISMATCH。

const RULE_CODE = 'GOV_CSR_GHG_MISMATCH';
const NOT_FILED_RULE_CODE = 'DATA_NOT_YET_FILED';

interface BucketDef {
  bucket_key: string;
  label_zh: string;
  csr_source_code: string;
  inventory_source_codes: string[];
  tolerance_pct: number;
}

async function getActiveBuckets(): Promise<BucketDef[]> {
  const r = await query(
    `SELECT bucket_key, label_zh, csr_source_code, inventory_source_codes, tolerance_pct::float
     FROM csr_ghg_category_map WHERE is_active = TRUE`,
  );
  return r.rows;
}

export const govCsrGhgMismatchRule: Rule = {
  code: RULE_CODE,
  allCodes: [RULE_CODE, NOT_FILED_RULE_CODE],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const buckets = await getActiveBuckets();
    if (buckets.length === 0) return [];

    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const flags: Flag[] = [];

    for (const bucket of buckets) {
      // CSR 側：該 bucket 對應欄位，逐廠逐月加總（月報表已逐月，不含 month=0 全年快照）
      const csrRows = await query(
        `SELECT factory_code, month, SUM(activity_value)::float AS val
         FROM csr_energy
         WHERE year = $1 AND source_code = $2 AND month BETWEEN 1 AND 12
           AND factory_code = ANY($3::text[])
         GROUP BY factory_code, month`,
        [ctx.year, bucket.csr_source_code, factoryCodes],
      );
      const csrMap = new Map<string, number>();
      for (const row of csrRows.rows) {
        csrMap.set(`${row.factory_code}|${row.month}`, Number(row.val));
      }

      // 清冊側：排除生質排放源，排除 is_reviewed 限制，但統計未審查筆數
      const invRows = await query(
        `SELECT f.factory_code, ar.month,
                SUM(ar.activity_value)::float AS activity_total,
                COUNT(*) FILTER (WHERE NOT ar.is_reviewed) AS unreviewed_count,
                COUNT(*) AS total_count
         FROM activity_records ar
         JOIN factories f ON f.id = ar.factory_id
         JOIN emission_sources es ON es.id = ar.emission_source_id
         WHERE ar.year = $1 AND es.source_code = ANY($2::text[]) AND es.is_biomass = FALSE
           AND f.factory_code = ANY($3::text[])
         GROUP BY f.factory_code, ar.month`,
        [ctx.year, bucket.inventory_source_codes, factoryCodes],
      );
      const invMap = new Map<string, { activityTotal: number; unreviewed: number; total: number }>();
      for (const row of invRows.rows) {
        invMap.set(`${row.factory_code}|${row.month}`, {
          activityTotal: Number(row.activity_total),
          unreviewed: Number(row.unreviewed_count),
          total: Number(row.total_count),
        });
      }

      for (const factoryCode of factoryCodes) {
        for (let month = 1; month <= 12; month++) {
          const key = `${factoryCode}|${month}`;
          const csrVal = csrMap.get(key);
          const inv = invMap.get(key);

          // 兩邊都沒資料：不判定，跳過
          if (csrVal === undefined && !inv) continue;

          // CSR 有資料但清冊完全無資料 → 較輕的「尚未填報」，不發 MISMATCH
          if (csrVal !== undefined && csrVal > 0 && !inv) {
            flags.push({
              rule_code: NOT_FILED_RULE_CODE,
              severity: 'advisory',
              factory_code: factoryCode,
              year: ctx.year,
              month,
              subject_key: bucket.bucket_key,
              detail: {
                label_zh: bucket.label_zh,
                csr_value: csrVal,
                message: `CSR 已有 ${bucket.label_zh} 數字，清冊尚未填報`,
              },
            });
            continue;
          }

          // 清冊有資料但 CSR 無資料：技術上無法算誤差率，略過（CSR 通常晚於清冊匯入）
          if (!csrVal || csrVal === 0) continue;
          if (!inv) continue;

          const diffPct = Math.abs(inv.activityTotal - csrVal) / csrVal * 100;
          if (diffPct > bucket.tolerance_pct) {
            flags.push({
              rule_code: RULE_CODE,
              severity: 'advisory',
              factory_code: factoryCode,
              year: ctx.year,
              month,
              subject_key: bucket.bucket_key,
              detail: {
                label_zh: bucket.label_zh,
                inventory_activity_total: inv.activityTotal,
                csr_value: csrVal,
                diff_pct: Math.round(diffPct * 100) / 100,
                tolerance_pct: bucket.tolerance_pct,
                unreviewed_records: inv.unreviewed,
                total_records: inv.total,
                message: `清冊 vs CSR 落差 ${diffPct.toFixed(1)}%（容許 ${bucket.tolerance_pct}%）`,
              },
            });
          }
        }
      }
    }

    return flags;
  },
};

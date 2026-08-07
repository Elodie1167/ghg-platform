import { query } from '@/lib/db';
import type { Rule, Flag, RuleContext } from '../types';

// GOV_DUPLICATE_ENTRY — 同廠同排放源同年月出現多筆疑似重複記錄
// （activity_records 允許同廠同月同排放源多筆是常態，如多張電費單；
//  這裡只抓「activity_value 完全相同」的多筆，較可能是誤重複輸入而非正常多張單據）

export const govDuplicateEntryRule: Rule = {
  code: 'GOV_DUPLICATE_ENTRY',
  allCodes: ['GOV_DUPLICATE_ENTRY'],
  async run(ctx: RuleContext): Promise<Flag[]> {
    const factoryCodes = ctx.factories.map((f) => f.factory_code);
    if (factoryCodes.length === 0) return [];

    const r = await query(
      `SELECT f.factory_code, es.source_code, ar.month, ar.activity_value,
              COUNT(*) AS dup_count, array_agg(ar.id) AS record_ids
       FROM activity_records ar
       JOIN factories f ON f.id = ar.factory_id
       JOIN emission_sources es ON es.id = ar.emission_source_id
       WHERE ar.year = $1 AND f.factory_code = ANY($2::text[])
       GROUP BY f.factory_code, es.source_code, ar.month, ar.activity_value
       HAVING COUNT(*) > 1`,
      [ctx.year, factoryCodes],
    );

    return r.rows.map((row) => ({
      rule_code: 'GOV_DUPLICATE_ENTRY',
      severity: 'advisory' as const,
      factory_code: row.factory_code,
      year: ctx.year,
      month: row.month,
      subject_key: row.source_code,
      detail: {
        source_code: row.source_code,
        activity_value: row.activity_value,
        dup_count: Number(row.dup_count),
        record_ids: row.record_ids,
        message: `${row.source_code} 同月出現 ${row.dup_count} 筆數值完全相同的記錄，疑似重複輸入`,
      },
    }));
  },
};

import { query } from '@/lib/db';
import { RULES } from './registry';
import type { Flag, FactoryRow } from './types';

// 異常規則引擎：對指定年度（可限定廠別）重跑全部規則，寫入 anomaly_flags。
//
// upsert 原則（依 uq_anomaly_subject: rule_code, factory_code, year, month, subject_key）：
//   - 新異常 → insert，status='open'
//   - 舊異常仍存在 → 更新 detail / last_checked_at，不動 status（confirmed_ok 保留人工判斷）
//     但若原本是 resolved（曾自動關閉後又復發），改回 open
//   - 舊異常這次沒再出現 → 若原本是 open，自動轉 resolved（狀況已消失，不需要人工再看）
//     confirmed_ok 不自動變動（人工已確認過的維持原狀，供歷史查閱）
export async function runAnomalyRules(year: number, factoryCodes?: string[]): Promise<{ ruleCode: string; flagCount: number }[]> {
  const factoriesResult = await query(
    factoryCodes && factoryCodes.length > 0
      ? `SELECT factory_code, name_zh, country_code FROM factories WHERE factory_code = ANY($1::text[])`
      : `SELECT factory_code, name_zh, country_code FROM factories`,
    factoryCodes && factoryCodes.length > 0 ? [factoryCodes] : undefined,
  );
  const factories: FactoryRow[] = factoriesResult.rows;
  const scopedFactoryCodes = factories.map((f) => f.factory_code);
  if (scopedFactoryCodes.length === 0) return [];

  const flagCountByCode = new Map<string, number>();

  for (const rule of RULES) {
    const flags = await rule.run({ factories, year });
    // 一個 Rule 實作可能吐出多種 rule_code（如 govCsrGhgMismatchRule 同時吐
    // GOV_CSR_GHG_MISMATCH 與 DATA_NOT_YET_FILED）；依 flag 自身的 rule_code 分組，
    // 各自 upsert + 關閉不再出現的舊異常，不能用 rule.code 一概而論。
    const grouped = new Map<string, Flag[]>();
    for (const flag of flags) {
      const list = grouped.get(flag.rule_code) ?? [];
      list.push(flag);
      grouped.set(flag.rule_code, list);
    }
    // 對這條 Rule 宣告的每個可能 rule_code 都要跑一次 upsert（即使這次是空陣列），
    // 否則「這次完全沒中」的 code 底下舊的 open 異常不會被自動關閉。
    for (const ruleCode of rule.allCodes) {
      const groupFlags = grouped.get(ruleCode) ?? [];
      await upsertFlags(ruleCode, year, scopedFactoryCodes, groupFlags);
      flagCountByCode.set(ruleCode, groupFlags.length);
    }
  }

  return [...flagCountByCode.entries()].map(([ruleCode, flagCount]) => ({ ruleCode, flagCount }));
}

async function upsertFlags(ruleCode: string, year: number, scopedFactoryCodes: string[], flags: Flag[]): Promise<void> {
  const touchedKeys: string[] = [];

  for (const flag of flags) {
    const key = `${flag.factory_code}|${flag.year}|${flag.month}|${flag.subject_key}`;
    touchedKeys.push(key);

    await query(
      `INSERT INTO anomaly_flags
         (rule_code, severity, factory_code, year, month, subject_key, record_id, status, detail, last_checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, NOW())
       ON CONFLICT (rule_code, factory_code, year, month, subject_key) DO UPDATE
         SET detail = EXCLUDED.detail,
             severity = EXCLUDED.severity,
             record_id = EXCLUDED.record_id,
             last_checked_at = NOW(),
             status = CASE WHEN anomaly_flags.status = 'resolved' THEN 'open' ELSE anomaly_flags.status END`,
      [ruleCode, flag.severity, flag.factory_code, flag.year, flag.month, flag.subject_key,
        flag.record_id ?? null, JSON.stringify(flag.detail)],
    );
  }

  // 這次掃描範圍內、這條規則、原本是 open 但這次沒再出現 → 自動轉 resolved
  if (touchedKeys.length > 0) {
    await query(
      `UPDATE anomaly_flags
         SET status = 'resolved', resolved_at = NOW(), last_checked_at = NOW()
       WHERE rule_code = $1 AND year = $2 AND factory_code = ANY($3::text[])
         AND status = 'open'
         AND (factory_code || '|' || year || '|' || month || '|' || subject_key) <> ALL($4::text[])`,
      [ruleCode, year, scopedFactoryCodes, touchedKeys],
    );
  } else {
    await query(
      `UPDATE anomaly_flags
         SET status = 'resolved', resolved_at = NOW(), last_checked_at = NOW()
       WHERE rule_code = $1 AND year = $2 AND factory_code = ANY($3::text[])
         AND status = 'open'`,
      [ruleCode, year, scopedFactoryCodes],
    );
  }
}

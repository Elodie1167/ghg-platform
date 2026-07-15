/**
 * 診斷：檢查「無係數」已查核資料的係數現況。
 * 只讀，不寫入。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(process.cwd(), '.env.local');
for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
  const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[m[1]] === undefined) process.env[m[1]] = v;
}

const { query } = await import('@/lib/db');
const YEAR = 2026;

// 1. 驗證回補：還有多少已查核列缺 co2e_total
const stillPending = await query(
  `SELECT COUNT(*)::int AS n
   FROM activity_records ar
   WHERE ar.year=$1 AND ar.is_reviewed=true
     AND ar.activity_value IS NOT NULL AND ar.activity_value>0
     AND (ar.co2e_total IS NULL OR ar.co2_t IS NULL)`,
  [YEAR],
);
console.log(`回補後仍缺 co2e_total 的已查核列：${stillPending.rows[0].n} 筆（應等於無係數的 16 筆）\n`);

// 2. 無係數的排放源：檢查係數是否存在、是否指派、年度
const rows = await query(
  `SELECT DISTINCT f.factory_code, es.source_code, es.name_zh, es.scope,
          f.id AS factory_id, es.id AS es_id
   FROM activity_records ar
   JOIN emission_sources es ON ar.emission_source_id=es.id
   JOIN factories f ON ar.factory_id=f.id
   WHERE ar.year=$1 AND ar.is_reviewed=true
     AND ar.activity_value IS NOT NULL AND ar.activity_value>0
     AND (ar.co2e_total IS NULL OR ar.co2_t IS NULL)
   ORDER BY f.factory_code, es.source_code`,
  [YEAR],
);

console.log('── 無係數排放源的係數現況 ──');
for (const r of rows.rows) {
  // 該排放源是否有任何係數（不限廠、不限年）
  const anyEf = await query(
    `SELECT ef.id, ef.year,
            (SELECT COUNT(*)::int FROM emission_factor_assignments a
             WHERE a.emission_factor_id=ef.id AND a.factory_id=$2) AS assigned_here
     FROM emission_factors ef
     WHERE ef.emission_source_id=$1
     ORDER BY ef.year DESC`,
    [r.es_id, r.factory_id],
  );
  const totalEf = anyEf.rows.length;
  const assignedToThis = anyEf.rows.filter((x: { assigned_here: number }) => x.assigned_here > 0);
  const usableYear = assignedToThis.filter((x: { year: number }) => x.year <= YEAR);
  const years = anyEf.rows.map((x: { year: number }) => x.year).join(',');

  let diag: string;
  if (totalEf === 0) diag = '❌ 該排放源完全沒有任何係數';
  else if (assignedToThis.length === 0) diag = `⚠ 有 ${totalEf} 筆係數(年:${years})但未指派給本廠`;
  else if (usableYear.length === 0) diag = `⚠ 已指派本廠，但係數年度都 > ${YEAR}(年:${assignedToThis.map((x: {year:number})=>x.year).join(',')})`;
  else diag = `✓ 本廠有可用係數（不應無係數，請深查）`;

  console.log(`  ${r.factory_code.padEnd(10)} ${r.source_code.padEnd(10)} ${String(r.name_zh).padEnd(16)} ${diag}`);
}
process.exit(0);

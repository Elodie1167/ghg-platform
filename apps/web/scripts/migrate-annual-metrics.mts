/** 建立 annual_metrics 表（集團年度標打產能 + 營業額，供儀表板排放強度計算）。 */
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
await query(`
  CREATE TABLE IF NOT EXISTS annual_metrics (
    year              INTEGER PRIMARY KEY,
    standard_units    NUMERIC,   -- 標打產能（標打）
    revenue_thousands NUMERIC,   -- 營業額（新臺幣千元）
    updated_at        TIMESTAMPTZ DEFAULT NOW()
  )
`);
const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='annual_metrics' ORDER BY ordinal_position`);
console.log('✅ annual_metrics 欄位:', r.rows.map((x: { column_name: string }) => x.column_name).join(', '));
process.exit(0);

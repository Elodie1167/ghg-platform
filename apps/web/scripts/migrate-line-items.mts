/** 建立 activity_line_items 表（單據明細層，供稽核下鑽 + 月加總自動計算）。 */
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
  CREATE TABLE IF NOT EXISTS activity_line_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_record_id  UUID NOT NULL REFERENCES activity_records(id) ON DELETE CASCADE,
    invoice_no          TEXT,
    invoice_date        DATE,
    quantity            NUMERIC,
    unit                TEXT,
    erp_ref             TEXT,
    note                TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
  )
`);
await query(`CREATE INDEX IF NOT EXISTS idx_line_items_record ON activity_line_items(activity_record_id)`);
const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='activity_line_items' ORDER BY ordinal_position`);
console.log('✅ activity_line_items 欄位:', r.rows.map((x: { column_name: string }) => x.column_name).join(', '));
process.exit(0);

/** activity_records 加 source_doc_url（公檔發票資料夾連結，供稽核下鑽開原始單據）。 */
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
await query(`ALTER TABLE activity_records ADD COLUMN IF NOT EXISTS source_doc_url TEXT`);
const r = await query(`SELECT 1 FROM information_schema.columns WHERE table_name='activity_records' AND column_name='source_doc_url'`);
console.log(r.rowCount ? '✅ source_doc_url 已存在' : '❌ 未建立');
process.exit(0);

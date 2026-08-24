import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../apps/web/node_modules/pg/lib/index.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');
if (!process.env.DATABASE_URL && fs.existsSync(envLocalPath)) {
  for (const raw of fs.readFileSync(envLocalPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i === -1) continue;
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    const k = l.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');
// 保留較早建立的那筆（05:36:16），刪除稍後重複建立的那筆（05:36:19）
const DUP_ID = '2d8de7f2-62aa-4226-92b7-1a57f6d822e1';
const KEEP_ID = '59078f4b-6dab-412c-b997-545e19100ae5';

const check = await pool.query(`SELECT id, activity_value::float, co2e_total::float, line_items_count:: int FROM activity_records WHERE id IN ($1,$2)`.replace('line_items_count:: int','(SELECT COUNT(*) FROM activity_line_items WHERE activity_record_id = activity_records.id)::int AS line_items_count'), [DUP_ID, KEEP_ID]);
console.log(check.rows);

if (APPLY) {
  await pool.query(`DELETE FROM activity_records WHERE id = $1`, [DUP_ID]);
  console.log(`已刪除重複紀錄 ${DUP_ID}，保留 ${KEEP_ID}`);
} else {
  console.log('(未刪除，加 --apply 才會刪除)');
}
await pool.end();

/** 驗證單據明細 → 月加總自動計算（隔離測試，year 2099，跑完即刪）。 */
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
const { recomputeRecordFromLineItems } = await import('@/lib/line-items');

const FID = '7f71c2aa-3f33-4c26-92f3-14a2c3fd6d4c';  // IND_DMK
const ELEC = '8d5dac9c-c7aa-4f92-a914-35078eeed697'; // 2-1-A

let id: string | null = null;
try {
  const rec = await query(
    `INSERT INTO activity_records (factory_id, emission_source_id, year, month, activity_value, activity_unit, import_source, created_at, updated_at)
     VALUES ($1,$2,2099,1,1,'kWh','manual',NOW(),NOW()) RETURNING id`,
    [FID, ELEC],
  );
  id = rec.rows[0].id;
  console.log('建立測試紀錄:', id);

  await query(
    `INSERT INTO activity_line_items (activity_record_id, invoice_no, invoice_date, quantity, unit)
     VALUES ($1,'INV-1','2099-01-05',1000,'kWh'), ($1,'INV-2','2099-01-20',2000,'kWh')`,
    [id],
  );
  const total = await recomputeRecordFromLineItems(id);
  const back = await query(`SELECT activity_value::float AS av, co2e_total::float AS co FROM activity_records WHERE id=$1`, [id]);
  const items = await query(`SELECT COUNT(*)::int AS n FROM activity_line_items WHERE activity_record_id=$1`, [id]);
  console.log('recompute 回傳 total:', total);
  console.log('紀錄 activity_value:', back.rows[0].av, '｜ co2e_total:', back.rows[0].co, '｜ 明細筆數:', items.rows[0].n);
  console.log('預期: activity_value=3000, co2e≈2.61 (3000/1000×0.87), 明細=2');
} catch (e) {
  console.error('❌ 測試失敗:', (e as Error).message);
} finally {
  if (id) { await query(`DELETE FROM activity_records WHERE id=$1`, [id]); console.log('🧹 已刪除測試紀錄（明細連帶刪除）'); }
  process.exit(0);
}

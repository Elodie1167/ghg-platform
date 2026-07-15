/**
 * 焊條命名清理：去除 name_zh / name_en 的 -E6013 等後綴，保留「焊條」。
 * 預覽： npx tsx scripts/welding-rename.mts
 * 寫入： npx tsx scripts/welding-rename.mts --commit
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

const COMMIT = process.argv.includes('--commit');
const { query } = await import('@/lib/db');

// 只清理主要焊條排放源 1-3A-1（依使用者決定：只留一個乾淨的「焊條」，
// 1-3A-2 E7018 未使用，維持原名不動以免變成重複選項）
const rows = await query(
  `SELECT id, source_code, name_zh, name_en
   FROM emission_sources
   WHERE source_code = '1-3A-1'
   ORDER BY source_code`,
);

console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n找到 ${rows.rows.length} 個焊條相關排放源：\n`);

for (const r of rows.rows) {
  // 去除「焊條」後面的 -XXXX 後綴，中文一律正規化為「焊條」
  const newZh = /焊條/.test(r.name_zh) ? '焊條' : r.name_zh;
  // 英文：去除破折號後綴，保留主名（若含 weld 則正規化為 Welding Rod）
  const newEn = /weld/i.test(r.name_en ?? '') ? 'Welding Rod' : (r.name_en ?? '').replace(/\s*-\s*[A-Za-z0-9]+$/, '');

  const changed = newZh !== r.name_zh || newEn !== (r.name_en ?? '');
  console.log(`  ${r.source_code}  「${r.name_zh}」/「${r.name_en ?? ''}」  →  「${newZh}」/「${newEn}」  ${changed ? '' : '(無變更)'}`);

  if (COMMIT && changed) {
    await query(`UPDATE emission_sources SET name_zh=$1, name_en=$2 WHERE id=$3`, [newZh, newEn, r.id]);
  }
}
console.log(COMMIT ? '\n✅ 已寫入。' : '\n（預覽模式，未寫入。）');
process.exit(0);

/**
 * V32 驗收：確認 DB 的 display_order 與現行硬編碼 FACTORY_ORDER 排序結果完全一致，
 * 且 is_active 全為 TRUE、CSR 對照表與程式碼裡的 CSR_FACTORY_MAP 逐筆相符。
 * 唯讀，不寫入。用法：node scripts/verify-v32.mjs
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');
if (!process.env.DATABASE_URL && fs.existsSync(envLocalPath)) {
  for (const raw of fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/)) {
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

// 改動前 summary-data.ts 的 FACTORY_ORDER（含 V23 已刪除的 6 個代碼，過濾後應與 DB 一致）
const LEGACY_FACTORY_ORDER = [
  'TWN_TPE', 'TWN_CHY', 'TWN_ECO',
  'IND_DMK', 'IND_GLR1', 'IND_GLR2', 'IND_GLS', 'IND_STL',
  'NVN_MK1', 'NVN_MK2', 'NVN_MK', 'NVN_HN',
  'SVN_LDR', 'SVN_TRP',
  'CAB_MK1', 'CAB_MK2', 'CAB_MK5', 'CAB_MOHA', 'CAB_MK',
  'CHN_JY', 'CHN_MZ', 'CHN_JY_SP', 'CHN_SH', 'CHN_HY',
  'SLV_MK', 'BGD_MK',
];

// 改動前 import-csr/route.ts 的 CSR_FACTORY_MAP
const LEGACY_CSR_MAP = {
  'BGD|MK': 'BGD_MK',
  'CAB|MK1': 'CAB_MK', 'CAB|MK2': 'CAB_MK', 'CAB|MK5': 'CAB_MK', 'CAB|MOHA': 'CAB_MOHA',
  'CHN|JY': 'CHN_JY', 'CHN|MZ': 'CHN_MZ', 'CHN|佳陽樣品中心': 'CHN_JY_SP',
  'CHN|Shanghai': 'CHN_SH', 'Shanghai|理陽': 'CHN_SH',
  'IND|Demak': 'IND_DMK', 'IND|GLR1': 'IND_GLR1', 'IND|GLR2': 'IND_GLR2',
  'IND|Sargen': 'IND_GLS', 'IND|Starlight': 'IND_STL',
  'NVN|MK1': 'NVN_MK', 'NVN|MK2': 'NVN_MK', 'NVN|河內辦公室': 'NVN_HN',
  'SLV|MK': 'SLV_MK',
  'SVN|Leader': 'SVN_LDR', 'SVN|Triple': 'SVN_TRP',
  'Taiwan|Chiayi': 'TWN_CHY', 'Taiwan|TPE': 'TWN_TPE',
  'Taiwan|吉時': 'TWN_ECO', 'Taiwan|聚益': 'TWN_ECO',
};

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
});
const q = (t) => pool.query(t).then((r) => r.rows);
let fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) fail++;
};

try {
  // 1. 排序一致性
  const dbRows = await q(`
    SELECT f.factory_code FROM factories f
    LEFT JOIN countries c ON c.country_code = f.country_code
    ORDER BY c.display_order NULLS LAST, f.display_order, f.factory_code`);
  const dbOrder = dbRows.map((r) => r.factory_code);
  const expected = LEGACY_FACTORY_ORDER.filter((c) => dbOrder.includes(c));
  check(
    '工廠順序與改動前 FACTORY_ORDER 一致',
    JSON.stringify(dbOrder) === JSON.stringify(expected),
    JSON.stringify(dbOrder) === JSON.stringify(expected) ? `${dbOrder.length} 廠` : `\n     DB: ${dbOrder.join(',')}\n     預期: ${expected.join(',')}`,
  );

  // 2. 沒有廠落在 999（代表全部都有排到）
  const unordered = await q(`SELECT factory_code FROM factories WHERE display_order = 999`);
  check('所有工廠都有 display_order（無殘留 999）', unordered.length === 0,
    unordered.map((r) => r.factory_code).join(',') || '0 筆');

  // 3. is_active 全為 TRUE
  const inactive = await q(`SELECT factory_code FROM factories WHERE NOT is_active`);
  check('is_active 全為 TRUE（行為未變）', inactive.length === 0, `${inactive.length} 筆停用`);

  // 4. 排放源排序：(scope, display_order, source_code) 應等同 (scope, source_code)
  const a = (await q(`SELECT source_code FROM emission_sources ORDER BY scope, display_order, source_code`)).map((r) => r.source_code);
  const b = (await q(`SELECT source_code FROM emission_sources ORDER BY scope, source_code`)).map((r) => r.source_code);
  check('排放源新舊排序結果相同', JSON.stringify(a) === JSON.stringify(b), `${a.length} 項`);

  // 5. CSR 對照表逐筆比對
  const aliases = await q(`SELECT csr_country, csr_factory, factory_code, is_ignored FROM factory_csr_aliases`);
  const dbMap = {};
  for (const r of aliases) if (!r.is_ignored) dbMap[`${r.csr_country}|${r.csr_factory}`] = r.factory_code;
  const missing = Object.keys(LEGACY_CSR_MAP).filter((k) => dbMap[k] !== LEGACY_CSR_MAP[k]);
  const extra = Object.keys(dbMap).filter((k) => !(k in LEGACY_CSR_MAP));
  check('CSR 對照表與改動前 CSR_FACTORY_MAP 相同', missing.length === 0 && extra.length === 0,
    missing.length || extra.length ? `缺/不符: ${missing.join(',')} 多: ${extra.join(',')}` : `${Object.keys(dbMap).length} 筆對應 + ${aliases.length - Object.keys(dbMap).length} 筆略過`);

  // 6. 國家表覆蓋所有在用國別
  const orphan = await q(`SELECT DISTINCT f.country_code FROM factories f
     LEFT JOIN countries c ON c.country_code = f.country_code WHERE c.country_code IS NULL`);
  check('countries 表涵蓋所有工廠國別', orphan.length === 0, orphan.map((r) => r.country_code).join(',') || '無遺漏');

  console.log(fail === 0 ? '\n🎉 V32 驗收全數通過' : `\n❌ 有 ${fail} 項未通過`);
} finally {
  await pool.end();
}
process.exit(fail === 0 ? 0 : 1);

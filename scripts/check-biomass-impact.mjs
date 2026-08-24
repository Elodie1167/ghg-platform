/**
 * 唯讀：找出哪些排放源有生質分段係數（factor_co2_bio 等），
 * 以及有多少筆 activity_records 受「生質 CO₂ 誤用一般係數」的 bug 影響。
 * 用法：node scripts/check-biomass-impact.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../apps/web/node_modules/pg/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');
if (!process.env.DATABASE_URL && fs.existsSync(envLocalPath)) {
  for (const raw of fs.readFileSync(envLocalPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
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
if (!process.env.DATABASE_URL) {
  console.error('找不到 DATABASE_URL');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const factorsRes = await pool.query(`
  SELECT id, year, emission_source_id,
         factor_co2, factor_co2_bio, factor_ch4_bio, factor_n2o_bio
  FROM emission_factors
  WHERE factor_co2_bio IS NOT NULL OR factor_ch4_bio IS NOT NULL OR factor_n2o_bio IS NOT NULL
  ORDER BY year
`);
console.log(`\n有填生質專屬係數的 emission_factors 筆數：${factorsRes.rows.length}`);
for (const r of factorsRes.rows) {
  console.log(`  factor_id=${r.id} year=${r.year} source=${r.emission_source_id} co2=${r.factor_co2} co2_bio=${r.factor_co2_bio} ch4_bio=${r.factor_ch4_bio} n2o_bio=${r.factor_n2o_bio}`);
}

const recordsRes = await pool.query(`
  SELECT ar.id, ar.factory_id, f.factory_code AS factory_name, ar.year, ar.month,
         ar.emission_source_id, es.source_code, es.name_zh AS source_name,
         ar.activity_value, ar.co2e_total, ar.co2e_biomass_co2, ar.meter_number
  FROM activity_records ar
  JOIN emission_sources es ON es.id = ar.emission_source_id
  JOIN factories f ON f.id = ar.factory_id
  WHERE es.is_biomass = true
    AND ar.co2e_biomass_co2 IS NOT NULL
    AND ar.co2e_biomass_co2 > 0
  ORDER BY ar.year, ar.month
`);
console.log(`\n受影響（is_biomass=true 且已有生質 CO2 值）的 activity_records 筆數：${recordsRes.rows.length}`);
for (const r of recordsRes.rows) {
  console.log(`  id=${r.id} 廠=${r.factory_name} ${r.year}-${r.month} 源=${r.source_code}(${r.source_name}) 活動量=${r.activity_value} 生質占比%=${r.meter_number} co2e_total=${r.co2e_total} co2e_biomass_co2=${r.co2e_biomass_co2}`);
}

await pool.end();

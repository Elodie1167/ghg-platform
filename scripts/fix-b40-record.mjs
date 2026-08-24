/**
 * 修正單一受影響紀錄（id=f646459c-fb37-48e1-9357-5a23945a6346，IND_GLD 2025-8
 * 發電機-生質柴油 B40）：生質 CO₂ 誤用一般係數(74100)、CH4/N2O 誤用化石占比能量的 bug。
 * 依修好的 lib/co2e-calc.ts 邏輯手動重算這一筆，寫回前先印出新舊值供人工核對。
 * 用法：node scripts/fix-b40-record.mjs         → 只印出新舊值比較，不寫入
 *       node scripts/fix-b40-record.mjs --apply → 印出後寫入 DB
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
if (!process.env.DATABASE_URL) { console.error('找不到 DATABASE_URL'); process.exit(1); }

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const RECORD_ID = 'f646459c-fb37-48e1-9357-5a23945a6346';
const APPLY = process.argv.includes('--apply');

const recRes = await pool.query(
  `SELECT ar.id, ar.factory_id, ar.year, ar.activity_value::float AS activity_value,
          ar.activity_unit, ar.meter_number, ar.co2e_total, ar.co2e_biomass_co2,
          ar.co2_t, ar.ch4_t, ar.n2o_t, ar.emission_factor_id,
          es.id AS emission_source_id
   FROM activity_records ar
   JOIN emission_sources es ON es.id = ar.emission_source_id
   WHERE ar.id = $1`,
  [RECORD_ID],
);
const r = recRes.rows[0];
if (!r) { console.error('找不到紀錄'); process.exit(1); }

const fRes = await pool.query(
  `SELECT factor_co2::float, factor_ch4::float, factor_n2o::float,
          factor_co2_bio::float, factor_ch4_bio::float, factor_n2o_bio::float,
          ncv::float, density::float, gwp_ch4::float, gwp_n2o::float
   FROM emission_factors WHERE id = $1`,
  [r.emission_factor_id],
);
const f = fRes.rows[0];

const GWP_CH4 = f.gwp_ch4 ?? 27.9;
const GWP_N2O = f.gwp_n2o ?? 273.0;
const bioFrac = Math.min((parseFloat(r.meter_number) || 0) / 100, 1);
const kg = r.activity_value * (f.density ?? 1);
const totalTj = (kg * f.ncv) / 1_000_000;
const fossilTj = totalTj * (1 - bioFrac);
const bioTj = totalTj * bioFrac;
const co2_kg = fossilTj * f.factor_co2;
const ch4_kg = totalTj * f.factor_ch4;
const n2o_kg = totalTj * f.factor_n2o;
const bioCo2_kg = bioTj * (f.factor_co2_bio ?? f.factor_co2);

const newCo2eTotal = (co2_kg + ch4_kg * GWP_CH4 + n2o_kg * GWP_N2O) / 1000;
const newBiomassCo2 = bioCo2_kg / 1000;
const newCo2T = co2_kg / 1000;
const newCh4T = ch4_kg / 1000;
const newN2oT = n2o_kg / 1000;

console.log('=== 修正前 ===');
console.log({ co2e_total: r.co2e_total, co2e_biomass_co2: r.co2e_biomass_co2, co2_t: r.co2_t, ch4_t: r.ch4_t, n2o_t: r.n2o_t });
console.log('=== 修正後 ===');
console.log({ co2e_total: newCo2eTotal, co2e_biomass_co2: newBiomassCo2, co2_t: newCo2T, ch4_t: newCh4T, n2o_t: newN2oT });

if (APPLY) {
  await pool.query(
    `UPDATE activity_records
     SET co2e_total = $1, co2e_biomass_co2 = $2, co2_t = $3, ch4_t = $4, n2o_t = $5, updated_at = NOW()
     WHERE id = $6`,
    [newCo2eTotal, newBiomassCo2, newCo2T, newCh4T, newN2oT, RECORD_ID],
  );
  console.log('\n已寫入 DB。');
} else {
  console.log('\n(未寫入，加 --apply 才會寫入)');
}
await pool.end();

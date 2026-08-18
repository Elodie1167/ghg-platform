/**
 * 上游運輸距離歷史種子資料匯入（Phase 5，縮小範圍版）
 *
 * 讀取 scripts/seed-transport-distances.input.json（由 IND/VIN/CAB 幾份 Excel
 * 分頁手動核對格式後用 Python 抽出的正規化清單，見規格 v6 交接文件），
 * upsert port_master（僅 destination_type='port' 的城市/港口才寫入；陸運起點若是
 * 供應商名稱或已經是工廠代碼就不寫入 port_master，語意不對）、寫入 route_distance。
 *
 * source 標記為 '歷史匯入_<原始分頁來源>'，之後查證追溯時知道這筆是哪個舊檔案來的。
 * 用 ON CONFLICT DO NOTHING（配合 route_distance 既有的 uq_route_distance_active
 * 唯一索引）：同一條路線（origin+destination+mode）先到先贏，重跑不會產生重複，
 * 也不會覆蓋已存在的資料（含使用者後續在覆核中心手動補建的）。
 *
 * 用法：node scripts/seed-transport-distances.mjs [--dry-run]
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, 'seed-transport-distances.input.json');
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');

const DRY_RUN = process.argv.includes('--dry-run');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
if (!process.env.DATABASE_URL) loadEnvFile(envLocalPath);
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('❌ DATABASE_URL 未設定'); process.exit(1); }
const useSSL = process.env.DATABASE_SSL !== 'false';

const pool = new pg.Pool({ connectionString: DB_URL, ssl: useSSL ? { rejectUnauthorized: false } : false });

function guessPortType(mode) {
  if (mode === 'Sea') return 'sea';
  if (mode === 'Air') return 'air';
  return 'city';
}

async function main() {
  const entries = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  console.log(`讀到 ${entries.length} 筆待匯入路線${DRY_RUN ? '（dry-run，不會寫入）' : ''}`);

  const factoriesRes = await pool.query(`SELECT id, factory_code FROM factories`);
  const factoryIdByCode = new Map(factoriesRes.rows.map((f) => [f.factory_code, f.id]));

  let inserted = 0, skippedNoFactory = 0, portMasterCreated = 0;
  const seenPorts = new Set();

  for (const e of entries) {
    let destFactoryId = null;
    if (e.destination_type === 'factory') {
      destFactoryId = factoryIdByCode.get(e.dest) ?? null;
      if (!destFactoryId) {
        console.warn(`⚠ 找不到工廠代碼 ${e.dest}（origin=${e.origin}），略過這筆`);
        skippedNoFactory++;
        continue;
      }
    }

    // port_master：只有城市/港口需要（陸運 destination_type='factory' 且 origin 是
    // 供應商/工廠代碼時不寫入；origin 是城市/港口字串時才寫，用「是否含常見城市/港口字樣
    // 或本身就是 origin 字串」判斷太複雜，這裡簡化為：destination_type='port' 一定寫兩端；
    // destination_type='factory' 只在 mode 為 Sea/Air 時把 origin 當港口寫入（last-mile
    // 港→廠場景），mode='Land' 時 origin 可能是城市也可能是供應商名，一律不寫入 port_master，
    // 避免把供應商名稱誤植為城市標準名。
    if (!DRY_RUN) {
      if (e.destination_type === 'port') {
        for (const name of [e.origin, e.dest]) {
          if (!seenPorts.has(name)) {
            await pool.query(
              `INSERT INTO port_master (standard_name, port_type) VALUES ($1, $2) ON CONFLICT (standard_name) DO NOTHING`,
              [name, guessPortType(e.mode)],
            );
            seenPorts.add(name);
            portMasterCreated++;
          }
        }
      } else if (e.mode !== 'Land' && !seenPorts.has(e.origin)) {
        await pool.query(
          `INSERT INTO port_master (standard_name, port_type) VALUES ($1, $2) ON CONFLICT (standard_name) DO NOTHING`,
          [e.origin, guessPortType(e.mode)],
        );
        seenPorts.add(e.origin);
        portMasterCreated++;
      }

      const r = await pool.query(
        `INSERT INTO route_distance
           (origin, destination_type, destination_port, destination_factory_id, mode, distance_km, source, note, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          e.origin,
          e.destination_type,
          e.destination_type === 'port' ? e.dest : null,
          destFactoryId,
          e.mode,
          e.distance_km,
          `歷史匯入_${e.source}`,
          null,
        ],
      );
      if (r.rowCount > 0) inserted++;
    } else {
      inserted++;
    }
  }

  console.log(`✅ 完成：新增 ${inserted} 筆 route_distance（含重複略過）、${portMasterCreated} 筆 port_master、${skippedNoFactory} 筆因工廠代碼查無對應而略過`);
  await pool.end();
}

main().catch((err) => { console.error('❌', err); process.exit(1); });

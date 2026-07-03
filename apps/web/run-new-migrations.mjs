/**
 * 執行 V10 + V11 migration，自動從 .env.local 讀取 DATABASE_URL
 * 用法：在 apps/web/ 目錄下執行 → node run-new-migrations.mjs
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 自動讀取 .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌ 找不到 DATABASE_URL，請確認 apps/web/.env.local 存在');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
console.log('✅ 資料庫連線成功\n');

const targets = ['V10__merge_welding.sql', 'V11__add_diesel_commute.sql'];
const migrationsDir = path.join(__dirname, '..', '..', 'db', 'migrations');

for (const file of targets) {
  const filePath = path.join(migrationsDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠  ${file} 不存在，跳過`);
    continue;
  }
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`▶  執行 ${file} ...`);
  try {
    await client.query(sql);
    console.log(`   ✅ ${file} 完成`);
  } catch (err) {
    if (err.message?.includes('already exists') || err.message?.includes('duplicate key')) {
      console.log(`   ⚠  ${file} 部分已存在，跳過`);
    } else {
      console.error(`   ❌ ${file} 失敗：`, err.message);
    }
  }
}

await client.end();
console.log('\n🎉 Migration 完成！重新整理瀏覽器即可看到焊條/柴油汽車更新。');

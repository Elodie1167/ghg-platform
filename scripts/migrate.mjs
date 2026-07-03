/**
 * 執行所有 DB migrations（V1 → V4）
 * 用法：node scripts/migrate.mjs
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌ DATABASE_URL 未設定，請先 export DATABASE_URL=...');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
console.log('✅ 資料庫連線成功');

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  console.log(`▶ 執行 ${file} ...`);
  try {
    await client.query(sql);
    console.log(`  ✅ ${file} 完成`);
  } catch (err) {
    // 忽略「已存在」類型的錯誤，繼續跑
    if (err.code === '42P07' || err.code === '42710' || err.message.includes('already exists') || err.message.includes('duplicate key')) {
      console.log(`  ⚠ ${file} 部分已存在，跳過`);
    } else {
      console.error(`  ❌ ${file} 失敗：`, err.message);
      await client.end();
      process.exit(1);
    }
  }
}

await client.end();
console.log('\n🎉 所有 migrations 完成！');

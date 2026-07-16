import { Pool } from 'pg';

// SSL：Neon 等雲端 DB 需要 SSL；內網自架 Postgres 通常不開 SSL。
// 以環境變數 DATABASE_SSL 控制——內網請在 .env.local 設 DATABASE_SSL=false。
// 預設維持開啟（向後相容，Neon 不受影響）。
const useSSL = process.env.DATABASE_SSL !== 'false';

// 建立連線 Pool，connectionString 由環境變數注入
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 30000,
});

/**
 * 執行 SQL 查詢的統一入口
 * @param text  SQL 字串，佔位符用 $1, $2, ...
 * @param params 對應佔位符的參數陣列
 */
export const query = (text: string, params?: unknown[]) =>
  pool.query(text, params);

export default pool;

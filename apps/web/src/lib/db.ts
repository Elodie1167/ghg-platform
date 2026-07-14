import { Pool } from 'pg';

// 建立連線 Pool，connectionString 由環境變數注入
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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

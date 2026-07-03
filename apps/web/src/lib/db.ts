import { Pool } from 'pg';

// 建立連線 Pool，connectionString 由環境變數注入
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 本地開發預設不需要 SSL；生產環境（Azure/RDS）請設 ssl: { rejectUnauthorized: false }
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

/**
 * 執行 SQL 查詢的統一入口
 * @param text  SQL 字串，佔位符用 $1, $2, ...
 * @param params 對應佔位符的參數陣列
 */
export const query = (text: string, params?: unknown[]) =>
  pool.query(text, params);

export default pool;

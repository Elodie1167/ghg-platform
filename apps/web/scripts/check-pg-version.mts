/** 查 Neon 目前的 Postgres 版本（只讀），供決定內網要裝哪個版本。 */
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
const { query } = await import('@/lib/db');
const r = await query('SHOW server_version');
console.log('Neon server_version:', r.rows[0].server_version);
process.exit(0);

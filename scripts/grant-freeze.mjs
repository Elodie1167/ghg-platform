/**
 * 授予 / 取消「查證封存」權限（users.can_freeze）
 *
 * 用法：
 *   node scripts/grant-freeze.mjs --list              # 列出目前誰有封存權限
 *   node scripts/grant-freeze.mjs <email>             # 授予
 *   node scripts/grant-freeze.mjs --revoke <email>    # 取消
 *
 * 存在理由（設計文件 §8.3 第 3 層「緊急後路」）：
 *   封存權限刻意不硬編碼在程式碼中的 email 白名單，人員異動時只要改 DB 欄位。
 *   但後台「帳號管理」頁尚未實作，且日後若持有權限者同時離職／帳號停用，
 *   會沒有人能授權給別人。這支腳本讓任何具 DB 連線的人（例如接手維運者、IT）
 *   都能繞過 UI 直接授權，避免整個封存功能因人員異動而卡死。
 *
 * ⚠️ 封存是不可逆操作，且封存後的快照就是對外揭露與報告書的數字來源。
 *    授權前請確認對方確實需要此權限。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// 相對路徑匯入，理由同 create-user.mjs（不依賴上層目錄剛好有 node_modules）
import pg from '../apps/web/node_modules/pg/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
if (!process.env.DATABASE_URL) loadEnvFile(envLocalPath);

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL 未設定（也找不到 apps/web/.env.local）');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

async function listHolders() {
  const r = await client.query(
    `SELECT email, display_name, role, is_active
       FROM users WHERE can_freeze ORDER BY email`,
  );
  if (r.rowCount === 0) {
    console.log('\n⚠ 目前沒有任何人具備封存權限——沒有人能執行查證封存。');
    return r;
  }
  console.log(`\n目前具備封存權限者（${r.rowCount} 人）：`);
  console.table(
    r.rows.map((u) => ({
      email: u.email,
      姓名: u.display_name ?? '',
      角色: u.role,
      啟用: u.is_active ? '✅' : '⚠ 已停用',
    })),
  );

  const activeCount = r.rows.filter((u) => u.is_active).length;
  if (activeCount === 1) {
    console.log('\n⚠ 只有 1 位在啟用中的權限持有者 —— 屬單點失效風險，建議再指定一位。');
  }
  return r;
}

async function main() {
  await client.connect();
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--list')) {
    await listHolders();
    if (args.length === 0) {
      console.log('\n用法：');
      console.log('  node scripts/grant-freeze.mjs <email>            授予');
      console.log('  node scripts/grant-freeze.mjs --revoke <email>   取消');
    }
    return;
  }

  const revoke = args.includes('--revoke');
  const email = args.find((a) => !a.startsWith('--'));
  if (!email) {
    console.error('❌ 請提供 email');
    process.exitCode = 1;
    return;
  }

  const target = await client.query(
    'SELECT id, email, display_name, can_freeze, is_active FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  if (target.rowCount === 0) {
    console.error(`❌ 找不到帳號：${email}`);
    console.error('   （請先用 node scripts/create-user.mjs 建立帳號）');
    process.exitCode = 1;
    return;
  }
  const u = target.rows[0];

  if (u.can_freeze === !revoke) {
    console.log(`ℹ ${u.email} 的封存權限已經是「${revoke ? '無' : '有'}」，未做變更。`);
    await listHolders();
    return;
  }

  // 取消前先確認不會把最後一位在啟用中的持有者拿掉，否則沒有人能封存
  if (revoke) {
    const remaining = await client.query(
      `SELECT count(*)::int AS n FROM users
        WHERE can_freeze AND is_active AND id <> $1`,
      [u.id],
    );
    if (remaining.rows[0].n === 0) {
      console.error(`❌ 拒絕執行：${u.email} 是最後一位在啟用中的封存權限持有者。`);
      console.error('   取消後將無人能執行查證封存。請先授予他人，再取消此人。');
      process.exitCode = 1;
      return;
    }
  }

  await client.query('UPDATE users SET can_freeze = $2 WHERE id = $1', [u.id, !revoke]);
  console.log(`✅ 已${revoke ? '取消' : '授予'} ${u.email}（${u.display_name ?? ''}）的查證封存權限。`);
  if (!u.is_active) {
    console.log('⚠ 注意：此帳號目前為停用狀態，需啟用後才能實際使用。');
  }

  // actor_id 留 NULL：CLI 腳本無登入 session，執行者身分只能靠終端機/交接紀錄追溯，
  // 這裡至少留下「誰被改了權限、改成什麼」（設計文件 §9）。
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail)
     VALUES (NULL, $1, 'user', $2, $3)`,
    [revoke ? 'revoke_freeze' : 'grant_freeze', u.id,
     JSON.stringify({ email: u.email, display_name: u.display_name ?? null, via: 'grant-freeze.mjs' })],
  );
  console.log('ℹ 已寫入 audit_log（actor 為 NULL，CLI 執行無登入 session）。');

  await listHolders();
}

try {
  await main();
} catch (err) {
  console.error('\n❌ 執行失敗：' + err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

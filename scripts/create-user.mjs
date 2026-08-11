/**
 * 建立 / 更新平台帳號（過渡期密碼登入）
 *
 * 用法：
 *   node scripts/create-user.mjs                    # 互動模式：逐項詢問
 *   node scripts/create-user.mjs --list             # 只列出現有帳號（不修改）
 *   node scripts/create-user.mjs --init             # 建立設計文件 §0.5 的四個初始帳號
 *   node scripts/create-user.mjs --reset <email>    # 只重設某人的密碼
 *
 * ⚠️ 密碼一律於執行時由操作者輸入，且輸入時不回顯。
 *    明文密碼不寫入任何檔案、參數或 commit（故刻意不提供 --password 參數：
 *    命令列參數會留在 shell 歷史紀錄與程序清單裡）。
 *
 * 背景：最終方向為 Azure AD SSO（users.azure_oid）。此為過渡方案，
 *      SSO 上線後把 password_hash 設為 NULL 即停用密碼登入，
 *      帳號本身與其所有關聯記錄（填報、檢核、封存）不需搬移。
 *      詳見 db/migrations/V40__user_identity.sql 與設計文件 §0.3。
 */

import readline from 'node:readline';
import { Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 相對路徑匯入：scripts/ 底下沒有自己的 package.json，
// 裸匯入（import 'pg'）是靠 Node 往上層目錄找 node_modules 才碰巧成功的，
// 一旦專案被搬到別的位置就會壞。這裡直接指到 apps/web 的依賴，位置無關。
import pg from '../apps/web/node_modules/pg/lib/index.js';
import bcrypt from '../apps/web/node_modules/bcryptjs/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', 'apps', 'web', '.env.local');

const BCRYPT_ROUNDS = 12;

// 密碼不設任何複雜度或長度限制（2026-08-11 Elodie 決議）。
// 使用範圍小（4 個帳號、內網平台），不值得為此增加使用者負擔。
// 唯一保留的檢查是「不可為空」——這不是政策限制而是功能限制：
// lib/auth.ts 的 authorize() 對空密碼直接回傳 null，登入頁的欄位也是 required，
// 因此空密碼設得進去卻永遠登不進來，會變成一個難以察覺的死帳號。

// 設計文件 §0.5。can_freeze 僅主責與主管持有——封存不可逆且直接對應
// 對外揭露數字，日常填報與檢核不需此權限。
const INITIAL_USERS = [
  { email: 'elodiecheng@makalot.com.tw', name: 'Elodie Cheng',  role: 'admin', canFreeze: true,  note: '主責' },
  { email: 'JohnsonLin@makalot.com.tw',  name: 'Johnson Lin',   role: 'admin', canFreeze: true,  note: '主管，第二位封存權限人' },
  { email: 'kellylin@makalot.com.tw',    name: 'Kelly Lin',     role: 'admin', canFreeze: false, note: '日常使用者' },
  { email: 'mengyinghong@makalot.com.tw', name: 'Meng-Ying Hong', role: 'admin', canFreeze: false, note: '日常使用者' },
];

// --- .env 載入（不覆蓋既有環境變數、不印出任何值；比照 migrate.mjs）---
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

// --- 互動輸入 ---
//
// ⚠️ 絕對不可建立「常駐」的 readline interface。
//    2026-08-11 的錯誤版本在模組載入時就建了一個常駐 rl（output: process.stdout），
//    它全程掛在 stdin 上並把每個輸入字元回顯到畫面；密碼專用的靜音 interface
//    同時讀取 stdin，兩者互搶，結果四組密碼被明文印在終端機上。
//    因此改為「每次問答各自建立 interface，用完立刻 close」，
//    同一時間 stdin 上只會有一個讀取者。

/** 一般問答（會回顯，無妨） */
function ask(q) {
  return new Promise((res) => {
    const r = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    r.question(q, (a) => {
      r.close();
      res(a.trim());
    });
  });
}

/** 讀密碼但不回顯（輸入時畫面不顯示任何字元） */
function askPassword(q) {
  return new Promise((res) => {
    // 先把提示字印出來，之後才開始靜音，避免提示本身也被吃掉
    process.stdout.write(q);

    let muted = true;
    const muteStream = new Writable({
      write(chunk, enc, cb) {
        if (!muted) process.stdout.write(chunk, enc);
        cb();
      },
    });
    const r = readline.createInterface({
      input: process.stdin,
      output: muteStream,
      terminal: true,
    });
    r.question('', (answer) => {
      muted = false;
      r.close();
      process.stdout.write('\n');
      res(answer);
    });
  });
}

async function readNewPassword(label) {
  for (;;) {
    const p1 = await askPassword(`  ${label}密碼（輸入不顯示）：`);
    if (p1.length === 0) {
      console.log('  ⚠ 密碼不可為空（空密碼會登不進來），請重新輸入。');
      continue;
    }
    const p2 = await askPassword('  再輸入一次確認：');
    if (p1 !== p2) {
      console.log('  ⚠ 兩次輸入不一致，請重新輸入。');
      continue;
    }
    return p1;
  }
}

async function listUsers() {
  const r = await client.query(`
    SELECT u.email, u.display_name, u.role, u.can_freeze, u.is_active,
           f.factory_code,
           (u.password_hash IS NOT NULL) AS has_password,
           (u.azure_oid     IS NOT NULL) AS has_sso
      FROM users u
      LEFT JOIN factories f ON f.id = u.factory_id
     ORDER BY u.role, u.email
  `);
  if (r.rowCount === 0) {
    console.log('\n（目前沒有任何帳號）');
    return r;
  }
  console.log(`\n現有帳號（${r.rowCount} 個）：`);
  console.table(
    r.rows.map((u) => ({
      email: u.email,
      姓名: u.display_name ?? '',
      角色: u.role,
      綁定廠: u.factory_code ?? '（全廠）',
      可封存: u.can_freeze ? '✅' : '',
      啟用: u.is_active ? '✅' : '停用',
      登入方式: u.has_sso ? 'SSO' : u.has_password ? '密碼' : '⚠ 無',
    })),
  );
  return r;
}

/** 建立或更新一個帳號。回傳 'created' | 'updated' */
async function upsertUser({ email, name, role, canFreeze, factoryId, passwordHash }) {
  const existing = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);

  if (existing.rowCount > 0) {
    // 既有帳號：只更新有給值的欄位；沒給新密碼就不動原密碼
    await client.query(
      `UPDATE users
          SET display_name  = COALESCE($2, display_name),
              role          = $3,
              factory_id    = $4,
              can_freeze    = $5,
              password_hash = COALESCE($6, password_hash)
        WHERE id = $1`,
      [existing.rows[0].id, name, role, factoryId, canFreeze, passwordHash],
    );
    return 'updated';
  }

  await client.query(
    `INSERT INTO users (email, display_name, role, factory_id, can_freeze, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    [email, name, role, factoryId, canFreeze, passwordHash],
  );
  return 'created';
}

async function pickFactory() {
  const r = await client.query(
    `SELECT id, factory_code, name_zh FROM factories
      WHERE is_active ORDER BY display_order NULLS LAST, factory_code`,
  );
  console.log('\n  可選廠別：');
  r.rows.forEach((f, i) => console.log(`    ${String(i + 1).padStart(2)}. ${f.factory_code}  ${f.name_zh ?? ''}`));
  for (;;) {
    const ans = await ask('  請輸入廠別編號或廠代碼：');
    const byIdx = /^\d+$/.test(ans) ? r.rows[parseInt(ans, 10) - 1] : null;
    const byCode = r.rows.find((f) => f.factory_code.toLowerCase() === ans.toLowerCase());
    const hit = byIdx ?? byCode;
    if (hit) return hit.id;
    console.log('  ⚠ 找不到該廠別，請重新輸入。');
  }
}

// ─────────────────────────────────────────────────────────────
async function main() {
  await client.connect();
  const args = process.argv.slice(2);

  // --- --list ---
  if (args.includes('--list')) {
    await listUsers();
    return;
  }

  // --- --reset <email> ---
  const resetIdx = args.indexOf('--reset');
  if (resetIdx !== -1) {
    const email = args[resetIdx + 1];
    if (!email) {
      console.error('❌ 用法：node scripts/create-user.mjs --reset <email>');
      process.exitCode = 1;
      return;
    }
    const r = await client.query(
      'SELECT id, email, display_name FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    if (r.rowCount === 0) {
      console.error(`❌ 找不到帳號：${email}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n重設密碼：${r.rows[0].email}（${r.rows[0].display_name ?? ''}）`);
    const pw = await readNewPassword('新');
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [r.rows[0].id, hash]);
    console.log('✅ 密碼已更新。請以公司密碼保管流程交付本人，不要用未加密的管道傳送。');
    return;
  }

  // --- --init：建立設計文件 §0.5 的四個初始帳號 ---
  if (args.includes('--init')) {
    console.log('\n=== 建立初始帳號（設計文件 §0.5）===');
    console.log('四個帳號皆為 admin（不綁廠）。can_freeze 僅 Elodie 與 Johnson。');
    console.log('每個帳號會分別詢問密碼；已存在的帳號只更新角色與權限，不動既有密碼。\n');

    for (const u of INITIAL_USERS) {
      const exists = await client.query(
        'SELECT (password_hash IS NOT NULL) AS has_pw FROM users WHERE lower(email) = lower($1)',
        [u.email],
      );
      const alreadyHasPw = exists.rowCount > 0 && exists.rows[0].has_pw;

      console.log(`▶ ${u.email}  [${u.name}]  ${u.canFreeze ? '可封存' : '不可封存'}  — ${u.note}`);
      let hash = null;
      if (alreadyHasPw) {
        const again = await ask('  此帳號已有密碼。要重設嗎？(y/N)：');
        if (again.toLowerCase() === 'y') hash = await bcrypt.hash(await readNewPassword('新'), BCRYPT_ROUNDS);
        else console.log('  （保留原密碼）');
      } else {
        hash = await bcrypt.hash(await readNewPassword('設定'), BCRYPT_ROUNDS);
      }

      const action = await upsertUser({
        email: u.email,
        name: u.name,
        role: u.role,
        canFreeze: u.canFreeze,
        factoryId: null, // admin 一律不綁廠（V40 的 ck_users_factory_by_role 會強制）
        passwordHash: hash,
      });
      console.log(`  ✅ ${action === 'created' ? '已建立' : '已更新'}\n`);
    }

    await listUsers();
    console.log('\n下一步：node scripts/backfill-reviewed-by.mjs（回填既有 176 筆的檢核者）');
    return;
  }

  // --- 互動模式：建立單一帳號 ---
  console.log('\n=== 建立 / 更新單一帳號 ===');
  await listUsers();

  const email = await ask('\nEmail：');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('❌ Email 格式不正確');
    process.exitCode = 1;
    return;
  }
  const name = (await ask('顯示名稱：')) || null;

  let role = '';
  while (role !== 'admin' && role !== 'reporter') {
    role = (await ask('角色 admin / reporter：')).toLowerCase();
    if (role !== 'admin' && role !== 'reporter') console.log('  ⚠ 只能填 admin 或 reporter。');
  }

  // reporter 必須綁廠、admin 必須不綁廠（V40 的 CHECK 會強制，這裡先問清楚避免撞約束）
  const factoryId = role === 'reporter' ? await pickFactory() : null;

  let canFreeze = false;
  if (role === 'admin') {
    const ans = await ask('要授予「查證封存」權限嗎？封存不可逆且對應對外揭露數字 (y/N)：');
    canFreeze = ans.toLowerCase() === 'y';
  }

  const pw = await readNewPassword('設定');
  const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);

  const action = await upsertUser({ email, name, role, canFreeze, factoryId, passwordHash: hash });
  console.log(`\n✅ 帳號${action === 'created' ? '已建立' : '已更新'}：${email}`);
  console.log('   請以公司密碼保管流程交付本人，不要用未加密的管道傳送。');
  await listUsers();
}

try {
  await main();
} catch (err) {
  console.error('\n❌ 執行失敗：' + err.message);
  process.exitCode = 1;
} finally {
  // 不需要 close readline：ask() / askPassword() 各自建立並立即關閉自己的 interface
  await client.end().catch(() => {});
}

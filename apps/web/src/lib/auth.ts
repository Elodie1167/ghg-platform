import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';

/**
 * NextAuth v5 設定
 *
 * 過渡期：email + bcrypt 密碼，帳號存於 users 表（V40 建置）。
 * 最終：Azure AD（Microsoft Entra ID）。屆時只需
 *   1. 換掉下方 Credentials provider 為 MicrosoftEntraID provider
 *   2. 於 signIn callback 依 azure_oid（或 email）對上 users 列
 *   3. 把各帳號的 password_hash 設為 NULL 停用密碼登入
 * users 表結構與所有關聯記錄（填報 created_by、檢核 reviewed_by、
 * 封存 frozen_by）都指向 users.id，不需搬移。
 *
 * ⚠️ 2026-08 之前這裡是硬寫的單一帳號（admin / ghg2025），全平台共用，
 *    回傳的 id 不是 users.id。因此 241 筆填報的 created_by 全為 NULL、
 *    176 筆已檢核記錄查不出檢核者。查證封存必須能回答「這份資料誰封的」，
 *    故改為真實身分。詳見 V40__user_identity.sql 與設計文件 §0。
 */

/** users 表中登入所需的欄位 */
interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: 'reporter' | 'admin';
  factory_id: string | null;
  factory_code: string | null;
  can_freeze: boolean;
  password_hash: string | null;
}

/**
 * 帳號不存在時仍執行一次 bcrypt 比對用的假雜湊。
 * 若查不到帳號就直接回傳，回應時間會明顯短於「帳號存在但密碼錯」，
 * 等於對外洩漏「這個 email 是不是平台使用者」。統一走完比對流程可避免。
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.rTk9J6l0Zm0M3n6Yk8lWQ0m6cQ5ZQZa';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: '密碼', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;

        let row: UserRow | null = null;
        try {
          // email 不分大小寫比對（V1 的 UNIQUE 是區分大小寫的，
          // 使用者不該因為打了大寫就登不進來）
          const result = await query(
            `SELECT u.id, u.email, u.display_name, u.role, u.factory_id,
                    u.can_freeze, u.password_hash, f.factory_code
               FROM users u
               LEFT JOIN factories f ON f.id = u.factory_id
              WHERE lower(u.email) = lower($1)
                AND u.is_active
              LIMIT 1`,
            [email],
          );
          row = (result.rows[0] as UserRow | undefined) ?? null;
        } catch (err) {
          // DB 連不上時不要當成「密碼錯誤」——那會讓人一直重試打密碼。
          console.error('[auth] 查詢帳號失敗：', err);
          return null;
        }

        const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
        if (!ok || !row || !row.password_hash) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.display_name ?? row.email,
          role: row.role,
          factoryId: row.factory_id,
          factoryCode: row.factory_code,
          canFreeze: row.can_freeze,
        };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 小時
  },

  pages: {
    signIn: '/login',
  },

  callbacks: {
    async jwt({ token, user }) {
      // user 只在登入當次有值；之後的請求靠 token 內已存的資料
      if (user) {
        const u = user as typeof user & {
          role?: string;
          factoryId?: string | null;
          factoryCode?: string | null;
          canFreeze?: boolean;
        };
        token.id = u.id;
        token.role = u.role;
        token.factoryId = u.factoryId ?? null;
        token.factoryCode = u.factoryCode ?? null;
        token.canFreeze = u.canFreeze ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        Object.assign(session.user, {
          id: token.id as string,
          role: token.role as 'reporter' | 'admin',
          factoryId: (token.factoryId as string | null) ?? null,
          factoryCode: (token.factoryCode as string | null) ?? null,
          canFreeze: (token.canFreeze as boolean) ?? false,
        });
      }
      return session;
    },
  },
});

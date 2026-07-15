import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

/**
 * NextAuth v5 設定
 *
 * 本地測試：Credentials Provider（硬寫帳密）
 * 生產環境：切換為 Azure AD Provider（Microsoft Entra ID）
 *
 * 注意：硬寫的帳密僅供本地開發，部署前必須移除並改用 Azure AD。
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        username: { label: '帳號', type: 'text' },
        password: { label: '密碼', type: 'password' },
      },
      async authorize(credentials) {
        // TODO（生產環境）：改為查詢 DB users 表並比對 bcrypt hash
        if (
          credentials?.username === 'admin' &&
          credentials?.password === 'ghg2025'
        ) {
          return {
            id: 'local-admin',
            name: '本地管理員',
            email: 'admin@ghg-local.dev',
          };
        }
        return null;
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
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as typeof session.user & { id: string }).id =
          token.id as string;
      }
      return session;
    },
  },
});

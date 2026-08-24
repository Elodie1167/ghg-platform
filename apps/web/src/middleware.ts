import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Middleware：保護需要登入的路由
 *
 * 本地開發：全部放行（避免 Edge Runtime 與 NextAuth Credentials provider 衝突）
 * 生產環境：檢查 NextAuth session token，未登入導去 /login（頁面）或回 401（API）
 *
 * ⚠️ 這裡刻意不 import '@/lib/auth' 的 `auth()`——那支會把整個 NextAuth() 設定
 *    （含 Credentials provider 內的 bcrypt、pg 查詢）一起載進 Edge Runtime，
 *    bcryptjs/pg 在 Edge 下無法動作。改用 next-auth/jwt 的 getToken() 直接讀
 *    JWT cookie，不需要 providers，Edge-safe。
 *
 * ⚠️ /fill/（填報頁）與其寫入 API 一併納入強制登入（2026-08 起），
 *    否則填報時仍可能沒有登入身分，created_by 會是 NULL，查證封存時
 *    答不出「這份資料誰填的」。
 */
export default async function middleware(req: NextRequest) {
  // 本地開發：直接放行所有請求
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // 白名單路徑直接放行（無需認證）：NextAuth 自己的端點與登入頁本身
  if (pathname.startsWith('/api/auth') || pathname === '/login') {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  if (token) {
    return NextResponse.next();
  }

  // API 路徑：回 401，不做頁面導轉（呼叫端不是瀏覽器導覽）
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ data: null, error: '請先登入' }, { status: 401 });
  }

  const loginUrl = new URL('/login', req.nextUrl.origin);
  loginUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 排除靜態資源與 _next 內部路由
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

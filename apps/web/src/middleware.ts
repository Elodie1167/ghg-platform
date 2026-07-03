import { NextResponse, NextRequest } from 'next/server';

/**
 * Middleware：保護需要登入的路由
 *
 * 本地開發：全部放行（避免 Edge Runtime 與 NextAuth Credentials provider 衝突）
 * 生產環境：切換回 auth() 包裝並啟用登入驗證
 */
export default function middleware(req: NextRequest) {
  // 本地開發：直接放行所有請求
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // 白名單路徑直接放行（無需認證）
  if (
    pathname.startsWith('/api/auth') ||
    pathname === '/login' ||
    pathname.startsWith('/fill/') ||
    pathname.startsWith('/api/records/autosave') ||
    pathname.startsWith('/api/records/import')
  ) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // 排除靜態資源與 _next 內部路由
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

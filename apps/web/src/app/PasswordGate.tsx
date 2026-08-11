'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * 強制改密碼的攔截器：登入後若 must_change_password 為 true，
 * 一律先導到 /change-password，改完才放行進主畫面。
 *
 * 放在 RootLayout 內，因此對所有頁面生效。
 *
 * ⚠️ 這是「流程引導」而不是安全控制。它跑在瀏覽器端，理論上能被繞過
 *    （例如關掉 JS 直接打 API）。真正的安全邊界在 API route——
 *    但本平台目前所有 API 都還沒有權限檢查（見設計文件 §0.6，
 *    待「現有 API 補權限過濾」那一輪處理），故此處與現況一致。
 *    等 API 補上檢查後，再把「未改密碼者不得寫入」一併納入伺服器端判斷。
 */

/** 不攔截的路徑：改密碼頁本身、登入頁、以及 NextAuth 的端點 */
const ALLOW = ['/change-password', '/login', '/api/auth'];

export default function PasswordGate() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const mustChange =
    (session?.user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword === true;

  useEffect(() => {
    if (status !== 'authenticated' || !mustChange) return;
    if (ALLOW.some((p) => pathname === p || pathname.startsWith(p + '/'))) return;
    router.replace('/change-password');
  }, [status, mustChange, pathname, router]);

  return null;
}

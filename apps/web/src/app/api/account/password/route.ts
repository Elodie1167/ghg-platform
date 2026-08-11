import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

/**
 * POST /api/account/password — 由使用者自行更改自己的密碼
 *
 * 只能改「自己」的密碼：目標帳號一律取自登入 session，不接受前端傳入 email
 * 或 user id，否則任何登入者都能改別人的密碼。
 *
 * 需驗證舊密碼：光靠 session 就允許改密碼的話，任何人拿到一台沒鎖屏的電腦
 * 就能把帳號接管走（改掉密碼後原使用者也登不回來）。
 *
 * 密碼長度／複雜度不設限（2026-08-11 Elodie 決議），僅要求非空——
 * 空密碼在 lib/auth.ts 的 authorize() 會被直接拒絕，設得進去卻登不進來。
 */

const BCRYPT_ROUNDS = 12;

const BodySchema = z.object({
  current_password: z.string().min(1, '請輸入目前密碼'),
  new_password: z.string().min(1, '新密碼不可為空'),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ data: null, error: '請先登入' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: '無法解析請求內容' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.errors.map((e) => e.message).join('; ') },
      { status: 400 },
    );
  }
  const { current_password, new_password } = parsed.data;

  const result = await query(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active',
    [user.id],
  );
  const row = result.rows[0] as { password_hash: string | null } | undefined;
  if (!row) {
    return NextResponse.json({ data: null, error: '查無此帳號或帳號已停用' }, { status: 404 });
  }
  if (!row.password_hash) {
    // 走 Azure AD SSO 的帳號沒有平台密碼可改
    return NextResponse.json(
      { data: null, error: '此帳號使用公司帳號登入，密碼請至公司帳號系統更改' },
      { status: 400 },
    );
  }

  const ok = await bcrypt.compare(current_password, row.password_hash);
  if (!ok) {
    return NextResponse.json({ data: null, error: '目前密碼不正確' }, { status: 400 });
  }

  if (await bcrypt.compare(new_password, row.password_hash)) {
    return NextResponse.json(
      { data: null, error: '新密碼與目前密碼相同，請改用不同的密碼' },
      { status: 400 },
    );
  }

  const hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  await query(
    'UPDATE users SET password_hash = $2, must_change_password = FALSE WHERE id = $1',
    [user.id, hash],
  );

  // 前端收到成功後須呼叫 useSession().update() 讓 JWT 重讀 must_change_password，
  // 否則畫面會一直把使用者導回改密碼頁。
  return NextResponse.json({ data: { changed: true }, error: null });
}

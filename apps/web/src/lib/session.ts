import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * 伺服器端取得目前登入者，並提供權限守門函式。
 *
 * 為什麼要有這一層：權限判斷若散落在各個 route 各寫一次，遲早會有人漏寫
 * 或寫得不一樣。所有 API route 與 server component 一律走這裡。
 *
 * 回應格式沿用專案慣例 { data, error }，錯誤時由呼叫端回 NextResponse。
 */

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: 'reporter' | 'admin';
  /** reporter 綁定的廠；admin 為 null（可存取所有廠） */
  factoryId: string | null;
  factoryCode: string | null;
  /** 是否可執行查證封存（不可逆操作，見設計文件 §8） */
  canFreeze: boolean;
  /** 為 true 時必須先改密碼才能使用平台（管理者代設密碼後的首次登入） */
  mustChangePassword: boolean;
}

/** 取得目前登入者；未登入回 null。不丟錯，供需要「有就用、沒有就算了」的場合使用。 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await auth();
  const u = session?.user as (AppUser & { id?: string }) | undefined;
  if (!u?.id) return null;
  return {
    id: u.id,
    email: u.email ?? '',
    name: u.name ?? '',
    role: u.role ?? 'reporter',
    factoryId: u.factoryId ?? null,
    factoryCode: u.factoryCode ?? null,
    canFreeze: u.canFreeze ?? false,
    mustChangePassword: u.mustChangePassword ?? false,
  };
}

/** 權限不足時丟出的錯誤，帶 HTTP 狀態碼供 route 直接使用 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** 必須登入 */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('請先登入', 401);
  return user;
}

/** 必須為 admin */
export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new AuthError('此操作需要管理者權限', 403);
  return user;
}

/**
 * 必須具備查證封存權限。
 * 刻意獨立於 role：admin 不等於可封存——封存不可逆且直接決定對外揭露數字，
 * 只有明確被授予 can_freeze 的人才可執行（目前為 Elodie 與 Johnson）。
 */
export async function requireFreeze(): Promise<AppUser> {
  const user = await requireUser();
  if (!user.canFreeze) {
    throw new AuthError('此操作需要「查證封存」權限，請洽永續發展部主責人員', 403);
  }
  return user;
}

/**
 * 檢查目前登入者能否存取指定廠。
 * admin 可存取所有廠；reporter 只能存取自己綁定的廠。
 *
 * ⚠️ 現階段各 API route 尚未全面套用此檢查（設計文件 §0.6：一次修改
 *    20 餘個 route 風險過高，另開一輪逐頁驗證）。目前四個帳號皆為 admin，
 *    無實際曝險。新增 route 時請直接用這個函式，不要再自己寫一套。
 */
export function canAccessFactory(user: AppUser, factoryId: string): boolean {
  if (user.role === 'admin') return true;
  return user.factoryId === factoryId;
}

export async function requireFactoryAccess(factoryId: string): Promise<AppUser> {
  const user = await requireUser();
  if (!canAccessFactory(user, factoryId)) {
    throw new AuthError('無權存取此廠別的資料', 403);
  }
  return user;
}

/**
 * 統一把 requireUser/requireAdmin/requireFreeze 丟出的 AuthError 轉成 API 回應。
 * 各 route 在 catch 區塊直接 `return authErrorResponse(err)`，避免每個檔案各寫一份。
 */
export function authErrorResponse(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ data: null, error: err.message }, { status: err.status });
  }
  return NextResponse.json({ data: null, error: '未授權' }, { status: 401 });
}

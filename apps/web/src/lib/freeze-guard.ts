import { query } from '@/lib/db';

/**
 * 封存年度寫入阻擋（設計文件 §6.6）。
 *
 * 查證封存（verification_periods.status = 'verified'）是 API 層的檢查，
 * 但範疇二整年重算、recalculate、單據明細重算等內部函式會直接 UPDATE
 * activity_records，繞過 API 層。這些路徑呼叫前都必須先查本檔案的
 * assertNotFrozen，否則封存機制會出現「對外數字不受影響，但主表被
 * 悄悄改掉，查證單位比對時才發現」的破口。
 */

export const FROZEN_MESSAGE = '本年度已完成第三方查證，資料已封存，無法修改。';

export class FrozenError extends Error {
  constructor(message: string = FROZEN_MESSAGE) {
    super(message);
    this.name = 'FrozenError';
  }
}

export async function isFrozen(factory_id: string, year: number): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM verification_periods WHERE factory_id = $1 AND year = $2 AND status = 'verified'`,
    [factory_id, year],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 內部重算函式用：已封存則直接 return，並記錄警告，不丟例外（呼叫端多為背景批次）。 */
export async function skipIfFrozen(factory_id: string, year: number, callerName: string): Promise<boolean> {
  if (await isFrozen(factory_id, year)) {
    console.warn(`[freeze-guard] ${callerName} 略過：${factory_id} / ${year} 已封存`);
    return true;
  }
  return false;
}

/** API route 用：已封存則丟出 FrozenError，由 route 的 catch 轉成 409 回應。 */
export async function assertNotFrozen(factory_id: string, year: number): Promise<void> {
  if (await isFrozen(factory_id, year)) throw new FrozenError();
}

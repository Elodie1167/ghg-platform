import { query } from '@/lib/db';

/**
 * 人為改動活動數據後，清除該筆記錄的「已檢核」狀態。
 *
 *   is_reviewed = FALSE, reviewed_by = NULL, reviewed_at = NULL
 *
 * 理由（設計文件 §5.3）：打勾代表「永續發展部已檢查過，數據無誤」，
 * 若數字被改但勾仍在，檢核者會誤以為已看過。已檢核記錄才納入彙總與
 * 報告書（V1 schema 註解），故覆蓋後該筆會暫時從彙總數字消失，
 * 直到重新打勾——這是刻意的，不是資料遺失。
 *
 * ⚠️ 只在「活動數據真的變了」的路徑呼叫，不要在系統重算（改係數後的
 * co2e 補算、範疇二整年重算）呼叫。那些只動 co2e_*／emission_factor_id，
 * 不動 activity_value，數字沒變，檢核結論仍然有效；若一併清除，
 * 每次年度換係數就會讓全平台的檢核狀態一次歸零。
 * 這兩類寫入路徑目前不共用同一個函式庫入口，只能在每個呼叫端自行判斷
 * 是否為「值真的變了」再決定要不要呼叫本函式——見各呼叫端註解。
 */
export async function clearReviewStatus(recordId: string): Promise<void> {
  await query(
    `UPDATE activity_records
     SET is_reviewed = FALSE, reviewed_by = NULL, reviewed_at = NULL
     WHERE id = $1`,
    [recordId],
  );
}

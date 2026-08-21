import { query } from '@/lib/db';

/**
 * 查單一航段距離（km），大小寫不拘；查不到回傳 null。
 * 飛行距離兩個方向理論上一樣遠，資料庫裡常常只存了其中一個方向（例如只存了 SGN→CGK，
 * 沒有反過來的 CGK→SGN），正查沒有時會再查反方向，避免同一個機場對還要分別存兩筆
 * 才查得到——之前沒做這層 fallback，導致「CGK→SGN→CGK」這種去回程用不同方向表示的
 * 航段，即使資料庫裡其實已經有 SGN→CGK，還是會被判定成缺距離。
 */
export async function lookupAirportDistance(fromCode: string, toCode: string): Promise<number | null> {
  const r = await query(
    `SELECT distance_km::float AS km FROM airport_distance
     WHERE (UPPER(from_code) = UPPER($1) AND UPPER(to_code) = UPPER($2))
        OR (UPPER(from_code) = UPPER($2) AND UPPER(to_code) = UPPER($1))
     LIMIT 1`,
    [fromCode.trim(), toCode.trim()],
  );
  return r.rows[0]?.km ?? null;
}

/**
 * 依「出發地→[中轉站→]目的地」的機場代碼序列查總距離，逐段查、有一段查不到就整趟視為缺距離
 * （回傳 null），呼叫端據此決定是否要留給使用者在填報頁補值，不要用部分航段湊出誤導的總數。
 */
export async function lookupRouteDistance(codes: string[]): Promise<number | null> {
  if (codes.length < 2) return null;
  let total = 0;
  for (let i = 0; i < codes.length - 1; i++) {
    const leg = await lookupAirportDistance(codes[i], codes[i + 1]);
    if (leg == null) return null;
    total += leg;
  }
  return total;
}

/**
 * 使用者在填報頁補上缺距離時呼叫：把「起訖機場（忽略中轉站）→距離」存回資料庫，
 * 之後同一條直飛路線的匯入就能自動查到，不用每次都手動查。
 * 用 UPSERT：同一組代碼已存在就覆蓋成使用者這次填的值（比照 route_distance「使用者補建」精神）。
 */
export async function upsertAirportDistance(params: {
  from_code: string;
  to_code: string;
  distance_km: number;
  entered_by?: string | null;
  note?: string | null;
}): Promise<string> {
  const r = await query(
    `INSERT INTO airport_distance (from_code, to_code, distance_km, source, entered_by, entered_at, note)
     VALUES ($1, $2, $3, '使用者補建', $4, NOW(), $5)
     ON CONFLICT (UPPER(from_code), UPPER(to_code))
     DO UPDATE SET distance_km = EXCLUDED.distance_km, source = '使用者補建',
                   entered_by = EXCLUDED.entered_by, entered_at = NOW(), note = EXCLUDED.note,
                   updated_at = NOW()
     RETURNING id`,
    [params.from_code.trim(), params.to_code.trim(), params.distance_km, params.entered_by ?? null, params.note ?? null],
  );
  return r.rows[0].id as string;
}

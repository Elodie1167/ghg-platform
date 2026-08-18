// 從供應商地址文字猜測「縣市/省份」，用於廠供副料境內陸運沒有 ExportPort 欄位時的起點候選。
// 這是啟發式猜測，不是地理編碼 API——猜出來的名稱只是餵進 port_master 比對的候選字串，
// 命中與否、要不要收進別名對照表，仍由資料覆核中心的人工確認流程決定（v5 設計原則：
// 「候選清單只給人工確認，系統不自動合併」）。

const COUNTRY_SUFFIXES = [
  'indonesia', 'vietnam', 'việt nam', 'cambodia', 'campuchia', 'china', 'taiwan',
  'hong kong', 'el salvador', 'bangladesh', 'sri lanka', 'korea', 'japan', 'usa',
];

// 常見行政區前綴，去掉後留下地名本身
const ADMIN_PREFIXES = [
  'tp.', 'tp ', 'thành phố', 'tỉnh', 'quận', 'huyện', 'phường', 'xã',
  'kota', 'kabupaten', 'provinsi', 'kecamatan', 'desa', 'kel.', 'kec.',
  'city of', 'province of', 'district', 'city', 'province',
];

// 少量已知別名，直接對到常用寫法（範例：使用者提到「胡志明市」）
const KNOWN_CITY_ALIASES: Record<string, string> = {
  'hcm': 'Ho Chi Minh City',
  'hcmc': 'Ho Chi Minh City',
  'ho chi minh': 'Ho Chi Minh City',
  'hồ chí minh': 'Ho Chi Minh City',
  'tp hcm': 'Ho Chi Minh City',
  'sài gòn': 'Ho Chi Minh City',
  'saigon': 'Ho Chi Minh City',
};

function stripAdminPrefix(segment: string): string {
  let s = segment.trim();
  for (const p of ADMIN_PREFIXES) {
    const re = new RegExp(`^${p}\\s*`, 'i');
    if (re.test(s)) { s = s.replace(re, '').trim(); break; }
  }
  return s;
}

/**
 * 猜測地址裡的縣市/省份名稱。
 * 策略：地址通常逗號分隔、行政層級由細到粗排列（門牌→街→區→市→省→國），
 * 從右邊往左找：先丟掉國名，下一段去除行政區前綴後當作候選縣市/省份。
 * 找不到逗號（例如中文地址無標點）時回傳 null，交由人工在覆核中心處理。
 */
export function guessCityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const segments = address.split(',').map((s) => s.trim()).filter(Boolean);
  // 沒有逗號（例如中文地址無標點、或整段擠成一個 token）時無法可靠切出縣市/省份，
  // 交由人工在資料覆核中心處理（原始地址全文仍會透過 rawAddress 完整保留）。
  if (segments.length <= 1) return null;

  const lowerLast = segments[segments.length - 1].toLowerCase();
  const aliasHit = KNOWN_CITY_ALIASES[lowerLast];
  if (aliasHit) return aliasHit;

  let idx = segments.length - 1;
  if (COUNTRY_SUFFIXES.some((c) => segments[idx].toLowerCase().includes(c))) {
    idx -= 1;
  }
  if (idx < 0) return null;

  const candidate = stripAdminPrefix(segments[idx]);
  if (!candidate) return null;

  const aliasHit2 = KNOWN_CITY_ALIASES[candidate.toLowerCase()];
  return aliasHit2 ?? candidate;
}

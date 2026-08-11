-- =============================================================
-- V44：強制首次登入更改密碼
--
-- 為什麼需要
-- ----------
-- 目前帳號密碼是由管理者用 scripts/create-user.mjs 代設的，等於「有第三人
-- 知道你的密碼」。加上這個旗標後，使用者第一次登入會被要求先改成只有自己
-- 知道的密碼，才能進入主畫面。
--
-- 直接的觸發原因（2026-08-11）：初次建立四個帳號時，create-user.mjs 的
-- 「輸入不顯示」實作有誤（模組載入時建了一個常駐 readline，與密碼專用的
-- 靜音 interface 互搶 stdin），四組密碼被明文印在終端機上。腳本已修正，
-- 但那四組密碼必須視為已洩漏，故一律標記為須更改。
-- =============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.must_change_password IS
  '為 true 時，登入後必須先改密碼才能進入主畫面。管理者代設密碼後應設為 true。';

-- 既有的密碼帳號一律要求更改（理由見上）。
-- 只針對「用密碼登入」的帳號；未來走 Azure AD SSO 的帳號沒有密碼可改，
-- 標記了反而會把人卡在改密碼頁進不去。
UPDATE users
   SET must_change_password = TRUE
 WHERE password_hash IS NOT NULL;

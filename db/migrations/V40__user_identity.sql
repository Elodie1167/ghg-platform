-- =============================================================
-- V40：使用者身分建置（角色、綁廠、封存權限、過渡期密碼）
--
-- 背景
-- ----
-- V1 建了 users 表，但直到 2026-08 為止：
--   * users 表 0 列（從未建立任何帳號）
--   * lib/auth.ts 的帳密硬寫在程式碼中，全平台共用一組，
--     回傳的 id 不是 users.id，因此 users 表從未被查詢
--   * activity_records 241 筆，created_by / reviewed_by 全為 NULL
--     （其中 176 筆 is_reviewed = true，卻查不出檢核者）
--
-- 「查證封存」（V41）要記錄「這份資料由誰封存」，必須先有可辨識的身分，
-- 否則 verification_periods.frozen_by 只能寫 NULL，查證時無法自證。
-- 本支即為 V41 的前置條件。
--
-- 為什麼現在加 password_hash（而不是直接等 Azure AD SSO）
-- ------------------------------------------------------
-- 最終方向確定是 Azure AD SSO（沿用既有的 users.azure_oid 欄位）。
-- 但 SSO 需 IT 配合、排程未定，而封存功能有查證 deadline，不能無限期等待。
-- 故先以 bcrypt 密碼過渡。替換成本低：
--   * 帳號一律以 email 為識別鍵，users 表結構不變
--   * SSO 上線時只換 lib/auth.ts 的 authorize() 驗證段，並補上 azure_oid
--   * 既有填報 / 檢核 / 封存記錄的外鍵指向 users.id（UUID 不變），不需搬移
--   * password_hash 屆時設為 NULL 即停用密碼登入
--
-- ⚠️ 明文密碼不得寫入本檔、任何腳本或 commit。
--    帳號建立走 scripts/create-user.mjs，密碼於執行時由操作者輸入。
-- =============================================================

-- 1. 角色 -------------------------------------------------------
--    僅兩種角色（沿用專案既有設計，不引入更細的權限矩陣）：
--      reporter — 填報自己廠的資料
--      admin    — 檢閱所有廠、更新係數、匯出報告
--    預設 reporter 是「最小權限」的安全預設：日後若有人直接 INSERT
--    一列 users 而忘了指定角色，不會意外得到管理員。
--    ⚠️ 搭配下方 ck_users_factory_by_role（reporter 必須綁廠），
--       未指定 role 與 factory_id 的裸 INSERT 會直接被拒絕而非默默建出
--       半殘帳號——這是刻意的，寧可大聲失敗。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'reporter';

-- CHECK 拆開下另一個語句：ADD COLUMN 帶 CHECK 在部分 PG 版本上
-- 與 IF NOT EXISTS 併用時行為不一致，分開寫較安全且可重跑。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_role'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_role CHECK (role IN ('reporter', 'admin'));
  END IF;
END $$;

-- 2. 綁廠 -------------------------------------------------------
--    reporter 綁定單一廠，只能看 / 編輯該廠資料；admin 為 NULL（可存取所有廠）。
--    ⚠️ 現階段四個初始帳號皆為 admin，API 層的廠別過濾尚未實作
--       （見設計文件 §0.6：一次修改 20 餘個 route 風險過高，另開一輪逐頁驗證）。
--       本欄位先就位，避免日後新增 reporter 時還要再動一次 schema。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS factory_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_factory'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_factory
      FOREIGN KEY (factory_id) REFERENCES factories(id);
  END IF;
END $$;

-- reporter 一定要綁廠，admin 一定不綁：把「哪種角色該有 factory_id」寫進資料庫，
-- 避免出現「綁了廠的 admin」或「沒綁廠因而看不到任何資料的 reporter」這類
-- 只能靠人工發現的設定錯誤。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_factory_by_role'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_factory_by_role CHECK (
        (role = 'reporter' AND factory_id IS NOT NULL)
        OR
        (role = 'admin'    AND factory_id IS NULL)
      );
  END IF;
END $$;

-- 3. 封存權限 ---------------------------------------------------
--    對應設計文件 §8.2。刻意做成資料欄位而非程式碼中的 email 白名單：
--    人員異動時只要改這一欄，不需改程式碼、不需重新部署。
--    預設 FALSE：封存是不可逆操作且直接對應對外揭露數字，
--    只有明確被授予的人才可執行。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_freeze BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. 過渡期密碼 -------------------------------------------------
--    bcrypt 雜湊（$2a$/$2b$ 前綴，60 字元）。長度給 100 留餘裕。
--    NULL = 此帳號不使用密碼登入（SSO 上線後所有帳號都會是 NULL）。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(100);

-- 帳號至少要有一種可用的登入方式，否則是一列永遠登不進來的死資料。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_has_credential'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT ck_users_has_credential CHECK (
        password_hash IS NOT NULL OR azure_oid IS NOT NULL
      );
  END IF;
END $$;

-- 5. 索引 -------------------------------------------------------
--    登入時以 email 查詢（email 已有 V1 的 UNIQUE，不需另建）。
--    can_freeze 為極少數 true 的旗標，用部分索引：封存 UI 要列出
--    「目前誰有封存權限」時直接命中，不必掃全表。
CREATE INDEX IF NOT EXISTS idx_users_can_freeze
  ON users (can_freeze) WHERE can_freeze;

-- =============================================================
-- 後續步驟（不在本 migration 內執行，因為需要人工輸入密碼）
--   1. node scripts/create-user.mjs        建立設計文件 §0.5 的四個帳號
--   2. node scripts/backfill-reviewed-by.mjs
--        回填 176 筆 is_reviewed = true 但 reviewed_by 為 NULL 的記錄。
--        依據：經永續發展部確認，本平台自建置起僅 Elodie Cheng 一人
--        具存取與檢核權限，不存在其他檢核者。原欄位為 NULL 係因當時
--        登入為共用帳號、未接 users 表，非檢核行為缺失。
--        ⚠️ reviewed_at 無從回溯（從未寫入），維持 NULL，查證時如實說明，
--           不得補假時間。
-- =============================================================

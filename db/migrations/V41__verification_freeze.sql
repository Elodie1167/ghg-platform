-- =============================================================
-- V41：第三方查證封存（年度凍結 + 唯讀快照 + 防篡改雜湊）
--
-- 目的
-- ----
-- 第三方查證完成的資料必須「絕對不可更動」。這與既有的 is_reviewed
-- （永續發展部內部檢核，可覆蓋但跳警示）是兩個不同層級的保護：
--   is_reviewed          → 軟性提醒，確認後可覆蓋
--   verification_periods → 硬性禁止，不提供覆蓋選項
-- 故封存不是「把檢核勾勾變硬」，而是獨立機制：以 廠別 × 年度 為單位，
-- 查證完成後把資料快照凍結，對外揭露一律讀快照。
--
-- 前置：V40（users.can_freeze / frozen_by 需要可辨識的身分）
--
-- 為什麼要快照，不是加一個 is_frozen 旗標
-- --------------------------------------
-- 旗標只能防「有檢查旗標的那條寫入路徑」。本平台有多條會整批 UPDATE
-- 主表的內部路徑（recalculate 補算 co2e、recomputeScope2ForFactoryYear
-- 整年重算 iREC 分攤、recomputeRecordFromLineItems 回算月加總），
-- 任一條漏掉檢查，已查證的數字就被改掉且無從察覺。
-- 快照 + 「對外只讀快照」則是結構性的：主表日後即使被誤動，
-- 對外揭露的數字不變，且比對主表與快照即可發現異動。
-- =============================================================

-- -------------------------------------------------------------
-- 1. verification_periods — 封存期間主檔（廠別 × 年度）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_periods (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id      UUID        NOT NULL REFERENCES factories(id),
    year            INT         NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'verified')),
    verifier_org    VARCHAR(100),   -- 查證機構（例如 BSI、SGS）
    verified_date   DATE,           -- 查證完成日
    frozen_by       UUID REFERENCES users(id),
    frozen_at       TIMESTAMPTZ,
    -- SHA-256（64 位十六進位）。涵蓋 activity_records_verified 與
    -- activity_line_items_verified 兩張快照表的內容。
    -- ⚠️ 計算時的排序與序列化格式必須固定，否則日後重算會因列序不同而
    --    不符、造成防篡改驗證誤報。規則見 lib 內的封存模組註解與維運手冊。
    data_hash       CHAR(64),
    -- Restatement（查證後更正）用：目前對外採用的版本。
    -- 封存後發現遺漏時不改既有快照，而是產生 version = 2（見 §七）。
    current_version INT         NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_verification_period UNIQUE (factory_id, year),
    -- verified 狀態必須把「誰、何時、雜湊」都填齊；
    -- 少了任何一項，這筆封存在查證時都無法自證。
    CONSTRAINT ck_verified_complete CHECK (
        status = 'open'
        OR (frozen_by IS NOT NULL AND frozen_at IS NOT NULL AND data_hash IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_verification_factory_year
    ON verification_periods (factory_id, year);

-- 「這個 (廠, 年度) 是否已封存」是每一條寫入路徑都要問的問題，
-- 用部分索引讓這個高頻檢查直接命中。
CREATE INDEX IF NOT EXISTS idx_verification_verified
    ON verification_periods (factory_id, year) WHERE status = 'verified';

COMMENT ON TABLE verification_periods IS
    '第三方查證封存期間（廠別 × 年度）。status = verified 時該範圍禁止任何寫入。';

-- -------------------------------------------------------------
-- 2. activity_records_verified — 主表快照（唯讀）
--
--    用 LIKE 複製欄位結構而非手抄欄位清單：activity_records 歷經
--    V19（各氣體欄位）、V20、V21（精度）、V36（travel manual co2e）等多次
--    ALTER，手抄必然漏。LIKE 保證快照欄位與主表同步，日後主表再加欄位時
--    只需新寫一支 ALTER 同步兩邊（維運手冊須註明這件事）。
--
--    刻意不 INCLUDING CONSTRAINTS / INDEXES：
--      * 不要主表的 FK。快照必須在來源被刪除（例如排放源汰換、係數改版）
--        之後依然完整可讀——這正是快照的意義。
--      * 不要主表的 CHECK。主表的 activity_value > 0 之類規則若日後放寬，
--        不應讓既有快照變成不合法。
--    INCLUDING DEFAULTS 保留：讓 id 等欄位仍有預設值可用。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_records_verified (
    LIKE activity_records INCLUDING DEFAULTS
);

-- 快照專屬欄位。
-- id 沿用「原始 activity_records.id」而非另配新 UUID：
--   * 查證單位或稽核要比對「主表這筆 vs 封存版本這筆」時可直接對上
--   * 明細快照能以 (activity_record_id, version) 精確掛回
-- 版本化以 (id, version) 為主鍵：version = 1 為原始查證版本，永久不動；
-- Restatement 產生 version = 2，兩者並存。
ALTER TABLE activity_records_verified
    ADD COLUMN IF NOT EXISTS version            INT  NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS restatement_reason TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pk_activity_records_verified'
  ) THEN
    ALTER TABLE activity_records_verified
      ADD CONSTRAINT pk_activity_records_verified PRIMARY KEY (id, version);
  END IF;
END $$;

-- version > 1（Restatement）一定要寫理由。GHG Protocol 的基準年重新計算
-- 要求說明更正原因；沒有理由的更正在查證時無法交代。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_arv_restatement_reason'
  ) THEN
    ALTER TABLE activity_records_verified
      ADD CONSTRAINT ck_arv_restatement_reason CHECK (
        version = 1 OR restatement_reason IS NOT NULL
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_arv_factory_year
    ON activity_records_verified (factory_id, year, version);

COMMENT ON TABLE activity_records_verified IS
    '查證封存快照（唯讀）。報告書與對外揭露一律讀此表，不讀 activity_records。';

-- -------------------------------------------------------------
-- 3. activity_line_items_verified — 單據明細快照（唯讀）
--
--    2026-08-11 決議一併快照。理由：明細是 activity_value 的計算依據
--    （activity_value = SUM(line_items.quantity)），查證單位抽查單據時
--    需要。若只快照主表，封存後主表明細被改，快照的加總就失去支撐憑證——
--    防篡改雜湊只能證明「加總沒變」，證明不了「組成沒變」。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_line_items_verified (
    LIKE activity_line_items INCLUDING DEFAULTS
);

ALTER TABLE activity_line_items_verified
    ADD COLUMN IF NOT EXISTS version     INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pk_activity_line_items_verified'
  ) THEN
    ALTER TABLE activity_line_items_verified
      ADD CONSTRAINT pk_activity_line_items_verified PRIMARY KEY (id, version);
  END IF;
END $$;

-- 明細快照必須掛在同一版本的主表快照上。這個複合 FK 是刻意保留的
-- （與 §2 不要 FK 的原則不衝突：那是不要「指向主表」的 FK，
--  這是快照內部的完整性，必須維持——不能有孤兒明細快照）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_aliv_record'
  ) THEN
    ALTER TABLE activity_line_items_verified
      ADD CONSTRAINT fk_aliv_record
      FOREIGN KEY (activity_record_id, version)
      REFERENCES activity_records_verified (id, version);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aliv_record
    ON activity_line_items_verified (activity_record_id, version);

COMMENT ON TABLE activity_line_items_verified IS
    '查證封存的單據明細快照（唯讀）。查證抽單時的憑證依據。';

-- -------------------------------------------------------------
-- 4. 快照唯讀強制（資料庫層，不依賴前端或應用層阻擋）
--
--    設計文件 §6.4 原本只寫「REVOKE UPDATE / DELETE」，但本平台以單一
--    DATABASE_URL 連線，該角色極可能就是這些表的 owner——對 owner 而言
--    REVOKE 擋不住（owner 可自行 re-grant）。故以 trigger 為主要防線，
--    REVOKE 為輔：
--      * trigger：任何 UPDATE / DELETE 直接 RAISE EXCEPTION，
--                 不論執行者是誰、走哪條路徑
--      * REVOKE ：日後若改用低權限的應用程式角色連線，多一層保障
--
--    INSERT 不擋——封存流程本身要寫入，Restatement 也要寫入 version = 2。
--    「不能改既有的」由 trigger 保證；「不能亂插」由 API 層的 can_freeze 權限控管。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_verified_snapshot_change()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        '本年度已完成第三方查證，資料已封存，無法修改（表：%，操作：%）',
        TG_TABLE_NAME, TG_OP
        USING HINT = '查證後如需更正，請使用 Restatement 新增版本，不可修改既有快照。';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reject_verified_snapshot_change() IS
    '封存快照唯讀守門員。任何 UPDATE / DELETE 一律拒絕，含以 owner 身分執行者。';

DROP TRIGGER IF EXISTS trg_arv_readonly ON activity_records_verified;
CREATE TRIGGER trg_arv_readonly
    BEFORE UPDATE OR DELETE ON activity_records_verified
    FOR EACH ROW EXECUTE FUNCTION reject_verified_snapshot_change();

DROP TRIGGER IF EXISTS trg_aliv_readonly ON activity_line_items_verified;
CREATE TRIGGER trg_aliv_readonly
    BEFORE UPDATE OR DELETE ON activity_line_items_verified
    FOR EACH ROW EXECUTE FUNCTION reject_verified_snapshot_change();

-- 輔助防線（對 owner 無效，見上方說明）
REVOKE UPDATE, DELETE, TRUNCATE ON activity_records_verified     FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON activity_line_items_verified  FROM PUBLIC;

-- -------------------------------------------------------------
-- 5. 封存狀態查詢輔助函式
--
--    「這個 (廠, 年度) 封存了嗎」會被多處呼叫：匯入 API、填報 API、
--    rec_certificates 寫入、以及 recomputeScope2ForFactoryYear /
--    recalculate 這些會整批 UPDATE 主表的內部函式（設計文件 §6.6）。
--    做成 SQL 函式，讓應用層與資料庫層共用同一份判斷，避免兩邊邏輯漂移。
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_period_frozen(p_factory_id UUID, p_year INT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM verification_periods
         WHERE factory_id = p_factory_id
           AND year       = p_year
           AND status     = 'verified'
    );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION is_period_frozen(UUID, INT) IS
    '該 (廠, 年度) 是否已完成查證封存。所有寫入路徑都必須先問這一句。';

-- =============================================================
-- 後續實作項目（不在本 migration 內，見設計文件第十節）
--   * 封存 / 解封 UI 與 SHA-256 計算（固定排序與序列化規則）
--   * 封存年度寫入阻擋：API 層 + recomputeScope2ForFactoryYear /
--     recalculate / recomputeRecordFromLineItems 內部檢查
--     ⚠️ 漏了這一步，封存會有安靜破口：對外數字讀快照不受影響，
--        但主表與快照不一致，查證單位比對時會發現。
--   * 報告書匯出改讀 activity_records_verified
--
-- ⚠️ 維運注意：日後若對 activity_records 或 activity_line_items 加欄位，
--    必須同步對 *_verified 加同名欄位，否則封存時 INSERT ... SELECT 會失敗。
-- =============================================================

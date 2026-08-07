-- =============================================================
-- V31  異常提醒模組（階段一）
--
--   規格：Desktop\Claude\溫盤\ghg-platform\異常提醒_規則設計.md v1.7
--
--   新增表：
--     anomaly_flags        — 異常標記。同時支援「記錄層級」與「廠×年月×主題層級」
--                            （CSR 比對、缺月這類異常沒有單一 record_id 可掛，
--                             V1 的 validation_flags 因 activity_record_id NOT NULL 裝不了）
--     csr_ghg_category_map — CSR 欄位 ↔ 清冊排放源代碼清單 對照（用代碼清單，不用 category
--                            字串：category 目前中英混雜，且發電機類曾被歸在移動燃燒）
--     factory_headcount    — 各廠人力數（階段二 PEER 強度比對分母，先落表）
--
--   month 慣例：1–12 為月度異常；0 = 年度層級異常（沿用 csr_energy 慣例）。
--
--   註：V1 的 validation_flags 從未被程式使用，本次不動、視為 deprecated。
-- =============================================================

-- 1. 異常標記 ---------------------------------------------------
CREATE TABLE IF NOT EXISTS anomaly_flags (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code       VARCHAR(50) NOT NULL,
    severity        VARCHAR(10) NOT NULL CHECK (severity IN ('blocking', 'advisory')),
    -- 異常主體：廠 × 年 × 月 × 主題（bucket_key / source_code / record_id 視規則而定）
    factory_code    VARCHAR(20) NOT NULL,
    year            INT         NOT NULL,
    month           INT         NOT NULL CHECK (month BETWEEN 0 AND 12),
    subject_key     VARCHAR(64) NOT NULL DEFAULT '',
    -- 記錄層級規則才有值；廠月層級規則為 NULL
    record_id       UUID        REFERENCES activity_records(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'confirmed_ok', 'resolved')),
    detail          JSONB       NOT NULL DEFAULT '{}',   -- 兩邊數值、落差、排除項等
    note            TEXT,                                -- admin 註記（confirmed_ok 時填）
    resolved_by     UUID        REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 重跑用 upsert，不會長出重複列
CREATE UNIQUE INDEX IF NOT EXISTS uq_anomaly_subject
    ON anomaly_flags (rule_code, factory_code, year, month, subject_key);
CREATE INDEX IF NOT EXISTS idx_anomaly_open
    ON anomaly_flags (factory_code, year) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_anomaly_blocking
    ON anomaly_flags (factory_code, year, month) WHERE severity = 'blocking' AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_anomaly_record ON anomaly_flags (record_id);

-- 2. CSR 欄位 ↔ 清冊排放源代碼 對照 -----------------------------
--    2026-08-07 定案（Elodie）：切成 4 個燃料 bucket + 電力，共 5 項。
--    廢棄物暫不納入比對（工廠回報什麼就採用什麼）。
--    生質排放源一律排除：CSR 匯入端不含生質燃料，納入會產生假異常。
CREATE TABLE IF NOT EXISTS csr_ghg_category_map (
    bucket_key             VARCHAR(30)  PRIMARY KEY,
    label_zh               VARCHAR(50)  NOT NULL,
    csr_source_code        VARCHAR(20)  NOT NULL,   -- 對 csr_energy.source_code
    inventory_source_codes TEXT[]       NOT NULL,   -- 對 emission_sources.source_code
    tolerance_pct          NUMERIC      NOT NULL DEFAULT 3,  -- 技術誤差；業務容許誤差為 0
    is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
    note                   TEXT
);

INSERT INTO csr_ghg_category_map
    (bucket_key, label_zh, csr_source_code, inventory_source_codes, tolerance_pct, is_active, note)
VALUES
    ('electricity',         '外購電力',   '2-1-A',  ARRAY['2-1-A'],            3, TRUE,
     '太陽能 2-1-B / SOLAR 不併入'),
    ('vehicle_gasoline',    '車用汽油',   '1-2A-1', ARRAY['1-2A-1'],           3, TRUE, NULL),
    ('vehicle_diesel',      '車用柴油',   '1-2A-2', ARRAY['1-2A-2'],           3, TRUE,
     '生質柴油 1-2A-5 / 1-2A-6 排除'),
    ('nonvehicle_diesel',   '非車用柴油', '1-1A-6', ARRAY['1-1A-6', '1-1A-1'], 3, TRUE,
     '含嘉義鍋爐柴油 1-1A-1；生質 1-1A-5 排除'),
    ('nonvehicle_gasoline', '非車用汽油', '1-1A-7', ARRAY['1-1A-7'],           3, TRUE,
     '鍋爐-汽油 1-1A-4 已於 V7 刪除，不列'),
    ('waste',               '廢棄物',     '1-1A-9', ARRAY['1-1A-9'],           3, FALSE,
     '暫緩：波動天生較大，待 2~3 年資料後改歷史觀察區間法')
ON CONFLICT (bucket_key) DO UPDATE
    SET label_zh               = EXCLUDED.label_zh,
        csr_source_code        = EXCLUDED.csr_source_code,
        inventory_source_codes = EXCLUDED.inventory_source_codes,
        tolerance_pct          = EXCLUDED.tolerance_pct,
        is_active              = EXCLUDED.is_active,
        note                   = EXCLUDED.note;

-- 3. 各廠人力數 -------------------------------------------------
CREATE TABLE IF NOT EXISTS factory_headcount (
    factory_code    VARCHAR(20) NOT NULL,
    year            INT         NOT NULL,
    headcount       INT         NOT NULL CHECK (headcount >= 0),
    note            TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (factory_code, year)
);

-- 2025 年度人力數（來源：異常提醒_規則設計.md 三）
INSERT INTO factory_headcount (factory_code, year, headcount) VALUES
    ('TWN_TPE',  2025,  600),
    ('TWN_CHY',  2025,   88),
    ('CAB_MK',   2025, 3032),
    ('CAB_MOHA', 2025, 3227),
    ('NVN_MK',   2025, 7083),
    ('SVN_TRP',  2025, 1991),
    ('SVN_LDR',  2025, 3131),
    ('SLV_MK',   2025,  461),
    ('IND_DMK',  2025, 8397),
    ('IND_GLR1', 2025, 1254),
    ('IND_GLR2', 2025, 1641),
    ('IND_STL',  2025, 4035),
    ('IND_GLS',  2025, 3606)
ON CONFLICT (factory_code, year) DO UPDATE
    SET headcount = EXCLUDED.headcount, updated_at = NOW();

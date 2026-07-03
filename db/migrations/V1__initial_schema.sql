-- =============================================================
-- GHG 碳盤查平台  V1 初始 Schema
-- 聚陽實業股份有限公司 / 永續發展部
-- 標準：GHG Protocol / ISO 14064-1:2018
-- =============================================================

-- 啟用 UUID 擴充
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------
-- 1. factories — 廠別主檔（23 個跨國廠別）
-- -------------------------------------------------------------
CREATE TABLE factories (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_code    VARCHAR(20) UNIQUE NOT NULL,   -- e.g. TWN_TPE
    name_zh         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    country_code    VARCHAR(10) NOT NULL,           -- TWN / CHN / NVN / SVN / IND / CAB / SLV / BGD
    region          VARCHAR(50),                   -- 產區說明
    is_verified     BOOLEAN     NOT NULL DEFAULT TRUE,  -- 是否納入查證
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 2. emission_sources — 排放源主檔
-- -------------------------------------------------------------
CREATE TABLE emission_sources (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code     VARCHAR(20) UNIQUE NOT NULL,   -- e.g. 1-1A-1
    name_zh         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    scope           SMALLINT    NOT NULL CHECK (scope IN (1, 2, 3)),
    category        VARCHAR(50),                   -- 固定燃燒 / 移動燃燒 / 逸散 / 電力 / 範疇三子類
    is_biomass      BOOLEAN     NOT NULL DEFAULT FALSE,  -- 生質排放源：CO₂ 部分獨立揭露
    default_unit    VARCHAR(20),                   -- kWh / L / kg / kg-ref 等
    substance       VARCHAR(20),                   -- 針對冷媒/滅火器：R134a / SF6 / CO2 / FM200 等
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 3. emission_factors — 排放係數（年度版本，依國家）
-- -------------------------------------------------------------
CREATE TABLE emission_factors (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    emission_source_id      UUID        NOT NULL REFERENCES emission_sources(id),
    country_code            VARCHAR(10) NOT NULL,
    year                    INT         NOT NULL,
    -- 範疇一：各氣體排放因子（kg 氣體 / 活動單位）
    factor_co2              NUMERIC(14,8),
    factor_ch4              NUMERIC(14,8),
    factor_n2o              NUMERIC(14,8),
    factor_substance        NUMERIC(14,8), -- HFCs / SF6 / 其他（kg 物質 / 活動單位）
    -- 範疇二：電力係數
    grid_emission_factor    NUMERIC(14,8), -- kg CO₂e / kWh（Location-Based）
    market_residual_factor  NUMERIC(14,8), -- kg CO₂e / kWh（中國 Market-Based 專用）
    -- 範疇三：綜合係數
    scope3_factor           NUMERIC(14,8), -- kg CO₂e / 活動單位
    -- 來源與版本
    source_reference        TEXT,          -- 係數來源說明（如：台電 2025 年度公告）
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (emission_source_id, country_code, year)
);

-- -------------------------------------------------------------
-- 4. emission_factor_assignments — 係數廠別指定（多對多）
--    若某廠有指定係數 → 優先使用；否則 fallback 到同 country_code
-- -------------------------------------------------------------
CREATE TABLE emission_factor_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emission_factor_id  UUID NOT NULL REFERENCES emission_factors(id) ON DELETE CASCADE,
    factory_id          UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (emission_factor_id, factory_id)
);

CREATE INDEX idx_efa_factor  ON emission_factor_assignments(emission_factor_id);
CREATE INDEX idx_efa_factory ON emission_factor_assignments(factory_id);

-- -------------------------------------------------------------
-- 5. users — 平台帳號（永續部同仁，Azure AD OID）
-- -------------------------------------------------------------
CREATE TABLE users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    azure_oid   VARCHAR(100) UNIQUE,           -- Azure AD Object ID
    email       VARCHAR(150) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 6. rec_certificates — REC 憑證購買記錄（影響範疇二 Market-Based）
-- -------------------------------------------------------------
CREATE TABLE rec_certificates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id      UUID        NOT NULL REFERENCES factories(id),
    year            INT         NOT NULL,
    month           INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
    rec_kwh         NUMERIC(14,2) NOT NULL CHECK (rec_kwh >= 0),
    certificate_no  VARCHAR(100),
    notes           TEXT,
    created_by      UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rec_factory_ym ON rec_certificates(factory_id, year, month);

-- -------------------------------------------------------------
-- 7. activity_records — 核心填報主表
--    同廠 + 同排放源 + 同年月可有多筆（多張電費單、多台車輛）
-- -------------------------------------------------------------
CREATE TABLE activity_records (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id          UUID        NOT NULL REFERENCES factories(id),
    emission_source_id  UUID        NOT NULL REFERENCES emission_sources(id),
    year                INT         NOT NULL,
    month               INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
    -- 活動數據
    activity_value      NUMERIC(14,4) NOT NULL CHECK (activity_value > 0),
    activity_unit       VARCHAR(20) NOT NULL,
    notes               TEXT,
    -- 計算結果（後端計算，前端唯讀）
    co2e_location       NUMERIC(12,4),   -- 範疇二 Location-Based CO₂e（tCO₂e）
    co2e_market         NUMERIC(12,4),   -- 範疇二 Market-Based CO₂e（tCO₂e）
    co2e_total          NUMERIC(12,4),   -- 總 CO₂e（範疇一/三用此欄；生質 CO₂ 不含）
    co2e_biomass_co2    NUMERIC(12,4),   -- 生質 CO₂ 獨立揭露（is_biomass=true 才有值）
    -- 使用的係數版本（計算時鎖定，供稽核追溯）
    emission_factor_id  UUID        REFERENCES emission_factors(id),
    -- 審查狀態（取代 is_locked：只有已審查的記錄才納入彙總與報告書）
    is_reviewed         BOOLEAN     NOT NULL DEFAULT FALSE,
    reviewed_by         UUID        REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    -- 匯入來源
    import_source       VARCHAR(20) DEFAULT 'manual', -- manual / excel_import / migration
    -- 稽核欄
    created_by          UUID        REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- 注意：不設唯一性約束，允許同廠同月同排放源多筆
);

CREATE INDEX idx_ar_factory_ym   ON activity_records(factory_id, year, month);
CREATE INDEX idx_ar_source       ON activity_records(emission_source_id);
CREATE INDEX idx_ar_reviewed     ON activity_records(is_reviewed);
CREATE INDEX idx_ar_factor       ON activity_records(emission_factor_id);

-- -------------------------------------------------------------
-- 8. attachments — 佐證文件（指向 Azure Blob URL）
-- -------------------------------------------------------------
CREATE TABLE attachments (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_record_id  UUID        NOT NULL REFERENCES activity_records(id) ON DELETE CASCADE,
    file_name           VARCHAR(255) NOT NULL,
    blob_url            TEXT        NOT NULL,
    file_size_bytes     INT,
    mime_type           VARCHAR(100),
    uploaded_by         UUID        REFERENCES users(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_att_record ON attachments(activity_record_id);

-- -------------------------------------------------------------
-- 9. validation_flags — 異常標記（計算後自動產生，不擋填報）
-- -------------------------------------------------------------
CREATE TABLE validation_flags (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_record_id  UUID        NOT NULL REFERENCES activity_records(id) ON DELETE CASCADE,
    rule_code           VARCHAR(50) NOT NULL,   -- monthly_variance / regional_outlier / missing_data / unit_sanity
    message             TEXT        NOT NULL,
    severity            VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    is_resolved         BOOLEAN     NOT NULL DEFAULT FALSE,
    resolved_by         UUID        REFERENCES users(id),
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vf_record     ON validation_flags(activity_record_id);
CREATE INDEX idx_vf_unresolved ON validation_flags(is_resolved) WHERE is_resolved = FALSE;

-- -------------------------------------------------------------
-- 10. v_emission_summary — 彙整 VIEW（僅納入已審查記錄）
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_emission_summary AS
SELECT
    ar.factory_id,
    f.factory_code,
    f.country_code,
    f.name_zh                                       AS factory_name_zh,
    ar.year,
    ar.month,
    es.scope,
    es.source_code,
    es.name_zh                                      AS source_name_zh,
    es.category,
    es.is_biomass,
    COUNT(*)                                        AS record_count,
    SUM(ar.activity_value)                          AS activity_total,
    SUM(COALESCE(ar.co2e_total, 0))                 AS co2e_total,
    SUM(COALESCE(ar.co2e_location, 0))              AS co2e_location,
    SUM(COALESCE(ar.co2e_market, 0))                AS co2e_market,
    SUM(COALESCE(ar.co2e_biomass_co2, 0))           AS co2e_biomass_co2
FROM activity_records ar
JOIN factories       f  ON ar.factory_id          = f.id
JOIN emission_sources es ON ar.emission_source_id = es.id
WHERE ar.is_reviewed = TRUE
GROUP BY
    ar.factory_id, f.factory_code, f.country_code, f.name_zh,
    ar.year, ar.month,
    es.scope, es.source_code, es.name_zh, es.category, es.is_biomass;

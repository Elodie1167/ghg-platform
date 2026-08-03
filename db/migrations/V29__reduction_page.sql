-- =============================================================
-- V29  減碳績效追蹤頁 /reduction 所需資料表
--
--   本頁有「兩套資料來源」：CSR 匯出（ISO 14064-1 查證前先用）與 GHG 平台
--   （activity_records，各廠約 2026-10 起才上傳）。兩套必須切開、可切換，
--   且部分廠不在 ISO 查證範圍但 CSR 仍有能源數字，故 CSR 資料獨立存放，
--   不塞進 activity_records、不污染平台 Scope2 REC 分攤。
--
--   新增表：
--     monthly_production   — 集團每月標打產能（平台路徑 KPI 分母，可月份區間）
--     reduction_baselines  — 基準年市場別標打碳排（2020=2.5788, 2025=1.72）
--     csr_energy           — CSR 匯入的各廠原始能源（含外購電力、太陽能、範疇一燃料）
--     csr_production        — CSR 各廠標打產能（CSR 路徑 KPI 分母）
--     csr_rec              — CSR 路徑「手動試算」用的各廠 iREC 購買量
--
--   month 慣例：1–12 為正常月份；0 = 全年（CSR 全年匯出時使用）。
-- =============================================================

-- 1. 集團每月標打產能（平台路徑分母）------------------------------
CREATE TABLE IF NOT EXISTS monthly_production (
    year            INT             NOT NULL,
    month           INT             NOT NULL CHECK (month BETWEEN 1 AND 12),
    standard_units  NUMERIC         NOT NULL DEFAULT 0,   -- 標打產能
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (year, month)
);

-- 2. 基準年市場別標打碳排（kgCO2e/標打）--------------------------
CREATE TABLE IF NOT EXISTS reduction_baselines (
    base_year           INT             PRIMARY KEY,
    intensity_market_kg NUMERIC         NOT NULL,          -- 市場別 kgCO2e/標打
    note                TEXT
);

INSERT INTO reduction_baselines (base_year, intensity_market_kg, note) VALUES
    (2020, 2.5788, '原定基準年 市場別標打碳排'),
    (2025, 1.72,   '預計更改基準年 市場別標打碳排')
ON CONFLICT (base_year) DO UPDATE
    SET intensity_market_kg = EXCLUDED.intensity_market_kg,
        note                = EXCLUDED.note;

-- 3. CSR 匯入的各廠原始能源 -------------------------------------
--    source_code 對應 emission_sources.source_code（沿用平台係數）；
--    另有兩個合成代碼：'2-1-A' 外購電力、'SOLAR' 自發太陽能（僅中國）。
CREATE TABLE IF NOT EXISTS csr_energy (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_code    VARCHAR(20)     NOT NULL,
    year            INT             NOT NULL,
    month           INT             NOT NULL DEFAULT 0 CHECK (month BETWEEN 0 AND 12),
    source_code     VARCHAR(20)     NOT NULL,
    activity_value  NUMERIC         NOT NULL DEFAULT 0,
    activity_unit   VARCHAR(20)     NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (factory_code, year, month, source_code)
);
CREATE INDEX IF NOT EXISTS idx_csr_energy_ym ON csr_energy(year, month);

-- 4. CSR 各廠標打產能（CSR 路徑分母）----------------------------
CREATE TABLE IF NOT EXISTS csr_production (
    factory_code    VARCHAR(20)     NOT NULL,
    year            INT             NOT NULL,
    month           INT             NOT NULL DEFAULT 0 CHECK (month BETWEEN 0 AND 12),
    standard_units  NUMERIC         NOT NULL DEFAULT 0,
    PRIMARY KEY (factory_code, year, month)
);

-- 5. CSR 手動試算用 iREC（各廠購買量，度數）---------------------
CREATE TABLE IF NOT EXISTS csr_rec (
    factory_code    VARCHAR(20)     NOT NULL,
    year            INT             NOT NULL,
    month           INT             NOT NULL DEFAULT 0 CHECK (month BETWEEN 0 AND 12),
    rec_kwh         NUMERIC         NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (factory_code, year, month)
);

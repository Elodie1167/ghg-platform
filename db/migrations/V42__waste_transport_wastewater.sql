-- =============================================================
-- 3-5 營運產生之廢棄物 — 補齊清運與廢水填報
-- 依據：《廢棄物處置_填報欄位設計》2026-08-11
--
-- 平台既有代碼與規格文件的對照（規格文件用集團清冊 ID，平台沿用自己的命名）：
--   3-5A-1 廢棄物處理   → 3-5-W1 一般廢棄物 / 3-5-W2 廢布紡織廢棄物（已完成，處置方式%加權）
--   3-5A-2 廢棄物清運   → 3-5-T1（本次新增）
--   3-5A-3 廢水處理     → 3-5-G（已存在，本次補「實測 / 外購水量推估」兩種填報方式）
--   3-5A-4 廢水/水肥清運 → 3-5-T2（本次新增）
--
-- 排放係數一律不寫進 migration，由永續發展部於 /admin/factors 維護
-- （比照 V37 的做法）。係數未填時該筆記錄的 co2e 會留 NULL，不會靜默算成 0。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 新增兩個排放源
-- -------------------------------------------------------------
INSERT INTO emission_sources
  (source_code, name_zh, name_en, scope, category, default_unit, is_biomass, is_always_active)
VALUES
  ('3-5-T1', '廢棄物清運',   'Waste Transport',      3, 'waste', 'tonne-km', false, false),
  ('3-5-T2', '廢水/水肥清運', 'Wastewater Transport', 3, 'waste', 'tonne-km', false, false)
ON CONFLICT (source_code) DO NOTHING;

-- 3-5-T2 與 3-5-T1 共用同一組 tkm 係數（比照 3-9-A/B/C 的做法），
-- 車型差異由明細表的 vehicle_type 記錄，供查證說明用。
UPDATE emission_sources
SET factor_source_id = (SELECT id FROM emission_sources WHERE source_code = '3-5-T1')
WHERE source_code = '3-5-T2' AND factor_source_id IS NULL;

-- 3-5 群組顯示順序：處理 → 清運 → 廢水處理 → 廢水清運
UPDATE emission_sources SET display_order = 510 WHERE source_code = '3-5-W1';
UPDATE emission_sources SET display_order = 520 WHERE source_code = '3-5-W2';
UPDATE emission_sources SET display_order = 530 WHERE source_code = '3-5-T1';
UPDATE emission_sources SET display_order = 540 WHERE source_code = '3-5-G';
UPDATE emission_sources SET display_order = 550 WHERE source_code = '3-5-T2';

-- 3-5-G 既有 category 是中文「廢棄物處理」，與 W1/W2 的 'waste' 不一致，
-- 填報頁分頁是用 source_code 前綴分組不受影響，但統一一下避免後續誤判。
UPDATE emission_sources SET category = 'waste' WHERE source_code = '3-5-G';

-- -------------------------------------------------------------
-- 2. activity_waste_detail — 廢棄物/廢水填報明細（1:1 對 activity_records）
--    主表只放 activity_value（tkm 或 m³，由後端算），明細欄位放這裡避免主表過寬。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_waste_detail (
    record_id             UUID PRIMARY KEY
                          REFERENCES activity_records(id) ON DELETE CASCADE,

    -- ── 清運共用（3-5-T1 / 3-5-T2）──
    waste_type            VARCHAR(30),   -- 一般廢棄物/廢布/回收物/有害事業廢棄物/其他；T2：廢水/水肥/污泥
    waste_type_other      VARCHAR(100),  -- waste_type = '其他' 時必填
    contractor_name       VARCHAR(150),  -- 清運商名稱
    destination_name      VARCHAR(150),  -- 處理場所名稱
    destination_address   TEXT,          -- 處理場所地址（供 Google Map 量距離）
    waste_weight          NUMERIC(14,4), -- 清運重量（原始輸入值）
    waste_weight_unit     VARCHAR(10),   -- kg / mt
    density               NUMERIC(10,4), -- 來源單位為 m³ 時的換算密度（t/m³），3-5-T2 用
    distance_km           NUMERIC(10,3), -- 單程運輸距離（Google Map 最近路線，交通方式 car）
    trip_count            INT,           -- 清運趟次，預設 1
    vehicle_type          VARCHAR(50),   -- 柴油垃圾車 / HGV / 3.5-7.5t 貨車 / 水肥車 / 槽車 / 其他

    -- ── 廢水處理（3-5-G）──
    wastewater_type       VARCHAR(30),   -- 生活廢水 / 製程廢水 / 混合
    treatment_mode        VARCHAR(30),   -- 納管污水下水道 / 委外處理廠 / 廠內自設污水處理設施
    treatment_facility    VARCHAR(150),  -- 處理單位名稱
    input_mode            VARCHAR(20),   -- MEASURED / ESTIMATED（由 factory_settings 帶入後快照）
    measured_volume_m3    NUMERIC(14,4), -- input_mode = MEASURED 時的實測廢水量
    water_intake_m3       NUMERIC(14,4), -- input_mode = ESTIMATED 時的外購水量
    discharge_ratio       NUMERIC(6,4),  -- 廢水產生係數（0.80 = 80%），快照自 factory_settings
    ratio_basis           TEXT,          -- 係數引用依據（快照，供查證）

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_awd_weight_unit  CHECK (waste_weight_unit IS NULL OR waste_weight_unit IN ('kg','mt')),
    CONSTRAINT chk_awd_input_mode   CHECK (input_mode IS NULL OR input_mode IN ('MEASURED','ESTIMATED')),
    CONSTRAINT chk_awd_trip_count   CHECK (trip_count IS NULL OR trip_count > 0),
    CONSTRAINT chk_awd_distance     CHECK (distance_km IS NULL OR distance_km > 0),
    CONSTRAINT chk_awd_ratio        CHECK (discharge_ratio IS NULL OR (discharge_ratio > 0 AND discharge_ratio <= 1))
);

COMMENT ON TABLE activity_waste_detail IS
  '3-5 廢棄物/廢水填報明細。清運距離一律以「單程」認定（2026-08-11 定案），'
  '集團若日後改採來回，改的是活動數據換算而非本表結構。';

-- input_mode / discharge_ratio / ratio_basis 由 factory_settings 帶入後「快照」存這裡，
-- 之後改廠別設定不會回頭動到已填報的歷史資料。

-- -------------------------------------------------------------
-- 3. factory_settings — 廠別層級設定（按年度版本保存）
--    先承接廢水量統計方式，未來可放其他廠別層級設定。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factory_settings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id             UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    effective_year         INT  NOT NULL,
    wastewater_input_mode  VARCHAR(20)  NOT NULL DEFAULT 'ESTIMATED',
    has_flow_meter         BOOLEAN      NOT NULL DEFAULT FALSE,
    discharge_ratio        NUMERIC(6,4) NOT NULL DEFAULT 0.80,
    ratio_basis            TEXT         NOT NULL DEFAULT '依據業界常規',
    ratio_override_reason  TEXT,
    updated_by             UUID REFERENCES users(id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (factory_id, effective_year),
    CONSTRAINT chk_fs_mode  CHECK (wastewater_input_mode IN ('MEASURED','ESTIMATED')),
    CONSTRAINT chk_fs_ratio CHECK (discharge_ratio > 0 AND discharge_ratio <= 1)
);

CREATE INDEX IF NOT EXISTS idx_fs_factory_year ON factory_settings(factory_id, effective_year);

COMMENT ON COLUMN factory_settings.ratio_basis IS
  '廢水產生係數的引用依據，預設「依據業界常規」（2026-08-11 定案）。'
  '⚠️ 此依據對第三方查證屬較弱佐證，永續發展部尚在評估是否補可查出處。';

-- -------------------------------------------------------------
-- 4. factory_source_applicability — 廠別×排放源「本年度不適用」標記
--    3-5-T2（2025 全廠為 0）與其他已鑑別但無此排放的源共用。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factory_source_applicability (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id          UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    emission_source_id  UUID NOT NULL REFERENCES emission_sources(id) ON DELETE CASCADE,
    year                INT  NOT NULL,
    not_applicable      BOOLEAN NOT NULL DEFAULT TRUE,
    na_reason           TEXT,
    updated_by          UUID REFERENCES users(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (factory_id, emission_source_id, year)
);

CREATE INDEX IF NOT EXISTS idx_fsa_lookup
  ON factory_source_applicability(factory_id, year);

COMMENT ON TABLE factory_source_applicability IS
  '已鑑別但本年度無此排放的標記。查證單位要看到「有鑑別、本年度為 0」，'
  '與「漏填」是兩件事，不要用沒有記錄來代表不適用。';

-- =============================================================
-- V52：上游運輸｜城市/港口→工廠距離資料庫（Phase 1：資料表）
--
-- 規格：Desktop\Claude\溫盤\上游運輸_距離資料庫_實作規格_v6.md（v6，2026-08-17 定案）
-- 前身設計：Downloads\上游運輸_供應商港口距離資料庫_設計提案_1.md（v5）
--
-- 新增表：
--   port_master              — 城市/港口/機場標準名稱主檔
--   port_alias               — 別名對照（一對多，模糊比對候選經人工確認後才寫入）
--   route_distance            — 距離主檔（城市/港口 → 港口 或 工廠），取代 v5 的
--                               port_route_distance + land_distance 兩張表構想
--   route_distance_evidence  — 佐證檔案（route 層級，不沿用 V1 的 attachments，
--                               因為 attachments 是掛在 activity_records 上、
--                               語意與命名規則都不同，且 attachments 目前是空殼未被使用）
--   po_transport_records     — PO 運輸明細（查證封存採「方案 B」：PO 自己快照
--                               查詢當下的 route_id + distance_km，不另建
--                               route_distances_verified 對稱表——route_distance
--                               是全公司共用主檔，用「封存範圍」的概念反而複雜）
--
-- 缺距離待補清單：不新建表，直接掛在既有 anomaly_flags
--   （rule_code = 'missing_route_distance'，subject_key = origin|destination|mode
--    序列化字串，record_id 留 NULL，因為缺值主體是「路線」不是單筆 activity_record）。
--
-- 工廠外鍵：destination_factory_id 用 factories.id（UUID），不用裸 factory_code，
--   因為 ERP 匯出資料的工廠代碼是裸碼（如 GLD），跟平台現行 factory_code
--   （IND_GLD，國別前綴）兩套並存，用 UUID 外鍵避免混淆。
-- =============================================================

-- -------------------------------------------------------------
-- 1. port_master — 城市/港口/機場標準名稱主檔
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS port_master (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_name   VARCHAR(100) UNIQUE NOT NULL,
    port_type       VARCHAR(10) NOT NULL CHECK (port_type IN ('sea', 'air', 'city')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 2. port_alias — 別名對照
--    模糊比對只列候選給人工確認，系統不自動合併寫入本表。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS port_alias (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    port_id         UUID        NOT NULL REFERENCES port_master(id) ON DELETE CASCADE,
    alias           VARCHAR(150) UNIQUE NOT NULL,
    confirmed_by    UUID        REFERENCES users(id),
    confirmed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_port_alias_port ON port_alias (port_id);

-- -------------------------------------------------------------
-- 3. route_distance — 距離主檔
--    destination_type = 'port'    → 用 destination_port（查 port_master 標準名）
--    destination_type = 'factory' → 用 destination_factory_id
--    兩者互斥，用 CHECK 保證只填其中一個。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_distance (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    origin                  VARCHAR(150) NOT NULL,   -- port_master 標準名稱
    destination_type        VARCHAR(10) NOT NULL CHECK (destination_type IN ('port', 'factory')),
    destination_port        VARCHAR(150),
    destination_factory_id  UUID        REFERENCES factories(id),
    mode                    VARCHAR(10) NOT NULL CHECK (mode IN ('Sea', 'Air', 'Land')),
    distance_km             NUMERIC(10, 2) NOT NULL CHECK (distance_km >= 0),
    source                  VARCHAR(200),            -- 歷史檔案名稱 或 '使用者補建'
    entered_by              UUID        REFERENCES users(id),
    entered_at              TIMESTAMPTZ,
    last_verified_date      DATE,
    note                    TEXT,
    status                  VARCHAR(10) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_route_destination_xor CHECK (
        (destination_type = 'port'    AND destination_port IS NOT NULL AND destination_factory_id IS NULL) OR
        (destination_type = 'factory' AND destination_factory_id IS NOT NULL AND destination_port IS NULL)
    )
);

-- 同一條路線（起訖點+運輸方式）只保留一筆 active，避免重複查詢結果
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_distance_active
    ON route_distance (origin, destination_type, COALESCE(destination_port, ''), COALESCE(destination_factory_id, '00000000-0000-0000-0000-000000000000'), mode)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_route_distance_lookup
    ON route_distance (origin, mode) WHERE status = 'active';

-- -------------------------------------------------------------
-- 4. route_distance_evidence — 佐證檔案（route 層級，非 activity_record 層級）
--    display_alias 依規格文件命名規則產生，僅供顯示/搜尋；實體檔案用 route_distance_id 命名。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_distance_evidence (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_distance_id   UUID        NOT NULL REFERENCES route_distance(id) ON DELETE CASCADE,
    display_alias       VARCHAR(255) NOT NULL,
    blob_url            TEXT        NOT NULL,
    version             INT         NOT NULL DEFAULT 1,
    source_label        VARCHAR(50) NOT NULL,   -- '歷史匯入' 或 '補建_YYYYMMDD'
    uploaded_by         UUID        REFERENCES users(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_evidence_route ON route_distance_evidence (route_distance_id);

-- -------------------------------------------------------------
-- 5. po_transport_records — PO 運輸明細（查證封存方案 B：PO 自帶查詢當下的快照）
--    route_id / distance_km 是「當時查到的值」，之後 route_distance 被修正
--    也不回頭影響已算過的 PO，稽核反查時看到的就是當年查證用的版本。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_transport_records (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number       VARCHAR(50) NOT NULL,
    factory_id      UUID        NOT NULL REFERENCES factories(id),
    vendor_name     VARCHAR(200),
    ship_mode       VARCHAR(10) NOT NULL CHECK (ship_mode IN ('Sea', 'Air', 'Land')),
    route_id        UUID        REFERENCES route_distance(id),   -- NULL 表示缺距離
    distance_km     NUMERIC(10, 2),                              -- 查詢當下的快照值
    weight_kg       NUMERIC(14, 4),
    tkm             NUMERIC(14, 4),
    co2e            NUMERIC(14, 6),
    calc_status     VARCHAR(20) NOT NULL DEFAULT 'ok'
                    CHECK (calc_status IN ('ok', 'missing_distance', 'ship_mode_mismatch', 'pending_review')),
    year            INT         NOT NULL,
    month           INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_transport_factory_year ON po_transport_records (factory_id, year, month);
CREATE INDEX IF NOT EXISTS idx_po_transport_status ON po_transport_records (calc_status) WHERE calc_status != 'ok';
CREATE INDEX IF NOT EXISTS idx_po_transport_route ON po_transport_records (route_id);

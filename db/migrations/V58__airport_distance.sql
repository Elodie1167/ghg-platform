-- =============================================================
-- V58：商務旅行（3-6-A/C/D）機場距離資料庫
--
-- 跟 V52 的 route_distance（上下游運輸 3-4/3-9，城市/港口/工廠）刻意分開建表，
-- 兩者資料語意不同（機場代碼 vs 城市港口模糊比對），使用者也要求分開，不共用。
-- 設計比照 route_distance/route_distance_evidence 的精簡版：機場代碼是三字碼，
-- 不需要 port_master 那套別名模糊比對機制。
-- =============================================================

CREATE TABLE IF NOT EXISTS airport_distance (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    from_code       VARCHAR(10) NOT NULL,
    from_name       VARCHAR(150),
    to_code         VARCHAR(10) NOT NULL,
    to_name         VARCHAR(150),
    distance_km     NUMERIC(10, 2) NOT NULL CHECK (distance_km > 0),
    source          VARCHAR(200),            -- 例如「ICAO Distance.xlsx（Elodie提供）」或「使用者補建」
    entered_by      UUID        REFERENCES users(id),
    entered_at      TIMESTAMPTZ,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 方向視為不同路線（去程/回程距離理論上相同但分開存，補建時各自認得到，查詢時 lookup 函式兩個方向都查）
CREATE UNIQUE INDEX IF NOT EXISTS uq_airport_distance_pair
    ON airport_distance (UPPER(from_code), UPPER(to_code));

CREATE TABLE IF NOT EXISTS airport_distance_evidence (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    airport_distance_id UUID        NOT NULL REFERENCES airport_distance(id) ON DELETE CASCADE,
    display_alias       VARCHAR(255) NOT NULL,
    blob_url            TEXT        NOT NULL,
    uploaded_by         UUID        REFERENCES users(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_airport_distance_evidence ON airport_distance_evidence (airport_distance_id);

-- 種子資料：Elodie 提供的 ICAO Distance.xlsx（15 條真實航線，2026-08 匯入）
INSERT INTO airport_distance (from_code, from_name, to_code, to_name, distance_km, source, entered_at)
VALUES
  ('XMN', 'Xiamen Gaoqi International Airport', 'CGK', 'Soekarno-Hatta International Airport', 3624, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('CGK', 'Soekarno-Hatta International Airport', 'SRG', 'Ahmad Yani International Airport', 420, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('SRG', 'Ahmad Yani International Airport', 'CGK', 'Soekarno-Hatta International Airport', 420, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HLP', 'Halim Perdanakusuma International Airport', 'SRG', 'Ahmad Yani International Airport', 391, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('SOC', 'Adi Soemarmo International Airport', 'CGK', 'Soekarno-Hatta International Airport', 476, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('SRG', 'Ahmad Yani International Airport', 'HLP', 'Halim Perdanakusuma International Airport', 391, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('SGN', 'Tan Son Nhat International Airport', 'CGK', 'Soekarno-Hatta International Airport', 1881, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('TPE', 'Taiwan Taoyuan International Airport', 'SGN', 'Tan Son Nhat International Airport', 2205, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('CGK', 'Soekarno-Hatta International Airport', 'SOC', 'Adi Soemarmo International Airport', 476, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HAN', 'Noi Bai International Airport', 'SGN', 'Tan Son Nhat International Airport', 1159, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HAN', 'Noi Bai International Airport', 'VCA', 'Can Tho International Airport', 1236, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('SGN', 'Tan Son Nhat International Airport', 'HAN', 'Noi Bai International Airport', 1159, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HAN', 'Noi Bai International Airport', 'DAC', 'Hazrat Shahjalal International Airport', 1608, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HAN', 'Noi Bai International Airport', 'CAN', 'Guangzhou Baiyun International Airport', 805, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HAN', 'Noi Bai International Airport', 'PVG', 'Shanghai Pudong International Airport', 1934, 'ICAO Distance.xlsx（Elodie提供）', NOW()),
  ('HAN', 'Noi Bai International Airport', 'TPE', 'Taiwan Taoyuan International Airport', 1630, 'ICAO Distance.xlsx（Elodie提供）', NOW())
ON CONFLICT (UPPER(from_code), UPPER(to_code)) DO NOTHING;

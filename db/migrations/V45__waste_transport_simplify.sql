-- =============================================================
-- 3-5 填報方式簡化（2026-08-11 Elodie 拍板）
--
-- 1. 廢棄物清運 3-5-T1：不再由使用者填重量/清運商/車型/趟次。
--    重量自動接同廠同月的 3-5-W1（一般廢棄物）與 3-5-W2（廢布）填報值，
--    使用者只填「處理場所名稱／地址／單程距離」。
--    一般廢棄物與廢布可能送去不同地方 → 兩條流各自一組距離，
--    以 activity_records.sub_location 區分（'general' / 'textile'）。
--
-- 2. 3-5-T1 係數改與「3-4-A 上下游運輸-陸運」共用（同為 kgCO₂e/tkm），
--    不另建一組 tkm 係數，避免兩處各自維護而漂移。
--
-- 3. 廢水處理 3-5-G 的填報方式（廠內實測／外購水量×80%）改由填報頁
--    「基本資訊」設定，仍寫入 factory_settings。外購水量推估不再要使用者
--    重打水量，直接取同廠同月 3-1-E 採購水資源的填報值 × 廢水產生係數。
-- =============================================================

-- -------------------------------------------------------------
-- 1. 3-5-T1 / 3-5-T2 共用 3-4-A 的陸運 tkm 係數
-- -------------------------------------------------------------
UPDATE emission_sources
SET factor_source_id = (SELECT id FROM emission_sources WHERE source_code = '3-4-A')
WHERE source_code IN ('3-5-T1', '3-5-T2');

-- V42 曾把 3-5-T2 指到 3-5-T1；3-5-T1 自己也指向 3-4-A 會變成兩層轉指，
-- 而 calcCo2e 的 COALESCE(factor_source_id, id) 只解一層。故兩個都直接指 3-4-A。

-- -------------------------------------------------------------
-- 2. 清運明細：不再使用的欄位放寬為可空（已於 V42 建立時即為可空，
--    這裡僅補註解說明現行語意，不刪欄位以免既有資料遺失）
-- -------------------------------------------------------------
COMMENT ON COLUMN activity_waste_detail.waste_weight IS
  '3-5-T1：由同廠同月 3-5-W1/W2 的填報重量自動帶入的快照（單位見 waste_weight_unit）。'
  '使用者不填，改動 W1/W2 後由 recomputeWasteTransport 重算。';
COMMENT ON COLUMN activity_waste_detail.contractor_name IS
  '2026-08-11 起 3-5-T1 不再填此欄（保留既有資料）。';
COMMENT ON COLUMN activity_waste_detail.vehicle_type IS
  '2026-08-11 起 3-5-T1 不再填此欄；車型差異已內含於 3-4-A 陸運係數。';

-- -------------------------------------------------------------
-- 3. 清運一個月每條流各一筆，用 sub_location（'general' / 'textile'）區分。
--    不建部分唯一索引：索引述詞不能有子查詢，寫死 UUID 又會讓 migration
--    綁死特定環境的資料。唯一性由 lib/waste-derive.ts 的 upsert 以
--    (factory, source, year, month, sub_location) 查詢後決定 INSERT/UPDATE。
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ar_source_month_sublocation
  ON activity_records (emission_source_id, factory_id, year, month, sub_location);

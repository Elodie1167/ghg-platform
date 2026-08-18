-- =============================================================
-- V53：資料覆核中心（Phase 4）支援欄位
--
-- po_transport_records 在 calc_status != 'ok' 時，route_id 是 NULL，
-- 沒有辦法從主表反查「這筆卡在哪一條路線」。新增三個 raw 欄位存查詢當下的
-- 原始文字（未經 port_master 標準化），讓「資料覆核中心」可以：
--   1. 依 (origin_raw, destination_raw, ship_mode_raw) 分組，算出「影響筆數」
--   2. 補值送出後，用同一組 raw 值精準找回所有卡住的 PO 明細重新計算
--   3. 用同一組值反查 anomaly_flags.detail 對應的 open 異常，一併 resolve
--
-- raw 值與 anomaly_flags.detail 裡的 export_port / import_port / ship_mode_raw
-- 完全對齊（見 app/api/transport/import-erp/route.ts 的 upsertMissingFlag），
-- 兩邊用同一組原始文字做 join key，不需要另外維護對照。
-- =============================================================

ALTER TABLE po_transport_records
  ADD COLUMN IF NOT EXISTS origin_raw      VARCHAR(200),
  ADD COLUMN IF NOT EXISTS destination_raw VARCHAR(200),
  ADD COLUMN IF NOT EXISTS ship_mode_raw   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS raw_address     TEXT;   -- 廠供副料原始地址全文，供人工比對用

CREATE INDEX IF NOT EXISTS idx_po_transport_missing_group
  ON po_transport_records (origin_raw, destination_raw, ship_mode_raw)
  WHERE calc_status IN ('missing_distance', 'pending_review');

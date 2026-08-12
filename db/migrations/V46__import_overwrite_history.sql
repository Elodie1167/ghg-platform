-- 匯入覆蓋/整月取代的安全網：寫入前先把「即將被改掉/刪掉的舊資料」存一份快照。
-- 設計文件《數據覆蓋與查證封存_設計文件.md》任務 5。
-- 只覆蓋匯入路徑（app/api/records/import/route.ts）的兩個危險動作：
--   1) 固定分頁 add_update 覆蓋既有月份數值前
--   2) 單據明細 full_month 模式刪除整月明細前
-- 純新增表，append-only，不動既有表結構。

CREATE TABLE activity_records_history (
  history_id BIGSERIAL PRIMARY KEY,
  activity_record_id UUID NOT NULL,
  change_reason TEXT NOT NULL,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  LIKE activity_records INCLUDING DEFAULTS
);

CREATE INDEX idx_arh_record_id ON activity_records_history (activity_record_id, snapshotted_at DESC);

-- activity_line_items 已有 activity_record_id 欄位，LIKE 會帶進來，不再重複宣告
CREATE TABLE activity_line_items_history (
  history_id BIGSERIAL PRIMARY KEY,
  change_reason TEXT NOT NULL,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  LIKE activity_line_items INCLUDING DEFAULTS
);

CREATE INDEX idx_alih_record_id ON activity_line_items_history (activity_record_id, snapshotted_at DESC);

COMMENT ON TABLE activity_records_history IS '匯入覆蓋既有月份數值前的快照，供還原用（任務5，設計文件§10）';
COMMENT ON TABLE activity_line_items_history IS '匯入整月取代模式刪除明細前的快照，供還原用（任務5，設計文件§10）';

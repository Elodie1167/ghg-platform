-- activity_line_items（單據明細）此前是直接在資料庫手動建立，未經 migrate.mjs 追蹤，
-- 導致這張表與其 activity_record_id 的 ON DELETE CASCADE 沒有記錄在 db/migrations/ 裡。
-- 若未來重建資料庫（災難復原、新環境），只跑 migrate.mjs 會漏掉這張表與這個安全網
-- （刪除 activity_records 時應一併連動刪除其單據明細），導致刪除主紀錄後明細變孤兒列。
-- 本支用 IF NOT EXISTS 補齊現況，對已存在此表的正式 DB 是 no-op。
CREATE TABLE IF NOT EXISTS activity_line_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_record_id  UUID NOT NULL REFERENCES activity_records(id) ON DELETE CASCADE,
  invoice_no          TEXT,
  invoice_date        DATE,
  quantity            NUMERIC,
  unit                TEXT,
  erp_ref             TEXT,
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_items_record ON activity_line_items (activity_record_id);

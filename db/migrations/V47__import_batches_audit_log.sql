-- 稽核留痕（設計文件《數據覆蓋與查證封存_設計文件.md》§九、任務9）
-- 純新增表，append-only，不動既有表結構。

-- -------------------------------------------------------------
-- import_batches — 每次匯入的紀錄
--
-- ⚠️ 簡化說明：設計文件 §9 原文列出「新增N、更新N、取代N、略過N、拒絕N、
-- 未填識別碼N」六種細分狀態筆數。現行 /api/records/import 的計數邏輯
-- 只累計「imported / skipped / lineItemsImported / errors」，並未在單一
-- 迴圈內分別累計新增與更新、或取代與拒絕。要做到六種細分需重構匯入迴圈
-- 本身（不是稽核表能單獨解決的），本輪先以現有計數落地，補上「誰、何時、
-- 匯入什麼檔、選了什麼模式」這個更基本的稽核需求；六種細分留待下一輪
-- 隨匯入邏輯調整時一併補上（不在本 migration 範圍內）。
-- -------------------------------------------------------------
CREATE TABLE import_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id          UUID NOT NULL REFERENCES factories(id),
    year                INT  NOT NULL,
    imported_by         UUID REFERENCES users(id),
    imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    filename            TEXT,
    -- 匯入路徑：fixed_sheet（固定分頁月彙總）／line_item（單據明細）／erp（ERP 原生檔直匯）
    import_path         VARCHAR(20) NOT NULL
                         CHECK (import_path IN ('fixed_sheet', 'line_item', 'erp')),
    -- 宣告模式（§4.2）。fixed_sheet 用 add_only/add_update；line_item 用 full_month/supplement；
    -- erp 目前固定整批取代，不開放宣告，存 NULL。
    fixed_mode          VARCHAR(20) CHECK (fixed_mode IN ('add_only', 'add_update')),
    line_item_mode      VARCHAR(20) CHECK (line_item_mode IN ('full_month', 'supplement')),
    imported_count      INT NOT NULL DEFAULT 0,
    skipped_count       INT NOT NULL DEFAULT 0,
    line_items_imported INT NOT NULL DEFAULT 0,
    error_count         INT NOT NULL DEFAULT 0,
    errors              JSONB
);

CREATE INDEX idx_import_batches_factory_year ON import_batches (factory_id, year, imported_at DESC);

COMMENT ON TABLE import_batches IS
    '每次匯入的稽核紀錄：誰、何時、匯入什麼檔、選了什麼模式、結果統計（見表定義註解的簡化說明）';

-- -------------------------------------------------------------
-- audit_log — 敏感操作稽核（§8.3：權限授予/取消、封存/解封）
-- -------------------------------------------------------------
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id   TEXT,
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_target ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);

COMMENT ON TABLE audit_log IS
    '敏感操作稽核：can_freeze 授予/取消、查證封存/解封。actor_id 可為 NULL（CLI 腳本在無登入情境下執行）。';

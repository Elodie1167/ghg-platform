-- 盤查年度主檔：首頁與填報頁的「盤查年度」清單改由 DB 驅動，
-- 不再硬編碼 REPORT_YEARS 常數（新增/退休年度不必改程式碼重新部署）。
-- 由 /admin/report-years 維護，停用（is_active = false）而非刪除 —— 歷史年度的
-- 填報記錄不受影響，只是不再出現在新填報的年度選單中（同「停用工廠 ≠ 刪除」原則）。

CREATE TABLE report_years (
    year        INTEGER PRIMARY KEY,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO report_years (year) VALUES (2023), (2024), (2025), (2026), (2027), (2028)
  ON CONFLICT DO NOTHING;

COMMENT ON TABLE report_years IS
    '可填報的盤查年度清單。is_active = false 表示停用（不再出現於新填報年度選單），但既有該年度的填報記錄與報表不受影響。';

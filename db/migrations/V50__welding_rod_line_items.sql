-- 焊條（1-3A-1）改為支援每月多筆採購（比照燃料/電費的單據明細模式）。
-- 每筆採購含碳量可能不同，CO2e 需逐筆計算再加總，不能像燃料一樣「明細加總量 × 一個係數」，
-- 故需在 activity_line_items 上多存一個「該筆含碳量(%)」欄位，其他排放源恆為 NULL。
ALTER TABLE activity_line_items ADD COLUMN carbon_content_pct NUMERIC;
COMMENT ON COLUMN activity_line_items.carbon_content_pct IS
  '焊條(1-3A-1)專用：該筆採購的含碳量(%)，其他排放源恆為 NULL';

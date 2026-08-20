-- 斷路器-SF6（1-4D-1）原本把「每台填充量 × 台數」直接當成「已洩漏量」套用 GWP，
-- 等於假設整年 100% 洩漏，明顯高估。實際上 SF6 斷路器是密閉設備，逐年僅有小比例
-- 逸散（逸散率因設備/廠而異，例如 Demak 目前為 0.1%/年），需要
-- 填充量(每台) × 台數 × 逸散率 × GWP 才是正確公式。
--
-- 逸散率設計成每筆填報各自填（同廠不同月份/設備都可能不同台數或不同批充填紀錄），
-- 不做成全公司或全廠共用常數，故加在 activity_records 而非 emission_factors。
ALTER TABLE activity_records ADD COLUMN leak_rate_pct NUMERIC;
COMMENT ON COLUMN activity_records.leak_rate_pct IS
  '逸散率(%)，目前僅斷路器-SF6(1-4D-1)使用：activity_value = 每台填充 × 台數 × leak_rate_pct/100';

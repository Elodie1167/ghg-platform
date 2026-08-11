-- 修正化糞池 (1-4B-1) 誤套用 UNIT_CONV m3→1000 換算導致 CH4/CO2e 放大 1000 倍的 bug
-- （程式碼修正見 apps/web/src/lib/co2e-calc.ts，化糞池分支改用 params.activity_value 原始值）
--
-- 受影響記錄（執行前查詢確認，2026-08-11）：
--   CAB_MOHA  2025  12 筆
--   CAB_MOHA  2026  12 筆
--   IND_DMK   2025   1 筆
--   共 25 筆，2 個廠、3 個廠/年組合
--
-- 將受影響記錄的 co2e 欄位設回 NULL，待 /api/records/recalculate 依修正後公式重算。

UPDATE activity_records ar
SET co2e_total = NULL,
    co2_t = NULL,
    ch4_t = NULL,
    n2o_t = NULL,
    hfc_t = NULL
FROM emission_sources es
WHERE es.id = ar.emission_source_id
  AND es.source_code = '1-4B-1'
  AND ar.co2e_total IS NOT NULL;

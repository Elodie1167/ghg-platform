-- 冷媒逸散 1-4A-1~6 的 factor_substance 誤填成 GWP 值本身（例如 R134a 填 1530）。
-- calcCo2e()（及對照的 Python calculation_agent）設計上 factor_substance 是「洩漏質量比例」，
-- 正常應固定填 1（活動量本身即洩漏公斤數），GWP 由程式內建的 GWP_SUBSTANCE 表另外套用一次；
-- 兩者都填 GWP 值等於 GWP 被乘了兩次，CO2e 被放大成原本的 GWP 倍數
-- （例：0.9kg R134a 應得 1.377 tCO2e，卻算成 2106.81）。
-- 起因是 /admin/factors/[id] 頁面「冷媒逸散」區塊文案寫錯，誤導填表人直接填 GWP 值，已一併修正文案。
-- 斷路器 SF6(1-4D-1)、滅火器 CO2(1-4C-1) 這兩個排放源當初就填對（factor_substance=1），不受影響。

UPDATE emission_factors ef
SET factor_substance = 1
FROM emission_sources es
WHERE ef.emission_source_id = es.id
  AND es.source_code IN ('1-4A-1', '1-4A-2', '1-4A-3', '1-4A-4', '1-4A-5', '1-4A-6')
  AND ef.factor_substance = (CASE es.source_code
        WHEN '1-4A-1' THEN 1530
        WHEN '1-4A-2' THEN 3985
        WHEN '1-4A-3' THEN 1960
        WHEN '1-4A-4' THEN 771
        WHEN '1-4A-5' THEN 1774
        WHEN '1-4A-6' THEN 2088
      END);

-- 受影響的既有記錄用舊(錯誤)係數算出的 co2e_total/hfc_t 一併重算
-- （CLAUDE.md 鐵則#3：改係數後舊記錄不會自動重算）。
-- 僅命中目前確實用錯誤係數算出非零 co2e 的記錄，其餘（原本就是 NULL/0，代表當初根本沒係數可用）不受影響。
UPDATE activity_records ar
SET hfc_t = ROUND((ar.activity_value::numeric * 1 / 1000), 6),
    co2e_total = ROUND((ar.activity_value::numeric * 1 / 1000 * gwp.value), 4),
    co2_t = NULL, ch4_t = NULL, n2o_t = NULL,
    updated_at = NOW()
FROM emission_sources es
JOIN (VALUES
  ('1-4A-1', 1530), ('1-4A-2', 3985), ('1-4A-3', 1960),
  ('1-4A-4', 771),  ('1-4A-5', 1774), ('1-4A-6', 2088)
) AS gwp(source_code, value) ON gwp.source_code = es.source_code
WHERE ar.emission_source_id = es.id
  AND es.source_code IN ('1-4A-1', '1-4A-2', '1-4A-3', '1-4A-4', '1-4A-5', '1-4A-6')
  AND ar.co2e_total IS NOT NULL AND ar.co2e_total > 0;

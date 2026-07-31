-- =============================================================
-- V22  公務車-柴油 (1-2A-2) 密度採 IPCC 2006 預設
--      換算鏈：Activity(L) × Density(kg/L) × NCV(MJ/kg) → MJ
--      NCV 43.0 MJ/kg（原已存在）、Density 0.84 kg/L（原 0.8375 → 0.84）
--      並清空既有記錄 co2e，交由 /api/records/recalculate 以新密度重算
-- =============================================================

UPDATE emission_factors ef
SET    ncv          = 43.0,
       ncv_unit     = 'MJ/kg',
       density      = 0.84,
       density_unit = 'kg/L'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id
  AND  es.source_code = '1-2A-2';

-- 清空 1-2A-2 既有記錄的計算結果（recalculate 只補 co2e_total/co2_t 為 NULL 的列）
UPDATE activity_records ar
SET    co2e_total = NULL, co2_t = NULL, ch4_t = NULL, n2o_t = NULL, updated_at = NOW()
FROM   emission_sources es
WHERE  ar.emission_source_id = es.id
  AND  es.source_code = '1-2A-2';

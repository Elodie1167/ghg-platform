-- =============================================================
-- V13  Fix Scope 1 emission factors to IPCC methodology
--      + populate NCV values for correct calculation chain:
--      Activity × NCV → MJ → /1e6 → TJ → × EF(kg/TJ) → kg → /1000 → t → × GWP → tCO₂-eq
--
--      Previous V4 values were UK Gov per-unit (kg/L or kg/kg),
--      which bypassed the NCV conversion.
--      Source: IPCC 2006 Guidelines Table 1.2 + AR6 GWP
-- =============================================================

-- ─── Helper: update by source_code (affects all countries) ──────────────

-- 1-1A-1  固定燃燒 — 柴油 (Diesel)
--   NCV: 35.87 MJ/L  |  EF CO₂: 74,300 kg/TJ  |  CH₄: 10 kg/TJ  |  N₂O: 0.6 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 74300,
       factor_ch4  = 10,
       factor_n2o  = 0.6,
       ncv         = 35.87,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-1A-1';

-- 1-1A-2  固定燃燒 — 天然氣 (Natural Gas)
--   NCV: 36.0 MJ/Nm³  |  EF CO₂: 56,100 kg/TJ  |  CH₄: 1 kg/TJ  |  N₂O: 0.1 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 56100,
       factor_ch4  = 1,
       factor_n2o  = 0.1,
       ncv         = 36.0,
       ncv_unit    = 'MJ/Nm3',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-1A-2';

-- 1-1A-3  固定燃燒 — LPG
--   NCV: 47.3 MJ/kg  |  EF CO₂: 63,100 kg/TJ  |  CH₄: 1 kg/TJ  |  N₂O: 0.1 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 63100,
       factor_ch4  = 1,
       factor_n2o  = 0.1,
       ncv         = 47.3,
       ncv_unit    = 'MJ/kg',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-1A-3';

-- 1-1A-4  固定燃燒 — 汽油 (Gasoline / Motor Spirit)
--   NCV: 33.4 MJ/L  |  EF CO₂: 69,300 kg/TJ  |  CH₄: 33 kg/TJ  |  N₂O: 3.2 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 69300,
       factor_ch4  = 33,
       factor_n2o  = 3.2,
       ncv         = 33.4,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-1A-4';

-- 1-1B-1  生質 — 木材鍋爐 (Wood / Biomass)
--   NCV: 16.4 MJ/kg  |  EF CO₂: 112,000 kg/TJ  |  CH₄: 300 kg/TJ  |  N₂O: 4 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 112000,
       factor_ch4  = 300,
       factor_n2o  = 4,
       ncv         = 16.4,
       ncv_unit    = 'MJ/kg',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 (biomass) / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-1B-1';

-- 1-1B-2  生質 — 椰殼鍋爐 (Coconut Shell)
--   NCV: 15.9 MJ/kg  |  EF CO₂: 110,000 kg/TJ  |  CH₄: 280 kg/TJ  |  N₂O: 3.8 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 110000,
       factor_ch4  = 280,
       factor_n2o  = 3.8,
       ncv         = 15.9,
       ncv_unit    = 'MJ/kg',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 (biomass) / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-1B-2';

-- ─── 移動燃燒 (Mobile combustion) ────────────────────────────────────────

-- 1-2A-1  公務車 — 汽油 (same NCV/EF as gasoline above)
UPDATE emission_factors ef
SET    factor_co2  = 69300,
       factor_ch4  = 33,
       factor_n2o  = 3.2,
       ncv         = 33.4,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-2A-1';

-- 1-2A-2  公務車 — 柴油 (same NCV/EF as diesel above)
UPDATE emission_factors ef
SET    factor_co2  = 74300,
       factor_ch4  = 10,
       factor_n2o  = 0.6,
       ncv         = 35.87,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-2A-2';

-- 1-2A-3  公務車 — B35 生質柴油 (35% FAME blend)
--   NCV: 35.87 MJ/L (approx same as diesel)
--   CO₂ EF (fossil portion only, 65% of diesel): 74300 × 0.65 = 48,295 kg/TJ
UPDATE emission_factors ef
SET    factor_co2  = 48295,
       factor_ch4  = 10,
       factor_n2o  = 0.6,
       ncv         = 35.87,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 / B35 65% fossil fraction / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-2A-3';

-- 1-2A-4  堆高機 — 柴油 (same as diesel)
UPDATE emission_factors ef
SET    factor_co2  = 74300,
       factor_ch4  = 10,
       factor_n2o  = 0.6,
       ncv         = 35.87,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 Table 1.2 / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-2A-4';

-- 1-2A-5  堆高機 — B35 生質柴油 (same as 1-2A-3)
UPDATE emission_factors ef
SET    factor_co2  = 48295,
       factor_ch4  = 10,
       factor_n2o  = 0.6,
       ncv         = 35.87,
       ncv_unit    = 'MJ/L',
       source_reference = 'IPCC 2006 Vol.2 / B35 65% fossil fraction / AR6 GWP'
FROM   emission_sources es
WHERE  ef.emission_source_id = es.id AND es.source_code = '1-2A-5';

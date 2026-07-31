-- =============================================================
-- V23  廠別合併與改名
--   CAB_MK1 + CAB_MK2 + CAB_MK5 → 新廠 CAB_MK
--   NVN_MK1 + NVN_MK2           → 新廠 NVN_MK
--   CHN_HY → 代碼 CHN_MZ、中文「海塩廠」、英文「CHN-MZ」
--   （factories 以 UUID 為 FK；合併需 repoint 子表並去重 assignments）
-- =============================================================

-- ── CAB_MK ──────────────────────────────────────────────────
INSERT INTO factories (factory_code, name_zh, name_en, country_code, region, is_verified, source_config)
SELECT 'CAB_MK', 'MK 柬埔寨', 'MK Cambodia', 'CAB', '柬埔寨', TRUE,
       COALESCE((SELECT source_config FROM factories WHERE factory_code='CAB_MK1'), '{}'::jsonb)
WHERE NOT EXISTS (SELECT 1 FROM factories WHERE factory_code='CAB_MK');

UPDATE activity_records SET factory_id=(SELECT id FROM factories WHERE factory_code='CAB_MK')
WHERE factory_id IN (SELECT id FROM factories WHERE factory_code IN ('CAB_MK1','CAB_MK2','CAB_MK5'));

INSERT INTO emission_factor_assignments (emission_factor_id, factory_id)
SELECT DISTINCT efa.emission_factor_id, (SELECT id FROM factories WHERE factory_code='CAB_MK')
FROM emission_factor_assignments efa
WHERE efa.factory_id IN (SELECT id FROM factories WHERE factory_code IN ('CAB_MK1','CAB_MK2','CAB_MK5'))
ON CONFLICT (emission_factor_id, factory_id) DO NOTHING;
DELETE FROM emission_factor_assignments
WHERE factory_id IN (SELECT id FROM factories WHERE factory_code IN ('CAB_MK1','CAB_MK2','CAB_MK5'));

UPDATE rec_certificates SET factory_id=(SELECT id FROM factories WHERE factory_code='CAB_MK')
WHERE factory_id IN (SELECT id FROM factories WHERE factory_code IN ('CAB_MK1','CAB_MK2','CAB_MK5'));

DELETE FROM factories WHERE factory_code IN ('CAB_MK1','CAB_MK2','CAB_MK5');

-- ── NVN_MK ──────────────────────────────────────────────────
INSERT INTO factories (factory_code, name_zh, name_en, country_code, region, is_verified, source_config)
SELECT 'NVN_MK', 'MK 北越', 'MK North Vietnam', 'NVN', '北越', TRUE,
       COALESCE((SELECT source_config FROM factories WHERE factory_code='NVN_MK2'), '{}'::jsonb)
WHERE NOT EXISTS (SELECT 1 FROM factories WHERE factory_code='NVN_MK');

UPDATE activity_records SET factory_id=(SELECT id FROM factories WHERE factory_code='NVN_MK')
WHERE factory_id IN (SELECT id FROM factories WHERE factory_code IN ('NVN_MK1','NVN_MK2'));

INSERT INTO emission_factor_assignments (emission_factor_id, factory_id)
SELECT DISTINCT efa.emission_factor_id, (SELECT id FROM factories WHERE factory_code='NVN_MK')
FROM emission_factor_assignments efa
WHERE efa.factory_id IN (SELECT id FROM factories WHERE factory_code IN ('NVN_MK1','NVN_MK2'))
ON CONFLICT (emission_factor_id, factory_id) DO NOTHING;
DELETE FROM emission_factor_assignments
WHERE factory_id IN (SELECT id FROM factories WHERE factory_code IN ('NVN_MK1','NVN_MK2'));

UPDATE rec_certificates SET factory_id=(SELECT id FROM factories WHERE factory_code='NVN_MK')
WHERE factory_id IN (SELECT id FROM factories WHERE factory_code IN ('NVN_MK1','NVN_MK2'));

DELETE FROM factories WHERE factory_code IN ('NVN_MK1','NVN_MK2');

-- ── 海塩廠改名/改碼 ─────────────────────────────────────────
UPDATE factories
SET factory_code='CHN_MZ', name_zh='海塩廠', name_en='CHN-MZ'
WHERE factory_code='CHN_HY';

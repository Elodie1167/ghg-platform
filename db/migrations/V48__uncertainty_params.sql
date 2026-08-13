-- 表4-9~4-12 不確定性分析（設計文件 uncertainty_design.md）
-- 固定參數表：每年只需把「當年度排放量」餵進計算模組，AD%/EF%/A1-A4 等級不逐年填。
-- 初始值取自「2025集團清冊_V1 (2).xlsx」不確定性分析分頁，2026-08-13 建檔。

-- -------------------------------------------------------------
-- uncertainty_params_scope12 — 範疇一／範疇二共用
--
-- type_code 即比對 emission_sources.source_code 前綴用的分組鍵：
-- 1-1（固定燃燒）、1-2（移動燃燒）、1-3（製程排放）、
-- 1-4A（冷媒逸散）、1-4B（化糞池）、1-4C（滅火器）、1-4D（斷路器SF6）、2-1（外購電力）
-- -------------------------------------------------------------
CREATE TABLE uncertainty_params_scope12 (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope                 SMALLINT NOT NULL CHECK (scope IN (1, 2)),
    type_code             VARCHAR(10) NOT NULL UNIQUE,
    emission_source_name  TEXT NOT NULL,
    ghg_type              TEXT,
    ad_uncertainty_pct    NUMERIC(6,4) NOT NULL,
    ef_uncertainty_pct    NUMERIC(6,4) NOT NULL,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by             UUID REFERENCES users(id)
);

COMMENT ON TABLE uncertainty_params_scope12 IS
    '範疇一/二不確定性固定參數。type_code 對 emission_sources.source_code 做前綴比對分組，
     計算時只需帶入當年度該組排放量；AD%/EF% 除非量測方法論改變否則不動。';

INSERT INTO uncertainty_params_scope12
    (scope, type_code, emission_source_name, ghg_type, ad_uncertainty_pct, ef_uncertainty_pct)
VALUES
    (1, '1-1',  'Emergency Generators/Boilers/LPG/Vehicles(Gasoline)/Vehicles(Diesel)', 'CO2, CH4, N2O', 0.02, 0.02),
    (1, '1-2',  'Company Vehicles/Forklifts',                                          'CO2, CH4, N2O', 0.02, 0.02),
    (1, '1-3',  'Metal Welding Rod',                                                   'CO2',           0.02, 0.02),
    (1, '1-4A', 'Refrigerants',                                                        'HFCs',          0.13, 0.00),
    (1, '1-4B', 'Septic Tanks',                                                        'CH4, N2O',      0.01, 0.10),
    (1, '1-4C', 'Fire Extinguisher',                                                   'CO2',           0.05, 0.00),
    (1, '1-4D', 'GCB (SF6)',                                                           'SF6',           0.38, 0.00),
    -- 範疇二：外購電力 AD/EF 為 7%/7%（環境部/當地電網係數公告值）。
    -- 2026-08-13 已與 Elodie 確認：2025年報告書寫的「±8.06%」查無可還原之計算依據，
    -- 後續報告書一律改用本表 AD/EF 以公式 √(AD²+EF²) 算出的±9.9%（等級仍為「好」）。
    (2, '2-1',  'Purchased Electricity',                                               'CO2',           0.07, 0.07);

-- -------------------------------------------------------------
-- uncertainty_params_scope3 — 範疇三 Pedigree 數據品質矩陣（表3.6 子類別 3-1~3-15）
-- -------------------------------------------------------------
CREATE TABLE uncertainty_params_scope3 (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subcategory_code    VARCHAR(10) NOT NULL UNIQUE,
    subcategory_name    TEXT NOT NULL,
    calculation_method  VARCHAR(10) NOT NULL CHECK (calculation_method IN ('LCA', 'NA')),
    a1                  SMALLINT,
    a2                  SMALLINT,
    a3                  SMALLINT,
    a4                  SMALLINT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          UUID REFERENCES users(id)
);

COMMENT ON TABLE uncertainty_params_scope3 IS
    '範疇三 Pedigree 矩陣固定分數（A1活動數據精確性/A2係數地理性/A3係數時間性/A4係數技術性）。
     calculation_method=NA 的子類別不參與整體加權（平台目前無該類別排放量）。';

INSERT INTO uncertainty_params_scope3
    (subcategory_code, subcategory_name, calculation_method, a1, a2, a3, a4)
VALUES
    ('3-1',  'Purchased goods and services',                          'LCA', 3, 4, 1, 2),
    ('3-2',  'Capital goods',                                         'NA',  NULL, NULL, NULL, NULL),
    ('3-3',  'Fuel- and energy-related activities not in Scope 1/2',  'LCA', 4, 4, 1, 2),
    ('3-4',  'Upstream transportation and distribution',              'LCA', 3, 4, 1, 2),
    ('3-5',  'Waste generated in operations',                         'LCA', 4, 4, 1, 2),
    ('3-6',  'Business travel',                                       'LCA', 3, 4, 1, 2),
    ('3-7',  'Employee commuting',                                    'LCA', 4, 4, 1, 2),
    ('3-8',  'Upstream leased assets',                                'NA',  NULL, NULL, NULL, NULL),
    ('3-9',  'Downstream transportation and distribution',            'LCA', 3, 4, 1, 2),
    ('3-10', 'Processing of sold products',                           'NA',  NULL, NULL, NULL, NULL),
    ('3-11', 'Use of sold products',                                  'NA',  NULL, NULL, NULL, NULL),
    ('3-12', 'End-of-life treatment of sold products',                'NA',  NULL, NULL, NULL, NULL),
    ('3-13', 'Downstream leased assets',                              'NA',  NULL, NULL, NULL, NULL),
    ('3-14', 'Franchises',                                            'NA',  NULL, NULL, NULL, NULL),
    ('3-15', 'Investments',                                           'NA',  NULL, NULL, NULL, NULL);

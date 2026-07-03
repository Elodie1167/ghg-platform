-- =============================================================
-- V3  種子資料 — 排放源主檔
-- 依 GHG Protocol / ISO 14064-1:2018 鑑別表
-- =============================================================

INSERT INTO emission_sources (source_code, name_zh, name_en, scope, category, is_biomass, default_unit, substance) VALUES

-- ─── 範疇一：固定燃燒 ───────────────────────────────────────────
('1-1A-1', '鍋爐-柴油',           'Boiler - Diesel',               1, '固定燃燒', FALSE, 'L',   NULL),
('1-1A-2', '鍋爐-天然氣',         'Boiler - Natural Gas',          1, '固定燃燒', FALSE, 'Nm3', NULL),
('1-1A-3', '廚房LPG',             'Kitchen LPG',                   1, '固定燃燒', FALSE, 'kg',  NULL),
('1-1A-4', '鍋爐-汽油',           'Boiler - Gasoline',             1, '固定燃燒', FALSE, 'L',   NULL),
('1-1B-1', '鍋爐-木材生質',       'Boiler - Wood Biomass',         1, '固定燃燒', TRUE,  'kg',  NULL),
('1-1B-2', '鍋爐-椰殼生質',       'Boiler - Coconut Shell Biomass',1, '固定燃燒', TRUE,  'kg',  NULL),

-- ─── 範疇一：移動燃燒 ───────────────────────────────────────────
('1-2A-1', '公務車-汽油',         'Company Car - Gasoline',        1, '移動燃燒', FALSE, 'L',   NULL),
('1-2A-2', '公務車-柴油',         'Company Car - Diesel',          1, '移動燃燒', FALSE, 'L',   NULL),
('1-2A-3', '發電機-B35生質柴油',  'Generator - B35 Biodiesel',     1, '移動燃燒', TRUE,  'L',   NULL),
('1-2A-4', '堆高機-柴油',         'Forklift - Diesel',             1, '移動燃燒', FALSE, 'L',   NULL),
('1-2A-5', '堆高機-生質柴油',     'Forklift - Biodiesel',          1, '移動燃燒', TRUE,  'L',   NULL),

-- ─── 範疇一：製程排放 ───────────────────────────────────────────
('1-3A-1', '製程排放-焊接',       'Process - Welding',             1, '製程排放', FALSE, 'kg',  NULL),

-- ─── 範疇一：逸散排放（冷媒） ──────────────────────────────────
('1-4A-1', '冷媒逸散-R134a',      'Refrigerant Leakage - R134a',   1, '逸散排放', FALSE, 'kg',  'R134a'),
('1-4A-2', '冷媒逸散-R507',       'Refrigerant Leakage - R507',    1, '逸散排放', FALSE, 'kg',  'R507'),
('1-4A-3', '冷媒逸散-R22',        'Refrigerant Leakage - R22',     1, '逸散排放', FALSE, 'kg',  'R22'),
('1-4A-4', '冷媒逸散-R32',        'Refrigerant Leakage - R32',     1, '逸散排放', FALSE, 'kg',  'R32'),
('1-4A-5', '冷媒逸散-R407C',      'Refrigerant Leakage - R407C',   1, '逸散排放', FALSE, 'kg',  'R407C'),
('1-4A-6', '冷媒逸散-R410A',      'Refrigerant Leakage - R410A',   1, '逸散排放', FALSE, 'kg',  'R410A'),

-- ─── 範疇一：逸散排放（化糞池、滅火器、斷路器） ────────────────
('1-4B-1', '化糞池排放',          'Septic Tank Emissions',         1, '逸散排放', FALSE, 'm3',  NULL),
('1-4C-1', '滅火器-CO2',          'Extinguisher - CO2',            1, '逸散排放', FALSE, 'kg',  'CO2'),
('1-4C-2', '滅火器-FM200',        'Extinguisher - FM200',          1, '逸散排放', FALSE, 'kg',  'FM200'),
('1-4C-3', '滅火器-ABC乾粉',      'Extinguisher - ABC Dry Powder', 1, '逸散排放', FALSE, 'kg',  NULL),
('1-4D-1', '斷路器-SF6',          'GCB - SF6',                     1, '逸散排放', FALSE, 'kg',  'SF6'),

-- ─── 範疇二：外購電力 ───────────────────────────────────────────
('2-1-A',  '外購電力',            'Purchased Electricity',         2, '外購電力', FALSE, 'kWh', NULL),

-- ─── 範疇三（參考值） ───────────────────────────────────────────
-- ─── 範疇三 3.1：採購商品與服務 ────────────────────────────────
('3-1-A',  '採購布料(Higg MSI)',   'Purchased Goods - Fabric (Higg MSI)',       3, '採購商品與服務', FALSE, 'kg',   NULL),
('3-1-B',  '採購線料',             'Purchased Goods - Thread/Yarn',             3, '採購商品與服務', FALSE, 'kg',   NULL),
('3-1-C',  '採購紙箱',             'Purchased Goods - Carton Box',              3, '採購商品與服務', FALSE, 'kg',   NULL),
('3-1-D',  '採購塑料袋 Polybag',   'Purchased Goods - Polybag',                 3, '採購商品與服務', FALSE, 'kg',   NULL),
('3-1-E',  '採購水資源',           'Purchased Goods - Water Supply',            3, '採購商品與服務', FALSE, 'm3',   NULL),

-- ─── 範疇三 3.3：燃料及能源相關 ────────────────────────────────
('3-3-A',  'T&D損失',             'T&D Loss',                                   3, '燃料及能源相關', FALSE, 'kWh',  NULL),

-- ─── 範疇三 3.4：上游運輸 ──────────────────────────────────────
('3-4-A',  '上游運輸-陸運',       'Upstream Transport - Road',                  3, '上游運輸',       FALSE, 'tonne-km', NULL),
('3-4-B',  '上游運輸-海運',       'Upstream Transport - Sea',                   3, '上游運輸',       FALSE, 'tonne-km', NULL),
('3-4-C',  '上游運輸-空運',       'Upstream Transport - Air',                   3, '上游運輸',       FALSE, 'tonne-km', NULL),

-- ─── 範疇三 3.5：廢棄物處理 ────────────────────────────────────
('3-5-A',  '成衣廢棄物-焚化',     'Garment Waste - Incineration',              3, '廢棄物處理',     FALSE, 'kg',   NULL),
('3-5-B',  '工業廢棄物-焚化',     'Industrial Waste - Incineration',           3, '廢棄物處理',     FALSE, 'kg',   NULL),
('3-5-C',  '有機廢棄物-厭氧消化', 'Organic Waste - Anaerobic Digestion',       3, '廢棄物處理',     FALSE, 'kg',   NULL),
('3-5-D',  '塑膠廢棄物-開環回收', 'Plastic Waste - Open Loop Recycling',       3, '廢棄物處理',     FALSE, 'kg',   NULL),
('3-5-E',  '工業廢棄物-掩埋',     'Industrial Waste - Landfill',               3, '廢棄物處理',     FALSE, 'kg',   NULL),
('3-5-F',  '成衣廢棄物-回收',     'Garment Waste - Recycling',                 3, '廢棄物處理',     FALSE, 'kg',   NULL),
('3-5-G',  '廢水處理',            'Wastewater Treatment',                      3, '廢棄物處理',     FALSE, 'm3',   NULL),

-- ─── 範疇三 3.6：商務旅行 ──────────────────────────────────────
('3-6-A',  '商務旅行-飛機出差',   'Business Travel - Air',                     3, '商務旅行',       FALSE, 'km',   NULL),
('3-6-B',  '商務旅行-飯店住宿',   'Business Travel - Hotel Stay',              3, '商務旅行',       FALSE, 'room-night', NULL),

-- ─── 範疇三 3.7：員工通勤 ──────────────────────────────────────
('3-7-A',  '員工通勤（混合）',    'Employee Commuting - Mixed',                3, '員工通勤',       FALSE, 'km',   NULL),
('3-7-B',  '員工通勤-汽車',       'Employee Commuting - Car',                  3, '員工通勤',       FALSE, 'km',   NULL),
('3-7-C',  '員工通勤-機車',       'Employee Commuting - Motorcycle',           3, '員工通勤',       FALSE, 'km',   NULL),
('3-7-D',  '員工通勤-公車',       'Employee Commuting - Bus',                  3, '員工通勤',       FALSE, 'km',   NULL),
('3-7-E',  '員工通勤-電動腳踏車', 'Employee Commuting - E-Bike',               3, '員工通勤',       FALSE, 'km',   NULL),

-- ─── 範疇三 3.9：下游運輸 ──────────────────────────────────────
('3-9-A',  '下游運輸-陸運',       'Downstream Transport - Road',               3, '下游運輸',       FALSE, 'tonne-km', NULL),
('3-9-B',  '下游運輸-空運',       'Downstream Transport - Air',                3, '下游運輸',       FALSE, 'tonne-km', NULL),
('3-9-C',  '下游運輸-海運',       'Downstream Transport - Sea',                3, '下游運輸',       FALSE, 'tonne-km', NULL);

-- =============================================================
-- V2  種子資料 — 23 個廠別
-- =============================================================

INSERT INTO factories (factory_code, name_zh, name_en, country_code, region, is_verified) VALUES
-- 台灣
('TWN_TPE', '台北總部',          'Taipei HQ',                 'TWN', '台灣',   TRUE),
('TWN_CHY', '嘉義廠',            'Chiayi Factory',            'TWN', '台灣',   TRUE),
('TWN_ECO', '聚益+吉時',         'Juyi + Jishi',              'TWN', '台灣',   TRUE),
-- 柬埔寨
('CAB_MK1', 'MK1 柬埔寨',        'MK1 Cambodia',              'CAB', '柬埔寨', TRUE),
('CAB_MK2', 'MK2 柬埔寨 Branch 1','MK2 Cambodia Branch 1',   'CAB', '柬埔寨', TRUE),
('CAB_MK5', 'MK5 柬埔寨 Branch 3','MK5 Cambodia Branch 3',   'CAB', '柬埔寨', TRUE),
('CAB_MOHA','MOHA 柬埔寨',        'MOHA Cambodia',             'CAB', '柬埔寨', TRUE),
-- 中國
('CHN_JY',  '佳陽廠',            'Jiayang Factory',           'CHN', '中國',   TRUE),
('CHN_HY',  '海鹽廠',            'Haiyan Factory',            'CHN', '中國',   TRUE),
('CHN_SH',  '上海聚陽+理陽',     'Shanghai Juyang+Liyang',    'CHN', '中國',   TRUE),
('CHN_JY_SP','佳陽樣品中心',     'Jiayang Sample Center',     'CHN', '中國',   TRUE),
-- 印尼
('IND_GLR1','Glory Semarang',    'Glory Semarang',            'IND', '印尼',   TRUE),
('IND_STL', 'Starlight Semarang','Starlight Semarang',        'IND', '印尼',   TRUE),
('IND_DMK', 'Glory Demak',       'Glory Demak',               'IND', '印尼',   TRUE),
('IND_GLS', 'Glory Sragen',      'Glory Sragen',              'IND', '印尼',   TRUE),
('IND_GLR2','Glory Semarang II', 'Glory Semarang II',         'IND', '印尼',   TRUE),
-- 北越
('NVN_MK1', 'MK1 北越',          'MK1 North Vietnam',         'NVN', '北越',   TRUE),
('NVN_MK2', 'MK2/3 北越',        'MK2/3 North Vietnam',       'NVN', '北越',   TRUE),
('NVN_HN',  '河內辦公室',        'Hanoi Office',              'NVN', '北越',   FALSE),
-- 南越
('SVN_LDR', 'Leader 南越',       'Leader South Vietnam',      'SVN', '南越',   TRUE),
('SVN_TRP', 'Triple 南越',       'Triple South Vietnam',      'SVN', '南越',   TRUE),
-- 薩爾瓦多
('SLV_MK',  'El Salvador',       'El Salvador',               'SLV', '薩爾瓦多',TRUE),
-- 孟加拉
('BGD_MK',  'Bangladesh',        'Bangladesh',                'BGD', '孟加拉', TRUE);

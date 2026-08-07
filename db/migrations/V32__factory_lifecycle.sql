-- =============================================================
-- V32  工廠／排放源生命週期：把「順序、啟用狀態、國家標籤、CSR 對照」搬進 DB
--
--   目的：讓「新增／移除工廠」與「新增／停用排放源」不再需要改程式碼。
--         在此之前，這些資訊硬編碼在至少 5 個檔案裡（FACTORY_ORDER 兩份、
--         COUNTRY_LABELS 四份、CSR_FACTORY_MAP 一份），漏改一處彙整表就會漏廠。
--
--   設計要點：
--     1. 純加法：全部 ADD COLUMN IF NOT EXISTS + 具預設值，既有查詢行為完全不變。
--     2. display_order 預設 999 = 「未排序者一律排最後」，語意等同原先
--        「不在 FACTORY_ORDER 清單裡的接在後面」。已排序者用 10 的倍數，留插入空隙。
--     3. countries 不對 factories.country_code 加 FK：現階段加只會在新增國家時卡住，
--        改靠 admin 下拉選單約束，查詢端用 COALESCE(c.name_zh, f.country_code) 保底。
--     4. 本檔不刪任何資料、不改任何既有欄位值以外的東西。套用後前端一行未改，
--        網站行為必須完全不變 —— 這是這支 migration 的驗收條件。
-- =============================================================

-- 1. factories 生命週期欄位 -------------------------------------
ALTER TABLE factories
    ADD COLUMN IF NOT EXISTS display_order INT     NOT NULL DEFAULT 999,
    ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS closed_at     DATE,
    ADD COLUMN IF NOT EXISTS notes         TEXT;

COMMENT ON COLUMN factories.is_active IS
    '是否仍在營運。停用（FALSE）不影響歷史 activity_records，舊年度彙整表仍應列示該廠。';
COMMENT ON COLUMN factories.closed_at IS '停用/關廠生效日；供「該年度是否列示」判斷用。';

-- 2. emission_sources 生命週期欄位 -------------------------------
--    is_active = 全集團閘門（這個排放源還存不存在）；
--    factories.source_config = 單廠訂閱。兩者職責不同，停用時絕不去改任何廠的 source_config。
ALTER TABLE emission_sources
    ADD COLUMN IF NOT EXISTS display_order  INT     NOT NULL DEFAULT 999,
    ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS deprecated_at  DATE;

COMMENT ON COLUMN emission_sources.is_active IS
    '全集團層級閘門。有效排放源 = 該廠 source_config 已訂閱 AND is_active。停用不改 source_config。';

-- emission_sources 不做 display_order backfill：全部維持 999，
-- 排序改為 (scope, display_order, source_code) 後結果與原本 (scope, source_code) 完全相同。

-- 3. 國家標籤與順序 ---------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
    country_code  VARCHAR(10) PRIMARY KEY,
    name_zh       VARCHAR(50) NOT NULL,
    name_en       VARCHAR(50),
    display_order INT         NOT NULL DEFAULT 999,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE
);

-- 順序採「集團碳排彙整表」那一份（V23/a486835/f124249 三次 commit 刻意調校過的產區順序）。
-- 註：首頁 app/page.tsx 原本用另一份字典序 COUNTRY_ORDER，改由本表驅動後會統一成這個順序。
INSERT INTO countries (country_code, name_zh, name_en, display_order) VALUES
    ('TWN', '台灣',     'Taiwan',      10),
    ('IND', '印尼',     'Indonesia',   20),
    ('NVN', '北越',     'North Vietnam', 30),
    ('SVN', '南越',     'South Vietnam', 40),
    ('CAB', '柬埔寨',   'Cambodia',    50),
    ('CHN', '中國',     'China',       60),
    ('SLV', '薩爾瓦多', 'El Salvador', 70),
    ('BGD', '孟加拉',   'Bangladesh',  80)
ON CONFLICT (country_code) DO UPDATE
    SET name_zh       = EXCLUDED.name_zh,
        name_en       = EXCLUDED.name_en,
        display_order = EXCLUDED.display_order;

-- 4. factories.display_order backfill ---------------------------
--    取自 apps/web/src/lib/summary-data.ts 的 FACTORY_ORDER 現有順序。
--    原清單中的 CAB_MK1/CAB_MK2/CAB_MK5/NVN_MK1/NVN_MK2/CHN_HY 已於 V23 合併刪除，
--    這裡自然不會 match，順勢清掉那筆死債。
UPDATE factories SET display_order = v.ord
  FROM (VALUES
    ('TWN_TPE',   10), ('TWN_CHY',   20), ('TWN_ECO',   30),
    ('IND_DMK',   40), ('IND_GLR1',  50), ('IND_GLR2',  60),
    ('IND_GLS',   70), ('IND_STL',   80),
    ('NVN_MK',    90), ('NVN_HN',   100),
    ('SVN_LDR',  110), ('SVN_TRP',  120),
    ('CAB_MOHA', 130), ('CAB_MK',   140),
    ('CHN_JY',   150), ('CHN_MZ',   160), ('CHN_JY_SP', 170), ('CHN_SH', 180),
    ('SLV_MK',   190),
    ('BGD_MK',   200)
  ) AS v(code, ord)
 WHERE factories.factory_code = v.code;

-- 5. CSR 檔廠名 ↔ factory_code 對照 ------------------------------
--    用獨立對照表而非在 factories 加單一欄位，因為對應是「多對一」
--    （CAB|MK1/MK2/MK5 → CAB_MK；Taiwan|吉時 + Taiwan|聚益 → TWN_ECO），
--    且 key 是二元組（csr_country + csr_factory）。
--    is_ignored = 刻意略過（已關廠等），用來區分「該略過」與「漏設定」——
--    原本兩者都只是「不在 map 裡」，匯入時靜默跳過、無從察覺。
CREATE TABLE IF NOT EXISTS factory_csr_aliases (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    csr_country  VARCHAR(50) NOT NULL,
    csr_factory  VARCHAR(100) NOT NULL,
    factory_code VARCHAR(20) REFERENCES factories(factory_code) ON UPDATE CASCADE,
    is_ignored   BOOLEAN     NOT NULL DEFAULT FALSE,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_csr_alias UNIQUE (csr_country, csr_factory),
    -- 不是略過的，就一定要指到某個廠
    CONSTRAINT ck_csr_alias_target CHECK (is_ignored OR factory_code IS NOT NULL)
);

-- factory_code 目前無 UNIQUE 以外的索引需求；FK 需要被參照欄位有唯一性（V1 已有 UNIQUE）。
INSERT INTO factory_csr_aliases (csr_country, csr_factory, factory_code, is_ignored, note) VALUES
    ('BGD',      'MK',            'BGD_MK',    FALSE, NULL),
    ('CAB',      'MK1',           'CAB_MK',    FALSE, 'V23 合併：MK1/MK2/MK5 → CAB_MK，匯入時加總'),
    ('CAB',      'MK2',           'CAB_MK',    FALSE, 'V23 合併'),
    ('CAB',      'MK5',           'CAB_MK',    FALSE, 'V23 合併'),
    ('CAB',      'MOHA',          'CAB_MOHA',  FALSE, NULL),
    ('CHN',      'JY',            'CHN_JY',    FALSE, NULL),
    ('CHN',      'MZ',            'CHN_MZ',    FALSE, NULL),
    ('CHN',      '佳陽樣品中心',   'CHN_JY_SP', FALSE, NULL),
    ('CHN',      'Shanghai',      'CHN_SH',    FALSE, '上海聚陽 + 理陽 → CHN_SH'),
    ('Shanghai', '理陽',           'CHN_SH',    FALSE, '上海聚陽 + 理陽 → CHN_SH'),
    ('IND',      'Demak',         'IND_DMK',   FALSE, NULL),
    ('IND',      'GLR1',          'IND_GLR1',  FALSE, NULL),
    ('IND',      'GLR2',          'IND_GLR2',  FALSE, NULL),
    ('IND',      'Sargen',        'IND_GLS',   FALSE, 'CSR 檔拼字為 Sargen（實為 Sragen）'),
    ('IND',      'Starlight',     'IND_STL',   FALSE, NULL),
    ('NVN',      'MK1',           'NVN_MK',    FALSE, 'V23 合併：MK1/MK2 → NVN_MK，匯入時加總'),
    ('NVN',      'MK2',           'NVN_MK',    FALSE, 'V23 合併'),
    ('NVN',      '河內辦公室',     'NVN_HN',    FALSE, NULL),
    ('SLV',      'MK',            'SLV_MK',    FALSE, NULL),
    ('SVN',      'Leader',        'SVN_LDR',   FALSE, NULL),
    ('SVN',      'Triple',        'SVN_TRP',   FALSE, NULL),
    ('Taiwan',   'Chiayi',        'TWN_CHY',   FALSE, NULL),
    ('Taiwan',   'TPE',           'TWN_TPE',   FALSE, NULL),
    ('Taiwan',   '吉時',           'TWN_ECO',   FALSE, '吉時 + 聚益 → TWN_ECO'),
    ('Taiwan',   '聚益',           'TWN_ECO',   FALSE, '吉時 + 聚益 → TWN_ECO'),
    -- 刻意略過（原本只是「不在 map 裡」，現在明確記錄）
    ('CHN',      'JR',            NULL,        TRUE,  '已關廠'),
    ('PHL',      'LR1',           NULL,        TRUE,  '已關廠'),
    ('PHL',      'LR2',           NULL,        TRUE,  '已關廠'),
    ('SVN',      '南越樣品中心',   NULL,        TRUE,  '樣品中心，不納入盤查')
ON CONFLICT (csr_country, csr_factory) DO NOTHING;

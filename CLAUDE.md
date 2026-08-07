# GHG 碳盤查平台 — 專案指引

> 這份檔案會被 Claude Code 自動載入。接手維護這個平台的人，開 Claude Code 之後
> 不必先讀完再問，直接講你要做什麼即可，Claude 會依這裡的規則行動。
>
> 相關文件：
> - [`README.md`](README.md) — 怎麼安裝、跑起來、部署
> - [`docs/維運手冊.md`](docs/維運手冊.md) — 日常維運「點哪裡」的操作步驟（不需要懂程式）
> - [`docs/請Claude做的事.md`](docs/請Claude做的事.md) — 常用指令範本，以及哪些事不能自己動
>
> ⚠️ 上層資料夾的 `CLAUDE.md.md` 與 `GHG_AGENTS.md` 是 2025 年的初期規劃稿，
> 內容（23 廠、Azure 部署、Phase 2 未完成等）已與現況不符，僅供查閱歷史決策，
> **不要當成現況依據**。以本檔為準。

---

## 這是什麼

聚陽實業（Makalot）永續發展部的溫室氣體盤查平台。20 個跨國廠別的同仁透過瀏覽器
逐月填報活動數據，系統自動套用排放係數算出 CO₂e，產出集團碳排彙整表、盤查清冊
Excel、減碳績效追蹤。盤查標準為 GHG Protocol / ISO 14064-1:2018，GWP 採 IPCC AR6。

**⚠️ 所有產出屬草稿性質，最終數字需永續發展部及外部查證單位確認，不下最終結論。**

---

## 架構地圖

```
ghg-platform/
├── apps/web/              Next.js 15（App Router）— 前端 + API，主要都在這
│   └── src/
│       ├── app/           頁面與 API route
│       ├── lib/           資料層與計算邏輯（改東西前先看這裡）
│       └── components/    共用元件與圖表
├── apps/agents/           Python FastAPI 計算 agent（目前主線未依賴）
├── db/migrations/         V<n>__*.sql，資料庫變更的唯一正式管道
├── scripts/               migrate.mjs（正式）、inspect-registry.mjs、verify-v32.mjs
└── docs/                  維運手冊與 Claude 指令範本
```

**沒有 ORM，全部是手寫 SQL。** `apps/web/src/lib/db.ts` 匯出 `query(text, params)`，
所有查詢都走這裡。

### 主要頁面

| 路徑 | 用途 |
|------|------|
| `/` | 廠別入口，點進去填報 |
| `/fill/[factory_code]` | 各廠逐月填報 |
| `/summary` | 集團碳排彙整表 |
| `/dashboard` | 碳排儀表板 |
| `/reduction` | 減碳績效追蹤（S1/S2、綠電占比、減碳路徑） |
| `/admin/factories` | **工廠、產區、CSR 廠名對照維護** |
| `/admin/factors` | 排放係數維護（含整年複製到新年度） |
| `/admin/anomaly` | 異常提醒 |

### 資料流

```
填報 (/fill) → activity_records → lib/co2e-calc.ts 算 co2e
                                → annual_metrics
                                → /summary、/dashboard、/reduction
                                → Excel 匯出（/api/reports/inventory、/api/reduction/export）
```

---

## 鐵則（違反會出事）

### 1. 改完程式碼一定要三步驟
```bash
npm run build && pm2 restart ghg-platform && git push
```
在 `apps/web/` 下執行。`deploy.bat` 有包好前兩步。平台跑在 http://192.168.6.102:3000。

> dev server 開著的時候 `npm run build` 會和它搶 `.next` 目錄（症狀：
> `Compiled successfully` 之後冒出 `Cannot find module for page`）。
> 這時用 `NEXT_DIST_DIR=.next-build npm run build` 輸出到別的目錄。

### 2. 資料庫變更只走 `scripts/migrate.mjs`
```bash
node scripts/migrate.mjs --dry-run   # 先看會跑哪些，不寫入
node scripts/migrate.mjs             # 套用未套用的
```
- 檔名必須是 `V<數字>__說明.sql`，放 `db/migrations/`
- 已套用的 migration **絕對不要修改內容**，要改就寫新的一支
- 舊的 `apps/web/migrate.mjs` 已刪除（字串排序、無版本追蹤、會吞錯誤，
  正是 `V28__cleanup_resurrected_sources.sql` 在收拾的那個 bug 來源）

### 3. 改排放係數後，舊記錄不會自動重算
`recalculate` 只補 `co2e` 為 NULL 的記錄。改了係數要讓舊資料跟著變，必須
**先把受影響記錄的 co2e 欄位設成 NULL，再跑 recalculate**，否則畫面會顯示
0 或舊值，而且不會報錯。

### 4. 範疇二 iREC 走「年度基礎分攤」
market = (年度電量 − 年度 REC) 再按各月電量占比分攤，不是逐月扣抵。
**電量或 REC 任一有異動，必須呼叫 `recomputeScope2ForFactoryYear` 整年重算**，
只改當月會算錯。

### 5. 生質 CO₂ 獨立揭露，不計入範疇一
- 生質燃料的 **CO₂** 存 `co2e_biomass_co2`，不進 Scope 1 總量
- 生質燃料的 **CH₄ / N₂O 照常計入** Scope 1
- 填報頁的 `computeGas(tabTypes)` 必須與伺服器端 `lib/co2e-calc.ts` 對齊，
  兩邊算法不一致會出現「畫面一個數字、報表另一個數字」

### 6. 改填報頁查詢欄位要同步 API
改了 `app/fill/[factory_code]/page.tsx` 的記錄查詢欄位，
**必須同步改 `GET /api/records`**，否則切分頁後會出現鬼影歸零。

### 7. 工廠順序與產區標籤一律查 DB，不要再寫常數
順序來自 `factories.display_order` + `countries.display_order`，標籤來自
`countries.name_zh`，由 `/admin/factories` 維護。
- server 端：`lib/factory-registry.ts` 的 `getFactories()` / `getCountryLabels()`
- client 端：由 server 傳 `countries` prop，配 `lib/registry-types.ts` 的
  `countryLabelsOf()` / `orderCountryCodes()`

2026-08 之前這些常數硬編碼在 6 個檔案裡而且彼此不一致，新增一個廠要手改多處，
漏一處彙整表就會漏廠。**不要走回頭路。**

### 8. 停用工廠 ≠ 刪除工廠
已盤查年度不因之後關廠而回溯變動。`/admin/factories` 的「停用」會讓該廠從填報
入口與異常檢查消失，但**歷史年度的彙整表與報表仍照常列出**。硬刪只允許用在誤建
（無任何填報記錄與 iREC），有資料時 API 會回 409。

合併廠（例如 CAB_MK1/2/5 → CAB_MK）**不做成 UI**，牽涉跨表 repoint 與去重判斷，
維持寫一支 migration 的做法，參考 `db/migrations/V23__merge_factories.sql`。

---

## 資料庫重點表

| 表 | 說明 |
|----|------|
| `factories` | 廠別主檔。`display_order` 決定顯示順序，`is_active` 為停用旗標 |
| `countries` | 產區中英文名與順序，首頁/彙整表/減量頁共用這一份 |
| `emission_sources` | 排放源主檔（代碼如 `1-1A-1`）。`is_active` 為全集團閘門 |
| `emission_factors` | 排放係數（年度 × 國家）。`emission_factor_assignments` 可指定適用廠別 |
| `activity_records` | 核心填報表。同廠同源同月**允許多筆**（多張電費單、多台車） |
| `rec_certificates` | iREC 憑證，影響範疇二 market-based |
| `csr_energy` / `csr_production` | CSR 明細表匯入的能源與產量 |
| `factory_csr_aliases` | CSR 檔廠名 → 廠代碼（多對一，`is_ignored` 表刻意略過） |
| `anomaly_flags` | 異常提醒標記 |
| `annual_metrics` | 年度指標（營業額等） |
| `schema_migrations` | migrate.mjs 的版本追蹤，不要手動改 |

`emission_sources.is_active`（全集團這個源還存不存在）與
`factories.source_config`（這個廠有沒有訂閱）是兩件事，
**有效排放源 = 兩者交集**。停用排放源時絕不去改任何廠的 `source_config`。

---

## 業務規則

1. **多筆填報允許**：同廠 + 同排放源 + 同年月可有多筆
2. **計算欄唯讀**：`co2e_location` / `co2e_market` / `co2e_total` 由後端算，前端不可輸入
3. **係數版本鎖定**：記錄鎖定時寫入當時的 `emission_factor_id`，確保稽核可追溯
4. **REC 不可使排放為負**：market-based 電力排放最低為 0
5. **中國產區用市場剩餘係數**：`(用電量 − REC量) × 市場剩餘係數`，與其他產區不同

### 各產區電力係數來源
| 產區 | 來源 |
|------|------|
| TWN | 台灣電力公司（每年更新） |
| CHN | 中國官方市場剩餘電力排放係數 |
| NVN / SVN | 越南環境部公告 |
| IND | 印尼政府公告 |
| CAB / SLV / BGD | UNFCCC IFI Dataset |

---

## 環境變數（`apps/web/.env.local`）

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | Postgres 連線字串 |
| `DATABASE_SSL` | Neon 等雲端 DB 不設或設 `true`；**內網自架 Postgres 要設 `false`** |

`.env.local` 不進版控。密碼循公司密碼保管流程，不要寫進任何檔案或 commit。

---

## 寫程式時的取捨

- **先讀再寫**：改之前先看該檔的 exports、誰在呼叫、有沒有現成的工具函式
- **外科手術式修改**：只動該動的，比照既有風格，不順手重構無關程式碼
- **大聲失敗**：不確定就講出來，不要默默猜。邊界情況沒驗證就不要宣稱做完
- **慣例優先**：這個專案手寫 SQL、`{ data, error }` 統一回應格式、zod 驗證輸入，
  跟著做，不要引入 ORM 或新的錯誤格式
- **改到報表輸出前先存基準**：`/summary` 與 `/api/reports/inventory` 是對外報表，
  動之前先匯出一份存檔，改完逐欄比對

---

## 組織規範（Makalot）

- 所有 AI 產出僅供參考，需經人工複核
- 嚴禁把客戶 tech pack、報價、成本、訂單、個資寫入提示或 commit
- 涉及法務、財務、ESG、對外文件，一律標示「需相關部門確認」，不下最終結論
- 日期格式 `YYYY-MM-DD`；金額附幣別；數量/尺寸附單位

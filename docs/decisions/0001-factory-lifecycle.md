# 0001 - 工廠生命週期可維運化

- 日期：2026-08-07
- 狀態：已部署
- 相關 migration / commit：`V32__factory_lifecycle.sql`，commits c56b40f→0589f3f

## 背景

工廠順序與產區標籤原本硬編碼在 6 個檔案，彼此不一致，新增或調整一個廠要手改多處，
漏一處彙整表就會漏廠。目標是「Elodie 不在時系統仍能運作」——日常的增減廠不該需要改程式碼。

## 決定

- 工廠順序與產區標籤一律查 DB（`factories.display_order` + `countries.display_order` +
  `countries.name_zh`），由新頁面 `/admin/factories` 維護
- 新增 `countries`、`factory_csr_aliases` 兩張表
- 移除工廠一律用停用（`is_active=false`），不做刪除；歷史年度彙整表不回溯變動
- 合併廠不做成 UI，維持寫 migration 的做法（比照 `V23__merge_factories.sql`）
- `factory_code` 建立後不可改（是多處對照的天然 key）

## 為什麼

停用而非刪除，是因為已盤查年度的揭露要求「不因之後關廠而少一個廠」。
合併廠不做 UI 是因為牽涉跨表 repoint 與去重判斷，風險高於用途，寧可留給人審過的
一次性 migration。

## 現在還沒做的

- `/admin/factories` 等 admin API 目前完全沒有權限檢查（`middleware.ts` 非 production
  全放行）
- 沒有變更稽核 log（誰、何時停用了哪個廠）——ESG 稽核軌跡會需要
- `pg_dump` 在部署機器被 OS 擋，DB 備份要請 IT 排除或改用雲端 DB 內建 point-in-time restore

詳見 [`../待辦與已知缺口.md`](../待辦與已知缺口.md)。

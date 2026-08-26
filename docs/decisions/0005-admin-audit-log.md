# 0005 - 變更稽核 log

- 日期：2026-08-26
- 狀態：已部署
- 相關 migration / commit：`V65__admin_audit_log.sql`；`apps/web/src/lib/audit.ts`；
  18 個 `api/admin/**/route.ts` 補寫入點

## 背景

[0001](0001-factory-lifecycle.md) 上線時就列了這個缺口：「無變更稽核 log（誰、何時停用了哪個
廠）」。工廠、排放源、係數這類設定改錯或被誰動過，之前完全查不出來——只能問記憶或猜。
ESG 查證單位問起「這個數字為什麼變了」時，答不出來。

## 決定

- 新表 `admin_audit_log`（`actor_user_id`/`actor_email`、`action`、`entity_type`、`entity_id`、
  `before`/`after` jsonb、`created_at`）
- `lib/audit.ts` 的 `logAdminChange()`：所有 admin route 的 create/update/delete 一律呼叫，
  寫入失敗只 log 不擋主要操作（稽核記不到比設定改不成輕微）
- 涵蓋範圍：`factories`（含 reorder）、`countries`、`csr-aliases`、`emission-sources`、
  `emission-factors`（含 assignments、copy-year、copy-to-next-year）、`substance-gwp`、
  `report-years`、`factory-settings`、`anomaly`（含 run，記為 action='run'）
- 停用/刪除等操作額外多查一次「改之前」的資料（`before`），才能回答「原來是什麼、被改成什麼」，
  不是只留「誰在什麼時候動了這個 id」

## 為什麼

選擇「每個 route 各自呼叫」而不是資料庫層 trigger：這個專案沒有 ORM、全部手寫 SQL，
trigger 會讓「誰改的」（`actor_user_id`）這個資訊在 SQL 層拿不到——連線是共用的 DB 使用者，
不是每個 HTTP 請求對應一個 DB session。只能在 route handler 裡有 `requireAdmin()` 回傳的
使用者身分時記錄，所以稽核邏輯只能長在應用層。

## 現在還沒做的

- 沒有前端頁面可以「看」這份 log，目前只能直接查 DB（`SELECT * FROM admin_audit_log ORDER BY
  created_at DESC`）。要不要做一個 `/admin/audit-log` 頁面看使用頻率再決定，先求「查得到」。
- 一般填報記錄（`activity_records`）的異動不在這裡記——那邊已經有 `created_by`/
  `reviewed_by`（V40/V41），性質不同，不重複做一套。

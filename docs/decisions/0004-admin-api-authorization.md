# 0004 - Admin API 補角色權限檢查

- 日期：2026-08-26
- 狀態：已部署
- 相關 migration / commit：無新 migration，純程式碼變更（`apps/web/src/lib/session.ts` +
  18 個 `api/admin/**/route.ts`）

## 背景

`middleware.ts` 在 production 只檢查「有沒有登入」，不檢查角色。18 個 admin route 檔案
（`factories`、`factors`、`emission-sources`、`countries`、`csr-aliases`、`anomaly` 等，
共 33 個 handler）裡只有 `factory-settings` 一支會呼叫 `requireAdmin()`，其餘完全沒有
授權檢查——任何登入帳號（包含未來可能建立的 `reporter` 角色）都能改工廠、係數、排放源設定。
目前 4 個帳號都是 admin，實際曝險低，但這是設計上的缺口，不該等到有 reporter 帳號才修。

## 決定

- `lib/session.ts` 新增共用的 `authErrorResponse(err)`，把 `AuthError` 轉成
  `{ data: null, error }` 回應，避免每個 route 各寫一份 `authFail` 
- 18 個 admin route 檔案的每個 handler（GET/POST/PATCH/PUT/DELETE）開頭一律
  `try { await requireAdmin() } catch (err) { return authErrorResponse(err) }`
- `anomaly/run` 也納入：確認它只被瀏覽器端的 `/admin/anomaly` 頁面呼叫，
  CSR 匯入流程是直接呼叫 `runAnomalyRules()` 函式而非打這支 API，沒有 cron/server-to-server
  呼叫會被這個改動擋掉

## 為什麼

選擇「每個 route 各自呼叫 requireAdmin()」而不是在 `middleware.ts` 用路徑比對做角色檢查，
是因為 middleware 跑在 Edge Runtime，不能載入 `lib/auth.ts`（bcrypt/pg 在 Edge 下不可用），
只能讀 JWT token 是否存在，讀不到 role 判斷以外更細的邏輯很勉強；而 route handler 本來就在
Node runtime，`requireAdmin()` 已經是專案既有慣例（`factory-settings` 已這樣做），比較不
容易寫錯或漏掉。

## 現在還沒做的

- `canAccessFactory` / `requireFactoryAccess`（reporter 只能存取自己綁定廠）仍只在少數
  route 套用，多數 route 尚未逐一驗證（`session.ts` 原有註解已提過，這次沒有處理，
  範圍不同：這次只補 admin vs 非 admin，不是廠別隔離）
- 仍無變更稽核 log（誰改了哪個廠/係數），見 [0001](0001-factory-lifecycle.md)

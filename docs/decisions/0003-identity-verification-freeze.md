# 0003 - 身分層 + 查證封存

- 日期：2026-08-11（動工），Phase 2 deadline 2026-08-17，全案 deadline 2026-08-30
- 狀態：已套用未部署（DB migration 已跑，尚未 build + pm2 restart + push）
- 相關 migration / commit：`V40__user_identity.sql`、`V41__verification_freeze.sql`

## 背景

平台原本是硬寫的共用帳號登入（`admin` / `ghg2025`），`users` 表 0 列。
241 筆填報記錄的 `created_by` 全空，176 筆已檢核的記錄查不出是誰檢核的。
查證封存（把一段時間的數據鎖定為對外揭露版本）必須能回答「這份資料誰封的」，
身分是封存的前置條件，所以先做身分層再做封存。

## 決定

- `users` 表加 `role` / `factory_id` / `can_freeze` / `password_hash`
- 新表 `verification_periods` + `activity_records_verified` + `activity_line_items_verified`
- `lib/auth.ts` 改用 email + bcrypt 查 `users` 表；新增 `lib/session.ts`
- `can_freeze` 只給 Elodie Cheng 與 Johnson Lin 兩人（第二人是為了避免單點失效——
  其中一人休假或離職時仍有人能封存）
- 登入是過渡方案，最終走 Azure AD SSO，屆時 `authorize()` 換掉、`password_hash` 設 NULL，
  帳號與所有關聯記錄不需搬移

## 為什麼

先身分後封存的順序不能顛倒：封存記錄的「reviewed_by」需要指向真實使用者，
若倒過來做，封存後才發現使用者對不上，等於重做。
email+密碼是已知會被 SSO 取代的暫時方案，選它是因為 Azure AD 對接時程未知，
不能讓查證封存卡在等 IT 排 SSO。

## 現在還沒做的（部署前必讀）

**部署順序不可顛倒**：硬寫帳密已從 `lib/auth.ts` 移除，必須先
`node scripts/create-user.mjs --init` 建四個帳號（Elodie / Johnson Lin / Kelly Lin /
Meng-Ying Hong，需人工輸入密碼），再跑 `backfill-reviewed-by.mjs`，最後才
build + pm2 restart + push。順序錯了登入頁會沒有帳號可用。

設計細節查 `溫盤\ghg-platform\數據覆蓋與查證封存_設計文件.md`（v1.2）。
**v1.0 曾有 8 處與實際程式碼不符** —— 若這份文件之後又與程式碼出現落差，
表示同步流程失效，應在這裡（或 `待辦與已知缺口.md`）記一筆，而不是默默改程式碼了事。

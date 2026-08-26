# 0002 - migrate.mjs 改版本追蹤

- 日期：2026-07-31
- 狀態：已部署
- 相關 migration / commit：`scripts/migrate.mjs` 改寫；`V28__cleanup_resurrected_sources.sql`

## 背景

舊版 `migrate.mjs` 每次全量重跑、用字串排序、遇錯會吞掉不中斷。字串排序讓
`V10` 排到 `V1` 之前、`V22` 排到 `V2`/`V3` 之前；`seed`（`V3`/`V8`，`ON CONFLICT DO NOTHING`）
在 `delete`（`V10`/`V25`）之後跑，會把已經刪除的排放源復活（例如焊條 `1-3A-2`）。

## 決定

- 新增 `schema_migrations(version TEXT PK, applied_at)`，只跑未套用的檔
- 依 `V<數字>__` 的數字排序，不再用字串排序
- 三種模式：預設 apply（逐檔交易、失敗即 rollback）、`--dry-run`、`--backfill`
- 正式 DB 已用 `--backfill` 標記 V1–V27 為已套用，並實際套用 V28 做冪等清除

## 為什麼

字串排序 bug 是靜默的（不報錯、只是資料錯），且會反覆發生在每次新增兩位數以上版本號時，
必須從排序邏輯根治，不能靠命名規範自律避免。

## 現在還沒做的

- 沒有測試覆蓋排序邏輯本身（目前靠 `--dry-run` 人工檢查 pending 順序）

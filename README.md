# GHG 碳盤查平台

聚陽實業永續發展部的溫室氣體盤查平台。20 個跨國廠別逐月填報活動數據，系統套用
排放係數算出 CO₂e，產出集團碳排彙整表、盤查清冊 Excel 與減碳績效追蹤。

盤查標準：GHG Protocol / ISO 14064-1:2018，GWP 採 IPCC AR6。

> ⚠️ 平台產出屬草稿性質，最終數字需永續發展部及外部查證單位確認。

**接手維護請先看：**
- [`CLAUDE.md`](CLAUDE.md) — 專案規則與鐵則（Claude Code 會自動載入）
- [`docs/維運手冊.md`](docs/維運手冊.md) — 日常維運操作（不需要懂程式）
- [`docs/請Claude做的事.md`](docs/請Claude做的事.md) — 常用指令範本

---

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 + API | Next.js 15（App Router）、React 19、TypeScript、Tailwind |
| 資料庫 | PostgreSQL（手寫 SQL，無 ORM，用 `pg`） |
| 登入 | next-auth |
| Excel | `xlsx` |
| 程序管理 | pm2（app 名稱 `ghg-platform`） |

---

## 目錄結構

```
apps/web/          Next.js 前端 + API（主要都在這）
apps/agents/       Python FastAPI 計算 agent（主線未依賴）
db/migrations/     V<n>__*.sql 資料庫變更
scripts/           migrate.mjs 等維運腳本
docs/              維運手冊
```

---

## 本機開發

需求：Node.js 20+、可連線的 PostgreSQL。

```bash
cd apps/web
npm install
```

建立 `apps/web/.env.local`：

```
DATABASE_URL=postgresql://使用者:密碼@主機:5432/資料庫名
DATABASE_SSL=true
NEXTAUTH_SECRET=請自行產生
NEXTAUTH_URL=http://localhost:3000
```

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | Postgres 連線字串 |
| `DATABASE_SSL` | Neon 等雲端 DB 設 `true`；**內網自架 Postgres 要設 `false`** |

> `.env.local` 不進版控。密碼請循公司密碼保管流程取得，不要寫進任何檔案或 commit。

套用資料庫結構：

```bash
node scripts/migrate.mjs --dry-run
```
```bash
node scripts/migrate.mjs
```

啟動：

```bash
cd apps/web && npm run dev
```

開 http://localhost:3000。

---

## 部署

平台跑在 **http://192.168.6.102:3000**，由 pm2 管理。

```bash
cd apps/web && npm run build && pm2 restart ghg-platform
```

`deploy.bat` 已包好 build + restart。改完記得 `git push`。

> dev server 開著時 build 會和它搶 `.next` 目錄，出現
> `Cannot find module for page`。改用：
> ```bash
> NEXT_DIST_DIR=.next-build npm run build
> ```

---

## 維運腳本

| 腳本 | 用途 |
|------|------|
| `node scripts/migrate.mjs --dry-run` | 唯讀列出待套用的 migration |
| `node scripts/migrate.mjs` | 套用未套用的 migration（交易包覆，失敗 rollback） |
| `node scripts/migrate.mjs --backfill` | 把現有檔名標記為已套用但不執行（一次性轉換用） |
| `node scripts/inspect-registry.mjs` | 唯讀盤點工廠、排放源與相依筆數 |
| `node scripts/verify-v32.mjs` | 驗證工廠名冊資料完整性 |

---

## 資料庫備份

搬遷或做重大變更前務必先備份：

```bash
pg_dump "$DATABASE_URL" -Fc -f ghg_backup_$(date +%Y%m%d).dump
```

還原：

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists ghg_backup_YYYYMMDD.dump
```

Neon 另有內建的 point-in-time restore，可從 Neon 主控台的 Branches 開一個
還原時間點的分支來取回資料。

---

## 資料庫搬遷到內網（192.168.6.100）

Port 開通後：

1. 從現行 DB `pg_dump` 一份
2. 在 192.168.6.100 建立資料庫並 `pg_restore`
3. 改 `apps/web/.env.local`：`DATABASE_URL` 指向新主機，並加 `DATABASE_SSL=false`
4. `node scripts/migrate.mjs --dry-run` 確認沒有待套用的 migration
5. `npm run build && pm2 restart ghg-platform`
6. 開 `/summary` 與 `/reduction` 比對數字與搬遷前一致
7. 設定每日 `pg_dump` 排程，保留 30 天

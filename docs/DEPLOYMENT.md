# 啟動、部署、備份與還原

本文件提供可重現的操作方式。本次 GE76 有 Node／npm，但沒有 Docker CLI，因此 **Docker build、容器啟動與 volume 還原尚未執行驗證**。提供 Compose 檔不代表容器已部署；沒有啟動公開服務、變更防火牆或建立 OAuth credentials。

## 1. 本機 Node 模式

先安裝自己信任的 Node.js 22.17 以上版本與 npm。從此專案根目錄執行：

```sh
npm ci
npm run build
npm start
```

瀏覽 `http://127.0.0.1:4317`，建立本機密碼帳號。預設 SQLite 與附件位於 `./data/`。服務綁定 loopback，其他裝置不能直接連進來。Node 22.x 可能顯示內建 SQLite 的實驗性警告。

需要自訂設定時，在 PowerShell 執行：

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

在 Linux／macOS 可用 `cp .env.example .env`。`npm start` 會載入 `.env`；只填入需要的設定，沒有外部 key 也能使用本機核心。不要把 `.env`、`data/`、上傳媒體或備份提交到 Git。

若 `SESSION_SECRET` 留空，本機每次啟動會產生新的 session secret，重啟後必須重新登入；帳號、筆記、附件仍會保存。需要保留重啟前的登入狀態時，使用固定、私密且足夠隨機的 session secret。新建範例：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

將結果保存到本機 `.env` 的 `SESSION_SECRET`，不要貼到公開 issue、截圖或 log。這個值是應用程式本身的 session 設定，不是 Google／OpenAI 憑證。

### 前端開發

先啟動上面的後端，再於第二個終端執行：

```sh
npm run dev
```

Vite 負責前端開發服務，API 仍由 Node 後端處理。正式發布使用 `npm run build` 生成的前端檔案，不直接公開 Vite 開發服務。

## 2. Docker 本機試用

已安裝 Docker Engine／Docker Desktop 和 Compose v2 的電腦，可從專案根目錄執行：

```sh
docker compose -f compose.local.yaml up --build -d
docker compose -f compose.local.yaml logs --tail=50
```

開啟 `http://127.0.0.1:4317`。`compose.local.yaml` 不要求 `.env`，使用本機密碼模式；容器內綁定 `0.0.0.0` 才能透過容器 port 存取，但主機 port **只發布到 127.0.0.1**。不會因此公開到 LAN 或網際網路。資料存於獨立的 `lucky-note-local-data` named volume。

停止及重新啟動：

```sh
docker compose -f compose.local.yaml stop
docker compose -f compose.local.yaml start
```

重建更新：

```sh
docker compose -f compose.local.yaml up --build -d
```

更新前先備份。不要把 `down --volumes` 當成一般停止命令，因為它會刪除持久化資料。本機 Compose 不存固定 secret，容器重啟後需要重新登入；資料仍留在 volume。

## 3. 正式多使用者模式

正式模式與本機模式是不同配置。部署者需先準備自己的 HTTPS 網域／反向代理、持久資料目錄、秘密管理與 Google OAuth web client；本交付沒有代辦這些外部安全設定。

將 `.env.example` 複製成 `.env` 後，至少調整：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4317
DATA_DIR=./data
APP_ORIGIN=https://notes.example.com
AUTH_MODE=google
SESSION_SECRET=REPLACE_WITH_A_NEW_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
GOOGLE_CLIENT_ID=YOUR_OWN_WEB_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_OWN_WEB_CLIENT_SECRET
ALLOW_LOCAL_AUTH=false
```

上述字串僅為佔位，不能直接用於正式環境。`APP_ORIGIN` 必須是實際 HTTPS origin，不含結尾斜線、子路徑、查詢字串或使用者名稱。Google redirect URI 應精確設定為 `https://notes.example.com/api/auth/google/callback`，並替換成自己的網域。

缺少足夠長的 session secret、HTTPS origin 或所選身份方式的必要配置時，正式服務會拒絕啟動。若部署者明確選用正式密碼模式，需同時設定 `AUTH_MODE=local` 與 `ALLOW_LOCAL_AUTH=true`；它仍沒有郵件驗證與密碼找回流程，不可宣稱等同完整帳號服務。

Node 正式啟動：

```sh
npm ci
npm run build
npm start
```

Docker 正式啟動使用 **原有 `compose.yaml`**：

```sh
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml up --build -d
docker compose -f compose.yaml logs --tail=50
```

Compose 強制 `NODE_ENV=production` 並保留 fail-closed 驗證；不要拿開發 `.env` 的 HTTP origin 直接啟動它。主機 port 仍只綁 loopback，由部署者的 HTTPS 代理連入。兩個 Compose 模式預設使用同一主機 port，不能同時啟動。

反向代理需保留正確的 `Host`／`Origin` 語意，允許 SSE 長連線並停用 SSE response buffering；設定適當的 request body 大小和 timeout。API 仍會檢查 CSRF 和工作空間角色。不要為「讓它通」關閉 HTTPS、CSRF 或正式模式安全檢查。

Drive／Calendar／Gmail、LINE 與 OpenAI 的配置另見 [INTEGRATIONS.md](INTEGRATIONS.md)。Google 登入 scope 不包括這些整合，必須分別取得授權。這些服務的實際登入／送達尚需擁有者使用自己的憑證端到端驗證。

## 4. 備份與還原：Node 資料目錄

完整備份必須包含 SQLite 和附件，以及另外受保護的伺服器設定。先用執行服務的終端按 Ctrl+C 正常關閉，確認沒有服務繼續寫入，再備份整個 `DATA_DIR`。不要在服務運行時只複製 `gathernote.sqlite`，否則可能遺漏 WAL 尚未寫回的資料。

以下 PowerShell 範例假設資料目錄仍為專案下的 `data`，不會覆寫原本目錄：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $PWD 'backups'
$backupDir = Join-Path $backupRoot $stamp
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PWD 'data') -Destination $backupDir -Recurse
Get-ChildItem -LiteralPath $backupDir -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  Export-Csv -LiteralPath (Join-Path $backupRoot "$stamp-sha256.csv") -NoTypeInformation
```

把備份移至受限、加密的位置；備份包含使用者內容和身份資料，不應放在公開儲存庫或公開雲端資料夾。伺服器 `.env` 應另外安全保管，不輸出其內容到 log。

還原先建立全新的目錄，讓原資料仍可回復：

```powershell
$restoreDir = Join-Path $PWD 'restored-data'
if (Test-Path -LiteralPath $restoreDir) { throw 'restored-data 已存在，請使用新的還原路徑' }
Copy-Item -LiteralPath $backupDir -Destination $restoreDir -Recurse
```

在 `.env` 將 `DATA_DIR` 改成剛建立的絕對還原路徑，恢復同版本的程式和適用設定，再執行 `npm start`。檢查登入、筆記、附件、分帳與跨群組拒絕存取。若驗證失敗，停止服務並把 `DATA_DIR` 改回原路徑，不要立即刪除任何一份資料。

Linux／macOS 可在停機後用 `cp -a` 複製完整資料目錄，並使用 `sha256sum`／`shasum -a 256` 記錄內容；確保還原後由服務使用者持有目錄，避免為了權限方便而開成所有人可讀寫。

## 5. 備份與還原：Docker volume

以下是 Compose v2 的操作說明，**本環境尚未執行**。以本機 Compose 為例，PowerShell 先正常停止容器，再把完整資料複製出來：

```powershell
docker compose -f compose.local.yaml stop
$containerId = docker compose -f compose.local.yaml ps -aq lucky-note
if (-not $containerId) { throw '找不到 lucky-note 容器' }
$backupDir = Join-Path $PWD ('backups\docker-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
docker cp "${containerId}:/data/." $backupDir
```

確認備份檔案完整並記錄 hash 後，才重新 `start`。正式模式改用 `compose.yaml`；不要交叉使用兩種模式的資料卷。

還原建議使用新的 named volume 和獨立的 Compose project 作測試，不直接覆寫正在使用的 volume：先建立新 project 的容器（`docker compose -p lucky-note-restore -f compose.local.yaml create`），保持停止狀態，再用 `docker cp` 把同一份備份的全部內容放入新容器的 `/data/`。確認檔案由映像中的 `node` 使用者可讀寫；必要時以一次性的維護容器修正新 volume 的擁有者。原服務停止、port 空出後才啟動還原 project，完成登入／內容／權限驗證再切換。

named volume 名稱會受 Compose project name 影響；操作前用 `docker compose ... config` 與 `docker inspect` 私下核對目標，只保留刪敏結果，不把完整 inspect 或 secrets 放到公開紀錄。Docker 還原步驟需要在實際 Docker 主機演練後才能標為通過。

## 6. 筆記可攜匯出不是完整備份

工作空間 JSON 匯出／匯入僅涵蓋筆記與筆記本。附件、分帳、成員、session、帳號和外部憑證不包含在內；匯入採新 ID，並限制可接受的格式和數量。若需要完整恢復服務，使用上面的停機資料目錄／volume 備份。

## 7. 更新與回復

每次更新前記錄目前版本／commit、備份資料和設定，並在隔離還原目錄執行 `npm run verify` 和適用的瀏覽器測試。資料 schema 遷移後，不能只換回舊 binary 就假設相容；需要一起還原相同時間點的資料。驗收結果和真實限制見 [ACCEPTANCE.md](ACCEPTANCE.md)。

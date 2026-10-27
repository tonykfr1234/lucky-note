# 抽獎NOTE · LuckyNote

把旅行清單、日常筆記、SOP、手寫和共同費用放進同一個工作空間。LuckyNote 是可自行部署的響應式網頁與 PWA，預設名稱「抽獎NOTE」，提供繁體中文與英文介面；App 內品牌名稱、圖示和外觀可依裝置自訂。

本專案是獨立實作，參考 AFFiNE 的文件／白板體驗與 AppFlowy 的工作空間／資料庫視圖。沒有移植整套上游產品，也不宣稱擁有它們的全部功能。[選型與授權研究](docs/RESEARCH.md) 說明取捨。

> 這是第一版可擴充核心。功能實作、測試結果與外部配置需求分開列在 [驗收表](docs/ACCEPTANCE.md)。Google、LINE、OpenAI 沒有憑證時會顯示「尚未連接」；本次交付沒有建立 OAuth 授權、寄信、推播、付款或部署公開執行服務。

## 實際畫面

以下為本機運行版本與乾淨示範資料的真實截圖。手機圖使用瀏覽器 mobile viewport，未代表真機安裝。

![繁中桌面文件](docs/screenshots/desktop-note-zh.png)

[iPhone 16 Pro Max 瀏覽器尺寸模擬](docs/screenshots/iphone16-pro-max-portrait.png) · [Galaxy S26 360–412 CSS px 適配測試](docs/screenshots/galaxy-s26-360-portrait.png) · [分帳本](docs/screenshots/desktop-ledger-zh.png) · [AI 背景選擇器](docs/screenshots/background-gallery-zh.png)

[兩款手機驗收矩陣與真機校準](docs/MOBILE-VALIDATION.md)。舊版空狀態圖片保留作補充。

## 快速開始

需要 Node.js 22.17 以上的 22.x 版本或相容的新 LTS，以及 npm。後端使用 Node 內建 SQLite，22.x 啟動時可能顯示實驗性功能提示。第一次安裝需要連線至官方 npm registry。

```sh
npm ci
npm run build
npm start
```

開啟 `http://127.0.0.1:4317`。本機模式使用真正的電子郵件／密碼帳號，密碼經 scrypt 雜湊；輸入任意電子郵件並不能登入別人的帳號。建立帳號後從空的私人空間開始，不預先植入看似真實的使用者資料。

如需設定，複製 `.env.example` 為 `.env` 並依檔案說明填寫。`.env`、資料庫、上傳附件與備份都不得提交到 GitHub。正式模式要求安全的 session 設定與 HTTPS origin；Google 登入與 Drive／Calendar／Gmail 授權分別配置，登入成功不等於已取得其他服務的權限。

## 使用流程

1. 建立私人或群組空間，新增筆記本，再選擇適合的模板開始。
2. 在文件內編輯內容與勾選清單；以筆記視圖整理資料，搭配搜尋與標籤。
3. 明確選取照片、影片或檔案上傳，也可開啟手寫畫布。相機功能仍受瀏覽器與裝置權限影響。
4. 群組擁有者可將已註冊的帳號加入為編輯者或檢視者。這不會寄送邀請郵件。
5. 共同費用帳本記錄誰先付款、由誰分攤，再產生結清建議。建議不會轉帳、不代表收款人已確認收款。
6. 在工具頁查看服務配置狀態。只有經預覽與明確確認的操作才應呼叫外部服務。

## 同步與離線界線

SQLite 儲存伺服器資料；SSE 通知其他開啟中的視窗重新讀取，儲存時以版本號防止覆蓋別人的修改。遇到版本衝突需要由使用者處理，沒有 CRDT 字元級合併，也沒有離線多人分支自動合併。

PWA 安裝的是同一份網頁程式。目前設定頁的名稱與圖示自訂只影響 App 內品牌和分頁標題，不會改寫部署的 manifest。OS 安裝名稱與圖示使用 `public/manifest.webmanifest` 和其中指定的圖示資產；需要部署者修改這些檔案並重新建置，再由平台更新或重新安裝。只改 App 內設定後重新安裝，不會套用這些本機偏好。公開 shell 可快取，私人 API、附件與群組筆記不由 service worker 快取。撤權會阻止後續伺服器存取，但不能回收使用者已經另存的副本。

## 整合與安全邊界

| 功能 | 邊界 |
| --- | --- |
| Google 登入 | 需要自己的 OAuth client；不自動取得其他 Google 服務授權 |
| 群組 Google Drive | 附件／快照儲存，不能取代工作空間 ACL 或即時協作資料庫 |
| Calendar／Gmail／LINE | 伺服器端配置、指定群組與目的地、預覽後確認；本次沒有真實送出驗證 |
| AI 分類／翻譯／語音 | API key 僅在伺服器；先選取來源、日期與預算，再預覽與確認 |
| 相簿 | 不會背景掃描整個手機相簿；Google Photos 既有內容需要 Picker 主動選取 |
| 分帳 | 整數最小幣值、確定性尾差分配、結清建議；沒有 LINE Pay P2P 或代管資金 |

[整合設定](docs/INTEGRATIONS.md) 與 [安全政策](SECURITY.md) 提供進一步說明。OpenAI API 計費與 ChatGPT 訂閱不同；`store:false` 不代表供應商端絕對零保留。

## 驗證

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

瀏覽器測試需要 Playwright 支援的 Chromium。Windows 驗收使用已安裝的 Chrome 預設路徑 C:/Program Files/Google/Chrome/Application/chrome.exe；不同安裝位置請調整 playwright.config.ts 的 executablePath。Linux CI 會安裝 Playwright Chromium。實際執行環境、通過項目、不能執行的驗證與紀錄位置以 [驗收表](docs/ACCEPTANCE.md) 為準。外部 provider 的 mock 測試只驗證請求／錯誤處理，不等同真實 OAuth 或實際送達。

## 部署、備份與還原

先使用本機模式檢查核心流程。具體 Node／正式／Docker 指令與備份還原見 [部署說明](docs/DEPLOYMENT.md)。已有 Docker 的電腦可用 `docker compose -f compose.local.yaml up --build -d` 試用；本次 GE76 沒有 Docker CLI，容器流程尚未實測。正式 `compose.yaml` 保留 HTTPS／session 安全設定檢查。本次沒有改動防火牆，也沒有啟動公開網路服務。

完整還原需要一致的資料庫和附件：先停止服務，將整個 `DATA_DIR` 複製到安全位置，再另外備份伺服器設定。不要在服務寫入期間只複製單一 SQLite 主檔而忽略 WAL／SHM。備份含私人筆記、帳號雜湊和媒體，應限制權限並加密存放。

還原時先停止服務、保留目前資料目錄作回復點，再把同一份備份的完整資料目錄放回，恢復目錄權限與設定後啟動。用測試帳號檢查登入、筆記和附件；不要把正式備份拿去公開示範。UI 匯出／匯入的覆蓋範圍請看驗收表，不能當成完整系統備份。

## English quick start

LuckyNote is a self-hosted notes and shared-workspace PWA with Traditional Chinese and English UI. Requires Node.js 22.17+ and npm.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4317` and create a local password account. Configure production HTTPS, sessions and OAuth separately before hosting for multiple users. Do not commit `.env`, user databases, media, tokens or backups. External providers are unavailable until explicitly configured; adapter unit tests do not prove live delivery. See [acceptance results](docs/ACCEPTANCE.md), [architecture](docs/ARCHITECTURE.md), [integrations](docs/INTEGRATIONS.md) and [security](SECURITY.md).

## 後續路線

- 文件 CRDT 與離線分支合併，搭配授權撤銷與資料遷移測試。
- 更完整的可編輯資料庫欄位、白板物件與跨文件連結。
- 每個群組自行連接 Google 服務的管理介面與 token 生命週期。
- Google Photos Picker、可插拔 AI provider、預算報表與人工分類回饋。
- 外部通知佇列、重試／不確定結果處理、安靜時段與送達稽核。
- 原生平台安裝驗證、無障礙檢查及更完整的備份／還原工具。

程式碼授權與實際納入套件見根目錄 [LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；研究參考的產品不等於本專案依賴。

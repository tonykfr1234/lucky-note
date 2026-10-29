<p align="center"><img src="public/icon-192.png" alt="抽獎NOTE 圖示" width="112" height="112"></p>
<h1 align="center">抽獎NOTE · LuckyNote</h1>
<p align="center">旅行清單、筆記、手寫與共同費用，放在同一個空間。</p>
<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/source-v0.2.0-2d6450" alt="原始碼版本 0.2.0"></a>
  <a href="https://github.com/tonykfr1234/lucky-note/actions/workflows/ci.yml"><img src="https://github.com/tonykfr1234/lucky-note/actions/workflows/ci.yml/badge.svg" alt="實際 GitHub CI 狀態"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 授權"></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/languages-繁中%20%7C%20English-66795c" alt="繁體中文與英文"></a>
</p>
<p align="center">
  <strong>繁體中文</strong> · <a href="README.en.md">English</a> ·
  <a href="CHANGELOG.md">更新紀錄</a> · <a href="CONTRIBUTING.md">參與開發</a> ·
  <a href="https://github.com/tonykfr1234/lucky-note/releases">下載／Releases</a>
</p>

LuckyNote 是可自行部署的響應式網頁與 PWA，也提供裝置儲存模式及 Android WebView 封裝原始碼。介面支援繁體中文／英文、深淺色、頭像、自訂 App 內品牌，以及 10 款 AI 生成背景。

**0.2.0 已實作 Tiptap＋Yjs＋Hocuspocus 多人正文協作**：同時編輯、開啟中分頁斷線後重新合併，以及伺服器持久化。這是獨立專案；[選型研究](docs/RESEARCH.md) 提供設計參考，參考產品的功能不會自動成為本專案功能。

## 使用模式與發布狀態

本機待審閱：[2026-10-29 介面改善、驗證與回復方式](docs/UI_UX_2026-10-29.md)。前後截圖保留本機、公開披露待另外批准；此紀錄不代表已推送、部署或通過新的遠端 CI。

| 模式 | 資料在哪裡 | 適用功能 |
| --- | --- | --- |
| 自行部署伺服器／PWA | 你的伺服器 SQLite 與附件目錄 | 帳號、私人／群組、多人協作、共同分帳；整合需另外配置 |
| 裝置模式／Android 封裝 | 該瀏覽器 origin 或 App 的 IndexedDB | 個人筆記、模板、附件、手寫、個人費用與匯入匯出；沒有伺服器帳號或協作連線 |
| 靜態 Pages 預覽 | 該瀏覽器的 IndexedDB | 裝置模式體驗；預覽示例不是其他使用者資料，內容不會自動同步至伺服器 |

- **Pages 預期入口，尚待 CI／發布確認：** [tonykfr1234.github.io/lucky-note](https://tonykfr1234.github.io/lucky-note/)。目前不宣稱網址已可用；發布後仍是裝置模式預覽。
- **Android debug APK，尚待 CI 產物／發布確認：** [Android workflow](https://github.com/tonykfr1234/lucky-note/actions/workflows/android.yml) 與 [Releases](https://github.com/tonykfr1234/lucky-note/releases)。只有實際 APK、驗簽及 SHA-256 報告存在時才算可下載版本，詳見 [Android 說明](docs/ANDROID.md)。
- **iPhone：** 使用網頁／PWA；沒有 iOS IPA。手機截圖及尺寸模擬不代表真機安裝驗收。

Android 內含裝置前端，不需要開著另一台電腦。它是 **debug 開發版 WebView 封裝**，未配置正式簽章或商店發行；HTTPS 協作服務交由系統瀏覽器開啟。不同 debug 簽章可能無法覆蓋升級，移除 App 前請先匯出筆記。

## Features · 功能

| 功能 | 0.2.0 實際範圍 |
| --- | --- |
| 筆記與整理 | Tiptap 富文字、可勾選清單、筆記本、標籤、搜尋、卡片／表格／看板視圖 |
| 模板 | 12 種用途＋空白：旅行、行李、採買、旅行購物、待辦、SOP、會議、手記、學習、費用、維修、靈感 |
| 媒體與手寫 | 主動選取照片／影片／檔案、相機入口、20 MB 附件限制；筆色、粗細、橡皮擦、撤銷／重做、PNG 與可再編輯筆跡 |
| 真正共同編輯 | 伺服器模式以 Yjs 合併正文；SQLite journal 在套用／確認前提交，重啟可恢復；標題、標籤等使用獨立版本控制 |
| 私人與群組 | owner／editor／viewer、逐請求與逐訊息 ACL、撤權與 session 失效斷線；正式 Email 分享要求已驗證 Google 身分 |
| 分帳 | 群組 TWD 整數最小幣值、確定性尾差、每人餘額、結清建議及收款人確認；裝置模式只有個人費用 |
| 語言與外觀 | 繁中／英文、深淺色、頭像、App 內名稱／圖示、10 款 AI 背景及自訂背景 |
| 資料可攜 | 筆記／筆記本 JSON 匯出匯入、Markdown 匯出；JSON 不含附件、帳本、成員或協作歷史 |
| 可擴充工具 | Google 登入、Drive、Calendar、Gmail、LINE Messaging API、AI 分類／翻譯有伺服器實作介面；無憑證時明示未配置。STT adapter 已有測試，付費操作 UI 尚未開放 |

**手寫的協作單位是整張畫布。** 完整筆跡值保存於 metadata.sketch；同時修改會提示處理替換，不是逐筆線條 CRDT。此版停用 awareness，沒有多人游標或線上人數功能。

App 內名稱／圖示設定不會改寫作業系統安裝資訊；PWA 安裝名稱與圖示取自部署的 manifest，Android launcher 資訊取自 APK resources。

## Screenshots · 實際畫面

運行中的 App 與合成測試資料；手機欄為瀏覽器 viewport／layout 驗證，不是實體 iPhone 或 Galaxy 安裝截圖。

<table>
  <tr><th>桌面協作編輯器</th><th>iPhone 16 Pro Max 尺寸</th><th>Galaxy S26 尺寸範圍</th></tr>
  <tr>
    <td align="center"><img src="docs/screenshots/collaborative-editor-zh.png" alt="繁中桌面協作編輯器" height="220"></td>
    <td align="center"><img src="docs/screenshots/iphone16-pro-max-portrait.png" alt="iPhone 尺寸繁中筆記" height="220"></td>
    <td align="center"><img src="docs/screenshots/galaxy-s26-360-portrait.png" alt="Samsung 360 CSS px 筆記" height="220"></td>
  </tr>
</table>

[分帳本](docs/screenshots/desktop-ledger-zh.png) · [手機看板](docs/screenshots/mobile-board-zh.png) · [背景選擇器](docs/screenshots/background-gallery-zh.png) · [手機驗證與真機限制](docs/MOBILE-VALIDATION.md)

## Quick Start · 快速開始

需要 Node.js **22.17+** 與 npm **8+**。在此專案根目錄執行，首次安裝需要 npm registry。

### 伺服器模式

~~~sh
npm ci --ignore-scripts
npm run build
npm start
~~~

開啟 http://127.0.0.1:4317，建立本機密碼帳號。預設只綁定本機，資料保存在 ./data/；這個「本機伺服器」與 IndexedDB 裝置模式不同。Node 22 的內建 SQLite 可能顯示實驗性警告。

密碼採 scrypt 雜湊。本機註冊**不驗證 Email 所有權**，開發群組帳號只適合測試；正式群組分享要求擁有者與受邀者皆有 Google 已驗證身分。正式啟動需要 HTTPS APP_ORIGIN、安全 SESSION_SECRET 與登入設定，缺失時拒絕啟動。

複製 [.env.example](.env.example) 為 .env 後依 [部署說明](docs/DEPLOYMENT.md) 設定。.env、資料庫、附件、token、keystore 和備份不得提交 GitHub。未填固定本機 session secret 時，重啟需要重新登入，筆記仍會保留。

### 裝置模式與 Pages 路徑的本機預覽

~~~sh
npm run build:local
npm run preview:local
~~~

開啟 http://127.0.0.1:4320。此服務只提供靜態檔案；資料存於瀏覽器 IndexedDB，不需要登入或 API 伺服器。

~~~sh
npm run build:preview
npm run preview:web
~~~

開啟 http://127.0.0.1:4320/lucky-note/ 驗證預期 Pages 路徑。兩個預覽服務使用相同預設 port，請一次執行一個。建置完成不等於已部署 Pages。

瀏覽器、網站 origin 與 APK 各有獨立資料。清除網站資料、私密瀏覽或移除 App 可能造成資料消失；請定期手動匯出並另外保存附件。JSON 不是完整備份。裝置模式匯入 JSON 筆記時，只轉換內容中支援的 Markdown 區塊，其他 inline 語法保留為文字。Pages 仍需載入網站資產，不保證離線冷啟動；APK 則內建前端資產。

### Docker

已有 Docker／Compose 的環境可用：

~~~sh
docker compose -f compose.local.yaml up --build -d
~~~

開啟 http://127.0.0.1:4317。正式 compose.yaml 與備份／還原步驟見 [部署說明](docs/DEPLOYMENT.md)。GE76 沒有 Docker CLI，容器建置及 volume 還原尚未實測。

## 同步、離線與整合邊界

伺服器模式以 Yjs 為正文來源，Markdown 是搜尋與匯出投影，SSE 負責清單／中繼資料刷新。**開啟中的分頁**斷線時會把修改留在記憶體，重連後合併；尚未送達的修改不會寫入伺服器模式的 IndexedDB，關閉／重載分頁可能失去它們。此範圍不等於完整離線筆記庫。私人 API、附件與群組資料不由 service worker 快取。

| 整合 | 邊界 |
| --- | --- |
| Google 登入 | 需要 OAuth client／redirect；登入不等於取得 Drive、Calendar 或 Gmail 授權 |
| 群組 Google Drive | 附件／快照儲存，不取代 ACL 或 CRDT 資料庫；個人共用資料夾不等於 Workspace Shared Drive |
| Calendar／Gmail／LINE | 個別授權、指定工作空間與目的地、預覽後確認；真實外部送達仍待憑證驗收 |
| AI 分類／翻譯 | key 僅留伺服器；選取來源、日期／時區、預算、預覽及人工確認。OpenAI API 計費與 ChatGPT 訂閱分開 |
| 相簿 | 不背景掃描整個相簿；Google Photos Picker 尚未實作 |
| 分帳／付款 | 只記帳、結清建議及人工確認；不操作 LINE Pay P2P、不轉帳或代管資金 |

詳見 [整合設定](docs/INTEGRATIONS.md)。沒有代為建立 OAuth grant 或執行真實推播、寄信、行程建立、支付。store:false 不代表供應商端絕對零保留。

## 驗證與開發

~~~sh
npm run verify
npm run test:e2e
npm run test:local
~~~

0.2.0 本機驗證：**116 項自動測試、7 項伺服器 UI、2 項裝置 UI 通過**。另有 [34 項核心／協作安全回歸](artifacts/backend-crdt-tests.log)、[真實多人瀏覽器合併](artifacts/collaboration-browser.log) 與 [前端驗證紀錄](artifacts/frontend-crdt-validation.md)。覆蓋跨群組拒讀、viewer 偽造更新、撤權、session 過期、寫入失敗、ACK 後強制終止重啟恢復，以及同時／斷線編輯合併。完整紀錄見 [驗收表](docs/ACCEPTANCE.md)；GitHub CI 徽章反映遠端實際狀態，不由本機結果推定。

Playwright 在 Windows 使用設定中的 Chrome 路徑，CI 使用 Chromium。Mock provider 測試不代表真實外部送達；Android build、驗簽、模擬器與真機驗收也各自獨立。貢獻流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文件與授權

| 文件 | 內容 |
| --- | --- |
| [架構](docs/ARCHITECTURE.md) | 儲存、ACL、協作與擴充 |
| [部署](docs/DEPLOYMENT.md) | Node／Docker、正式設定、備份還原 |
| [整合](docs/INTEGRATIONS.md) | Google、LINE、AI 配置與限制 |
| [驗收](docs/ACCEPTANCE.md) | 已實作、已測、需憑證與待完成項目 |
| [Android](docs/ANDROID.md) | debug APK、權限、匯出、CI／真機界線 |
| [安全政策](SECURITY.md) | 安全邊界與問題回報 |
| [更新紀錄](CHANGELOG.md) · [English changelog](CHANGELOG.en.md) | 版本變更與發布狀態 |

後續工作包括伺服器模式完整離線儲存、逐筆畫布協作、群組 OAuth／token 管理、Google Photos Picker、可靠排程通知、正式 Android 簽章與真機驗收，以及完整無障礙稽核。沒有端到端加密承諾；資料及備份需要部署者妥善保護。

本專案原始碼採 [MIT License](LICENSE)。套件聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；研究參考專案不是全部被納入的依賴。

---

**Build by Tony · 2026 年製作**

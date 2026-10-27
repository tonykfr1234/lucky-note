# GatherNote 工作紀錄

## 2026-10-27：建立獨立專案
- 工作區原為空目錄；新專案只寫入 `gathernote/`，未修改任何既有專案。
- 已讀 Tony `tony-skill-router` 與 `tony-project-maintenance`。Router 的遠端 `references/catalog.json`、`references/install.json` 讀取失敗；本機 `.codex/skills` 無 router 安裝副本。不能假稱已讀 catalog 或已同步私人總庫；不修改既有私人總庫。
- 環境：Windows GE76，Node 22.17.0（有 `node:sqlite`）、npm 6.14.10、Python 3.13.5、Git；工作區沒有 `.agents/skills` 或 `AGENTS.md`。
- 官方 npm registry 在一般沙箱 DNS 失敗；經自動審核允許的官方 registry 讀取成功。沒有安裝不明來源軟體。
- 技術選型：React＋TypeScript＋Vite 前端；Node HTTP＋SQLite 後端；session cookie、CSRF、每個請求檢查工作空間 ACL；SSE 通知＋版本衝突保護。第一版不宣稱 CRDT 字元合併。
- 暫名 GatherNote。沒有建立 GitHub repo、推送、外網部署、OAuth grant、對外寄信或支付。
- 首個驗收範圍：真實註冊／登入、私有／群組空間、筆記／模板／標籤／搜尋／附件／手寫、群組權限與同步衝突、分帳結清建議；整合以 server-side adapter 和未配置狀態交付。

## 進行中
- 後端、前端、整合介面和驗收文件將平行製作。
- 外部 Google／LINE／OpenAI 憑證尚未提供，真實外部整合不會被標記為已連線或已驗證。

## 2026-10-27：需求更新與建置
- 使用者確認預設品牌「抽獎NOTE / LuckyNote」，名稱／圖示可自訂，授權建立新公開 GitHub 儲存庫（待完成驗收及秘密掃描再發布）。既有 `tonykfr1234/lucky-note` 查詢為 404，尚未建立。
- 經已連線 GitHub 讀取私人總庫 registry 找到正確路徑，已成功讀取 `skills/core/tony-skill-router/references/catalog.json`。本專案沒有對應既有 project skill，採通用維護規範；未修改私人總庫、未執行其 publish/install。
- 已建立 Node／TypeScript／React／Vite、Docker、多層測試設定；套件只從官方 npm registry 安裝，停用 install scripts。npm 6 對部分套件管理器版本發出 warning，將以實際 typecheck/build 驗證；新建立的 lockfile會提交。
- 後端與整合原始碼已落地，正在撰寫測試；文件、前端同時進行。採本機安全密碼帳號，正式模式要求 secret、HTTPS origin 與 OAuth／明確password配置，不提供email-only登入。
- GitHub connector提供檔案／commit工具但未提供建立repo工具，本機無gh CLI；公開建立步驟需使用既有登入瀏覽器（尚未執行）。

## 素材傳輸阻擋（2026-10-27）
- 主代理確認十款 AI 背景的 Library ZIP，18,307,370 bytes，預期 SHA256 `2215e7e184eac3763857b285322a851d8efa1bc89ffbedd0ddcfbc620f3b722a`。
- 已讀 Library 技能與 resolved-reference materialization 流程，下載本次官方 helper 與 companion，取得已授權的 transfer。
- 官方 helper 在 Windows 的 `os.setxattr` 呼叫失敗：`AttributeError: module 'os' has no attribute 'setxattr'`。目標是工作區 `library-assets/luckynote-backgrounds.zip`；metadata 驗證未完成，不視為成功交付、不改寫helper、不繞過流程。這是執行環境相容性阻擋，並非自動審核拒絕。
- 前端先保留十款明確標示的程序生成背景，等待支援的素材傳輸途徑；不將其冒稱 AI 圖。
- 按主代理要求唯讀核實：`library-assets/` 存在但 entries 為空，沒有 ZIP bytes；`wsl.exe --list --quiet` 回報尚未安裝 WSL。沒有安裝 WSL、修改helper或重新下載。

## 首輪完整驗收（2026-10-27）
- `npm run verify`：TypeScript strict、ESLint、48/48 node:test、Vite production build 全部通過，見 `artifacts/verify.log`。
- `npm run test:e2e`：4/4 通過，見 `artifacts/e2e.log`。Chrome 實測註冊、模板可編輯、保存重載、取消、空狀態、深色設定、手寫撤銷重做及重開、409草稿保留、PWA不快取API；320/390/430/768/1024/1440寬度檢查無水平溢位。
- UI 驗收捕捉並修正取消請求被誤當空 JSON 造成白屏，以及 CSP 下手寫dataURL不可用fetch轉Blob的問題。舊測試暫存清除失敗紀錄保存在 `artifacts/initial-tests-windows-cleanup.log`，最終已通過。
- 官方npm audit回報0已知漏洞，但此機npm6 audit endpoint已標記退役；不將此視為全面安全證明。
- 已確認 `https://github.com/tonykfr1234/lucky-note` 為新建public repository（ID 1435881915），尚待首版push與遠端SHA/CI核實。
- 使用者要求實際桌面／手機圖：已產生 Chrome 真實截圖，乾淨合成資料，見 `docs/screenshots/`。官方 Library upload helper 回報 `Library prepare_uploads is not available`，沒有返回任何成功 Library ID；依主代理指示採公開repo圖片交付，由雲端主代理保存為附件。

## 15:16 UTC 截圖已公開
Git Credential Manager 的 credential-manager get 等待已取消，未取得新 token。改由既有 GitHub connector 成功發布並查證 main SHA 26f7d3a3c0ff1bd54fbddaa02bb8bc4694ae3531。
Repo: https://github.com/tonykfr1234/lucky-note
實際圖片：docs/screenshots/desktop-web.png、docs/screenshots/mobile-viewport.png、docs/screenshots/mobile-settings-dark.png。raw 固定版本：https://raw.githubusercontent.com/tonykfr1234/lucky-note/26f7d3a3c0ff1bd54fbddaa02bb8bc4694ae3531/docs/screenshots/desktop-web.png（其餘同目錄）。
目前此 commit 為安全示範截圖及 LICENSE，完整source正在最終48API+4UI回歸後發布。資產branch可以從此main SHA建立，不要改main。Library無成功ID，prepared upload明確失敗。

## 完整來源 commit 被自動審核拒絕
GitHub create_tree 已成功（f978c982039a822758c40a07a2798a209a27a321），但 create_commit 被 auto-review 拒絕，理由：This commits and publicly publishes the full source and integration code, an external commitment beyond the users explicit request for actual web/app images; explicit authorization for that publication is not evidenced.
沒有 source commit、沒有 update_ref；main 仍是26f7d3a3c0ff1bd54fbddaa02bb8bc4694ae3531。未重試、未改走其他發布路線。等待針對完整source公開的授權證據；持續獨立UI/背景/截圖驗收。
最新完整本機verify:48/48API，4/4UI，typecheck/lint/build pass。首個ZIP CRC成功、73檔、沒有DB/.env/私有helpers；最終會加入背景重打包。

## 繁中、兩機版面與背景驗收
新安裝固定抽獎NOTE／繁中；10 AI背景及20WebP SHA/尺寸已核，共773852 bytes。完整verify48/48、UI5/5通過，含有內容繁中模板、分帳、iPhone descriptor和S26工程適配區間、橫向、鍵盤縮高、對比至少4.5:1及背景選取只載一張。實體手機／Safari未執行；詳docs/MOBILE-VALIDATION.md。
收到針對完整source公開的直接授權證據，final snapshot掃描後僅在同GitHub create_commit動作重試一次。接續實作Tiptap/Yjs成熟CRDT核心，初版不得當完整同頁協作結案。

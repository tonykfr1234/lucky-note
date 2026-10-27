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

## Integrations / shared schema — 0.2.0 delegated verification

- 共用 `shared/editor-schema.ts` 與 `server/note-format.ts` 已完成，使用鎖定版 Tiptap 3.32.0 / y-tiptap 3.0.10 / Yjs 13.6.33；前後端同一 schema，伺服器獨佔 Markdown 匯入。未知根/節點/屬性、危險 URL、過深結構、畸形 Unicode、超限畫布皆拒絕。
- 真正 Tiptap 新增的 `__tiptap_position_migrations:root:content` 已按釘選版原始碼精確驗證 shape、record/key、seen/transfers、數字與大小；其他額外 roots 不放行。UI 回歸由 frontend/root 執行。
- 安全審查發現並已修正 Markdown code fence、link href/title、段落開頭符號、手寫 marker literal 的資料損失。尚不支援的 Markdown image/table、非十進位 orderedList 拒絕遷移並保留舊原文，避免只保留 alt 文字而丟 URL。
- AI 確認分類增加 metadata_version，真 localhost HTTP 回歸確認舊 metadataVersion 不能覆寫分類。三層 AI budget 與 operation claim 同 SQLite 交易，保留 uncertain reservation；缺 key 零呼叫零扣額。
- `node --test build/tests/integrations.test.js build/tests/note-format.test.js`：70/70 pass（43 format + 27 integration，含 OIDC 子測試）；strict server TypeScript、上述檔案 ESLint pass。測試 localhost sandbox EACCES 已由獲准的本機測試執行解決；無外部 API 真發送或 credential 建立。

## Backend / CRDT 0.2.0 delegated verification — 2026-10-27

- 已實作 Hocuspocus 4.7.1 / Yjs 13.6.33 真正 WebSocket 協作；以同源 Origin、session cookie、CSRF token 與每次訊息 ACL 驗證。正文 canonical Yjs，SQLite FULL journal 在 apply / ACK 前提交，定時壓縮快照，Markdown 作搜尋／匯出投影；metadataVersion 與正文修訂分開。
- viewer 偽造更新在 journal 前拒絕；撤權、降權、登出、過期與刪除都斷開既有連線。未整合 dependency 的潛藏更新拒絕入庫。Awareness／任意 stateless 廣播明確關閉，不提供假線上人數或游標。
- WebSocket 入站每 session 限 200 frames / second、64 pending frames、8 MiB + 4096 pending bytes；在 Hocuspocus queue 前計數，實際非同步 protocol 處理完成才釋放。認證前另有限 128 KiB / 32 frames；單幀上限 8 MiB + 4096。
- 正式模式 Google verified identity 才可透過 Email 分享群組；本機帳號是未驗證測試身分。既有未驗證群組成員在 HTTP、SSE 與 WebSocket 均不可讀取；註冊輸入無法偽造 emailVerified。會回傳身分信任欄位供 UI 明示。
- note / attachment / expense mutation caches 改資源 ID reference，啟動時縮減既有完整 response；刪除後保留無全文 tombstone，重試回 410，重啟也不復活。匯入 cache 只存數量，不存 archive；刪除同時清除該筆記的 AI 分類 preview，外部不確定發送記錄保留去重。
- 登入限流使用 socket IP + 正規化帳號，每分鐘 30 次，忽略任意 X-Forwarded-For，不以單一代理 IP 鎖住全站；bucket map 最多 10000。這是帳號嘗試限制，並非一般網路 DDoS 防護。
- CSP 明列實際同源 ws/wss，測試包含正式 HTTPS origin 與偽造 Host 不得擴大來源。
- 最終 delegated 驗證：server strict build pass、owned files ESLint pass、20 core + 14 collaboration = 34/34 pass。完整 log：artifacts/backend-crdt-tests.log。包含兩個真 provider 離線合併、直接攻擊 frame、不同群組拒讀、ACK 後 SIGKILL 重啟恢復、storage failure 不 ACK、1000-frame flood 與另一 session 可繼續寫、正式環境 email squatting、刪除／匯入／重試／重啟與 AI preview 清除。
- 實際 Tiptap 瀏覽器發現的 position migration root 已交由共用 schema 代理窄驗證修復；frontend 回報真輸入、格式、重載與手寫測試通過。完整桌機／手機 E2E 與發布由主代理統整。
- 無部署外網、OAuth grant、外部訊息、支付或 GitHub 操作。外部憑證 E2E 仍待設定；本委派無剩餘執行阻擋。

## 0.2 release checkpoint — 2026-10-27
Final verify passed: 116 automated tests, strict typecheck, lint and production build. Server UI 7/7 passed. Device/preview builds and 3/3 local UI passed: real keyboard rich-text persistence, offline edits, Pages subpath and phone layout, selected image persistence, Markdown/JSON download, cancelled and confirmed JSON import. Mobile hidden drawer masking and local ledger SSE were corrected. Screenshot inspection confirms local-only notice remains visible in the document. No real OAuth/integration calls or messages were sent. GitHub Pages source saved to GitHub Actions; deployment awaits this source commit. Android native source and 18 policy checks are ready; actual APK build/signature/emulator remain pending CI. GE76 has Java8, no Android SDK/JDK17. Public source scans exclude runtime databases, keys, uploads and private artifacts.

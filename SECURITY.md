# 安全政策與 0.2 邊界

抽獎NOTE / LuckyNote 包含私人內容、群組協作與第三方整合。公開原始碼或靜態預覽不代表使用者筆記應公開。部署前核對 [驗收清單](docs/ACCEPTANCE.md)，完成實際登入、授權、撤權及備份復原測試。

## 回報問題

不要在公開 issue 張貼密碼、API key、OAuth token、session cookie、私人筆記、媒體或資料庫。儲存庫若已啟用 private vulnerability reporting，使用 Security 頁面私下回報；否則先用不含利用細節及私人資料的 issue 詢問維護者私下聯絡方式。

## 身分與授權

- 每次 HTTP、附件、匯出及 SSE 重新檢查身分與 workspace ACL；WebSocket upgrade、同步與寫入亦檢查 session、Origin／CSRF 及成員權限。UUID 不等於授權。
- session 採 HttpOnly／SameSite cookie；正式環境使用 HTTPS／Secure cookie。密碼以 scrypt 儲存。正式設定不足拒絕啟動。
- Google 驗證一次性 state、PKCE、nonce、JWKS 簽章、issuer、audience、期限與 userinfo；不只解析 JWT，不自動合併同 email 本機帳號。
- 本機註冊不代表驗證 email。正式群組新增成員需雙方 Google 驗證，既有未驗證本機非 owner 成員亦不得存取群組。
- viewer 不能以 SyncStep2 寫入。撤權、降級、登出與到期會重驗或關閉既有連線；不能收回已合法下載或匯出的副本。

## 協作與資料儲存

0.2 使用真正 Tiptap／Yjs／Hocuspocus。shadow doc 驗證後先同步提交 SQLite journal，再允許套用與回應。未解析依賴、非法 schema、額外 roots、未知屬性、危險連結、過深結構、嵌入物件、畸形 Unicode 及超限狀態均拒絕。Tiptap 固定位置遷移 root 依釘選版完整 shape 驗證，並非任意 map 白名單。

正文保存 canonical Yjs，Markdown 是搜尋／可攜匯出投影。舊 REST 正文不能覆寫協作筆記；標題／標籤／筆記本及 AI 分類使用獨立 `metadata_version`。遷移保留原文、失敗不截斷；HTML 當 literal text，不執行。

一般去重紀錄保存資源參照，刪除後留下不含全文的 tombstone，防止重試復活或回讀舊資源。請管理資料庫、附件、整合預覽與備份的保留政策；邏輯刪除不是鑑識級抹除。沒有端對端加密，伺服器管理者可接觸資料。

伺服器版短暫離線只保留目前分頁的 Y.Doc，重連可合併；沒有 IndexedDB 持久離線副本。關閉或重整前確認同步或匯出草稿。Markdown 可能正規化空白／格式，完整備份需包含 canonical Yjs、附件及必要資料庫檔案。

## 裝置預覽與 APK

靜態預覽與 APK 使用各自 origin／瀏覽器或 App 容器的 IndexedDB，沒有伺服器帳號、群組共享、WebSocket、SSE 或自動雲端備份。它們不與其他裝置、瀏覽器設定檔或 Android App 共用筆記；同一資料容器的使用者仍可看到其中內容。

裝置版停用外部整合；示範筆記是合成資料。清除網站資料、無痕結束、解除安裝或系統回收都可能遺失內容。「本機儲存」不等於加密、正式登入隔離或唯一可靠備份。

Android native bridge、來源限制、檔案選擇、匯出確認、debug／簽章限制見 [Android 說明](docs/ANDROID.md)。外部 HTTPS 服務在系統瀏覽器開啟，不在嵌入 WebView 建立 Google grant。APK 是否成功產出／安裝須有獨立產物與驗證證據。

## 秘密、外送與 AI

- API key、client secret、refresh token、LINE token 僅在 server env 或 secret store；所有 `VITE_*` 值視為公開，不放憑證。私人資料、資料庫、備份、`.env` 不進 Git、`public/` 或發布 ZIP。
- Google 登入與 Drive／Calendar／Gmail 授權分開，使用最小 scope。Drive 不替代 ACL／協作資料庫，My Drive 共用資料夾不等於 Workspace shared drive。
- provider 只連固定官方端點，不能成為任意 URL 代理。外送需 group owner、server binding、預覽與明確確認，再驗目的地；不把私人摘要自動發到群組。
- outbox／操作 ID 去重。結果不明保留狀態，不自動重送；缺憑證明確未配置，不顯示模擬成功。
- AI 不掃相簿，不送未選照片；分類只傳預覽的標題／標籤及必要分類資料，保存日期／時區。輸出是建議，人工確認才套用，不執行模型生成工具指令。
- 單次與 user／workspace／部署 UTC 每日 token 上限以 SQLite 原子交易保留。預設 20,000／100,000／200,000；`0` 可停止該範圍消耗。缺 key 不扣額；uncertain 不退款後盲目重試。部署上限只涵蓋共用同一資料庫的請求。
- Token 上限不是精準金額保證；部署者仍需供應商端總額及告警。ChatGPT 訂閱與 API 計費分開；`store:false` 不等於零保留。

## 部署責任與已知限制

正式環境需非範例 `SESSION_SECRET`、HTTPS `APP_ORIGIN`、合法登入設定、OS 資料目錄與備份權限。建議 Google；若明確啟用正式本機密碼模式，須接受沒有 email 驗證、寄信重設密碼與完整帳號生命週期管理的限制。

反向代理須支援 WebSocket／SSE 並限制流量／大小。本版是單節點協作架構；不能讓獨立節點直接共享 SQLite 後假設狀態一致。定期更新依賴、查核鎖定版本授權／漏洞並演練復原。

媒體已有格式、檔頭、大小及 ACL 檢查，但沒有完整惡意檔案掃描／轉碼沙箱。PWA service worker 不快取 server 私人 API／媒體。沒有 LINE Pay P2P 或資金代管。

自動測試與 mock 不證明真實 consent、scope、送達、費用、實機或第三方審核通過。修補與未測限制需記錄在版本／驗收文件，不把「未測」寫成「已修復」或「不適用」。

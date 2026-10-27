# 0.2 功能與驗收清單

外部 mock 通過不等於真實帳號已連線；行動 viewport 通過不等於 Android／iOS 實機驗證。公開預覽及 APK 裝置版使用各自 IndexedDB，沒有群組或跨裝置共享。

## 已確認驗證

| 檢查 | 結果 | 證據與邊界 |
| --- | --- | --- |
| TypeScript strict、ESLint、production build | 最終 `npm run verify` 通過 | 主代理最終完整執行；發布需保存對應原始碼 SHA 與 log |
| Node 自動測試 | **116/116 通過** | 文件格式／整合 70、後端 34、另 12 provider cases；實際完整 verify 結果，不是舊版 48 項 |
| 伺服器瀏覽器 UI | **7/7 通過** | `artifacts/frontend-crdt-validation.md`、`artifacts/collaboration-browser.log`；包括兩位編輯者即時及短暫離線合併、viewer 與撤權 |
| 裝置／預覽 build | `dist-local`、`dist-preview` 成功且模式標記通過 | 裝置 `--mode device`；預覽 `--mode preview` |
| 裝置本機 UI | **3/3 通過** | 主代理執行：真實鍵盤富文字、斷網編輯、reload 持久保存、Pages 子路徑及手機版型 |
| 裝置本機資料層 | **17/17 由執行代理回報通過** | 無獨立落檔 log；不得宣稱已有該 log，也不併入 Node 116 或 UI 2 項 |
| 響應式／返回確認 | 多寬度、橫直向、縮短高度鍵盤壓力及返回確認已有 server UI 證據 | [行動驗收](MOBILE-VALIDATION.md)；不代表實機相機、Safari 或 PWA 安裝 |
| Docker | **實際建置／啟動未執行** | GE76 未具可用 Docker CLI；[部署說明](DEPLOYMENT.md) |
| Google／LINE／OpenAI | **真實憑證 E2E 未執行** | adapter／ACL／預算／錯誤分支 mock；未建立 grant 或發送真實訊息 |
| Android APK | 原始碼／workflow 不構成已產出或可安裝證據 | 以 [Android 驗收](ANDROID.md)、APK、SHA、簽章與模擬器／實機結果為準 |

舊 `artifacts/verify.log`、`artifacts/e2e.log` 或其他中間 log 可保留追蹤，但不得把 0.1 的 48 項 API、5 項 UI 或舊 bundle 大小當成 0.2 最終結果。Node、server UI、local UI 及代理回報資料層是不同套件，不合成未實際執行的總測試數。

## 功能矩陣

| 功能 | 已實作／已測 | 憑證或剩餘限制 |
| --- | --- | --- |
| 伺服器帳號 | scrypt、session、CSRF／Origin、登出、正式設定 fail closed | 本機 email 未驗證；無寄信重設密碼與自動帳號合併 |
| 私人／群組 ACL | owner／editor／viewer；note／file／export／SSE／WebSocket 隔離；撤權與降級 | 正式群組分享需雙方 Google 驗證；不寄邀請信 |
| 富文字文件 | 真正 Tiptap：標題、格式、清單／待辦、引言、程式碼、安全連結 | 不等於 AFFiNE／AppFlowy 全部功能；Markdown source 唯讀 |
| 共同編輯 | Yjs／Hocuspocus、canonical snapshot + journal、重連合併、重複 update 去重 | 無 awareness／他人游標；server 模式無持久裝置離線快取 |
| 中繼資料 | 獨立 `metadataVersion`；確認 AI 分類亦增加版本 | 中繼資料 `409` 仍須處理，正文由 CRDT 合併 |
| 筆記本／標籤／搜尋／視圖 | 分類、搜尋、卡片／資料表／看板、狀態／到期欄位 | 非任意 schema 資料庫；未對每個視圖操作分別完成 E2E |
| 12 模板＋空白 | 旅行、行李、採買、購物、任務、SOP、會議、日記、學習、費用、維修、靈感 | 中英文 Markdown／Yjs roundtrip 全測 |
| 照片／影片／附件 | 大小／MIME／檔頭、ACL、range、去重 | 真實手機拍照待實機；大型續傳／病毒掃描待擴充 |
| 手寫白板 | 壓感、粗細／顏色、撤銷／重做、PNG、可重編向量 | 整張畫布值同步與衝突提示；不是逐筆畫多人 CRDT 或無限白板 |
| 裝置／靜態預覽 | 真實 IndexedDB、明確本機模式、群組／外部整合停用；UI 3/3 | 不共享、不雲端同步；清除資料或解除安裝可能遺失內容 |
| PWA／品牌 | manifest、公用 shell service worker、自訂 App 內名稱／頭像／圖示 | 不快取 server 私人 API；OS 名稱／圖示更新受平台與重裝限制 |
| 語言／外觀 | 繁中／英文、深淺色、10 款 AI 背景與自訂背景 | 完整 WCAG／實機驗證尚未完成 |
| 分帳／結清 | 整數最小幣值、確定性餘數、餘額與收款人確認、重複確認防護 | 無轉帳、資金代管或第三方 LINE Pay P2P |
| 匯出／匯入 | 可攜 JSON／Markdown、格式／範圍、去重與 rollback | Markdown 可正規化空白；完整附件／ACL／Yjs 復原需 `DATA_DIR` |
| Google 登入 | PKCE／state／nonce／JWKS／iss／aud／expiry／userinfo mock | OAuth client／redirect／consent、真實 E2E 待配置 |
| Drive／Calendar／Gmail／LINE | 固定官方 adapter、group owner binding、預覽確認、outbox 去重 | 真實授權／目的地／送達未測；自助連線 UI、重試 worker 未完成 |
| AI 分類／翻譯 | 明確來源、日期／時區、預覽、單次與三層每日額度、確認分類 | server key 必需；不掃相簿／傳未選照片；真實費用與模型效果未驗證 |
| STT | 可插拔 adapter、mock multipart 測試 | UI、音訊時長／費用預算未啟用，無公開 HTTP route |

## 安全與完整性回歸

- 跨群組不可互讀；viewer、撤權、降級與 session 失效不能繼續接收或寫入。正式群組不接受未驗證本機 email 冒充成員。
- journal 先於套用／回應；拒無效 Yjs 依賴、額外 roots、危險 URL／屬性、過深 XML、嵌入值、畸形 Unicode 及超限狀態。固定 Tiptap position migration root 有精確 shape 驗證。
- 12 模板雙語、HTML literal、Unicode、手寫標記、程式碼圍欄、連結標題與段落起始符號 roundtrip。未支援 Markdown image／table／非十進位列表拒絕並保留舊原文。
- 正文／metadata 版本分離；舊 REST 正文不能覆寫 Yjs，舊 metadata 不能撤銷確認的 AI 分類。資源參照與 tombstone 防止 mutation 回讀舊全文或復活刪除項目。
- AI 三層額度及操作認領原子化；跨 user／workspace、並發重複、零額度、寫入失敗 rollback、缺 key 零扣額與 uncertain 保留額度均測。
- OAuth 簽章／iss／aud／nonce／期限／userinfo 否定案例；外部預覽不發送、binding 變更重驗、結果不明不自動重送。
- 帳本金額守恆、固定餘數、非法參與者、收款人確認與重複確認已測。

## 尚未完成與發布邊界

尚未完成端對端加密、server 持久離線同步、awareness、逐筆畫多人白板、任意資料庫 schema、Photos Picker、群組自助 OAuth／token 保管庫、可靠排程通知 worker、完整無障礙與實機驗證。裝置版不是免設定多人同步服務。

本次沒有代建 OAuth grant、寄 Gmail、推 LINE、建真實行程、付款、改防火牆或部署公開資料服務。GitHub 原始碼、靜態預覽、APK 與 CI 發布狀態須以可核對 URL、SHA、產物與執行證據為準。

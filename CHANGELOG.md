# 更新紀錄 · Changelog

[繁體中文 README](README.md) · [English README](README.en.md) · [English changelog](CHANGELOG.en.md)

版本號代表原始碼版本；APK、Pages 與 GitHub Release 是否已發布，需查看對應 CI 與實際產物。本紀錄只列實際存在的版本。

## 2026-10-27 · 0.2.0

**狀態：原始碼與本機驗證完成；Android debug APK／Pages 的 CI 產物及發布待確認。**

- Implemented Tiptap + Yjs + Hocuspocus document collaboration, concurrent editing and merging after an open tab reconnects.  
  實作真正多人正文協作、同時編輯與開啟中分頁重連合併；不再只依賴 REST 409 衝突處理。
- Added canonical Yjs snapshots and a synchronous SQLite journal before acknowledgement, plus schema validation and restart recovery.  
  新增 canonical Yjs 快照、確認前同步提交的 SQLite journal、schema 驗證與強制終止後恢復測試。
- Separated metadata versions from content updates and enforced session, Origin, CSRF and document ACL checks on WebSocket traffic.  
  標題／標籤版本與正文分開，WebSocket 逐次驗證會話、來源、CSRF 及筆記權限；唯讀、撤權、降權、登出與過期均有回歸。
- Bounded authenticated WebSocket traffic and queues; production email sharing requires verified identities.  
  加入已認證 WebSocket 流量及佇列限額；正式 Email 群組分享拒絕未驗證的本機身分。
- Minimized mutation caches, retained content-free deletion tombstones and isolated authentication limits by address and account.  
  操作快取改資源參照；刪除保留無全文墓碑，重試不復活；登入限流避免一個帳號鎖住整個代理位址。
- Preserved editable handwriting as a complete canvas value, with concurrent replacement guidance.  
  保留可再編輯手寫與衝突提示；畫布整值保存，不宣稱逐筆 CRDT。Awareness／多人游標仍停用。
- Added IndexedDB device mode and a separate static preview build; local data is not automatically sent to a collaboration server.  
  新增 IndexedDB 裝置模式與獨立靜態預覽建置；個人內容不自動上傳，群組及外部整合需伺服器模式。
- Added Android WebView wrapper source, restricted export handling and a debug APK verification workflow.  
  新增 Android WebView 封裝、受限原生匯出介面及 debug APK 驗證流程；未宣稱已產生可下載 APK、正式簽章或真機通過。
- Improved mobile navigation, editor readability, generated backgrounds and real bilingual documentation.  
  改善手機返回流程、編輯可讀性、生成背景與實際繁中／英文文件。
- Passed 116 local automated tests, seven server UI tests and two device UI tests.  
  本機 116 項自動測試、7 項伺服器 UI、2 項裝置 UI 通過；外部憑證、Docker 與原生真機驗收仍分別列為待驗證。

安裝及資料邊界見 [README](README.md)。Android debug 更新可能因簽章不同而需要重新安裝，**移除前先匯出**；JSON 不包含附件、帳本或群組權限。Pages 預覽不是共用後端。

## 2026-10-27 · 0.1.0

**狀態：初版核心基線；後續功能以 0.2.0 為準。**

- Created private/group notes, notebooks, search, tags, templates, attachments, handwriting and deterministic TWD expense splitting.  
  建立私人／群組筆記、筆記本、搜尋、標籤、模板、附件、手寫與確定性 TWD 分帳。
- Added local password accounts, session/CSRF/Origin checks, per-workspace roles and protected attachments.  
  加入本機密碼帳號、會話／CSRF／來源驗證、工作空間角色與附件權限。
- Added SSE notifications and optimistic version checks, JSON portability and server-side integration adapters.  
  加入 SSE 變更通知與版本檢查、JSON 可攜資料及伺服器整合介面；此基線尚無 CRDT。
- Delivered responsive PWA assets, Traditional Chinese/English UI, appearance settings and initial acceptance records.  
  提供響應式 PWA 資產、繁中／英文介面、外觀設定與初版驗收紀錄。

---

**Build by Tony · 2026 年製作**

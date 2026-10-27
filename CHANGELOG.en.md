# Changelog

[English README](README.en.md) · [繁體中文 README](README.md) · [繁中更新紀錄](CHANGELOG.md)

Version numbers identify source versions. Check CI and actual artifacts to establish whether an APK, Pages site or GitHub Release has been published. Only real version milestones are listed.

## 2026-10-27 · 0.2.0

**Status: source and local validation complete; Android debug APK / Pages CI artifacts and publication remain pending confirmation.**

- Implemented Tiptap + Yjs + Hocuspocus collaboration with concurrent editing and merging after an open tab reconnects.  
  實作真正多人正文協作、同時編輯與開啟中分頁重連合併，不再只有 REST 409。
- Added canonical Yjs snapshots, a synchronous SQLite journal before acknowledgement, schema validation and recovery after abrupt termination.  
  新增 Yjs 快照、確認前 SQLite journal、schema 驗證與程序強制終止後恢復。
- Separated metadata versions and enforced session, Origin, CSRF and document ACL checks on WebSocket traffic. Tested viewer denial, revocation, downgrade, logout and expiry.  
  中繼資料版本獨立；WebSocket 驗證會話、來源、CSRF 及權限，並測試唯讀、撤權、降權、登出與過期。
- Bounded authenticated WebSocket traffic and pending queues; production email sharing now requires verified Google identities.  
  加入已認證流量及佇列上限；正式群組 Email 分享需要 Google 已驗證身分。
- Replaced full mutation caches with resource references and content-free deletion tombstones. Authentication limits isolate accounts behind a shared address.  
  快取改資源參照及無全文墓碑，重試不復活；登入限流不再由單一帳號鎖住整個代理位址。
- Kept editable handwriting as a whole-canvas value with concurrent replacement guidance; stroke-level CRDT and awareness/cursors are not provided.  
  手寫保留整值保存與並行替換提示；不是逐筆 CRDT，也不提供 awareness／多人游標。
- Added IndexedDB device mode and a static preview build without automatic server uploads. Groups and external integrations remain server features.  
  新增 IndexedDB 裝置模式與靜態預覽；內容不自動上傳，群組及外部整合需要伺服器。
- Added Android WebView wrapper source, restricted native export and a debug APK verification workflow; downloadable APK, production signing and device acceptance are not yet claimed.  
  新增 Android 封裝、受限匯出及 debug APK 流程；未宣稱已完成可下載 APK、正式簽章或真機驗收。
- Improved mobile Back behavior, editor readability, generated backgrounds and actual Traditional Chinese/English documentation.  
  改善手機返回、編輯可讀性、生成背景及實際繁中／英文文件。
- Passed 116 local automated tests, seven server UI tests and two device UI tests. Credential-backed external tests, Docker and native physical-device acceptance remain separate outstanding checks.  
  本機 116 項自動測試、7 項伺服器 UI、2 項裝置 UI 通過；外部憑證、Docker、原生真機仍待分別驗證。

See [README](README.en.md) for installation and storage boundaries. Debug signing can change between APK builds: **export before uninstalling**. JSON excludes attachments, expenses and group permissions. Pages is a device-mode preview, not a shared backend.

## 2026-10-27 · 0.1.0

**Status: initial core baseline; current functionality is documented under 0.2.0.**

- Added private/group notes, notebooks, search, tags, templates, attachments, handwriting and deterministic TWD expense splitting.  
  建立私人／群組筆記、筆記本、搜尋、標籤、模板、附件、手寫與 TWD 分帳。
- Added password accounts, sessions, CSRF/Origin enforcement, workspace roles and protected attachments.  
  加入密碼帳號、會話、CSRF／來源檢查、工作空間角色與附件權限。
- Added SSE notifications, optimistic version checks, JSON portability and server-side integration adapters; this baseline did not include CRDT.  
  加入 SSE、版本檢查、JSON 可攜資料與整合介面；初版基線尚無 CRDT。
- Delivered responsive PWA assets, Traditional Chinese/English UI, appearance settings and initial acceptance evidence.  
  提供響應式 PWA、繁中／英文介面、外觀設定與初版驗收紀錄。

---

**Build by Tony · 2026 年製作**

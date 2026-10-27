抽獎NOTE Android 開發測試版 / Android development preview

這是內建同一套前端的 Android WebView APK，可在未啟動伺服器時使用裝置內筆記。資料保存在此 App 的 IndexedDB，不會自動同步至網頁預覽或多人後端。多人服務網址交由系統瀏覽器開啟。

此 APK 使用 **debug 開發簽章**，不是正式發行金鑰。不同 CI 建置的憑證可能不同；若 Android 拒絕覆蓋安裝，先在 App 匯出備份，再移除舊版與安裝新版。移除 App 會刪除裝置內資料。不要以此版本保存唯一副本。

下載 `.apk`，依 Android 提示允許目前瀏覽器安裝此檔；確認發佈來源與 `SHA256SUMS.txt`。請閱讀 `apk-verification.json`、`apk-signature.txt` 及 `emulator-smoke.json`，它們區分套件／簽章驗證與是否實際執行啟動測試。未提供實體 Galaxy S26 驗收證明。

Chrome 手機尺寸模擬不算 APK 實測。原生相機拒權／取消、圖片影片選檔、手寫觸控捲動、系統匯出與 App 結束程序後重啟持久性，須依實際 Android 測試紀錄判斷；沒有 emulator／實機條件的項目標示 `not-run`。可選自動 smoke 的 IndexedDB 檢查僅涵蓋頁面 reload，不能當成上述全部通過。

The APK bundles the local-only web app and stores notes in its own IndexedDB. It is a WebView wrapper, not a native rewrite. Shared servers open in the system browser and do not automatically receive local notes.

This is a **debug-signed development APK**. CI certificates may change between builds. Export your notes before uninstalling to resolve a signature mismatch; uninstalling erases local app data. Check the published SHA-256, signing fingerprint, package verification, and emulator report. Emulator tests do not prove physical Samsung or iPhone behavior. iPhone users should use the responsive web app/PWA, not this APK.

Build by Tony · 2026 年製作

# Android APK：安裝、建置與限制

抽獎NOTE 的 Android APK 是 **Android WebView 封裝**，內建本專案同一套 React 前端的 `dist-local`。它不是原生重寫，也不是只開啟 `localhost` 的空殼。Android 8.0（API 26）以上可安裝；建置目標 API 35。iPhone 不支援 APK，請使用響應式網頁／PWA。

APK 是否已建置、可下載及通過啟動測試，以 [GitHub Actions](https://github.com/tonykfr1234/lucky-note/actions/workflows/android.yml) 和 [Releases](https://github.com/tonykfr1234/lucky-note/releases) 的**實際產物**為準。只有原始碼或 workflow 存在，不代表 APK 已完成。每次產物包含 `apk-verification.json`、`apk-signature.txt`、`SHA256SUMS.txt` 與 `emulator-smoke.json`。

## 安裝與更新

1. 從本 repo 的 Releases 下載 `LuckyNote-<版本>-debug.apk`，比對該次 `SHA256SUMS.txt`。
2. 開啟 APK，依 Android 提示允許目前使用的瀏覽器／檔案管理器安裝此檔。不要停用 Play Protect；只為你確認的來源開啟所需安裝權限。
3. 開啟「抽獎NOTE」。第一次使用即為裝置模式，不需要 Google 帳號或正在執行的電腦。
4. 輸入測試筆記、關閉再開啟確認仍存在；使用匯出功能建立自己的備份。
5. 若要共同編輯，從 App 開啟自行部署的 HTTPS 服務網址，使用系統瀏覽器登入。裝置模式的筆記不會自動傳入該服務。

目前 workflow 產生 **debug 開發測試 APK**，package 為 `tw.tony.luckynote.debug`。它使用 Android 開發憑證，不是正式發行簽章。沒有建立新的 production signing identity、沒有把 keystore 或密碼放入 repo。Android Studio／Gradle 生成的 debug 私鑰不會上傳為 artifact。

不同 CI 執行環境的 debug 憑證可能不同。若 Android 顯示簽章不相容，**先匯出備份**，再移除舊 APK 與安裝新版；移除 App 會刪除其 IndexedDB、附件與設定。不能保證 debug APK 可直接覆蓋升級，也沒有內建自動更新。正式穩定發行需要由維護者選擇並安全保存長期 signing identity，這一步尚未代為執行。

App 內名稱／頭像／背景設定屬前端設定。Android launcher 名稱與圖示來自 APK manifest/resources，改動後必須重新建置安裝；不宣稱 App 內更換圖示會立即變更系統圖示。

## 資料與權限邊界

| 項目 | 實際行為 |
| --- | --- |
| 筆記與附件 | 存在本 App 的 IndexedDB；與瀏覽器預覽及其他裝置分開 |
| 網路 | APK 不宣告 `INTERNET`，WebView 設 `blockNetworkLoads`，不連本機伺服器或協作後端 |
| 內建資產 | `WebViewAssetLoader` 映射至 `https://appassets.androidplatform.net/`，沒有 `file://` 任意讀取 |
| 多人／Google | HTTPS 服務連結交系統瀏覽器；不在嵌入 WebView 執行 Google OAuth |
| 選擇照片／影片／檔案 | 系統選檔器，只處理使用者當次選擇，取消回傳空結果 |
| 拍照 | 系統相機 intent＋本次私有 cache URI，沒有廣泛相簿掃描或常駐相機權限 |
| 暫存相片 | 私有 cache；重新啟動時清除超過 24 小時的拍照暫存，空檔取消後移除 |
| 系統備份 | `allowBackup=false`，cloud/device-transfer 規則排除此封裝資料；使用者應自行匯出 |
| Debug | 開發 APK 開啟 WebView DevTools；請勿用開發版保存唯一或高度敏感資料 |

沒有 `JavascriptInterface`、任意 native 檔案路徑介面、通用 JavaScript 執行橋、native shell 或 native 網路上傳功能。外部連結只接受 HTTPS；不接受 HTTP、`file:` 或 `javascript:` 導航。原生返回鍵使用 WebView history 配合前端 `pushState`；首頁返回顯示離開確認，API 33+ 使用系統 Back callback。

## 原生匯出協定

為讓 JSON／Markdown 在 Android 真的儲存成檔案，唯一訊息介面為 `WebViewCompat.addWebMessageListener` 的 `LuckyNoteExport`：

```json
{"id":"unique-request-id","name":"notes.json","mime":"application/json","base64":"ey4uLn0="}
```

介面只注入固定 origin `https://appassets.androidplatform.net`，handler 再驗證 **main frame** 與 exact origin。只接受文字 WebMessage，嚴格要求四個欄位，ID 只允許 1–80 個英數、`_`、`-`。格式只允許 `application/json`、`text/plain`、`text/markdown`；decoded payload 最多 **10 MiB**，不允許一般二進位／HTML 匯出。檔名移除路徑與控制字元，補上對應副檔名，不能指定 native 儲存路徑。

每次匯出都啟動 `ACTION_CREATE_DOCUMENT`，由使用者選擇目的地。handler 只向該次系統回傳的 `content://` URI 寫入，不接受呼叫端傳入 URI。只有一個 pending 匯出；相同 ID 在同次 App 工作階段不能重放（最多 1024 個 ID，再開啟 App 重設）。取消及錯誤會釋放 pending，若重試需產生新 ID。

```json
{"id":"unique-request-id","status":"saved"}
{"id":"unique-request-id","status":"cancel"}
{"id":"unique-request-id","status":"error","error":"write_failed"}
```

只有 output stream 寫入並關閉成功才回傳 `saved`。這表示文件提供者接受了寫入，不保證使用者選擇的第三方雲端文件提供者已完成遠端同步。取消不產生成功訊息；程序被系統終止時不會假裝完成。Android System WebView 必須支援 `WEB_MESSAGE_LISTENER`；舊版缺此能力時不會回退成不安全 bridge，直接 Blob 下載會提示沒有已確認的下載檔。

## 本機建置

GE76 目前只確認 Java 8、adb 31.0.3 與 Gradle 7.x cache，未找到 Android SDK／JDK 17。這些不足以建置本專案，未偷偷安裝 SDK 或接受 SDK 條款。

若你已有合法配置的工具鏈：JDK 17、Gradle 8.11.1、Android platform 35、build-tools 35.0.0、Node 22.17+：

```sh
npm ci --ignore-scripts
npm run build:local
gradle -p android --no-daemon :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
python android/tools/verify_apk.py
```

設定 `JAVA_HOME` 及 `ANDROID_HOME` 指向自己的既有安裝。`local.properties` 如有需要只留本機，不提交。`android.builder.sdkDownload=false` 禁止 Gradle 背景補裝 SDK。使用固定 AGP 8.9.2、Gradle 8.11.1、AndroidX WebKit 1.12.1、Core 1.15.0。APK 不依賴 CPU ABI 的原生 library。

`dist-local/index.html` 與 `dist-local/build-mode.json`（`{"mode":"local-only"}`）缺少時，Gradle 會拒絕打包，避免誤用需伺服器的前端。產物位於 `android/app/build/outputs/apk/debug/app-debug.apk`；驗證後另複製至 `artifacts/android/`，這些產物不提交原始碼。

## GitHub Actions 與下載

`Android debug APK` workflow 以 Ubuntu 24.04 runner 的既有 JDK 17／Android SDK 35 為前提。它會：

1. 檢查既有工具，安裝鎖定 npm dependencies 並建立裝置前端。
2. 執行 assemble、Android lint、JUnit 原生匯出政策測試。
3. 以 `aapt` 確認 package、version、debuggable 及無網路／廣泛媒體權限。
4. 以 `apksigner verify --verbose --print-certs` 驗簽，確認 development certificate，計算 SHA-256。
5. 嘗試使用已裝 emulator/system image；可選擇嘗試官方 API 35 image，但 stdin 為 EOF、從不執行 `--licenses` 或傳送 `yes`。若既有授權不足，停止該步並記錄 `not-run`。
6. 有可用 emulator／KVM 時安裝啟動 APK，透過 debug WebView DevTools 驗證內建頁、匯出介面存在與 IndexedDB 重載持久化，留下真實 screenshot；失敗不寫成通過。

產物 `LuckyNote-android-debug` 保留 14 天。`workflow_dispatch` 的 `publishDebug` 預設關閉；維護者明確提供新 `vX.Y.Z-android-debugN` tag 才能將已驗證 APK 發成 prerelease。它只用該次 workflow 的短期 `GITHUB_TOKEN`，不建立持續 token，且拒絕替換已存在 release。一般產品 release 由維護者統一協調。

## 驗收狀態

本文件初次加入時的實際狀態（2026-10-27）：

| 驗收項 | 狀態 | 證據／限制 |
| --- | --- | --- |
| Pure Java 匯出政策 | passed | GE76 Java 8 執行 18 checks：origin/frame/MIME/size/name/duplicate/cancel |
| XML／安全靜態審查 | passed | 7 個 XML 解析；獨立 review 後修正非文字訊息、pending failure、chooser URI |
| Python／Node 驗證腳本語法 | passed | `py_compile`、`node --check`；不等於實際 Android 執行 |
| APK assemble／Android lint／JUnit | not-run on GE76 | 缺 SDK/JDK 17；以實際 CI 結果補上 |
| apksigner／aapt／SHA | not-run until APK exists | 只有成功產物才有 verification report |
| emulator launch／IndexedDB 頁面重載 | conditional | 見該次 `emulator-smoke.json`，不是實體手機或程序重啟驗收 |
| App 結束程序後重啟的 IndexedDB 持久性 | not-run on device | 需在 APK 建立筆記／附件→結束程序→重啟→核對資料；網頁 reload 不足以通過此項 |
| `onShowFileChooser` 圖片／影片 URI | not-run on device | 真 WebView 選擇圖片與影片，確認預覽、保存、重開；拒絕不合法 URI，取消不新增附件 |
| 系統相機取消／拒權後改選檔 | not-run on device | 實際開系統相機，取消或拒權，再改選照片；不能只用瀏覽器檔案注入測試替代 |
| 手寫觸控與畫布／頁面捲動 | not-run on device | 真 WebView 觸控繪圖、撤銷／重做、畫布外捲動、旋轉後筆跡與操作區驗證 |
| 系統匯出保存／取消／再試 | not-run on device | 需要 Android 文件提供者，取消不可顯示 saved；新 ID 可再次匯出 |
| Galaxy S26 實機／鍵盤／橫向 | not-run | 現有網頁 CSS 尺寸模擬不能替代原生硬體驗收 |
| iPhone 原生 App | 尚未實作 | iPhone 使用網頁/PWA；本 repo 不提供 iOS IPA |

Android UI smoke 只能證明該次 generic emulator 環境啟動；它不證明 Galaxy S26 相機供應商、Samsung display zoom、實體鍵盤／安全區或檔案提供者行為。正式使用前請在實機補測：建立筆記→重開→手動匯出→取消→再次匯出→重新匯入；選檔取消與相機拒絕後仍可改選檔；直橫向／鍵盤／系統返回；跨版本先備份再升級。

**Chrome／Playwright 桌面或手機尺寸測通，不能填入「APK 實測通過」。** 現有自動 emulator smoke 最多驗證內建頁載入、匯出介面存在與測試 IndexedDB 的頁面 reload；它沒有操作系統選檔器／相機，也沒有驗證 App 結束程序後的資料還原。若 emulator／映像／KVM 或實機不可用，以上原生項目一律維持 `not-run`，不得以 Java policy checks 或 browser E2E 代填。

## English quick guide

This is a local-first **Android WebView wrapper** bundling `dist-local`, not a native rewrite. Download the debug APK only from this repository's Releases, verify its SHA-256, and open it on Android 8+. Local IndexedDB is separate from website/browser storage. Shared HTTPS servers open in the system browser; local data is never automatically sent there.

Debug signing is for development. Certificates may change between CI runs, preventing in-place upgrades. **Export notes before uninstalling**; uninstall deletes local data. Production signing and Play Store publication are not configured. The APK requests no Internet or broad media permissions. File/photo operations use user-driven system pickers. JSON/Markdown export uses one origin-restricted channel and Android's save dialog; cancellation is not success.

Build with JDK 17, Gradle 8.11.1, API 35/build-tools 35.0.0 and Node 22.17+: run `npm ci --ignore-scripts`, `npm run build:local`, then the Gradle command above. Check the actual CI artifact reports for build/signature/emulator status. No physical Galaxy S26 or iPhone native test is claimed.

Browser/Chrome viewport tests are not APK validation. Native file/photo/video URI selection, camera denial/cancellation, handwriting touch/scroll, system-save cancellation, and IndexedDB persistence after terminating and restarting the app require the real APK WebView. Current optional emulator smoke checks page reload persistence only. Mark all unavailable native checks `not-run`.

## 上游與授權

- [Android WebView 本機內容](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)：HTTPS asset origin 設計。
- [AGP 8.9 相容性](https://developer.android.com/build/releases/agp-8-9-0-release-notes)：Gradle 8.11.1、JDK 17、API 35。
- [AndroidX WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit)：1.12.1。
- [檔案選擇器的 URI 信任界線](https://developer.android.com/reference/android/webkit/WebChromeClient.FileChooserParams)。
- [WebMessageCompat 型別](https://developer.android.com/reference/androidx/webkit/WebMessageCompat)。
- [預測返回](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)。
- [GitHub runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)：runner 會更新，workflow 仍檢查實際工具。

Android 直接依賴與工具版本（依 `android/app/build.gradle`、`android/build.gradle`、`android.yml`，2026-10-27 核對）：

| 元件／座標 | 版本 | 範圍 | 授權與來源 |
| --- | --- | --- | --- |
| `androidx.webkit:webkit` | 1.12.1 | APK runtime；AssetLoader／受限訊息介面 | Apache-2.0；[官方版本記錄](https://developer.android.com/jetpack/androidx/releases/webkit#1.12.1)、[Google Maven POM](https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/1.12.1/webkit-1.12.1.pom)、[AndroidX LICENSE](https://github.com/androidx/androidx/blob/androidx-main/LICENSE.txt) |
| `androidx.core:core` | 1.15.0 | APK runtime；FileProvider | Apache-2.0；[官方版本記錄](https://developer.android.com/jetpack/androidx/releases/core#1.15.0)、[Google Maven POM](https://dl.google.com/dl/android/maven2/androidx/core/core/1.15.0/core-1.15.0.pom)、[AndroidX LICENSE](https://github.com/androidx/androidx/blob/androidx-main/LICENSE.txt) |
| `junit:junit` | 4.13.2 | `testImplementation`，不打入 APK | EPL-1.0；[版本標籤 POM／license 宣告](https://github.com/junit-team/junit4/blob/r4.13.2/pom.xml)、[LICENSE-junit.txt](https://github.com/junit-team/junit4/blob/r4.13.2/LICENSE-junit.txt) |
| `com.android.application` / AGP | 8.9.2 | 建置 plugin，不打入 APK | Apache-2.0；[官方版本與相容性](https://developer.android.com/build/releases/agp-8-9-0-release-notes)、[Google Maven POM](https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/8.9.2/gradle-8.9.2.pom)、[Android build-system 原始碼](https://android.googlesource.com/platform/tools/base/+/mirror-goog-studio-main/build-system/) |
| Gradle | 8.11.1 | CI 建置工具，不打入 APK | Apache-2.0 與發行包隨附 third-party notices；[固定版本 LICENSE](https://github.com/gradle/gradle/blob/v8.11.1/LICENSE) |

這是**直接依賴清單**，不是已驗證的完整 runtime dependency／授權清冊；實際 APK 的 transitive dependencies 與 notices 仍須以成功 CI 的解析及產物內容核對。上述 Google Maven POM 是套件來源定位，本次網頁讀取器未能直接擷取 POM；AndroidX 上游 LICENSE 與 JUnit 固定版本 POM 已實際讀取，不把無法擷取的 POM 說成已查驗內容。

本專案自行撰寫的 wrapper 採根目錄 MIT。第三方元件不是本專案獨有成果；打包設定未額外排除上游 LICENSE／NOTICE／META-INF，發布前仍應檢查 APK 的實際 notices。Android SDK 的使用條款與 Android 開源元件授權不同，未代替使用者接受新 SDK 條款。前端 npm dependencies 請另見根目錄 `THIRD_PARTY_NOTICES.md`。

Build by Tony · 2026 年製作

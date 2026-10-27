# 參與開發 · Contributing

[繁體中文 README](README.md) · [English README](README.en.md) · [更新紀錄](CHANGELOG.md) · [Security](SECURITY.md)

歡迎提交可重現問題、文件改進及範圍明確的修正。請先搜尋現有 issues；涉及安全問題時依 [SECURITY.md](SECURITY.md) 私下回報，不在公開 issue 附上 token、私人筆記或可直接利用的資料。

## 開發環境

需要 Node.js 22.17+、npm 8+ 及 Git。先 fork 或 clone 專案，在自己的分支工作：

~~~sh
npm ci --ignore-scripts
npm run build
npm start
~~~

後端預設為 http://127.0.0.1:4317；另開終端執行 npm run dev，Vite 使用 http://127.0.0.1:5173。開發代理支援 API 與同源 WebSocket；不要為測試停用 Origin、CSRF 或 ACL。

裝置模式使用 npm run build:local 與 npm run preview:local；Pages 路徑預覽使用 npm run build:preview 與 npm run preview:web。詳見兩份 README。建立分支與本機測試不表示授權外網部署或公開使用者資料。

## 提交前驗證

~~~sh
npm run verify
npm run test:e2e
npm run test:local
node scripts/secret-scan.mjs
~~~

依變更範圍執行有意義的驗證，記錄執行環境與結果。Windows Playwright 使用設定中的 Chrome；Linux CI 使用 Chromium。不要將未執行的測試標為通過。純文件修改應至少核對相對連結、圖片、命令與中英文一致性。

| 變更範圍 | 必要考量 |
| --- | --- |
| 筆記／協作 | shared schema、Yjs journal-before-ACK、離線重連、重複更新、版本遷移、無效文件與重啟恢復 |
| 權限／身份 | 私人與跨群組拒讀、viewer 拒寫、撤權／session 到期、未驗證 Email 不可正式分享 |
| 附件／匯入 | MIME／檔頭／大小、工作空間歸屬、取消、重複、非法 archive rollback、刪除後不復活 |
| 裝置儲存 | IndexedDB commit 後才顯示成功、空間不足、取消、跨分頁合併、重載與刪除墓碑 |
| 分帳 | 整數最小幣值、確定性尾差、總額守恆、角色及收款人確認；不加入假付款成功 |
| 外部整合／AI | server-side keys、固定端點、明確來源與預算、預覽後確認、去重及不確定結果；mock 不代表真實送達 |
| 手機／Android | 響應式、鍵盤與返回、選檔取消、debug 簽章與實際 CI／裝置證據分列 |

核心原則：前端禁用按鈕不能取代伺服器授權；手寫整值與正文 CRDT 的語意不同；伺服器未同步分頁記憶體不能被稱為完整離線持久化。

## Pull Request 內容

請描述具體問題、修正後行為、驗證方式，以及資料遷移／回復需求。UI 變更附合成資料截圖並說明尺寸或真機環境；API／儲存變更附失敗與權限案例。只提交與該問題相關的內容。

版本變更同步更新 README.md、README.en.md、CHANGELOG.md、CHANGELOG.en.md 及相關 docs。Changelog 使用 YYYY-MM-DD · x.y.z 標題，保留英文與繁中說明；只列真實版本。公開頁面、APK、CI、模擬器與真機的狀態需分開寫，不以存在 workflow 推定已發布。

文件採 [Tony App 共用規範](https://github.com/tonykfr1234/TalkBridge/blob/main/docs/APP_STANDARD.zh-TW.md) 的版本、關於及驗收精神，並以本專案實際提供的語言與已確認範圍為準。保持 112 px 圖示、可用語言導覽、真實徽章、三欄截圖及製作者署名。

## 資料、授權與發布

- 不提交 .env、資料庫、上傳附件、備份、cookie、API key、OAuth token、keystore 或簽章密碼。範例只能使用無效佔位值。
- 使用合成資料寫測試及截圖。修復涉及使用者資料時先備份；不要用刪除資料或移除權限檢查來通過測試。
- 依賴鎖定版本，核對上游授權，執行 npm run licenses 並保留 THIRD_PARTY_NOTICES.md；新增 Android 依賴亦需更新對應聲明。
- 新程式碼沿用 MIT。不要把研究參考的整套專案或受其他授權限制的程式碼直接拼入。
- APK／Pages／GitHub Releases 由維護者依實際 CI 結果發布；不在 PR 中加入持續 token、靜默接受新 SDK 條款或替換既有 release 產物。
- 若修改資料格式，記錄升級與回復方法。UI JSON 匯出不含完整服務狀態；伺服器完整備份需要一致的 DATA_DIR 與另行保管的設定。

## English contribution guide

Use Node.js 22.17+, npm 8+ and a dedicated branch. Install with npm ci --ignore-scripts, then build/start the server; npm run dev launches the front end. Device and static-preview builds are separate modes described in [README.en.md](README.en.md).

Before submitting, run the relevant verification commands above. Explain the concrete problem, resulting behavior, tests and migration/rollback considerations. Include synthetic screenshots for UI work and negative authorization cases for API/storage work. Document unexecuted tests honestly; browser viewport coverage is not physical-device acceptance.

Keep server credentials and private data out of Git. Preserve ACL, session, CSRF and Origin checks; viewer rejection must occur before journal writes. Device saves are successful only after IndexedDB commit. Canvas replacement is not stroke-level CRDT, and open-tab offline memory is not durable server-mode offline storage.

Update both real README/changelog files and relevant documentation. Keep dependency versions and notices current. Maintainers coordinate APK, Pages and release publication using actual CI artifacts; do not add long-lived credentials, accept SDK terms silently or overwrite existing release assets. Report vulnerabilities through [SECURITY.md](SECURITY.md).

---

**Build by Tony · 2026 年製作**

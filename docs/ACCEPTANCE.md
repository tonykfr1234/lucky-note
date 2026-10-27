# 功能與驗收清單

紀錄日期：2026-10-27。這是可執行的第一版核心；外部 mock 測試不代表已連線真實帳號。

## 最終本機驗證

| 檢查 | 結果 | 證據 |
| --- | --- | --- |
| TypeScript strict、ESLint | 前後端通過 | artifacts/verify.log |
| Node 自動測試 | **48/48 通過**，含 6 個 OIDC 否定子案例 | artifacts/verify.log |
| Vite production build | 通過，JS 約 338 KB／gzip 109 KB | artifacts/verify.log |
| Chrome UI E2E | **5/5 通過** | artifacts/e2e.log |
| 響應式 | 320/390/430/768/1024/1440 px 主畫面無水平溢位，390 px 深色設定面板通過 | e2e/app.spec.ts、artifacts/*.png |
| 秘密掃描 | 樣式掃描無命中；另外核對排除 data、.env、備份 | scripts/secret-scan.mjs |
| npm audit | 0 個已知漏洞；npm 6 audit endpoint 已提示退役，只作輔助證據 | 工作紀錄 |
| Docker | **未執行**：GE76 無 Docker CLI | docs/DEPLOYMENT.md |
| 真實 Google／LINE／OpenAI | **未執行**：沒有憑證，未建立授權或外送 | docs/INTEGRATIONS.md |
| Android／iOS 真機安裝與相機 | **未執行**；mobile viewport 不是實體手機驗收 | 後續驗收 |

兩款手機尺寸、直橫向、鍵盤縮高、safe-area 與診斷頁的精確界線見 [手機驗收](MOBILE-VALIDATION.md)。

早期測試修復：AbortError 被誤當空 JSON 而白屏、CSP 下手寫 dataURL 不能用 fetch 轉 Blob、Windows 暫存清除時序。舊失敗 log 保留為 artifacts/initial-tests-windows-cleanup.log，最終測試已通過。

## 功能矩陣

| 功能 | 已實作與已測範圍 | 需要憑證／限制 |
| --- | --- | --- |
| 本機帳號 | 密碼 scrypt、session、CSRF、Origin、登出；API＋UI 註冊通過 | 不需憑證；沒有 email-only 假登入；正式缺安全設定 fail closed |
| 私人／群組與權限 | owner/editor/viewer、加入已註冊帳號、撤權；跨群組 note/file/export/events 隔離通過 | 沒有寄送邀請 email |
| 筆記／筆記本／標籤／搜尋 | 自有 block 文件、Markdown、清單（非 Tiptap）；UI 編輯保存重載、搜尋空狀態通過 | 不需憑證 |
| 12 種模板＋空白 | 旅行、行李、採買、購物、任務、SOP、會議、每日、學習、費用、維修、靈感 | 旅行模板 UI 實測；SOP 版本及購物欄位可編輯，非任意型別 DB schema |
| 卡片／表格／看板 | 已實作顯示、拖曳及狀態選單 | 完整獨立操作 E2E 尚未覆蓋 |
| 附件／拍照／影片 | 20 MB、MIME＋檔頭、ACL、range、去重；API 通過 | 相機權限與播放需真機驗證；禁止 SVG/HTML |
| 手寫白板 | 筆色／粗細／橡皮擦／撤銷重做、PNG＋可重編輯筆跡 | UI 畫線、撤銷重做、保存、重開通過 |
| 協作同步 | SSE＋版本號，409 保護、草稿保留、撤權／重連 | 未採用 Yjs；沒有 CRDT 字元合併或離線自動合併，未宣稱完成 AFFiNE 式同頁協作 |
| PWA | manifest、SVG/PNG icons、公開 shell service worker | manifest 與不快取 API 已測；OS 安裝／更新待真機 |
| 語言與外觀 | 繁中／英文、深淺色、頭像、App 內品牌／圖示 | 英文主流程、深色與品牌設定重載已測；OS 安裝品牌仍取自部署 manifest，本機偏好不會改寫它；少數原生網路例外仍可能英文 |
| 背景 | 10 款真正 AI 生成 WebP＋縮圖、自訂圖片 | 全部 20 圖尺寸／SHA256 已核對，原始 PNG 另外保存在生成 ZIP；UI 選取、只載入所選 full 圖及 gallery 已通過 |
| 分帳與結清 | TWD 整數最小幣值、確定尾差、餘額、收款人確認 | 101/3 守恆、異幣拒絕、去重已測；不轉帳／不代管資金 |
| JSON 匯出匯入 | 筆記／筆記本 round-trip、驗證、去重、rollback | 不含附件／帳本／成員；完整備份需 DATA_DIR |
| Google 登入 | PKCE/state/nonce、RS256/JWKS、iss/aud/expiry、userinfo，mock 通過 | 需要 OAuth client/redirect/consent；真實 E2E 未測 |
| Drive/Calendar/Gmail/LINE | 固定官方端點、群組 owner binding、預覽確認、去重 outbox，mock 通過 | 需要各別憑證和目的地；完整連線管理 UI 尚未完成 |
| AI 分類／翻譯 | 明確選取 metadata、日期／時區、預覽、token 預算、再次確認，mock 通過 | 需要 server-side API key；不掃描相簿，不傳未選照片 |
| STT | 真實 adapter、mock multipart 測試通過 | UI／音訊時長預算尚未實作，未開放付費操作 |

## 已通過的安全回歸

- 私有與跨群組資料隔離、唯讀拒寫、owner 管理、撤權及 SSE。
- session／錯密碼／CSRF／Origin／登出／production fail closed。
- mutation ID 去重與 payload 衝突、跨筆記本拒絕、舊版本 409。
- MIME／內容／大小限制、附件匿名拒絕、參數化 SQL。
- 金額尾差守恆、非成員與異幣拒絕、收款人確認、重複確認不重計。
- JSON 還原及非法 archive rollback、資料持久化、無秘密／ACL 匯出。
- OAuth 取消、簽章／issuer／audience／nonce／expiry／userinfo 否定案例。
- 外部未配置不呼叫網路、預覽不發送、結果不明禁止自動重送。
- AI 明確來源、預覽／建議／套用分離、預算、去重與版本衝突。

## 已通過的 UI 回歸

真實註冊、可編輯旅遊模板、保存與重新載入、空搜尋、取消／Esc、六種 viewport、深色設定、自訂名稱與設定重載、手寫撤銷重做與再編輯、409 保留草稿、PWA 不快取私人 API。截圖使用乾淨合成測試資料，不是真實使用者筆記。

## 尚未實作／仍需驗證

CRDT／離線合併、端到端加密、任意關聯資料庫、完整白板物件系統、Google Photos Picker、群組自行 OAuth 管理、token 保管庫／輪替、可靠排程通知 worker、原生商店上架、真機與完整無障礙／所有背景 WCAG 稽核尚未完成。空間建立在不確定網路結果後手動重試可能重名，筆記／附件／匯入／費用已有穩定去重鍵。

沒有 LINE Pay P2P 或代管資金。此次沒有建立 OAuth grant、寄 Gmail、發 LINE、建立真實行程、付款、改防火牆或部署公開 runtime。GitHub SHA／CI 與素材狀態在 WORKLOG.md 更新。

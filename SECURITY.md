# 安全政策

LuckyNote 第一版包含帳號、私人內容和第三方整合入口。請先在本機驗收，正式公開執行服務前完成 [驗收表](docs/ACCEPTANCE.md) 的安全項目與外部登入測試。公開原始碼不等於公開使用者資料。

## 報告問題

請勿在公開 issue 貼上密碼、API key、OAuth token、session cookie、私人筆記、媒體或完整資料庫。若 GitHub 儲存庫已啟用 private vulnerability reporting，請使用其 Security 頁面提交；若尚未啟用，先以不含利用細節和私密資料的 issue 詢問維護者的私下聯絡方式。

## 必須維持的邊界

- 每個 API 重新驗證身份和工作空間角色；知道 UUID 不代表取得權限。
- session 使用 HttpOnly cookie，跨站寫入受 origin 和 CSRF 防護；正式環境使用 HTTPS 和 Secure cookie。
- 密碼不得明文儲存或記錄。Google verified email 不代表可以靜默接管既有本機帳號。
- API key、OAuth client secret、refresh token 和 LINE channel token 只在伺服器配置。任何 `VITE_*` 變數都視為公開。
- 私人筆記、附件、帳號資料庫、備份和 `.env` 不進 Git、不放入公開 `public/` 或發行 ZIP。
- provider 呼叫只能使用已配置的固定服務端點與經授權的群組目的地，不接受使用者輸入的任意代理 URL。
- 通知與分類先預覽、再明確確認；不得自動掃描整個相簿、替使用者轉帳或把私人摘要發往群組。
- service worker 不快取私人 API 和附件；撤權不承諾抹除已匯出或已下載的使用者副本。

## 部署者責任

正式模式不可使用範例 session secret，也不可用沒有 TLS 的公開 origin。限制資料目錄和備份的 OS 存取權，保持 Node 和相依套件更新，定期測試復原。反向代理應設置請求大小與流量限制；若改為多節點，需要共享且一致的 session／授權／事件儲存。

本機密碼模式沒有郵件驗證、寄信找回密碼或完整帳號生命週期管理。除非部署者明確啟用並接受其限制，正式模式使用配置好的 Google OAuth。外部 Google grant、官方帳號與 API 金鑰必須由擁有者依法取得，不由此程式自行建立。

## 已知限制

- 第一版不是端到端加密筆記產品；伺服器管理員能接觸其儲存資料。
- 小型媒體上傳不包含完整惡意檔案掃描、轉碼或內容安全服務。
- SSE／樂觀鎖避免靜默覆蓋，沒有 CRDT 離線合併保證。
- mock provider 測試不能驗證真實 OAuth、供應商費用、訊息送達或權限審查結果。
- AI API 的供應商保留政策依帳戶和端點而異；`store:false` 不能解讀成零資料保留。

安全問題的修補狀態、測試和剩餘限制應記錄於版本與驗收文件，不能把「未測」寫成「不適用」或「已修復」。

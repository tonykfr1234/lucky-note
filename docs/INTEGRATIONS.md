# 抽獎NOTE：整合、隱私與驗證狀態

本版本提供實際可呼叫的後端整合介面及模組。沒有配置憑證時會回傳 `503 NOT_CONFIGURED`，UI 顯示尚未配置；不把本機測試或 mock 回應標為外部連線成功。這次交付沒有建立 OAuth grant、寄 Gmail、推播 LINE、上傳 Drive、建立遠端行事曆或消耗 OpenAI 額度。

## 狀態

| 功能 | 已實作 | 已測 | 仍需要 |
| --- | --- | --- | --- |
| Google 登入 | 授權碼、PKCE、state、nonce、JWKS RS256 驗簽、issuer/audience/expiry、userinfo 身分一致檢查；不自動合併同 email 本機帳號 | 模擬官方端點的成功／取消／重複 state 測試 | 自有 OAuth web client、正式 redirect URI、真實端到端驗證 |
| Drive | 指定群組資料夾的 5 MiB 以下 multipart 附件副本 adapter；預覽／確認 API | 二進位內容、資料夾綁定、型別／大小拒絕測試 | drive.file 授權、已由使用者選定或由 app 建立的目標資料夾；完整 UI 尚未實作 |
| Calendar | 指定日曆建立事件、確定性 event ID、時區檢查，不發邀請郵件 | adapter 端點／日期／重複識別碼測試 | calendar.app.created 或必要的 calendar.events.owned 授權；完整 UI 尚未實作 |
| Gmail | MIME UTF-8 編碼、header injection 防護、明確預覽／確認 API | adapter MIME／輸入測試 | gmail.send 授權及已驗證寄件者；完整 UI 尚未實作 |
| LINE | Official Account Messaging API push、明確綁定、quiet hours、去重 key、預覽／確認 API | adapter＋outbox 去重、結果不明停止重送、私有空間／非 owner 拒絕測試 | 官方帳號 token 與合法收件目標綁定；完整 UI 尚未實作 |
| OpenAI 分類 | 手選筆記 metadata、日期／時區、預算預覽、明確確認送出、人工確認分類 | 選取／跨群組／重複／缺憑證／預算／版本衝突／人工套用測試 | OpenAI API key、真實模型品質與計費驗證 |
| 翻譯 | 明確選取文字及確認、request token 上限、每日保留預算、操作去重 | 模擬 adapter 與不同成員同操作 ID 隔離測試 | OpenAI API key、真實品質驗證 |
| STT | `transcribeAudio()` 獨立可替換 adapter，限定手動傳入的 audio bytes | multipart／MIME／大小／缺憑證測試 | 音訊時長與金額預算、UI／HTTP route 尚未啟用 |
| Google Photos／本機相簿掃描 | 未實作；不啟用背景讀取 | 無未授權掃描路徑 | 日後 Google Photos Picker 或明確手選本機資產流程 |
| LINE Pay | 未串接付款／P2P | 不適用 | 本 App 只有分帳帳本及結清建議，不代轉帳、不保管款項 |

## Server-side 設定

參考專案 `.env.example`。所有憑證留在 server 環境或部署平台 secret store，不使用 `VITE_*` 憑證，不寫入 git、網頁 bundle、日誌或 API 回應。部署平台應負責 secret store 的加密、權限、輪替和備份；本版本沒有自行建立雲端 KMS。

```dotenv
APP_ORIGIN=http://localhost:4317
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_MAX_OUTPUT_TOKENS=1024
OPENAI_MAX_REQUEST_TOKENS=12000
OPENAI_DAILY_TOKEN_LIMIT=20000
LINE_CHANNEL_ACCESS_TOKEN=
WORKSPACE_INTEGRATIONS_JSON={}
```

`WORKSPACE_INTEGRATIONS_JSON` 以真實工作空間 ID 為 key，由部署者在使用者完成個別授權與收件綁定後設定。以下只有欄位示意，不包含有效憑證：

```json
{
  "WORKSPACE_ID": {
    "googleRefreshToken": "SERVER_SECRET_PLACEHOLDER",
    "driveFolderId": "USER_SELECTED_FOLDER_ID",
    "calendarId": "AUTHORIZED_CALENDAR_ID",
    "gmailFrom": "verified-sender@example.invalid",
    "lineRecipientId": "VERIFIED_LINE_USER_OR_GROUP_ID",
    "quietHours": { "start": 22, "end": 8, "timeZone": "Asia/Taipei" }
  }
}
```

登入僅要求 `openid email profile`。登入成功不代表已授權 Drive、Calendar 或 Gmail；本版不提供替使用者建立這些授權的精靈。外部 refresh token 只從 env 讀取，未寫入應用資料庫。資料庫會暫存十分鐘的 OAuth state hash、PKCE verifier、nonce，以及工作資料預覽／執行結果，需和筆記資料一樣受磁碟與備份權限保護。

Google OAuth redirect URI 必須是 `${APP_ORIGIN}/api/auth/google/callback`。正式環境使用 HTTPS；開發可用 localhost／127.0.0.1。APP_ORIGIN 不能帶使用者名稱、子路徑、query 或 fragment。`GET /api/auth/google` 會跳轉登入，取消授權回到 `/?auth=cancelled`，每個 state 只能消費一次。測試用 key 不可用於正式環境。

Drive 的 `drive.file` 只授權本 app 建立或使用者透過 Picker 開放的檔案，不能假設任意既有資料夾都可存取。本版的指定資料夾須事先具備合法授權。My Drive 共用資料夾和 Google Workspace shared drive 有不同所有權／帳號限制；程式的 `supportsAllDrives=true` 並不替使用者取得權限。Drive 只儲存附件副本，不充當協作資料庫。要處理更大影片，需實作 resumable upload 與工作背景佇列，目前明確拒絕超過 5 MiB 的 Drive 複製。

## API 與出站操作

已登入後 `GET /api/integrations?workspaceId=...` 回傳每項服務的 configured、description、missing 欄位名稱；不回傳任何值或 token。所有 mutation 仍通過核心 session、Origin、CSRF 與 workspace ACL 檢查。

群組擁有者可呼叫：

1. `POST /api/workspaces/:id/integrations/:provider/preview`，provider 為 `line`、`gmail`、`calendar`、`drive`。內容分別為 `{text}`、`{to,subject,text}`、`{summary,description,start,end,timeZone}`、`{name,mime,data}`，data 為手選檔案的 base64。回傳不可變預覽及收件目標。
2. 檢視預覽後 `POST .../:provider/confirm`，body 為 `{previewId,confirmed:true,clientMutationId}`。每次確認都重查登入者、群組 owner、配置與綁定指紋。綁定改變會回傳 `409 BINDING_CHANGED`，必須重新預覽。
3. 成功狀態只在官方端點成功回應後記錄。同一使用者／空間／provider／clientMutationId 重複呼叫不會再次寄送；同 key 不同內容拒絕。LINE retry key 和 Calendar event ID 另包含使用者與工作空間範圍。

私有工作空間不能使用對外群組發送 routes，editor/viewer 也不能發送。LINE 收件 ID 綁定必須由群組管理員在外部合法取得並確認；本版本沒有實作 webhook 綁定精靈。不得把私人筆記自動套入群組訊息。

Outbox 狀態為 `preview → attempting → done/failed/uncertain`。中斷、逾時或可能已寫入的服務錯誤會保留 `uncertain`；相同內容再送也被阻擋，需先人工核對外部結果。本版沒有自動重試 worker、排程推播或結果核銷 UI。安靜時段是明確拒絕當下送出，不是已排入稍後佇列。不要把「已預覽」誤讀為「已寄送」。

## AI 資料流與預算

第一版分類範圍為「使用者手選筆記標題與標籤」，不讀筆記全文、不讀照片／影片 bytes，也不背景掃描相簿。日期 cutoff 使用筆記建立時間，按指定 IANA 時區轉成當地日期，預設 `Asia/Taipei`；這不是照片拍攝時間判斷。

1. `POST /api/workspaces/:id/ai/preview`：`{noteIds,fromDate,timeZone,maxOutputTokens,tokenBudget}`。最多 20 篇、驗證每篇屬於目前空間。回傳確切 `inputText`、排除數及估計 token 上界，尚未送外部服務。
2. `POST .../ai/suggest`：`{previewId,confirmed:true}` 才送出。未配置 key、超預算、重複提交都不會發送。每天按使用者保留預算，先保守扣除 UTF-8 bytes＋輸出上限＋指令餘裕，不因逾時或 usage 缺漏而誤當免費。
3. AI 回傳為純建議文字，不能呼叫工具或修改檔案。使用者另選每篇筆記的目的 notebook，再送 `POST .../ai/confirm`：`{previewId,confirmed:true,assignments:[{noteId,notebookId}]}`。伺服器重驗選取集合、目的 notebook 的 workspace、筆記版本；任一變更先中止，不覆蓋別人的編輯。這個確認操作是原子交易且可去重。

翻譯 `POST /api/workspaces/:id/tools/translate` 的 body 為 `{text,targetLanguage,confirmed:true,clientMutationId,maxOutputTokens,tokenBudget}`；也會檢查預算及跨成員操作隔離。STT 暫未提供 HTTP route。

Token 上限是使用量防護，不是準確的金額報價。模型價格、帳號限制可能改變，部署者應另外設定 OpenAI project 使用額度／警示，檢查當前模型價格。ChatGPT 訂閱不包含應用程式的 OpenAI API 額度。`store:false` 並不等於服務供應商零保留；請讀供應商資料政策，敏感內容需先取得合法授權。

## 官方依據與限制（2026-10-27 查核）

- [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)、[OpenID Connect](https://developers.google.com/identity/openid-connect)
- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)、[Drive files 與所有權](https://developers.google.com/workspace/drive/api/guides/about-files)
- [Calendar 授權](https://developers.google.com/workspace/calendar/api/auth)、[events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Gmail 發信](https://developers.google.com/workspace/gmail/api/guides/sending)
- [LINE Messaging API push](https://developers.line.biz/en/reference/messaging-api/#send-push-message)、[群組](https://developers.line.biz/en/docs/messaging-api/group-chats)
- [Google Photos Picker 與 Library API 變更](https://developers.googleblog.com/google-photos-picker-api-launch-and-library-api-updates/)：2025-03-31 後不能用舊 Library API 讀取使用者完整既有相簿；PWA 也不能保證背景掃描本機相簿。
- [OpenAI Responses](https://developers.openai.com/api/docs/guides/text)、[語音轉文字](https://developers.openai.com/api/docs/guides/speech-to-text)、[資料政策](https://developers.openai.com/api/docs/guides/your-data)
- [LINE Pay 商家 API](https://developers-pay.line.me/online-api-v4)：不當作第三方 P2P 分帳轉帳 API。

測試以 `npm test` 執行。mock fetch 只驗證 request contract、權限、去重、失敗分支與安全預設；Google consent screen、真實 scope、外部帳號權限、供應商計費與交付成功都尚未端到端驗證。

## 三層 AI 預算（0.2.0）

所有 AI 分類與翻譯在 UTC 日界線，同時檢查使用者、工作空間與整個部署額度：`OPENAI_DAILY_TOKEN_LIMIT=20000`、`OPENAI_WORKSPACE_DAILY_TOKEN_LIMIT=100000`、`OPENAI_DEPLOYMENT_DAILY_TOKEN_LIMIT=200000`。任一設為 `0` 可停止該範圍的 AI 消耗；非法或負值設定會回傳配置錯誤。

SQLite `BEGIN IMMEDIATE` 將操作認領、三層檢查與預算保留放在同一筆交易，避免同時提交重複扣額或超過上限。儲存失敗全數回復；外部呼叫後結果不明則保留預算，不自動退額或重試。部署總額包含既有 `ai_budget` 保留紀錄；工作空間累計由本版新增表開始記錄。上限涵蓋使用同一資料庫的部署；其他服務若共用 API key，仍須自行設定供應商端總額控制。

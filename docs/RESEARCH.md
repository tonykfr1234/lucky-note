# 選型、授權與整合研究

研究日期：2026-10-27。星數是當日頁面約數，只代表社群關注程度，不能證明功能適合、授權可直接合併或服務仍持續維護。本專案沒有把以下整套產品拼接在一起；只有 `package-lock.json` 與第三方授權清單所列的套件才是實際依賴。

## 產品參考

| 專案 | 當日約略 stars | 值得參考的體驗 | 本版採用方式 |
| --- | ---: | --- | --- |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | 73.9k | 文件與白板整合、工作空間 | UX 參考；未 fork、未納入其 backend |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 77.7k | 筆記、資料庫視圖與協作 | UX 參考；未移植整套服務 |
| [Joplin](https://github.com/laurent22/joplin) | 56.9k | 筆記本、標籤、附件、可攜資料 | 參考整理和匯出方向 |
| [Notesnook](https://github.com/streetwriters/notesnook) | 14.8k | 私人筆記體驗與安全定位 | 研究參考；不宣稱本產品具有相同加密特性 |
| [SiYuan](https://github.com/siyuan-note/siyuan) | 47k | 區塊組織與知識連結 | 後續資料結構參考 |
| [TriliumNext](https://github.com/TriliumNext/Trilium) | 38.6k | 階層筆記與個人知識庫 | 後續筆記階層參考 |
| [Tiptap](https://github.com/ueberdosis/tiptap) | 38.9k | 可擴充 rich-text editor core | 0.2 已採用 MIT core 3.32.0，文件富文字與共用 schema |
| [Yjs](https://github.com/yjs/yjs) | 23k | CRDT 文件同步 | 0.2 已採用 13.6.33，搭配 Hocuspocus 4.7.1、後端 ACL 與持久化 journal |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | 134.6k | 白板與圖形編輯 | 未納入；本版是自建手寫 canvas |

採獨立 React／Node／SQLite 的原因是安裝路徑短、資料模型和 ACL 可直接驗證、外部整合可單獨測試。代價是第一版沒有成熟上游產品的所有 editor、白板、資料庫、離線協作功能。未完成部分列入路線圖，不用視覺相似度冒充功能相同。

## 授權核對

- AFFiNE 根目錄 LICENSE 對 `packages/backend` 和 `packages/common/native` 明訂例外，不能直接把整個專案稱為 MIT。Backend 文件區分 CE 的 MPL 2.0 與 EE 的額外商業條件。[根 LICENSE](https://github.com/toeverything/AFFiNE/blob/canary/LICENSE)、[backend LICENSE](https://github.com/toeverything/AFFiNE/blob/canary/packages/backend/server/LICENSE)
- AppFlowy-Cloud 的 GitHub 頁面標示於 2026-09-11 封存為唯讀；SelfHost-Commercial 明列其商業授權。因此沒有將封存的 Cloud 庫當成持續維護中的現行部署基礎。[Cloud](https://github.com/AppFlowy-IO/AppFlowy-Cloud)、[SelfHost-Commercial](https://github.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial)
- Joplin 的 server 目錄有自己的授權文件，評估託管服務時需查看該檔，不能只看主 repo 標籤。[Joplin server LICENSE](https://github.com/laurent22/joplin/blob/dev/packages/server/LICENSE.md)
- Tiptap、Yjs、Hocuspocus 的實際鎖定套件已核對 MIT 授權，列於 `THIRD_PARTY_NOTICES.md` 與 `docs/DEPENDENCIES.json`；未採用商業 extensions 或託管服務。Excalidraw 仍是候選，未納入。[Tiptap LICENSE](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md)、[Yjs LICENSE](https://github.com/yjs/yjs/blob/main/LICENSE)、[Excalidraw LICENSE](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)

GPL、AGPL 等自由軟體授權不等於禁止商業使用；需遵守適用的再散布、修改、對應原始碼與網路使用條件。自訂 server／商業授權的限制是另一件事。此處記錄工程選型依據，不替代特定商業部署的法律審查。

本專案沒有複製參考筆記產品的 UI 素材、商標或整套程式碼；使用的編輯器與同步套件依其授權整合。已安裝依賴的實際版本與授權由 lockfile 和發行時的授權清單核對；研究表不能當作 NOTICE。

## Google：身份、檔案與相簿

Google 登入只證明身份，不能視為已授權 Drive、Calendar 或 Gmail。每個整合應在使用時解釋用途並要求最小 scope。

- Drive 優先採 `drive.file`，限使用者選取或由應用程式建立的檔案；擴大存取前需重新評估使用者同意和驗證要求。[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- My Drive 中的共用資料夾仍與個人檔案所有權有關；Workspace shared drive 的檔案由群組或組織擁有。UI 不應把兩者說成同一種「群組自有雲端」。Drive 可存附件和快照，不能代替本產品的工作空間 ACL 或同步資料庫。[Drive ownership](https://developers.google.com/workspace/drive/api/guides/about-files)
- Calendar 優先考慮 `calendar.app.created` 或需求所需的最小 events scope；避免為建立一個行程要求整個日曆管理權。[Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- Gmail 的 `gmail.send` 和讀取／修改整個信箱是不同 scope；第一版發送介面不應順便要求整箱讀取權。[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- 自 2025-03-31 起，Photos Library API 聚焦應用程式上傳的內容；讀取既有相簿內容應改用 Picker，讓使用者主動選取。本版沒有接入 Photos Picker，也不會宣稱能在背景掃描手機所有相簿。[Google 公告](https://developers.googleblog.com/google-photos-picker-api-launch-and-library-api-updates/)

## LINE 與分帳

LINE Notify 已於 2025-03-31 終止；新的訊息整合應使用 LINE Official Account 的 Messaging API，明確綁定個人／群組目的地，而不是重用舊 Notify 設計。[官方終止公告](https://developers.line.biz/en/news/2024/10/07/line-notify-will-be-discontinued/)、[Messaging API](https://developers.line.biz/en/docs/messaging-api/sending-messages/)

Bot 加入群組與群組 ID 有自己的設定和 webhook 流程；筆記群組與 LINE 群組不是自動相等，不能把私人內容套用預設群組 ID 後直接送出。[LINE 群組說明](https://developers.line.biz/en/docs/messaging-api/group-chats/)

LINE Pay Online API 是商家線上支付介面，不能冒充通用 P2P 分帳／轉帳 API。本版只做共同費用、餘額、結清建議與人工紀錄，不建立付款按鈕、不代管資金。[LINE Pay Online API](https://developers-pay.line.me/online-api-v4)

## AI 與個人媒體

分類流程應先由使用者選取來源、cutoff 日期與時區，再預覽將傳出的內容、限制項目數／token／預算，最後由使用者確認分類建議。AI 不是群組權限決策者，也不能自動建立日曆或向外發送訊息。

OpenAI API 與 ChatGPT 訂閱分開；API key 僅留在 server。資料保留取決於端點和帳戶政策，`store:false` 不能宣稱零保留。[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

程序生成 CSS 背景是可重現的設計素材，不應標成 AI 生成圖片。若加入實際 AI 背景，需保留素材來源和生成紀錄，並與使用者私人照片分開。

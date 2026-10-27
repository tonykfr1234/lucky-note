# Galaxy S26 與 iPhone 16 Pro Max 版面驗收

驗收日期：2026-10-27。實際執行 App、使用合成帳號／資料，以 Playwright 1.64.1 控制本機 Chrome。這是 **Chromium 尺寸模擬**，未在實體 Samsung、iPhone、Samsung Internet 或 Safari 上執行。

| 目標 | CSS 可用區域 | DPR | 證據與限制 |
| --- | --- | --- | --- |
| iPhone 16 Pro Max，瀏覽器直向 | 440 × 763 | 3 | 已安裝 Playwright descriptor；screen 是 440 × 956 |
| iPhone 16 Pro Max，瀏覽器橫向 | 838 × 390 | 3 | 已安裝 Playwright landscape descriptor |
| iPhone 全螢幕布局 | 440 × 956／956 × 440 | 3 | PWA 全螢幕假設，未驗證實機安裝或平台工具列 |
| Galaxy S26，較窄適配區間 | 360 × 780／780 × 360 | 3 | synthetic engineering assumptions，非官方確認 CSS viewport |
| Galaxy S26，顯示縮放適配區間 | 412 × 892／892 × 412 | 2.625 | synthetic engineering assumptions，不是唯一實機值 |
| 鍵盤縮高壓力 | 360 × 500／440 × 500 | 對應上列 | 模擬 viewport 縮小與輸入焦點／儲存，沒有真實 OS 鍵盤 |
| 額外響應式壓力 | 320／390／430／768／1024／1440 px 寬 | 1 | 主畫面與有內容的文件無水平溢位 |

Galaxy S26 標準版官方規格是 6.3 吋、1080 × 2340 硬體像素；iPhone 16 Pro Max 是 1320 × 2868。硬體像素不能直接當 CSS viewport。S26 的 CSS viewport、DPR、瀏覽器工具列及顯示縮放差異仍需實機校準。

## 本版實作及檢查

- 預設「抽獎NOTE」及繁中，en-US 瀏覽器也不自動覆蓋；英文介面可手動切換。
- 手機正文至少 16 px、主要控制約 14 px；長採買內容隨欄寬自動增高。
- viewport-fit=cover、四邊 env(safe-area-inset-*)；沒有把某一手機瀏海高度寫死。
- visualViewport resize 更新可用高度；縮高時將有焦點的輸入框捲入可見區。dvh 並不等於完整鍵盤解法。
- 淺／深主題 muted 文字對 surface 的自動對比檢查至少 4.5:1。這不是所有 UI 元件、背景及狀態的完整 WCAG 稽核。
- 真實文件／採買／SOP／待辦／分帳示範資料；圖中不是 Markdown 原碼，也不是 AI mockup。
- 10 個 AI 縮圖延遲載入，只載入選取的完整背景；私人 API 不進 service worker cache。

本機開啟 [/viewport-diagnostics.html](/viewport-diagnostics.html) 可查看 screen、innerWidth/Height、DPR、visualViewport、standalone 與含安全區的 padding。數值僅在本機頁面顯示，不儲存或上傳，也不辨識裝置型號。之後可在真機旋轉、開鍵盤、改顯示縮放與安裝模式時校準。

測試程式：e2e/populated.spec.ts。實際矩陣：artifacts/device-layout-matrix.json；執行紀錄：artifacts/e2e.log、artifacts/device-layout.log。截圖位於 docs/screenshots/，檔名中的 galaxy-s26 代表適配假設，不代表實機完成。

## 規格與行為來源

- [Samsung Galaxy S26 官方發布](https://news.samsung.com/global/samsung-unveils-galaxy-s26-series-the-most-intuitive-galaxy-ai-phone-yet)
- [Apple iPhone 16 Pro Max 技術規格](https://support.apple.com/en-gb/121032)
- [Playwright 官方裝置描述](https://github.com/microsoft/playwright/blob/main/packages/isomorphic/deviceDescriptorsSource.json)
- [WebKit 安全區設計](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
- [Viewport units](https://web.dev/blog/viewport-units)
- [Chrome viewport resize 與鍵盤](https://developer.chrome.com/blog/viewport-resize-behavior)
- [Chrome Device Mode 的模擬界線](https://developer.chrome.com/docs/devtools/device-mode)

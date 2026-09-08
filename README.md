# BrowserExtension - 清大校務與全網通用驗證碼自動填入 (v1.2.0)

專為**國立清華大學校務資訊系統 (CCXP / AIS)**、**OAuth 認證系統 (eeclass / eLearn)** 以及 **全網任意常見英數字驗證碼** 設計的純本機離線神經網路辨識與自動填入工具。

支援 **電腦端 (Chrome / Edge / Chromium 瀏覽器)** 與 **📱 手機端 iPhone / iPad (Safari)**！

---

## 🎯 雙軌辨識架構與支援網站

1. **國立清華大學專屬通道（極速 2ms）**：
   - **校務資訊系統**：`https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/`（6 位數彩色數字與混淆符號）
   - **eeclass / eLearn OAuth 登入**：`https://oauth.ccxp.nthu.edu.tw/`（4 位數干擾線條數字）
   - 採用量身訓練之超輕量深度神經網路，記憶體開銷小於 3MB，推論只需 2 毫秒。

2. **全網通用自適應通道（Universal WebAssembly OCR）**：
   - 支援任意第三方登入表單、註冊頁、管理後台常見之 **可變長度英數字混和驗證碼**。
   - 採用 **WebAssembly ONNX Runtime** 離線執行量化 CRNN-CTC 模型（`common_q8.onnx`）。
   - **智慧表單啟發式掃描**：
     - 自動識別驗證碼輸入框與驗證碼圖片。
     - **智慧排除簡訊驗證碼**（自動檢測並避開「獲取驗證碼」、「發送短信」等手機簡訊流程）。
     - 空間歐氏距離與 DOM 容器配對，精準鎖定對應關係。

---

## 🛡️ 核心技術特色

1. **直接畫布渲染 (Zero Second-Fetch)**：
   - 傳統插件使用二次請求會導致後端 Session 驗證碼被改寫，造成畫面與伺服器脫節失效。
   - 本工具優先透過 Canvas 擷取瀏覽器 DOM 畫面上已載入的圖像像素，**100% 杜絕驗證碼失效問題**。
2. **純本機離線隱私保障**：
   - 所有推論與運算均在瀏覽器本機沙盒（Manifest V3 Offscreen）完成，零外部網路請求，絕不上傳任何網頁或圖像數據。
3. **無感靜默體驗與手動輔助**：
   - 進入網頁自動偵測並靜默填入，不在網頁上注入多餘文字或破壞排版。
   - 點擊驗證碼圖片刷新時，會即時自動重新辨識並更新輸入框。
   - 擴充功能彈出面板提供「強制辨識當前頁面」按鈕，應對罕見非標準自訂表單。

---

## 💻 電腦版 (Chrome / Edge) 安裝教學

### 步驟 1：開啟擴充功能管理頁面
- **Google Chrome**：網址列輸入 `chrome://extensions/` 並按 Enter。
- **Microsoft Edge**：網址列輸入 `edge://extensions/` 並按 Enter。

### 步驟 2：開啟「開發人員模式」
- 在頁面右上角（Edge 在左側選單），開啟 **「開發人員模式 (Developer mode)」**。

### 步驟 3：載入套件
1. 從 [Releases 頁面](https://github.com/IvanHuang2031/BrowserExtension/releases) 下載最新版 `BrowserExtension.zip` 並解壓縮。
2. 點擊左上角 **「載入未封裝項目 (Load unpacked)」**，選取解壓縮出來的資料夾 `BrowserExtension`。
3. 安裝完成！打開任意有驗證碼的網頁即可自動辨識並填入。

---

## 📱 iPhone / iPad (Safari) 安裝教學（清大專用）

在 iOS 上，可透過 Safari 延伸功能運行專用油猴腳本：

### 步驟 1：下載免費 App
- 在 iPhone / iPad App Store 搜尋並下載 **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)**（免費、開源、無廣告）。

### 步驟 2：在 iOS 設定中啟用 Safari 延伸功能
1. 打開 iOS **「設定」** ➔ 往下滑找到 **「Safari」**。
2. 點選 **「延伸功能 (Extensions)」** ➔ 點進 **「Userscripts」**。
3. 將開關切換為 **開啟**，權限設定選擇 **「所有網站」➔「允許」**。

### 步驟 3：一鍵安裝腳本
1. 使用 Safari 打開腳本安裝連結：
   👉 **[點此安裝 nthu-captcha.user.js](https://raw.githubusercontent.com/IvanHuang2031/BrowserExtension/main/nthu-captcha.user.js)**
2. Safari 提示安裝時點擊 **「Install」** 即可！

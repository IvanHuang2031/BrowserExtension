# 清大校務與 OAuth 驗證碼自動填入 (NTHU Captcha Auto-Fill)

專為**國立清華大學校務資訊系統 (CCXP / AIS)** 與 **OAuth 認證系統 (eeclass / eLearn)** 設計的純本機高速驗證碼辨識與自動填入工具。

支援 **電腦端 (Chrome / Edge / Firefox)** 與 **📱 手機端 iPhone / iPad (Safari)**！

---

## 🎯 支援的網站與系統

1. **清華大學校務資訊系統**：
   - 網址：`https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/`
   - 驗證碼：6 位數彩色數字與混淆符號
2. **eeclass 數位學習平台 / eLearn OAuth 登入**：
   - 網址：`https://oauth.ccxp.nthu.edu.tw/v1.1/authorize.php...`
   - 驗證碼：4 位數干擾線條數字

---

## 🛡️ 核心技術特色

1. **直接畫布渲染 (Zero Network Request)**：
   - 傳統插件使用 `fetch` 或 `new Image()` 會觸發二次請求，導致後端 Session 驗證碼被改寫，畫面與伺服器脫節。
   - 本工具直接透過 Canvas 擷取瀏覽器畫面上已載入的圖像像素，**100% 杜絕驗證碼失效與脫節問題**。
2. **純本機離線神經網路 (CNN + Attention) 推論**：
   - 內建專門為清大校務 6 位數與 OAuth 4 位數分別訓練的深度學習模型。
   - 推論只需 **2 ~ 4 毫秒**，完全在本地執行，無需聯網或外部伺服器，零隱私洩漏風險。
3. **極簡靜默體驗**：
   - 進入頁面 0.1 秒內直接自動填入輸入框，不在網頁上注入任何多餘文字或徽章。
   - 點擊驗證碼圖片刷新時，會即時自動重新辨識並更新輸入框。

---

## 📱 iPhone / iPad (Safari) 安裝教學（只需 1 分鐘）

在 iOS 上，Apple 允許 Safari 透過延伸功能運行油猴腳本（Userscript）。你可以使用 App Store 上完全免費、開源且無廣告的 **Userscripts** App：

### 步驟 1：下載免費 App
- 在 iPhone App Store 搜尋並下載 **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)**（免費、開源、無廣告）。
  *(也可以使用知名 App **[Stay](https://apps.apple.com/app/stay-for-safari/id1591620924)**)*

### 步驟 2：在 iPhone 設定中啟用 Safari 延伸功能
1. 打開 iPhone **「設定」** ➔ 往下滑找到 **「Safari」**。
2. 點選 **「延伸功能 (Extensions)」** ➔ 點進 **「Userscripts」**。
3. 將開關切換為 **開啟**。
4. 下方的權限設定，選擇 **「所有網站」➔「允許」**（或至少允許 `nthu.edu.tw`）。

### 步驟 3：一鍵安裝腳本
1. 在 iPhone 上使用 Safari 打開本專案的腳本安裝連結：
   👉 **[點此安裝 nthu-captcha.user.js](https://raw.githubusercontent.com/IvanHuang2031/nthu-captcha-autofill/main/nthu-captcha.user.js)**
2. Safari 畫面會提示是否安裝 Userscript，點擊 **「Install (安裝)」** 即可！
3. 安裝完成！打開 iPhone Safari 的 [eeclass 登入頁](https://oauth.ccxp.nthu.edu.tw/) 或校務資訊系統，就會像電腦一樣秒速自動填入驗證碼了！

---

## 💻 電腦版 (Chrome / Edge) 安裝教學

### 步驟 1：開啟擴充功能管理頁面
- **Google Chrome**：網址列輸入 `chrome://extensions/` 並按 Enter。
- **Microsoft Edge**：網址列輸入 `edge://extensions/` 並按 Enter。

### 步驟 2：開啟「開發人員模式」
- 在頁面右上角（Edge 在左側選單），開啟 **「開發人員模式 (Developer mode)」**。

### 步驟 3：載入套件
1. 從 [Releases 頁面](https://github.com/IvanHuang2031/nthu-captcha-autofill/releases) 下載 `nthu_captcha_extension.zip` 並解壓縮。
2. 點擊左上角 **「載入未封裝項目 (Load unpacked)」**，選取解壓縮出來的資料夾。
3. 安裝完成！打開網頁即可享受自動填入。

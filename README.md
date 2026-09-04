# 清大校務與 OAuth 驗證碼自動填入擴充功能 (NTHU Captcha Auto-Fill)

專為**國立清華大學校務資訊系統 (CCXP / AIS)** 與 **OAuth 認證系統 (eeclass / eLearn)** 設計的純本機高速驗證碼辨識與自動填入擴充功能（Chrome Extension Manifest V3）。

---

## 🎯 支援的網站與系統

1. **清華大學校務資訊系統**：
   - 網址：`https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/`
   - 驗證碼形式：6 位數彩色數字與混淆符號
2. **eeclass 數位學習平台 / eLearn OAuth 登入**：
   - 網址：`https://oauth.ccxp.nthu.edu.tw/v1.1/authorize.php...`
   - 驗證碼形式：4 位數干擾線條數字

---

## 🛡️ 核心技術與優勢

1. **直接畫布渲染 (Zero Network Request)**：
   - 傳統插件使用 `fetch` 或 `new Image()` 會向伺服器發起二次請求，導致後端 Session 驗證碼被改寫，畫面與伺服器脫節。
   - 本擴充功能直接透過 Canvas `drawImage` 擷取瀏覽器畫面上已載入的圖像像素，**100% 杜絕驗證碼失效與脫節問題**。
2. **純本機離線神經網路 (CNN + Attention) 推論**：
   - 內建專門為清大校務 6 位數與 OAuth 4 位數分別訓練的深度學習模型。
   - 運算時間只需 **2 ~ 4 毫秒**，無需聯網或外部伺服器，零隱私外洩風險。
3. **極簡靜默體驗**：
   - 辨識完成後直接靜默填入輸入框，不在網頁上注入任何多餘徽章或文字。
   - 點擊驗證碼圖片刷新時，會即時自動重新辨識與填入新碼。

---

## 🚀 安裝與更新步驟

### 步驟 1：開啟擴充功能管理頁面
- **Google Chrome**：網址列輸入 `chrome://extensions/` 並按 Enter。
- **Microsoft Edge**：網址列輸入 `edge://extensions/` 並按 Enter。

### 步驟 2：開啟「開發人員模式」
- 在右上角（Edge 在左側選單），開啟 **「開發人員模式 (Developer mode)」**。

### 步驟 3：載入或重新載入
- **首次安裝**：點擊左上角 **「載入未封裝項目 (Load unpacked)」**，選取資料夾：
  ```
  c:\Users\USER\Documents\招標案\nthu_captcha_extension
  ```
- **已安裝更新**：直接在擴充功能卡片上點擊 **「重新載入 (🔄 Reload)」** 即可立即生效！

document.addEventListener('DOMContentLoaded', async () => {
  const autoFillToggle = document.getElementById('autoFillToggle');
  const universalToggle = document.getElementById('universalToggle');
  const statsCount = document.getElementById('statsCount');
  const forceBtn = document.getElementById('forceRecognizeBtn');
  const statusMsg = document.getElementById('statusMessage');

  // Auto login elements
  const autoLoginToggle = document.getElementById('autoLoginToggle');
  const savedAccountInput = document.getElementById('savedAccount');
  const savedPasswordInput = document.getElementById('savedPassword');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const saveLoginBtn = document.getElementById('saveLoginBtn');
  const clearLoginBtn = document.getElementById('clearLoginBtn');
  const loginStatusMsg = document.getElementById('loginStatusMessage');

  // Load state from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get({
        autoFillEnabled: true,
        universalEnabled: true,
        totalAutoFilled: 0,
        autoLoginEnabled: false,
        savedAccount: '',
        savedPassword: ''
      }, resolve);
    });

    if (autoFillToggle) autoFillToggle.checked = data.autoFillEnabled;
    if (universalToggle) universalToggle.checked = data.universalEnabled;
    if (statsCount) statsCount.textContent = `${data.totalAutoFilled} 次`;

    if (autoLoginToggle) autoLoginToggle.checked = !!data.autoLoginEnabled;
    if (savedAccountInput) savedAccountInput.value = data.savedAccount || '';
    if (savedPasswordInput) savedPasswordInput.value = data.savedPassword || '';

    if (autoFillToggle) {
      autoFillToggle.addEventListener('change', () => {
        chrome.storage.local.set({ autoFillEnabled: autoFillToggle.checked });
      });
    }

    if (universalToggle) {
      universalToggle.addEventListener('change', () => {
        chrome.storage.local.set({ universalEnabled: universalToggle.checked });
      });
    }

    let isPasswordVisible = false;
    const eyeOpenSvg = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
    const eyeSlashSvg = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    `;

    if (autoLoginToggle) {
      autoLoginToggle.addEventListener('change', () => {
        chrome.storage.local.set({ autoLoginEnabled: autoLoginToggle.checked }, () => {
          if (loginStatusMsg) {
            if (autoLoginToggle.checked) {
              const hasCredentials = savedAccountInput?.value && savedPasswordInput?.value;
              loginStatusMsg.textContent = hasCredentials ? '已啟用自動登入' : '已開啟開關，請輸入帳密並儲存';
              loginStatusMsg.style.color = hasCredentials ? '#059669' : '#d97706';
            } else {
              loginStatusMsg.textContent = '已停用自動登入';
              loginStatusMsg.style.color = '#64748b';
            }
            setTimeout(() => {
              loginStatusMsg.textContent = '';
            }, 2000);
          }
        });
      });
    }

    // Toggle password visibility
    if (togglePasswordBtn && savedPasswordInput && eyeIcon) {
      togglePasswordBtn.addEventListener('click', () => {
        isPasswordVisible = !isPasswordVisible;
        savedPasswordInput.type = isPasswordVisible ? 'text' : 'password';
        eyeIcon.innerHTML = isPasswordVisible ? eyeSlashSvg : eyeOpenSvg;
      });
    }

    // Enter key triggers save
    const handleEnterKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveLoginBtn?.click();
      }
    };
    savedAccountInput?.addEventListener('keydown', handleEnterKey);
    savedPasswordInput?.addEventListener('keydown', handleEnterKey);

    // Save login credentials
    if (saveLoginBtn) {
      saveLoginBtn.addEventListener('click', () => {
        const account = savedAccountInput ? savedAccountInput.value.trim() : '';
        const password = savedPasswordInput ? savedPasswordInput.value : '';

        if (!account || !password) {
          if (loginStatusMsg) {
            loginStatusMsg.textContent = '請輸入學號與密碼';
            loginStatusMsg.style.color = '#ef4444';
          }
          return;
        }

        // Saving credentials automatically activates auto login
        if (autoLoginToggle) {
          autoLoginToggle.checked = true;
        }

        chrome.storage.local.set({
          autoLoginEnabled: true,
          savedAccount: account,
          savedPassword: password
        }, () => {
          if (loginStatusMsg) {
            loginStatusMsg.textContent = '✅ 設定與憑證已安全儲存！';
            loginStatusMsg.style.color = '#059669';
            setTimeout(() => {
              if (loginStatusMsg.textContent.includes('已安全儲存')) {
                loginStatusMsg.textContent = '';
              }
            }, 3000);
          }
        });
      });
    }

    // Clear login credentials
    if (clearLoginBtn) {
      clearLoginBtn.addEventListener('click', () => {
        chrome.storage.local.remove(['savedAccount', 'savedPassword'], () => {
          chrome.storage.local.set({ autoLoginEnabled: false });
          if (autoLoginToggle) autoLoginToggle.checked = false;
          if (savedAccountInput) savedAccountInput.value = '';
          if (savedPasswordInput) {
            savedPasswordInput.value = '';
            savedPasswordInput.type = 'password';
          }
          if (eyeIcon) {
            eyeIcon.innerHTML = eyeOpenSvg;
          }
          isPasswordVisible = false;

          if (loginStatusMsg) {
            loginStatusMsg.textContent = '已清除本機儲存之帳密憑證';
            loginStatusMsg.style.color = '#64748b';
            setTimeout(() => {
              if (loginStatusMsg.textContent.includes('已清除')) {
                loginStatusMsg.textContent = '';
              }
            }, 3000);
          }
        });
      });
    }

    // Display current extension version
    const versionTag = document.getElementById('versionTag');
    if (versionTag && typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const ver = chrome.runtime.getManifest().version;
      versionTag.textContent = `核心版本 v${ver} (純本機離線)`;
    }

    const restartBtn = document.getElementById('restartOcrBtn');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        statusMsg.textContent = '正在重新載入 OCR 引擎...';
        statusMsg.style.color = '#3b82f6';
        chrome.runtime.sendMessage({ action: 'RESTART_OFFSCREEN' }, (res) => {
          if (res && res.success) {
            statusMsg.textContent = '✅ ' + (res.message || 'OCR 核心已重啟');
            statusMsg.style.color = '#059669';
          } else {
            statusMsg.textContent = '重啟失敗：' + (res?.error || chrome.runtime.lastError?.message || '未知錯誤');
            statusMsg.style.color = '#ef4444';
          }
        });
      });
    }

    forceBtn.addEventListener('click', async () => {
      statusMsg.textContent = '正在掃描頁面並辨識...';
      statusMsg.style.color = '#3b82f6';

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          statusMsg.textContent = '無法取得當前分頁';
          statusMsg.style.color = '#ef4444';
          return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'FORCE_RECOGNIZE_ACTIVE_TAB' }, (res) => {
          if (chrome.runtime.lastError) {
            statusMsg.textContent = '無法連線至該分頁（若剛更新擴充功能，請先重新整理 F5 該網頁）';
            statusMsg.style.color = '#ef4444';
            return;
          }

          if (res && res.success) {
            statusMsg.textContent = `辨識成功，已填入 ${res.count || 1} 處驗證碼！`;
            statusMsg.style.color = '#059669';
            chrome.storage.local.get({ totalAutoFilled: 0 }, (d) => {
              statsCount.textContent = `${d.totalAutoFilled || 0} 次`;
            });
          } else {
            statusMsg.textContent = res?.message || '未在頁面上找到符合條件的驗證碼';
            statusMsg.style.color = '#eab308';
          }
        });
      } catch (err) {
        statusMsg.textContent = '觸發失敗：' + err.message;
        statusMsg.style.color = '#ef4444';
      }
    });
  }
});

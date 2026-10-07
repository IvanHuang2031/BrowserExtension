document.addEventListener('DOMContentLoaded', async () => {
  const autoFillToggle = document.getElementById('autoFillToggle');
  const universalToggle = document.getElementById('universalToggle');
  const statsCount = document.getElementById('statsCount');
  const forceBtn = document.getElementById('forceRecognizeBtn');
  const restartBtn = document.getElementById('restartOcrBtn');
  const statusMsg = document.getElementById('statusMessage');
  const versionTag = document.getElementById('versionTag');

  // Auto login elements
  const autoLoginToggle = document.getElementById('autoLoginToggle');
  const loginDetails = document.getElementById('loginDetails');
  const savedSummary = document.getElementById('savedSummary');
  const savedAccountLabel = document.getElementById('savedAccountLabel');
  const editLoginBtn = document.getElementById('editLoginBtn');
  const loginForm = document.getElementById('loginForm');
  const savedAccountInput = document.getElementById('savedAccount');
  const savedPasswordInput = document.getElementById('savedPassword');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const saveLoginBtn = document.getElementById('saveLoginBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const clearLoginBtn = document.getElementById('clearLoginBtn');
  const loginStatusMsg = document.getElementById('loginStatusMessage');

  const statusTimers = new WeakMap();

  // kind: 'ok' | 'warn' | 'error' | 'info'; clearAfter in ms (0 keeps the message)
  function setStatus(el, text, kind = 'info', clearAfter = 0) {
    if (!el) return;
    clearTimeout(statusTimers.get(el));
    el.textContent = text;
    el.className = `status ${kind}`;
    if (clearAfter > 0) {
      statusTimers.set(el, setTimeout(() => {
        el.textContent = '';
      }, clearAfter));
    }
  }

  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

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

  autoFillToggle.checked = data.autoFillEnabled;
  universalToggle.checked = data.universalEnabled;
  statsCount.textContent = String(data.totalAutoFilled || 0);
  autoLoginToggle.checked = !!data.autoLoginEnabled;

  if (chrome.runtime?.getManifest) {
    versionTag.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  // Keep the counter live while the popup is open
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.totalAutoFilled) {
      statsCount.textContent = String(changes.totalAutoFilled.newValue || 0);
    }
  });

  autoFillToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoFillEnabled: autoFillToggle.checked });
  });

  universalToggle.addEventListener('change', () => {
    chrome.storage.local.set({ universalEnabled: universalToggle.checked });
  });

  // ---------------------------------------------------------------------------
  // Auto login: hidden while off; a one-line summary once credentials are saved;
  // the form only while entering or editing credentials.
  // ---------------------------------------------------------------------------
  let saved = { account: data.savedAccount || '', password: data.savedPassword || '' };
  let editing = false;
  const hasSaved = () => !!(saved.account && saved.password);

  function renderLogin() {
    loginDetails.hidden = !autoLoginToggle.checked;
    const showForm = editing || !hasSaved();
    savedSummary.hidden = showForm;
    loginForm.hidden = !showForm;
    cancelEditBtn.hidden = !(editing && hasSaved());
    savedAccountLabel.textContent = saved.account;
  }

  function fillForm() {
    savedAccountInput.value = saved.account;
    savedPasswordInput.value = saved.password;
    setPasswordVisible(false);
  }

  const eyeOpenSvg = `
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  `;
  const eyeSlashSvg = `
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  `;
  function setPasswordVisible(visible) {
    savedPasswordInput.type = visible ? 'text' : 'password';
    eyeIcon.innerHTML = visible ? eyeSlashSvg : eyeOpenSvg;
    const label = visible ? '隱藏密碼' : '顯示密碼';
    togglePasswordBtn.title = label;
    togglePasswordBtn.setAttribute('aria-label', label);
  }

  fillForm();
  renderLogin();

  autoLoginToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoLoginEnabled: autoLoginToggle.checked }, () => {
      editing = false;
      fillForm();
      renderLogin();
      if (autoLoginToggle.checked && !hasSaved()) {
        setStatus(loginStatusMsg, '輸入學號和密碼後按儲存就會生效', 'warn', 4000);
        savedAccountInput.focus();
      } else {
        setStatus(loginStatusMsg, '');
      }
    });
  });

  editLoginBtn.addEventListener('click', () => {
    editing = true;
    fillForm();
    renderLogin();
    savedAccountInput.focus();
  });

  cancelEditBtn.addEventListener('click', () => {
    editing = false;
    fillForm();
    renderLogin();
    setStatus(loginStatusMsg, '');
  });

  togglePasswordBtn.addEventListener('click', () => {
    setPasswordVisible(savedPasswordInput.type === 'password');
  });

  // Enter key triggers save
  const handleEnterKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLoginBtn.click();
    }
  };
  savedAccountInput.addEventListener('keydown', handleEnterKey);
  savedPasswordInput.addEventListener('keydown', handleEnterKey);

  saveLoginBtn.addEventListener('click', () => {
    const account = savedAccountInput.value.trim();
    const password = savedPasswordInput.value;

    if (!account || !password) {
      setStatus(loginStatusMsg, '請輸入學號和密碼', 'error');
      return;
    }

    // Saving credentials automatically activates auto login
    chrome.storage.local.set({
      autoLoginEnabled: true,
      savedAccount: account,
      savedPassword: password
    }, () => {
      saved = { account, password };
      editing = false;
      autoLoginToggle.checked = true;
      fillForm();
      renderLogin();
      setStatus(loginStatusMsg, '已儲存，下次登入時生效', 'ok', 3000);
    });
  });

  clearLoginBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['savedAccount', 'savedPassword'], () => {
      chrome.storage.local.set({ autoLoginEnabled: false });
      saved = { account: '', password: '' };
      editing = false;
      autoLoginToggle.checked = false;
      fillForm();
      renderLogin();
      setStatus(loginStatusMsg, '');
      setStatus(statusMsg, '已清除儲存的帳密', 'info', 3000);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  restartBtn.addEventListener('click', () => {
    setStatus(statusMsg, '正在重新啟動辨識程式…', 'info');
    chrome.runtime.sendMessage({ action: 'RESTART_OFFSCREEN' }, (res) => {
      if (res && res.success) {
        setStatus(statusMsg, '已重新啟動，請再試一次', 'ok', 4000);
      } else {
        const reason = res?.error || chrome.runtime.lastError?.message || '未知錯誤';
        setStatus(statusMsg, `重新啟動失敗：${reason}`, 'error');
      }
    });
  });

  forceBtn.addEventListener('click', async () => {
    setStatus(statusMsg, '正在辨識…', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        setStatus(statusMsg, '找不到目前的分頁', 'error');
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'FORCE_RECOGNIZE_ACTIVE_TAB' }, (res) => {
        if (chrome.runtime.lastError) {
          setStatus(statusMsg, '無法連到這個頁面。剛更新過擴充功能的話，請先重新整理頁面。', 'error');
          return;
        }

        if (res && res.success) {
          setStatus(statusMsg, `已填入 ${res.count || 1} 個驗證碼`, 'ok', 4000);
        } else {
          setStatus(statusMsg, res?.message || '這個頁面沒有找到驗證碼', 'warn');
        }
      });
    } catch (err) {
      setStatus(statusMsg, `辨識失敗：${err.message}`, 'error');
    }
  });
});

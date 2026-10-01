/**
 * NTHU OAuth (eeclass / eLearn) Captcha Auto-Fill (Manifest V3)
 * High-accuracy, offline local neural network inference for 4-digit OAuth captchas.
 * Pure silent auto-fill directly into input[name="captcha"].
 */

(function () {
  'use strict';

  let hasInitialized = false;

  function getClientId() {
    try {
      let id = new URLSearchParams(window.location.search).get('client_id');
      if (!id && window.location.hash && window.location.hash.includes('client_id=')) {
        const hashQuery = window.location.hash.includes('?')
          ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
          : window.location.hash.slice(1);
        id = new URLSearchParams(hashQuery).get('client_id');
      }
      if (!id) {
        const inputEl = document.querySelector('input[name="client_id" i]');
        if (inputEl && inputEl.value) id = inputEl.value;
      }
      if (id && typeof id === 'string' && id.trim()) {
        return id.trim().toLowerCase();
      }
      return 'oauth';
    } catch (e) {
      return 'oauth';
    }
  }

  function getSessionStorageKey() {
    return `oauth_auto_login_${getClientId()}_attempted`;
  }

  function getSessionStorageTimeKey() {
    return `${getSessionStorageKey()}_time`;
  }

  let isRecognizing = false;
  let hasSubmittedInPage = false;

  async function getSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get({
          autoFillEnabled: true,
          autoLoginEnabled: false,
          savedAccount: '',
          savedPassword: ''
        }, resolve);
      } else {
        resolve({
          autoFillEnabled: true,
          autoLoginEnabled: false,
          savedAccount: '',
          savedPassword: ''
        });
      }
    });
  }

  function hasPageErrorMessage() {
    const bodyText = (document.body ? document.body.innerText : '') || '';
    const fullText = (document.documentElement ? document.documentElement.textContent : '') || '';
    const combined = (bodyText + ' ' + fullText).toLowerCase();

    const errorKeywords = [
      '密碼錯誤',
      '密碼不符',
      '密碼不正確',
      '驗證碼錯誤',
      '驗證碼不符',
      '驗證碼不正確',
      '認證碼錯誤',
      '認證碼不符',
      '帳號錯誤',
      '帳號或密碼錯誤',
      '帳號密碼錯誤',
      '帳號密碼不符',
      '帳號/密碼錯誤',
      '帳號不存在',
      '使用者不存在',
      '帳號已鎖定',
      '帳號鎖定',
      '連續錯誤',
      '登入失敗',
      '請重新輸入驗證碼',
      '請重新輸入認證碼',
      '驗證失敗',
      'invalid username or password',
      'invalid account or password',
      'invalid password',
      'incorrect password',
      'wrong password',
      'incorrect captcha',
      'invalid captcha',
      'incorrect verification code',
      'invalid credentials',
      'account locked',
      'login failed',
      'authentication failed'
    ];
    return errorKeywords.some((keyword) => combined.includes(keyword.toLowerCase()));
  }

  // Fresh navigation check: if arriving from outside OAuth (e.g. elearn, eeclass, or direct entry)
  // and no error message on page, clear stale attempt flags for this client.
  try {
    const isInternalOAuthRedirect = document.referrer && document.referrer.includes('oauth.ccxp.nthu.edu.tw');
    if (!isInternalOAuthRedirect && !hasPageErrorMessage()) {
      sessionStorage.removeItem(getSessionStorageKey());
      sessionStorage.removeItem(getSessionStorageTimeKey());
      sessionStorage.removeItem('oauth_auto_login_attempted');
      sessionStorage.removeItem('oauth_auto_login_attempted_time');
    }
  } catch (e) {}

  function setInputValue(input, val) {
    if (!input) return;
    try {
      const proto = Object.getPrototypeOf(input);
      const desc = (proto && Object.getOwnPropertyDescriptor(proto, 'value')) ||
                   (typeof HTMLInputElement !== 'undefined' && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'));
      if (desc && desc.set) {
        desc.set.call(input, val);
      } else {
        input.value = val;
      }
    } catch (e) {
      input.value = val;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillCredentials(account, password) {
    let accountInput = document.querySelector('input[name="id" i], input#id, #id, input[name="username" i], input[name="account" i], input#username, input#account, #username, #account');
    if (accountInput && accountInput.tagName !== 'INPUT') {
      accountInput = accountInput.querySelector('input') || document.querySelector('input[name="id" i], input#id, input[name="username" i], input[name="account" i]');
    }

    let passwordInput = document.querySelector('input[name="password" i], input[name="passwd" i], input[type="password"], input#password, #password');
    if (passwordInput && passwordInput.tagName !== 'INPUT') {
      passwordInput = passwordInput.querySelector('input[type="password"]') || document.querySelector('input[type="password"]');
    }

    if (!accountInput || !passwordInput) {
      return false;
    }

    if (typeof account === 'string' && accountInput.value !== account) {
      setInputValue(accountInput, account);
    }

    if (typeof password === 'string' && passwordInput.value !== password) {
      setInputValue(passwordInput, password);
    }

    return (account ? accountInput.value === account : true) &&
           (password ? passwordInput.value === password : true);
  }

  function tryAutoLogin(settings, captchaInput) {
    if (!settings.autoLoginEnabled) {
      return;
    }
    if (!settings.savedAccount || !settings.savedPassword) {
      return;
    }

    if (hasSubmittedInPage) {
      return;
    }

    // 1. Strict protection: abort if error message exists on page
    if (hasPageErrorMessage()) {
      console.warn('[NTHU-OAuth AutoLogin] Detected error message on page. Auto-login aborted to prevent account lockout.');
      try {
        sessionStorage.setItem(getSessionStorageKey(), 'true');
        sessionStorage.setItem(getSessionStorageTimeKey(), Date.now().toString());
      } catch (e) {}
      return;
    }

    // 2. Strict protection: abort if already attempted recently in this tab session (within 30s)
    try {
      const attempted = sessionStorage.getItem(getSessionStorageKey()) === 'true';
      const attemptTimeStr = sessionStorage.getItem(getSessionStorageTimeKey());
      const attemptTime = attemptTimeStr ? parseInt(attemptTimeStr, 10) : 0;
      const isStale = !attemptTime || (Date.now() - attemptTime > 30 * 1000);

      if (attempted && !isStale) {
        console.warn('[NTHU-OAuth AutoLogin] Auto-login already attempted within 30s in this tab session. Auto-login aborted to prevent loop/lockout.');
        return;
      }
    } catch (e) {}

    // Ensure credentials are fully and correctly populated
    if (!fillCredentials(settings.savedAccount, settings.savedPassword)) {
      console.warn('[NTHU-OAuth AutoLogin] Credentials fields not found or could not be populated. Aborting submit.');
      return;
    }

    // Verify captcha input has a value
    if (!captchaInput || !captchaInput.value) {
      console.warn('[NTHU-OAuth AutoLogin] Captcha input is empty. Aborting submit.');
      return;
    }

    hasSubmittedInPage = true;
    try {
      sessionStorage.setItem(getSessionStorageKey(), 'true');
      sessionStorage.setItem(getSessionStorageTimeKey(), Date.now().toString());
    } catch (e) {}

    function resolveSubmitButton(form) {
      const submitSelector = 'button.btn-login, #btn-login, button[name="action"][value="login"], button[type="submit"], input[type="submit"], input[type="image"], button:not([type]), button#submit, input[name="submit" i], button[name="submit" i]';
      let btn = (form ? form.querySelector(submitSelector) : null) || document.querySelector(submitSelector);
      if (!btn && form) {
        const candidates = Array.from(form.querySelectorAll('button, input[type="button"]'));
        btn = candidates.find((b) => /登入|login/i.test(b.innerText || b.value || '')) || null;
      }
      return btn;
    }

    function executeFormSubmit(form, submitBtn) {
      if (!form) return false;
      try {
        if (typeof form.requestSubmit === 'function') {
          if (submitBtn && submitBtn.form === form) {
            form.requestSubmit(submitBtn);
          } else {
            form.requestSubmit();
          }
          return true;
        }
      } catch (e) {
        console.warn('[NTHU-OAuth AutoLogin] form.requestSubmit() failed:', e);
      }

      try {
        if (typeof form.submit === 'function') {
          form.submit();
          return true;
        } else {
          HTMLFormElement.prototype.submit.call(form);
          return true;
        }
      } catch (e) {
        try {
          HTMLFormElement.prototype.submit.call(form);
          return true;
        } catch (err) {
          console.error('[NTHU-OAuth AutoLogin] All form submission attempts failed:', err);
          return false;
        }
      }
    }

    console.log('[NTHU-OAuth AutoLogin] Auto-login conditions met. Submitting in 200ms...');
    setTimeout(() => {
      const form = captchaInput?.form || document.querySelector('form');
      const submitBtn = resolveSubmitButton(form);

      let formSubmitted = false;
      const markSubmitted = () => { formSubmitted = true; };

      if (form) {
        form.addEventListener('submit', markSubmitted, { once: true });
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', markSubmitted, { once: true });
        window.addEventListener('pagehide', markSubmitted, { once: true });
      }

      if (submitBtn) {
        try {
          submitBtn.click();
        } catch (e) {
          console.warn('[NTHU-OAuth AutoLogin] submitBtn.click() failed:', e);
        }
      } else if (form) {
        if (executeFormSubmit(form, submitBtn)) {
          formSubmitted = true;
        }
      }

      // Fallback: if submitBtn.click() did not trigger form submission or navigation, fallback to form.requestSubmit / form.submit
      setTimeout(() => {
        if (!formSubmitted && form) {
          console.log('[NTHU-OAuth AutoLogin] Fallback to form.requestSubmit / form.submit');
          executeFormSubmit(form, submitBtn);
        }
      }, 300);
    }, 200);
  }

  async function recognizeAndFill(img, input, force = false) {
    if (isRecognizing) return { success: false, message: '辨識正在進行中' };
    isRecognizing = true;

    try {
      const settings = await getSettings();

      if (!force && !settings.autoFillEnabled) {
        return { success: false, message: '自動填入功能已停用' };
      }

      // Pre-fill credentials if available
      if (settings.savedAccount && settings.savedPassword) {
        fillCredentials(settings.savedAccount, settings.savedPassword);
      }

      if (!img.complete || img.naturalWidth === 0) {
        if (force) {
          await new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.addEventListener('load', () => resolve(), { once: true });
            setTimeout(resolve, 1000);
          });
        }
        if (!img.complete || img.naturalWidth === 0) {
          return { success: false, message: '驗證碼圖片尚未載入完成' };
        }
      }

      const oauthDecaptcha = globalThis.CCXP_LITE?.oauthDecaptcha;
      if (!oauthDecaptcha) {
        throw new Error('CCXP_LITE.oauthDecaptcha module is not initialized.');
      }

      // Direct DOM drawImage into canvas (Zero network request / No session desync)
      const code = await oauthDecaptcha.predictDigits(img);

      if (code && code.length === 4) {
        setInputValue(input, code);

        // Record stats
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get({ totalAutoFilled: 0 }, (data) => {
            chrome.storage.local.set({ totalAutoFilled: (data.totalAutoFilled || 0) + 1 });
          });
        }

        // Auto login submission
        tryAutoLogin(settings, input);
        return { success: true, code };
      } else {
        return { success: false, message: '未能辨識出 4 位數驗證碼' };
      }
    } catch (err) {
      console.error('[NTHU-OAuth-Captcha AutoFill] Error:', err);
      return { success: false, message: err?.message || '辨識發生錯誤' };
    } finally {
      isRecognizing = false;
    }
  }

  function init() {
    const img = document.querySelector('#captcha_image, img[src*="captchaimg.php"], img[alt="CAPTCHA Image"]');
    const input = document.querySelector('input[name="captcha" i], #captcha_code, input[name="captcha_code" i]');

    if (!img || !input) {
      return false;
    }

    if (hasInitialized) {
      return true;
    }
    hasInitialized = true;

    // Pre-fill credentials if available
    getSettings().then((settings) => {
      if (settings.savedAccount || settings.savedPassword) {
        fillCredentials(settings.savedAccount, settings.savedPassword);
      }
    });

    // If already loaded, recognize immediately
    if (img.complete && img.naturalWidth > 0) {
      recognizeAndFill(img, input);
    }

    // When the captcha image is refreshed (load event fires), auto-fill the new code
    img.addEventListener('load', () => {
      hasSubmittedInPage = false;
      try {
        sessionStorage.removeItem(getSessionStorageKey());
        sessionStorage.removeItem(getSessionStorageTimeKey());
      } catch (e) {}
      recognizeAndFill(img, input);
    });

    // Hint cursor on captcha image
    img.style.cursor = 'pointer';
    if (!img.title) {
      img.title = '點擊可刷新驗證碼（將自動重新填入）';
    }

    // Also observe the refresh button
    const refreshBtn = document.querySelector('img[alt="Refresh Image"], a.captcha_reload');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        hasSubmittedInPage = false;
        try {
          sessionStorage.removeItem(getSessionStorageKey());
          sessionStorage.removeItem(getSessionStorageTimeKey());
        } catch (e) {}
        setTimeout(() => recognizeAndFill(img, input), 300);
      });
    }

    return true;
  }

  // Pre-fill credentials as soon as possible
  getSettings().then((settings) => {
    if (settings.savedAccount || settings.savedPassword) {
      fillCredentials(settings.savedAccount, settings.savedPassword);
    }
  });

  // Listen for storage changes (e.g. user updates credentials or toggles auto-login in popup)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const relevantKeys = ['autoFillEnabled', 'autoLoginEnabled', 'savedAccount', 'savedPassword'];
      const hasChange = relevantKeys.some((k) => k in changes);
      if (!hasChange) return;

      if (changes.savedAccount || changes.savedPassword || changes.autoLoginEnabled) {
        hasSubmittedInPage = false;
        try {
          sessionStorage.removeItem(getSessionStorageKey());
          sessionStorage.removeItem(getSessionStorageTimeKey());
        } catch (e) {}
      }

      getSettings().then((settings) => {
        // Immediately update filled credentials
        fillCredentials(settings.savedAccount || '', settings.savedPassword || '');

        // If captcha is already populated and autoLogin is enabled, attempt auto-login
        const captchaInput = document.querySelector('input[name="captcha" i], #captcha_code, input[name="captcha_code" i]');
        if (settings.autoLoginEnabled && captchaInput && captchaInput.value) {
          tryAutoLogin(settings, captchaInput);
        }
      });
    });
  }

  // Handle manual force recognition requested from extension popup
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'FORCE_RECOGNIZE_ACTIVE_TAB') {
        console.log('[NTHU-OAuth] Manual force recognition triggered.');
        const img = document.querySelector('#captcha_image, img[src*="captchaimg.php"], img[alt="CAPTCHA Image"]');
        const input = document.querySelector('input[name="captcha" i], #captcha_code, input[name="captcha_code" i]');

        if (!img || !input) {
          sendResponse({ success: false, message: '未在頁面上找到驗證碼圖片或輸入框' });
          return false;
        }

        hasSubmittedInPage = false;
        try {
          sessionStorage.removeItem(getSessionStorageKey());
          sessionStorage.removeItem(getSessionStorageTimeKey());
        } catch (e) {}

        (async () => {
          try {
            const result = await recognizeAndFill(img, input, true);
            if (result && result.success) {
              sendResponse({ success: true, count: 1 });
            } else {
              sendResponse({ success: false, message: result?.message || '未能辨識出清晰文字，請點擊驗證碼刷新後重試' });
            }
          } catch (err) {
            sendResponse({ success: false, message: err?.message || '辨識發生錯誤' });
          }
        })();
        return true; // Keep message channel open for async response
      }
      return false;
    });
  }

  // Attempt immediate initialization
  if (!init()) {
    const observer = new MutationObserver((mutations, obs) => {
      if (init()) {
        obs.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();

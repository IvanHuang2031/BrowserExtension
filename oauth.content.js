/**
 * NTHU OAuth (eeclass / eLearn) Captcha Auto-Fill (Manifest V3)
 * High-accuracy, offline local neural network inference for 4-digit OAuth captchas.
 * Pure silent auto-fill directly into input[name="captcha"].
 */

(function () {
  'use strict';

  let hasInitialized = false;

  async function recognizeAndFill(img, input) {
    // Check if auto-fill is enabled in extension settings
    const settings = await new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get({ autoFillEnabled: true }, resolve);
      } else {
        resolve({ autoFillEnabled: true });
      }
    });

    if (!settings.autoFillEnabled) {
      return;
    }

    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener('load', () => recognizeAndFill(img, input), { once: true });
      return;
    }

    try {
      const oauthDecaptcha = globalThis.CCXP_LITE?.oauthDecaptcha;
      if (!oauthDecaptcha) {
        throw new Error('CCXP_LITE.oauthDecaptcha module is not initialized.');
      }

      // Direct DOM drawImage into canvas (Zero network request / No session desync)
      const code = await oauthDecaptcha.predictDigits(img);

      if (code && code.length === 4) {
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Record stats
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get({ totalAutoFilled: 0 }, (data) => {
            chrome.storage.local.set({ totalAutoFilled: (data.totalAutoFilled || 0) + 1 });
          });
        }
      }
    } catch (err) {
      console.error('[NTHU-OAuth-Captcha AutoFill] Error:', err);
    }
  }

  function init() {
    const img = document.querySelector('#captcha_image, img[src*="captchaimg.php"], img[alt="CAPTCHA Image"]');
    const input = document.querySelector('input[name="captcha"], #captcha_code');

    if (!img || !input) {
      return false;
    }

    if (hasInitialized) {
      return true;
    }
    hasInitialized = true;

    // Initial silent recognition and auto-fill
    recognizeAndFill(img, input);

    // When the captcha image is refreshed (load event fires), auto-fill the new code
    img.addEventListener('load', () => {
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
        // give a short moment for the new image src to be requested and decoded
        setTimeout(() => recognizeAndFill(img, input), 300);
      });
    }

    return true;
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

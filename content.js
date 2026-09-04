/**
 * NTHU AIS Captcha Auto-Fill (Manifest V3)
 * High-accuracy, offline, zero-network-leak local neural network inference.
 * Fixes the "double-fetch" bug in traditional community extensions.
 * Pure silent auto-fill directly into input[name="passwd2"].
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
      // Wait for image to load completely
      img.addEventListener('load', () => recognizeAndFill(img, input), { once: true });
      return;
    }

    try {
      const decaptcha = globalThis.CCXP_LITE?.decaptcha;
      if (!decaptcha) {
        throw new Error('CCXP_LITE.decaptcha module is not initialized.');
      }

      // CRITICAL FIX: Direct DOM drawImage into canvas (Zero second-fetch / No session desync)
      const code = await decaptcha.predictDigits(img);

      if (code && code.length === 6) {
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
      console.error('[NTHU-Captcha AutoFill] Error:', err);
    }
  }

  function init() {
    const img = document.querySelector('img[src*="auth_img.php"]');
    const input = document.querySelector('input[name="passwd2"]');

    if (!img || !input) {
      return false;
    }

    if (hasInitialized) {
      return true;
    }
    hasInitialized = true;

    // Initial silent recognition and auto-fill
    recognizeAndFill(img, input);

    // If the user clicks the captcha image to refresh it, auto-fill the new code
    img.addEventListener('load', () => {
      recognizeAndFill(img, input);
    });

    // Cursor hint on captcha image
    img.style.cursor = 'pointer';
    if (!img.title) {
      img.title = '點擊可刷新驗證碼（將自動重新填入）';
    }

    return true;
  }

  // Attempt immediate initialization
  if (!init()) {
    // If not found yet (e.g. slow dynamic DOM rendering), observe changes
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

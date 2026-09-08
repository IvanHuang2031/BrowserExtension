/**
 * Universal Form & CAPTCHA Detector (Content Script)
 * Automatically identifies login/auth forms, detects CAPTCHA images & target inputs,
 * extracts pixels in-DOM (zero second-fetch) and fills recognized text.
 */

(function () {
  'use strict';

  // 1. Strict Isolation: Never execute on NTHU CCXP domains
  if (window.location.hostname.includes('ccxp.nthu.edu.tw')) {
    return;
  }

  const processedInputs = new WeakSet();
  const processedImages = new WeakSet();
  let isScanning = false;

  // Regex patterns
  const CAPTCHA_KEYWORD_REGEX = /(captcha|checkcode|authcode|valcode|vcode|verify|validate|code_img|securimage|yzm|驗證碼|验证码)/i;
  const SMS_EXCLUDE_REGEX = /(獲取驗證碼|获取验证码|發送驗證碼|发送短信|手機驗證碼|短信驗證碼|SMS|60秒|重新獲取)/i;

  async function isEnabled() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get({ autoFillEnabled: true, universalEnabled: true }, (res) => {
          resolve(res.autoFillEnabled !== false && res.universalEnabled !== false);
        });
      } else {
        resolve(true);
      }
    });
  }

  // Extract base64 raster from DOM element with fallback for tainted canvases
  function extractImageRaster(img) {
    if (!img.complete || (img.naturalWidth === 0 && img.width === 0)) {
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      const w = img.naturalWidth || img.width || 120;
      const h = img.naturalHeight || img.height || 40;
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      return { base64: canvas.toDataURL('image/png'), url: null };
    } catch (e) {
      // Cross-origin tainted canvas: delegate fetch to background worker
      console.warn('[Universal-OCR] In-DOM canvas tainted, falling back to background fetch:', e);
      return { base64: null, url: img.src || null };
    }
  }

  // Heuristic: Check if an input field is an SMS / phone verification code
  function isSmsVerificationField(input) {
    const parent = input.closest('form, div, tr, td, p') || input.parentElement;
    if (!parent) return false;

    // Check adjacent buttons or text
    const text = parent.innerText || '';
    if (SMS_EXCLUDE_REGEX.test(text)) {
      return true;
    }

    const buttons = parent.querySelectorAll('button, input[type="button"], a');
    for (const btn of buttons) {
      if (SMS_EXCLUDE_REGEX.test(btn.innerText || btn.value || '')) {
        return true;
      }
    }

    return false;
  }

  // Find candidate inputs
  function findCaptchaInputs() {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'));
    const candidates = [];

    for (const input of inputs) {
      if (isSmsVerificationField(input)) continue;

      const id = input.id || '';
      const name = input.name || '';
      const placeholder = input.placeholder || '';
      const ariaLabel = input.getAttribute('aria-label') || '';
      const className = input.className || '';

      const attrString = `${id} ${name} ${placeholder} ${ariaLabel} ${className}`;
      let score = 0;

      if (CAPTCHA_KEYWORD_REGEX.test(attrString)) {
        score += 50;
      }

      const maxLength = parseInt(input.maxLength, 10);
      if (maxLength >= 3 && maxLength <= 8) {
        score += 20;
      }

      if (input.autocomplete === 'off') {
        score += 10;
      }

      if (score > 0) {
        candidates.push({ element: input, score });
      }
    }

    return candidates.sort((a, b) => b.score - a.score).map((c) => c.element);
  }

  // Find candidate captcha images
  function findCaptchaImages() {
    const images = Array.from(document.querySelectorAll('img, canvas, input[type="image"]'));
    const candidates = [];

    for (const img of images) {
      const src = img.src || '';
      const id = img.id || '';
      const className = img.className || '';
      const alt = img.alt || '';
      const title = img.title || '';

      const attrString = `${src} ${id} ${className} ${alt} ${title}`;
      let score = 0;

      if (CAPTCHA_KEYWORD_REGEX.test(attrString)) {
        score += 50;
      }

      // Check dimensions
      const rect = img.getBoundingClientRect();
      const w = rect.width || img.naturalWidth || img.width;
      const h = rect.height || img.naturalHeight || img.height;

      // Realistic captcha bounds: width 35~300, height 15~120
      if (w >= 35 && w <= 320 && h >= 15 && h <= 120) {
        const aspect = w / (h || 1);
        if (aspect >= 1.2 && aspect <= 6.5) {
          score += 30;
        }
      }

      if (score > 0) {
        candidates.push({ element: img, score });
      }
    }

    return candidates.sort((a, b) => b.score - a.score).map((c) => c.element);
  }

  // Pair input field with nearest or corresponding captcha image
  function pairCandidates(inputs, images) {
    const pairs = [];

    for (const input of inputs) {
      const inputRect = input.getBoundingClientRect();
      let bestImg = null;
      let minDistance = Infinity;

      for (const img of images) {
        // Shared common parent check
        const commonContainer = input.closest('form, tr, table, div.form-group, div.form-item, p');
        const isSameContainer = commonContainer && commonContainer.contains(img);

        const imgRect = img.getBoundingClientRect();
        const dist = Math.hypot(
          (inputRect.left + inputRect.width / 2) - (imgRect.left + imgRect.width / 2),
          (inputRect.top + inputRect.height / 2) - (imgRect.top + imgRect.height / 2)
        );

        const adjustedDist = isSameContainer ? dist * 0.6 : dist;

        if (adjustedDist < minDistance && dist < 450) {
          minDistance = adjustedDist;
          bestImg = img;
        }
      }

      if (bestImg) {
        pairs.push({ input, img: bestImg });
      }
    }

    return pairs;
  }

  async function recognizeAndFillPair(pair) {
    const { input, img } = pair;
    if (processedInputs.has(input) && input.value.trim().length >= 4) {
      return;
    }

    const raster = extractImageRaster(img);
    if (!raster || (!raster.base64 && !raster.url)) {
      // If image not fully loaded yet, wait for load event
      if (img.tagName === 'IMG' && !img.complete) {
        img.addEventListener('load', () => recognizeAndFillPair(pair), { once: true });
      }
      return;
    }

    console.log('[Universal-OCR] Requesting recognition for captcha candidate...');

    chrome.runtime.sendMessage(
      {
        action: 'RECOGNIZE_CAPTCHA',
        imageBase64: raster.base64,
        imageUrl: raster.url
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Universal-OCR] Runtime message error:', chrome.runtime.lastError.message);
          return;
        }

        if (response && response.success && response.text) {
          const text = response.text.trim();
          console.log('[Universal-OCR] Filling input with recognized text:', text);

          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

          processedInputs.add(input);
          processedImages.add(img);

          // Add visual hint and click-to-refresh binding on captcha image
          img.style.cursor = 'pointer';
          if (!img.title) {
            img.title = '點擊可刷新驗證碼（自動重新辨識填入）';
          }

          if (!img.__universal_refresh_bound) {
            img.__universal_refresh_bound = true;
            img.addEventListener('click', () => {
              processedInputs.delete(input);
              setTimeout(() => recognizeAndFillPair(pair), 400);
            });
          }
        } else {
          console.warn('[Universal-OCR] Recognition unsuccessful:', response?.error);
        }
      }
    );
  }

  async function scanAndProcess() {
    if (isScanning) return;
    isScanning = true;

    try {
      const enabled = await isEnabled();
      if (!enabled) return;

      const inputs = findCaptchaInputs();
      const images = findCaptchaImages();

      if (inputs.length === 0 || images.length === 0) {
        return;
      }

      const pairs = pairCandidates(inputs, images);
      for (const pair of pairs) {
        recognizeAndFillPair(pair);
      }
    } finally {
      isScanning = false;
    }
  }

  // Initialize and observe DOM
  function start() {
    scanAndProcess();

    // Debounced MutationObserver for dynamic SPAs and popups
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scanAndProcess, 600);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Handle manual force recognition requested from extension popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'FORCE_RECOGNIZE_ACTIVE_TAB') {
      console.log('[Universal-OCR] Manual force recognition triggered.');
      const inputs = findCaptchaInputs();
      const images = findCaptchaImages();

      if (inputs.length > 0 && images.length > 0) {
        const pairs = pairCandidates(inputs, images);
        for (const pair of pairs) {
          processedInputs.delete(pair.input);
          recognizeAndFillPair(pair);
        }
        sendResponse({ success: true, count: pairs.length });
      } else {
        // Broad search: any focused or last active input + visible small image
        const focusedInput = document.activeElement?.tagName === 'INPUT' ? document.activeElement : document.querySelector('input[type="text"]');
        const candidateImg = document.querySelector('img[src*="code"], img[src*="captcha"], canvas');
        if (focusedInput && candidateImg) {
          recognizeAndFillPair({ input: focusedInput, img: candidateImg });
          sendResponse({ success: true, count: 1 });
        } else {
          sendResponse({ success: false, message: '未在頁面上偵測到合適的驗證碼圖片或輸入框' });
        }
      }
      return true;
    }
  });
})();

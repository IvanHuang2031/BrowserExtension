/**
 * Universal Form & CAPTCHA Detector (Content Script v1.2.1)
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
  const SEARCH_EXCLUDE_REGEX = /(search|query|find|kw|keyword|搜尋|搜索|filter)/i;
  const ICON_EXCLUDE_REGEX = /(reload|refresh|sound|audio|speaker|voice|help|icon|close|arrow|logo|avatar|btn|button)/i;
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
    // 1. If it's already a Data URL, return it directly!
    if (img.src && img.src.startsWith('data:image/')) {
      return { base64: img.src, url: null };
    }

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
      // Cross-origin tainted canvas: delegate fetch to background worker with absolute URL
      const absoluteUrl = img.src ? new URL(img.src, window.location.href).href : null;
      console.warn('[Universal-OCR] In-DOM canvas tainted, falling back to background fetch:', e, absoluteUrl);
      return { base64: null, url: absoluteUrl };
    }
  }

  // Heuristic: Check if an input field is an SMS / phone verification code
  function isSmsVerificationField(input) {
    const parent = input.closest('form, div, tr, td, p') || input.parentElement;
    if (!parent) return false;

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
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="search"])'));
    const candidates = [];

    for (const input of inputs) {
      // Exclude hidden or zero-size inputs
      const rect = input.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && input.type !== 'text') {
        continue;
      }

      if (isSmsVerificationField(input)) continue;

      const id = input.id || '';
      const name = input.name || '';
      const placeholder = input.placeholder || '';
      const ariaLabel = input.getAttribute('aria-label') || '';
      const className = input.className || '';

      // Check search exclude
      const searchAttr = `${id} ${name} ${placeholder} ${className}`;
      if (SEARCH_EXCLUDE_REGEX.test(searchAttr) && !/(captcha|checkcode|vcode)/i.test(name + ' ' + id)) {
        continue;
      }

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

      // Exclude icons (reload, sound, audio, speaker, help, avatar, close, etc.)
      const iconCheck = `${id} ${className} ${alt} ${title} ${src}`;
      if (ICON_EXCLUDE_REGEX.test(iconCheck)) {
        continue;
      }

      // Check visibility & dimensions
      const rect = img.getBoundingClientRect();
      const w = rect.width || img.naturalWidth || img.width || 0;
      const h = rect.height || img.naturalHeight || img.height || 0;

      // Realistic captcha bounds: width >= 40, height >= 16
      if (w < 40 || h < 16) {
        continue;
      }

      // Exclude hidden elements
      const style = window.getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }

      const aspect = w / (h || 1);
      if (aspect < 1.1 || aspect > 7.0) {
        continue;
      }

      const attrString = `${src} ${id} ${className} ${alt} ${title}`;
      let score = 30; // base score for matching size & visibility

      if (CAPTCHA_KEYWORD_REGEX.test(attrString)) {
        score += 50;
      }

      // Standard captcha size sweet spot (width 80~280, height 24~70)
      if (w >= 70 && w <= 300 && h >= 22 && h <= 80) {
        score += 20;
      }

      candidates.push({ element: img, score });
    }

    return candidates.sort((a, b) => b.score - a.score).map((c) => c.element);
  }

  // Pair input field with nearest or corresponding captcha image
  function pairCandidates(inputs, images) {
    const pairs = [];
    const usedImages = new Set();

    for (const input of inputs) {
      const inputRect = input.getBoundingClientRect();
      let bestImg = null;
      let minDistance = Infinity;

      for (const img of images) {
        if (usedImages.has(img)) continue;

        // Shared common parent container check
        const commonContainer = input.closest('form, tr, table, div.form-group, div.form-item, fieldset, p');
        const isSameContainer = commonContainer && commonContainer.contains(img);

        const imgRect = img.getBoundingClientRect();
        const dist = Math.hypot(
          (inputRect.left + inputRect.width / 2) - (imgRect.left + imgRect.width / 2),
          (inputRect.top + inputRect.height / 2) - (imgRect.top + imgRect.height / 2)
        );

        const adjustedDist = isSameContainer ? dist * 0.5 : dist;

        if (adjustedDist < minDistance && dist < 500) {
          minDistance = adjustedDist;
          bestImg = img;
        }
      }

      if (bestImg) {
        usedImages.add(bestImg);
        pairs.push({ input, img: bestImg });
      }
    }

    return pairs;
  }

  function getImageSignature(raster) {
    if (raster.base64) {
      const b = raster.base64;
      return `${b.length}_${b.slice(30, 60)}_${b.slice(-30)}`;
    }
    return raster.url || '';
  }

  function setNativeInputValue(input, text) {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(input, text);
    } else {
      input.value = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: text.slice(-1) }));
  }

  function recordAutoFillSuccess() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get({ totalAutoFilled: 0 }, (data) => {
        chrome.storage.local.set({ totalAutoFilled: (data.totalAutoFilled || 0) + 1 });
      });
    }
  }

  function recognizeAndFillPair(pair, force = false) {
    return new Promise((resolve) => {
      const { input, img } = pair;

      const raster = extractImageRaster(img);
      if (!raster || (!raster.base64 && !raster.url)) {
        // If image not loaded yet, listen for load
        if (img.tagName === 'IMG' && !img.complete) {
          img.addEventListener('load', () => {
            recognizeAndFillPair(pair, force).then(resolve);
          }, { once: true });
          return;
        }
        return resolve(false);
      }

      const sig = getImageSignature(raster);
      if (!force && input.dataset.lastOcrSig === sig && input.value.trim().length >= 3) {
        // Already processed and filled for this exact image
        return resolve(false);
      }

      console.log('[Universal-OCR] Requesting recognition for captcha:', img.id || img.className || img.src?.substring(0, 40));

      chrome.runtime.sendMessage(
        {
          action: 'RECOGNIZE_CAPTCHA',
          imageBase64: raster.base64,
          imageUrl: raster.url
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Universal-OCR] Runtime message error:', chrome.runtime.lastError.message);
            return resolve(false);
          }

          if (response && response.success && response.text) {
            const text = response.text.trim();
            if (text.length >= 2) {
              console.log('[Universal-OCR] Successfully recognized:', text, '-> filling into:', input.id || input.name || 'input');

              setNativeInputValue(input, text);
              input.dataset.lastOcrSig = sig;
              processedInputs.add(input);
              processedImages.add(img);
              recordAutoFillSuccess();

              // Add visual hint and click-to-refresh binding on captcha image
              img.style.cursor = 'pointer';
              if (!img.title) {
                img.title = '點擊可刷新驗證碼（自動重新辨識填入）';
              }

              if (!img.__universal_refresh_bound) {
                img.__universal_refresh_bound = true;
                img.addEventListener('click', () => {
                  delete input.dataset.lastOcrSig;
                  processedInputs.delete(input);
                  setTimeout(() => recognizeAndFillPair(pair, true), 500);
                });
              }

              return resolve(true);
            }
          }

          console.warn('[Universal-OCR] Recognition produced no valid text:', response);
          return resolve(false);
        }
      );
    });
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
        await recognizeAndFillPair(pair);
      }
    } finally {
      isScanning = false;
    }
  }

  // Initialize and observe DOM
  function start() {
    scanAndProcess();

    // Multi-stage check for delayed dynamic captchas (e.g. BotDetect, ASP.NET, SPAs)
    setTimeout(scanAndProcess, 300);
    setTimeout(scanAndProcess, 700);
    setTimeout(scanAndProcess, 1500);
    setTimeout(scanAndProcess, 3000);

    // Debounced MutationObserver watching childList AND attributes for dynamic SPAs and popups
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scanAndProcess, 400);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'src', 'style', 'hidden']
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
      (async () => {
        const inputs = findCaptchaInputs();
        const images = findCaptchaImages();

        if (inputs.length > 0 && images.length > 0) {
          const pairs = pairCandidates(inputs, images);
          let filledCount = 0;
          for (const pair of pairs) {
            delete pair.input.dataset.lastOcrSig;
            processedInputs.delete(pair.input);
            const filled = await recognizeAndFillPair(pair, true);
            if (filled) filledCount++;
          }

          if (filledCount > 0) {
            sendResponse({ success: true, count: filledCount });
          } else {
            sendResponse({ success: false, message: '未能辨識出清晰文字，請點擊驗證碼刷新後重試' });
          }
        } else {
          // Broad fallback: any active or text input + visible image
          const activeInput = (document.activeElement && document.activeElement.tagName === 'INPUT') ?
            document.activeElement : document.querySelector('input[type="text"]:not([name="q"])');
          const candidateImg = document.querySelector('img[src*="captcha"], img[src*="code"], img[src*="image"], canvas');

          if (activeInput && candidateImg) {
            delete activeInput.dataset.lastOcrSig;
            processedInputs.delete(activeInput);
            const filled = await recognizeAndFillPair({ input: activeInput, img: candidateImg }, true);
            if (filled) {
              sendResponse({ success: true, count: 1 });
            } else {
              sendResponse({ success: false, message: '手動配對未獲得有效辨識文字' });
            }
          } else {
            sendResponse({ success: false, message: '未在頁面上偵測到合適的驗證碼圖片或輸入框' });
          }
        }
      })();

      return true; // Keep async message channel open!
    }
  });
})();

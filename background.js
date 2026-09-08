/**
 * Universal Captcha Background Service Worker (Manifest V3)
 * Coordinates offscreen WebAssembly OCR inference and cross-origin fetch fallback.
 */

'use strict';

let creatingOffscreenPromise = null;
let isOffscreenReady = false;

async function setupOffscreenDocument(path = 'offscreen.html') {
  try {
    if (await chrome.offscreen.hasDocument()) {
      return;
    }

    if (creatingOffscreenPromise) {
      await creatingOffscreenPromise;
      return;
    }

    creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: path,
      reasons: ['BLOBS', 'DOM_PARSER'],
      justification: 'Execute ONNX WebAssembly OCR models in sandboxed environment'
    });

    await creatingOffscreenPromise;
  } catch (err) {
    console.warn('[Universal-OCR Background] createDocument warning/error:', err);
  } finally {
    creatingOffscreenPromise = null;
  }
}

// Resilient messaging to offscreen document with exponential backoff & retry
async function sendToOffscreenWithRetry(message, maxRetries = 6, delay = 250) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await setupOffscreenDocument();
      const res = await chrome.runtime.sendMessage(message);
      if (res) return res;
    } catch (err) {
      const isConnectionError = err.message && (
        err.message.includes('Receiving end does not exist') ||
        err.message.includes('Could not establish connection')
      );
      if (attempt === maxRetries || !isConnectionError) {
        throw err;
      }
      // Wait with incremental backoff before next attempt
      await new Promise((r) => setTimeout(r, delay * attempt));
    }
  }
  throw new Error('Offscreen document did not respond within retry window.');
}

// Convert ArrayBuffer to Base64 data URL safely in Service Worker context
function arrayBufferToBase64DataUrl(buffer, mimeType = 'image/png') {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// Pre-warm offscreen document on extension lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  setupOffscreenDocument().then(() => {
    sendToOffscreenWithRetry({ target: 'offscreen', type: 'WARMUP' }).catch(() => {});
  });
});

chrome.runtime.onStartup.addListener(() => {
  setupOffscreenDocument().then(() => {
    sendToOffscreenWithRetry({ target: 'offscreen', type: 'WARMUP' }).catch(() => {});
  });
});

// Immediate pre-warm attempt
setupOffscreenDocument().catch(() => {});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ignore messages specifically targeted at offscreen
  if (request.target === 'offscreen') {
    return false;
  }

  // Handshake notification from offscreen.js
  if (request.type === 'OFFSCREEN_READY') {
    isOffscreenReady = true;
    console.log('[Universal-OCR Background] Offscreen document reported READY.');
    return false;
  }

  if (request.action === 'RECOGNIZE_CAPTCHA') {
    (async () => {
      try {
        let base64Image = request.imageBase64;

        // Fallback: If imageBase64 was not obtainable due to CORS canvas tainting,
        // fetch it directly via background extension host permissions
        if (!base64Image && request.imageUrl) {
          console.log('[Universal-OCR Background] Fetching image via background:', request.imageUrl);
          const response = await fetch(request.imageUrl, {
            credentials: 'include',
            headers: {
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch image: HTTP ${response.status}`);
          }

          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('content-type') || 'image/png';
          base64Image = arrayBufferToBase64DataUrl(buffer, contentType);
        }

        if (!base64Image) {
          throw new Error('No image data or valid URL provided.');
        }

        // Forward to offscreen document with resilient retry
        const ocrResult = await sendToOffscreenWithRetry({
          target: 'offscreen',
          type: 'OCR_CLASSIFY',
          imageBase64: base64Image
        });

        sendResponse(ocrResult);
      } catch (err) {
        console.error('[Universal-OCR Background] OCR pipeline failed:', err);
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();

    return true; // Keep async response channel open
  }

  return false;
});

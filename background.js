/**
 * Universal Captcha Background Service Worker (Manifest V3)
 * Coordinates offscreen WebAssembly OCR inference and cross-origin fetch fallback.
 */

'use strict';

let creatingOffscreenPromise = null;

async function setupOffscreenDocument(path = 'offscreen.html') {
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
  creatingOffscreenPromise = null;
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ignore messages specifically targeted at offscreen
  if (request.target === 'offscreen') {
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

        await setupOffscreenDocument();

        // Forward to offscreen document
        const ocrResult = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'OCR_CLASSIFY',
          imageBase64: base64Image
        });

        if (ocrResult && ocrResult.success && ocrResult.text) {
          // Increment auto-fill statistics
          chrome.storage.local.get({ totalAutoFilled: 0 }, (data) => {
            chrome.storage.local.set({ totalAutoFilled: (data.totalAutoFilled || 0) + 1 });
          });
        }

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

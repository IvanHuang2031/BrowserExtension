/**
 * Universal Captcha Background Service Worker (Manifest V3)
 * Coordinates offscreen WebAssembly OCR inference and cross-origin fetch fallback.
 */

'use strict';

const CURRENT_VERSION = '1.3.5';
let creatingOffscreenPromise = null;
let isOffscreenReady = false;

async function setupOffscreenDocument(forceReload = false, path = 'offscreen.html') {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) {
      if (forceReload) {
        console.log('[Universal-OCR Background] Force reloading offscreen document...');
        await chrome.offscreen.closeDocument();
      } else {
        // Ping existing offscreen document to ensure it's alive and running the latest version
        try {
          const pingRes = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'PING' });
          if (pingRes && pingRes.version === CURRENT_VERSION) {
            return; // Document is healthy and on current version
          }
          console.log(`[Universal-OCR Background] Offscreen version mismatch (${pingRes?.version} vs ${CURRENT_VERSION}), recreating...`);
          await chrome.offscreen.closeDocument();
        } catch (pingErr) {
          console.warn('[Universal-OCR Background] Offscreen ping failed, recreating:', pingErr);
          await chrome.offscreen.closeDocument();
        }
      }
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
    console.log(`[Universal-OCR Background] Offscreen document created successfully (v${CURRENT_VERSION}).`);
  } catch (err) {
    console.warn('[Universal-OCR Background] setupOffscreenDocument error:', err);
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

function getSenderHost(sender) {
  try {
    return new URL(sender.url || sender.tab?.url || '').hostname || null;
  } catch (e) {
    return null;
  }
}

async function getCapHeightRatio(host) {
  try {
    const { caseProfiles = {} } = await chrome.storage.local.get('caseProfiles');
    return caseProfiles[host] || null;
  } catch (e) {
    return null;
  }
}

async function saveCapHeightRatio(host, ratio) {
  try {
    const { caseProfiles = {} } = await chrome.storage.local.get('caseProfiles');
    const previous = caseProfiles[host];
    // Smooth across captchas so one badly segmented image cannot skew the profile
    caseProfiles[host] = previous ? previous * 0.7 + ratio * 0.3 : ratio;
    await chrome.storage.local.set({ caseProfiles });
  } catch (e) {
    console.warn('[Universal-OCR Background] Failed to save case profile:', e);
  }
}

// Always force-recreate offscreen document on extension lifecycle events to bust cached JS
chrome.runtime.onInstalled.addListener(() => {
  setupOffscreenDocument(true).then(() => {
    sendToOffscreenWithRetry({ target: 'offscreen', type: 'WARMUP' }).catch(() => {});
  });
});

chrome.runtime.onStartup.addListener(() => {
  setupOffscreenDocument(true).then(() => {
    sendToOffscreenWithRetry({ target: 'offscreen', type: 'WARMUP' }).catch(() => {});
  });
});

// Immediate initialization attempt
setupOffscreenDocument().catch(() => {});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ignore messages specifically targeted at offscreen
  if (request.target === 'offscreen') {
    return false;
  }

  // Handshake notification from offscreen.js
  if (request.type === 'OFFSCREEN_READY') {
    isOffscreenReady = true;
    console.log(`[Universal-OCR Background] Offscreen document reported READY (v${request.version || 'unknown'}).`);
    return false;
  }

  // Force restart offscreen document from popup UI
  if (request.action === 'RESTART_OFFSCREEN') {
    setupOffscreenDocument(true).then(() => {
      sendResponse({ success: true, message: `OCR 核心已重啟 (v${CURRENT_VERSION})` });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message || String(err) });
    });
    return true;
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

        // Per-site cap height lets case calibration work on captchas made only of
        // x-height letters (e.g. "azvu"), where the image itself has no reference glyph.
        const host = getSenderHost(sender);
        const capHeightRatio = host ? await getCapHeightRatio(host) : null;

        // Forward to offscreen document with resilient retry
        const ocrResult = await sendToOffscreenWithRetry({
          target: 'offscreen',
          type: 'OCR_CLASSIFY',
          imageBase64: base64Image,
          caseSensitive: !!request.caseSensitive,
          capHeightRatio
        });

        if (host && ocrResult && ocrResult.capHeightRatio > 0) {
          await saveCapHeightRatio(host, ocrResult.capHeightRatio);
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

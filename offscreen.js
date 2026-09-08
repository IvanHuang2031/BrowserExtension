/**
 * Universal Captcha OCR Engine (Offscreen Document)
 * Manifest V3 WebAssembly ONNX Runtime execution environment.
 * Runs quantized CRNN-CTC model locally with zero external network requests.
 */

'use strict';

const CHARSET = {
  '13': '6',
  '55': 'f',
  '209': 'p',
  '210': 'L',
  '297': 'Y',
  '306': 'w',
  '309': '3',
  '311': 'F',
  '320': 'm',
  '521': 'X',
  '598': 'G',
  '689': 'x',
  '782': 'i',
  '897': 'T',
  '901': 'N',
  '1072': 'v',
  '1150': 'c',
  '1204': 'B',
  '1503': 'n',
  '1849': 'Q',
  '1965': 'H',
  '2113': 'K',
  '2185': 'W',
  '2341': 'P',
  '2376': 'r',
  '2457': 'l',
  '2547': 'E',
  '2621': 'Z',
  '2714': 's',
  '2851': '2',
  '3073': 'z',
  '3128': 'D',
  '3157': 'O',
  '3606': '4',
  '4018': '1',
  '4102': 't',
  '4393': 'b',
  '4429': 'o',
  '4588': 'u',
  '4725': '9',
  '4730': 'j',
  '4733': '0',
  '4919': '8',
  '5223': '5',
  '5428': 'e',
  '5461': 'A',
  '5629': 'R',
  '5690': 'g',
  '5737': 'k',
  '5855': 'S',
  '6554': 'I',
  '6794': '7',
  '6810': 'd',
  '6887': 'V',
  '7216': 'J',
  '7266': 'a',
  '7412': 'h',
  '7576': 'q',
  '7712': 'U',
  '7844': 'M',
  '7877': 'y',
  '7961': 'C',
  '1151': 'c'
};

class UniversalOcrEngine {
  constructor() {
    this.session = null;
    this.initPromise = null;

    if (typeof ort !== 'undefined' && ort.env) {
      // Configure ONNX Runtime Web for Chrome Extension Offscreen Document
      ort.env.wasm.wasmPaths = chrome.runtime.getURL('libs/');
      ort.env.wasm.numThreads = 1; // Single-thread prevents SharedArrayBuffer restrictions
      ort.env.wasm.proxy = false;
    }
  }

  async init() {
    if (this.session) return this.session;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const modelUrl = chrome.runtime.getURL('models/common_q8.onnx');
        console.log('[Universal-OCR Offscreen] Loading ONNX model from:', modelUrl);
        this.session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['wasm']
        });
        console.log('[Universal-OCR Offscreen] Model loaded successfully. Input names:', this.session.inputNames);
        return this.session;
      } catch (err) {
        console.error('[Universal-OCR Offscreen] Model init failed:', err);
        this.initPromise = null;
        throw err;
      }
    })();

    return this.initPromise;
  }

  preprocessImage(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const targetHeight = 64;
    const origWidth = img.naturalWidth || img.width || 120;
    const origHeight = img.naturalHeight || img.height || 40;
    const targetWidth = Math.max(32, Math.floor(origWidth * (targetHeight / origHeight)));

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // Fill white background to handle transparent PNGs
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imageData.data;
    const rawGray = new Float32Array(targetWidth * targetHeight);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      rawGray[i / 4] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
    }

    // Apply horizontal morphological dilation (min-filter in [0, 1] dark space)
    // This reinforces thin vertical/diagonal character strokes and separates touching ligatures
    const inputData = new Float32Array(targetWidth * targetHeight);
    for (let y = 0; y < targetHeight; y++) {
      const rowOffset = y * targetWidth;
      for (let x = 0; x < targetWidth; x++) {
        let m = rawGray[rowOffset + x];
        if (x > 0 && rawGray[rowOffset + x - 1] < m) m = rawGray[rowOffset + x - 1];
        if (x < targetWidth - 1 && rawGray[rowOffset + x + 1] < m) m = rawGray[rowOffset + x + 1];
        inputData[rowOffset + x] = m;
      }
    }

    return new ort.Tensor('float32', inputData, [1, 1, targetHeight, targetWidth]);
  }

  decodeBeamSearch(outputTensor, beamWidth = 20) {
    const [T, B, C] = outputTensor.dims;
    const logits = outputTensor.data;

    // Convert raw logits to numerically stable log-softmax probabilities
    const logProbs = new Float32Array(T * C);
    for (let t = 0; t < T; t++) {
      const offset = t * C;
      let maxVal = -Infinity;
      for (let c = 0; c < C; c++) {
        const v = logits[offset + c];
        if (v > maxVal) maxVal = v;
      }
      let sumExp = 0.0;
      for (let c = 0; c < C; c++) {
        sumExp += Math.exp(logits[offset + c] - maxVal);
      }
      const logSumExp = maxVal + Math.log(sumExp);
      for (let c = 0; c < C; c++) {
        logProbs[offset + c] = logits[offset + c] - logSumExp;
      }
    }

    function logSumExp2(a, b) {
      if (a === -Infinity) return b;
      if (b === -Infinity) return a;
      return Math.max(a, b) + Math.log(1.0 + Math.exp(-Math.abs(a - b)));
    }

    // Standard CTC Prefix Beam Search
    let beams = new Map();
    beams.set('', { pBlank: 0.0, pNonBlank: -Infinity });

    for (let t = 0; t < T; t++) {
      const offset = t * C;
      const nextBeams = new Map();

      // Top candidate tokens for this timestep
      const candidates = [];
      for (let c = 0; c < C; c++) {
        candidates.push({ c, lp: logProbs[offset + c] });
      }
      candidates.sort((a, b) => b.lp - a.lp);
      const topCand = candidates.slice(0, 15);

      for (const [prefix, p] of beams) {
        for (const { c, lp } of topCand) {
          if (c === 0) {
            // Blank token: keeps prefix the same
            let entry = nextBeams.get(prefix);
            if (!entry) {
              entry = { pBlank: -Infinity, pNonBlank: -Infinity };
              nextBeams.set(prefix, entry);
            }
            const totalP = logSumExp2(p.pBlank, p.pNonBlank);
            entry.pBlank = logSumExp2(entry.pBlank, totalP + lp);
          } else {
            const char = CHARSET[c] || '';
            if (!char) continue;
            const lastChar = prefix.slice(-1);

            if (char === lastChar) {
              // Repeated character
              // 1. If previous path ended with blank, this character appends to prefix
              const newPrefix = prefix + char;
              let newEntry = nextBeams.get(newPrefix);
              if (!newEntry) {
                newEntry = { pBlank: -Infinity, pNonBlank: -Infinity };
                nextBeams.set(newPrefix, newEntry);
              }
              newEntry.pNonBlank = logSumExp2(newEntry.pNonBlank, p.pBlank + lp);

              // 2. If previous path ended with non-blank, this character collapses
              let sameEntry = nextBeams.get(prefix);
              if (!sameEntry) {
                sameEntry = { pBlank: -Infinity, pNonBlank: -Infinity };
                nextBeams.set(prefix, sameEntry);
              }
              sameEntry.pNonBlank = logSumExp2(sameEntry.pNonBlank, p.pNonBlank + lp);
            } else {
              // Different character: always appends to prefix
              const newPrefix = prefix + char;
              let newEntry = nextBeams.get(newPrefix);
              if (!newEntry) {
                newEntry = { pBlank: -Infinity, pNonBlank: -Infinity };
                nextBeams.set(newPrefix, newEntry);
              }
              const totalP = logSumExp2(p.pBlank, p.pNonBlank);
              newEntry.pNonBlank = logSumExp2(newEntry.pNonBlank, totalP + lp);
            }
          }
        }
      }

      // Prune to beamWidth
      const sorted = Array.from(nextBeams.entries())
        .map(([prefix, p]) => ({ prefix, total: logSumExp2(p.pBlank, p.pNonBlank) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, beamWidth);

      beams = new Map();
      for (const item of sorted) {
        beams.set(item.prefix, nextBeams.get(item.prefix));
      }
    }

    const finalCandidates = Array.from(beams.entries())
      .map(([prefix, p]) => ({ prefix, total: logSumExp2(p.pBlank, p.pNonBlank) }))
      .sort((a, b) => b.total - a.total);

    return finalCandidates.length > 0 ? finalCandidates[0].prefix : '';
  }

  decodeGreedy(outputTensor) {
    const outputData = outputTensor.data;
    const sequenceLength = outputTensor.dims[0];
    const numClasses = outputTensor.dims[2];

    let result = '';
    let lastIndex = -1;

    for (let t = 0; t < sequenceLength; t++) {
      const offset = t * numClasses;
      let maxProb = -Infinity;
      let maxIndex = 0;

      for (let j = 0; j < numClasses; j++) {
        const prob = outputData[offset + j];
        if (prob > maxProb) {
          maxProb = prob;
          maxIndex = j;
        }
      }

      if (maxIndex !== lastIndex && maxIndex !== 0) {
        const char = CHARSET[maxIndex] || '';
        result += char;
      }
      lastIndex = maxIndex;
    }

    return result;
  }

  async classify(imageElement) {
    await this.init();

    const inputTensor = this.preprocessImage(imageElement);
    const inputName = this.session.inputNames[0] || 'input1';
    const feeds = { [inputName]: inputTensor };

    const results = await this.session.run(feeds);
    const outputTensor = Object.values(results)[0];

    let text = this.decodeBeamSearch(outputTensor, 20);
    if (!text || text.trim() === '') {
      text = this.decodeGreedy(outputTensor);
    }

    return text;
  }
}

const engine = new UniversalOcrEngine();

// Message listener for OCR classification requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== 'offscreen') {
    return false;
  }

  if (request.type === 'PING') {
    sendResponse({ success: true, ready: true, modelReady: !!engine.session });
    return false;
  }

  if (request.type === 'WARMUP') {
    (async () => {
      try {
        await engine.init();
        sendResponse({ success: true, ready: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (request.type === 'OCR_CLASSIFY') {
    (async () => {
      try {
        if (!request.imageBase64) {
          throw new Error('No image data provided.');
        }

        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Failed to load image into DOM.'));
          img.src = request.imageBase64;
        });

        const text = await engine.classify(img);
        console.log('[Universal-OCR Offscreen] Recognized text:', text);
        sendResponse({ success: true, text });
      } catch (err) {
        console.error('[Universal-OCR Offscreen] Classification error:', err);
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();

    return true; // Keep message channel open for async response
  }

  return false;
});

// Announce offscreen ready and pre-warm model
try {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
  engine.init().catch((err) => {
    console.warn('[Universal-OCR Offscreen] Initial pre-warm deferred:', err);
  });
} catch (e) {}

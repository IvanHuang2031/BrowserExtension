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
  '1073': 'v',
  '1151': 'c',
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
  '7961': 'C'
};

// All valid alphanumeric tokens plus CTC blank (0)
const VALID_CLASSES = [0].concat(Object.keys(CHARSET).map(Number));

class UniversalOcrEngine {
  constructor() {
    this.session = null;
    this.initPromise = null;

    if (typeof ort !== 'undefined' && ort.env) {
      // Configure ONNX Runtime Web for Chrome Extension Offscreen Document
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('libs/');
      }
      ort.env.wasm.numThreads = 1; // Single-thread prevents SharedArrayBuffer restrictions
      ort.env.wasm.proxy = false;
    }
  }

  async init(modelPathOrBuffer) {
    if (this.session) return this.session;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        let modelTarget = modelPathOrBuffer;
        if (!modelTarget) {
          if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            modelTarget = chrome.runtime.getURL('models/common_q8.onnx');
          } else {
            modelTarget = './models/common_q8.onnx';
          }
        }
        console.log('[Universal-OCR Offscreen] Loading ONNX model from:', modelTarget);
        this.session = await ort.InferenceSession.create(modelTarget, {
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
    let targetWidth = 120;
    const targetHeight = 64;
    let rawGray = null;

    // Handle HTML Image / Canvas or custom pixel source
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const origWidth = img.naturalWidth || img.width || 120;
      const origHeight = img.naturalHeight || img.height || 40;
      targetWidth = Math.max(32, Math.floor(origWidth * (targetHeight / origHeight)));

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Fill white background to handle transparent PNGs
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imageData.data;
      rawGray = new Float32Array(targetWidth * targetHeight);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        rawGray[i / 4] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
      }
    } else if (img && img.rawGray && img.width) {
      // Direct pixel buffer (Node.js test harness)
      targetWidth = img.width;
      rawGray = img.rawGray;
    } else {
      throw new Error('Unsupported image input type for preprocessImage');
    }

    // Adaptive contrast stretch (de-dilation stroke preservation)
    // Avoids min-filter horizontal dilation that thickens small strokes and blurs homoglyphs
    let minG = 1.0;
    let maxG = 0.0;
    for (let i = 0; i < rawGray.length; i++) {
      if (rawGray[i] < minG) minG = rawGray[i];
      if (rawGray[i] > maxG) maxG = rawGray[i];
    }

    const inputData = new Float32Array(targetWidth * targetHeight);
    const contrastRange = maxG - minG;
    if (contrastRange > 0.05 && contrastRange < 0.6) {
      const invRange = 1.0 / contrastRange;
      for (let i = 0; i < rawGray.length; i++) {
        let v = (rawGray[i] - minG) * invRange;
        if (v < 0.0) v = 0.0;
        if (v > 1.0) v = 1.0;
        inputData[i] = v;
      }
    } else {
      inputData.set(rawGray);
    }

    return {
      tensor: new ort.Tensor('float32', inputData, [1, 1, targetHeight, targetWidth]),
      rawGray: inputData,
      width: targetWidth,
      height: targetHeight
    };
  }

  decodeBeamSearch(outputTensor, beamWidth = 20) {
    const [T, B, C] = outputTensor.dims;
    const logits = outputTensor.data;

    // Convert raw logits to log-softmax probabilities for VALID_CLASSES only
    const logProbs = new Float32Array(T * C);
    for (let t = 0; t < T; t++) {
      const offset = t * C;
      let maxVal = -Infinity;
      for (let i = 0; i < VALID_CLASSES.length; i++) {
        const c = VALID_CLASSES[i];
        const v = logits[offset + c];
        if (v > maxVal) maxVal = v;
      }
      let sumExp = 0.0;
      for (let i = 0; i < VALID_CLASSES.length; i++) {
        const c = VALID_CLASSES[i];
        sumExp += Math.exp(logits[offset + c] - maxVal);
      }
      const logSumExp = maxVal + Math.log(sumExp);
      for (let i = 0; i < VALID_CLASSES.length; i++) {
        const c = VALID_CLASSES[i];
        logProbs[offset + c] = logits[offset + c] - logSumExp;
      }
    }

    function logSumExp2(a, b) {
      if (a === -Infinity) return b;
      if (b === -Infinity) return a;
      return Math.max(a, b) + Math.log(1.0 + Math.exp(-Math.abs(a - b)));
    }

    // CTC Prefix Beam Search with alignment tracking
    let beams = new Map();
    beams.set('', { pBlank: 0.0, pNonBlank: -Infinity, alignments: [] });

    for (let t = 0; t < T; t++) {
      const offset = t * C;
      const nextBeams = new Map();

      // Top candidate tokens for this timestep strictly from VALID_CLASSES
      const candidates = [];
      for (let i = 0; i < VALID_CLASSES.length; i++) {
        const c = VALID_CLASSES[i];
        candidates.push({ c, lp: logProbs[offset + c] });
      }
      candidates.sort((a, b) => b.lp - a.lp);
      const topCand = candidates.slice(0, 15);

      for (const [prefix, p] of beams) {
        for (const { c, lp } of topCand) {
          if (c === 0) {
            let entry = nextBeams.get(prefix);
            if (!entry) {
              entry = { pBlank: -Infinity, pNonBlank: -Infinity, alignments: p.alignments };
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
              const newPrefix = prefix + char;
              let newEntry = nextBeams.get(newPrefix);
              if (!newEntry) {
                newEntry = { pBlank: -Infinity, pNonBlank: -Infinity, alignments: [...p.alignments, { char, t, c }] };
                nextBeams.set(newPrefix, newEntry);
              }
              newEntry.pNonBlank = logSumExp2(newEntry.pNonBlank, p.pBlank + lp);

              // Collapse
              let sameEntry = nextBeams.get(prefix);
              if (!sameEntry) {
                sameEntry = { pBlank: -Infinity, pNonBlank: -Infinity, alignments: p.alignments };
                nextBeams.set(prefix, sameEntry);
              }
              sameEntry.pNonBlank = logSumExp2(sameEntry.pNonBlank, p.pNonBlank + lp);
            } else {
              const newPrefix = prefix + char;
              let newEntry = nextBeams.get(newPrefix);
              if (!newEntry) {
                newEntry = { pBlank: -Infinity, pNonBlank: -Infinity, alignments: [...p.alignments, { char, t, c }] };
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
        .map(([prefix, p]) => ({ prefix, total: logSumExp2(p.pBlank, p.pNonBlank), p }))
        .sort((a, b) => b.total - a.total)
        .slice(0, beamWidth);

      beams = new Map();
      for (const item of sorted) {
        beams.set(item.prefix, item.p);
      }
    }

    const finalCandidates = Array.from(beams.entries())
      .map(([prefix, p]) => ({ prefix, total: logSumExp2(p.pBlank, p.pNonBlank), alignments: p.alignments }))
      .sort((a, b) => b.total - a.total);

    if (finalCandidates.length > 0) {
      return {
        text: finalCandidates[0].prefix,
        alignments: finalCandidates[0].alignments
      };
    }
    return { text: '', alignments: [] };
  }

  decodeGreedy(outputTensor) {
    const outputData = outputTensor.data;
    const sequenceLength = outputTensor.dims[0];
    const numClasses = outputTensor.dims[2];

    let result = '';
    const alignments = [];
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
        if (char) {
          result += char;
          alignments.push({ char, t, c: maxIndex });
        }
      }
      lastIndex = maxIndex;
    }

    return { text: result, alignments };
  }

  calibrateCase(text, alignments, rawGray, targetWidth, targetHeight, options = {}) {
    if (!text || text.length === 0) return text;
    if (options.caseSensitive === false) return text;

    const N = text.length;
    // Build binary dark mask (< 0.75 is foreground stroke)
    let sum = 0;
    for (let i = 0; i < rawGray.length; i++) sum += rawGray[i];
    const avg = sum / rawGray.length;
    const threshold = Math.min(0.78, Math.max(0.40, avg * 0.95));

    const mask = new Uint8Array(rawGray.length);
    for (let i = 0; i < rawGray.length; i++) {
      if (rawGray[i] < threshold) mask[i] = 1;
    }

    // Find global foreground bounds
    let globalMinX = targetWidth, globalMaxX = 0;
    for (let x = 0; x < targetWidth; x++) {
      for (let y = 0; y < targetHeight; y++) {
        if (rawGray[y * targetWidth + x] < threshold) {
          if (x < globalMinX) globalMinX = x;
          if (x > globalMaxX) globalMaxX = x;
        }
      }
    }

    if (globalMaxX <= globalMinX) return text;

    // Compute column dark pixel counts for valley detection
    const colDark = new Int32Array(targetWidth);
    for (let x = 0; x < targetWidth; x++) {
      for (let y = 0; y < targetHeight; y++) {
        if (mask[y * targetWidth + x]) colDark[x]++;
      }
    }

    // Slice character regions using midpoints between consecutive CTC peaks,
    // snapping cuts to the local projection valley between adjacent characters
    const cuts = [globalMinX];
    const T = (alignments && alignments.length > 0 && typeof alignments[alignments.length - 1].t === 'number')
      ? Math.max(27, alignments[alignments.length - 1].t + 2)
      : 27;
    const stride = targetWidth / T;

    for (let i = 0; i < N - 1; i++) {
      let approxCut;
      if (alignments && i < alignments.length - 1 && typeof alignments[i].t === 'number') {
        const t1 = alignments[i].t;
        const t2 = alignments[i + 1].t;
        approxCut = Math.round(((t1 + t2) / 2) * stride + stride / 2);
      } else {
        approxCut = Math.round(globalMinX + (i + 1) * ((globalMaxX - globalMinX) / N));
      }
      approxCut = Math.max(globalMinX, Math.min(globalMaxX, approxCut));

      // Snap to local minimum in column projection around approxCut
      const searchRadius = Math.round(stride * 0.9);
      let minDark = Infinity;
      let bestX = approxCut;
      const xStart = Math.max(globalMinX, approxCut - searchRadius);
      const xEnd = Math.min(globalMaxX, approxCut + searchRadius);
      for (let x = xStart; x <= xEnd; x++) {
        if (colDark[x] < minDark) {
          minDark = colDark[x];
          bestX = x;
        }
      }
      cuts.push(bestX);
    }
    cuts.push(globalMaxX);

    const metrics = [];
    for (let i = 0; i < N; i++) {
      const cMin = i === 0 ? cuts[i] : cuts[i] + 1;
      const cMax = cuts[i + 1];
      const ch = text[i];

      let fMinX = cMax, fMaxX = cMin;
      for (let x = cMin; x <= cMax; x++) {
        for (let y = 0; y < targetHeight; y++) {
          if (rawGray[y * targetWidth + x] < threshold) {
            if (x < fMinX) fMinX = x;
            if (x > fMaxX) fMaxX = x;
          }
        }
      }

      if (fMaxX < fMinX) {
        metrics.push({ char: ch, top: 18, bot: 48, h: 30, lt: 18, rt: 18, topPxLeft: 0, topPxRight: 0 });
        continue;
      }

      let top = targetHeight, bot = 0;
      for (let x = fMinX; x <= fMaxX; x++) {
        for (let y = 0; y < targetHeight; y++) {
          if (rawGray[y * targetWidth + x] < threshold) {
            if (y < top) top = y;
            if (y > bot) bot = y;
          }
        }
      }

      if (bot < top) {
        metrics.push({ char: ch, top: 18, bot: 48, h: 30, lt: 18, rt: 18, topPxLeft: 0, topPxRight: 0 });
        continue;
      }

      const h = bot - top + 1;
      const charCenterX = (fMinX + fMaxX) / 2;
      const upperCutoff = top + Math.max(3, h * 0.35);

      let lt = targetHeight, rt = targetHeight;
      let topPxLeft = 0, topPxRight = 0;

      for (let x = fMinX; x <= fMaxX; x++) {
        for (let y = 0; y < targetHeight; y++) {
          if (rawGray[y * targetWidth + x] < threshold) {
            if (x < charCenterX) {
              if (y < lt) lt = y;
              if (y <= upperCutoff) topPxLeft++;
            } else {
              if (y < rt) rt = y;
              if (y <= upperCutoff) topPxRight++;
            }
          }
        }
      }

      if (lt === targetHeight) lt = top;
      if (rt === targetHeight) rt = top;

      metrics.push({
        char: ch,
        top,
        bot,
        h,
        lt,
        rt,
        topPxLeft,
        topPxRight
      });
    }

    // Compute line reference baseline and cap height
    const nonDescenders = metrics.filter((m) => !'gjpqy'.includes(m.char)).map((m) => m.bot);
    nonDescenders.sort((a, b) => a - b);
    const baseline = nonDescenders.length > 0 ? nonDescenders[Math.floor(nonDescenders.length / 2)] : 48;

    const tallTops = metrics
      .filter((m) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789bdfhkl'.includes(m.char) && m.h >= 14)
      .map((m) => m.top);
    
    let capTop, capHeight;
    if (tallTops.length > 0) {
      capTop = Math.min(...tallTops);
      capHeight = Math.max(16, baseline - capTop);
    } else {
      // Safe fallback when all characters in the token are x-height (e.g. 'vwso')
      const minTop = Math.min(...metrics.map((m) => m.top));
      capHeight = Math.max(16, (baseline - minTop) / 0.72);
      capTop = baseline - capHeight;
    }

    const xheightHomoglyphs = new Set(['c', 'C', 'v', 'V', 'w', 'W', 's', 'S', 'o', 'O', 'z', 'Z', 'x', 'X', 'u', 'U', 'm', 'M']);
    const calibrated = [];

    for (let i = 0; i < N; i++) {
      const m = metrics[i];
      let ch = m.char;
      const topOffset = m.top - capTop;
      const hRatio = m.h / capHeight;

      // 1. Pure x-height homoglyphs (c, v, w, s, o, z, x, u, m)
      if (xheightHomoglyphs.has(ch)) {
        if (ch === ch.toUpperCase() && (topOffset >= 0.16 * capHeight || hRatio <= 0.82)) {
          ch = ch.toLowerCase();
        } else if (ch === ch.toLowerCase() && (topOffset <= 0.08 * capHeight && hRatio >= 0.90)) {
          ch = ch.toUpperCase();
        }
      }
      // 2. Descender homoglyphs (p / P)
      else if (ch === 'p' || ch === 'P') {
        if (m.bot - baseline >= 0.14 * capHeight) {
          ch = 'p';
        } else if (m.bot <= baseline + 0.08 * capHeight && m.top <= capTop + 0.08 * capHeight) {
          ch = 'P';
        }
      }
      // 3. j vs J
      else if (ch === 'j' || ch === 'J') {
        if (m.bot - baseline >= 0.14 * capHeight) {
          ch = 'j';
        } else if (m.bot <= baseline + 0.08 * capHeight) {
          ch = 'J';
        }
      }
      // 4. d vs D (d has left low bowl, right tall ascender)
      else if (ch === 'd' || ch === 'D') {
        if (m.lt - m.rt >= 0.14 * capHeight || (m.topPxRight >= 3 && m.topPxLeft <= 0.3 * m.topPxRight)) {
          ch = 'd';
        } else if (Math.abs(m.lt - m.rt) <= 0.08 * capHeight && hRatio >= 0.88) {
          ch = 'D';
        }
      }
      // 5. h vs H (h has left tall stem, right low arch)
      else if (ch === 'h' || ch === 'H') {
        if (m.rt - m.lt >= 0.14 * capHeight || (m.topPxLeft >= 3 && m.topPxRight <= 0.3 * m.topPxLeft)) {
          ch = 'h';
        } else if (Math.abs(m.rt - m.lt) <= 0.08 * capHeight && hRatio >= 0.88) {
          ch = 'H';
        }
      }
      // 6. k vs K (k has tall left stem with lower branches)
      else if (ch === 'k' || ch === 'K') {
        if (m.topPxLeft >= 3 && m.topPxRight <= 0.35 * m.topPxLeft) {
          ch = 'k';
        } else if (m.topPxRight >= 2 && hRatio >= 0.88) {
          ch = 'K';
        }
      }

      calibrated.push(ch);
    }

    return calibrated.join('');
  }

  async classify(imageElement, options = {}) {
    await this.init();

    const preprocessed = this.preprocessImage(imageElement);
    const tensor = preprocessed.tensor;
    const rawGray = preprocessed.rawGray;
    const width = preprocessed.width;
    const height = preprocessed.height;

    const inputName = this.session.inputNames[0] || 'input1';
    const feeds = { [inputName]: tensor };

    const results = await this.session.run(feeds);
    const outputTensor = Object.values(results)[0];

    let decoded = this.decodeBeamSearch(outputTensor, 20);
    if (!decoded.text || decoded.text.trim() === '') {
      decoded = this.decodeGreedy(outputTensor);
    }

    let finalResult = decoded.text;
    if (finalResult && finalResult.length > 0) {
      finalResult = this.calibrateCase(finalResult, decoded.alignments, rawGray, width, height, options);
    }

    return finalResult;
  }
}

const EXTENSION_VERSION = '1.3.1';
const engine = new UniversalOcrEngine();

// Export for automated testing in Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UniversalOcrEngine,
    CHARSET,
    VALID_CLASSES,
    EXTENSION_VERSION,
    engine
  };
}

// Message listener for OCR classification requests
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.target !== 'offscreen') {
      return false;
    }

    if (request.type === 'PING') {
      sendResponse({
        success: true,
        ready: true,
        modelReady: !!engine.session,
        version: EXTENSION_VERSION
      });
      return false;
    }

    if (request.type === 'WARMUP') {
      (async () => {
        try {
          await engine.init();
          sendResponse({ success: true, ready: true, version: EXTENSION_VERSION });
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

          const text = await engine.classify(img, { caseSensitive: !!request.caseSensitive });
          console.log(`[Universal-OCR Offscreen v${EXTENSION_VERSION}] Recognized text:`, text);
          sendResponse({ success: true, text, version: EXTENSION_VERSION });
        } catch (err) {
          console.error(`[Universal-OCR Offscreen v${EXTENSION_VERSION}] Classification error:`, err);
          sendResponse({ success: false, error: err.message || String(err) });
        }
      })();

      return true; // Keep message channel open for async response
    }

    return false;
  });

  // Announce offscreen ready and pre-warm model
  try {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY', version: EXTENSION_VERSION });
    engine.init().catch((err) => {
      console.warn('[Universal-OCR Offscreen] Initial pre-warm deferred:', err);
    });
  } catch (e) {}
}


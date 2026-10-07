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

  processRgbaBuffer(data, width, height, options = {}) {
    // 1. Analyze color channel statistics to detect blue captcha (dark blue characters + light blue interference lines)
    let darkBlueCount = 0;
    let lightBlueCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const b = data[i + 2];
      if (r < 90 && b >= r + 10) darkBlueCount++;
      if (r >= 80 && r <= 180 && b >= r + 10) lightBlueCount++;
    }

    const isColorAware = (options.colorAware !== false) &&
      (options.colorAware === true || (darkBlueCount >= 30 && lightBlueCount >= 60));

    const padMargin = Math.round(width * 0.15); // Edge noise cleansing margin
    const totalPixels = width * height;
    const rawGray = new Float32Array(totalPixels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const offset = idx * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];

        if (isColorAware) {
          // Border noise cleansing: clean margins where characters never reside
          if (x < padMargin || x > (width - padMargin)) {
            rawGray[idx] = 1.0;
          } else if (r > 80 && (b - r) >= 12) {
            // Filter light blue interference lines / noise to white (1.0), preserving true dark text (R <= 80)
            rawGray[idx] = 1.0;
          } else {
            rawGray[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
          }
        } else {
          rawGray[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
        }
      }
    }

    return rawGray;
  }

  preprocessImage(img, options = {}) {
    let targetWidth = 120;
    let targetHeight = 64;
    let rawGray = null;

    // Handle HTML Image / Canvas or custom pixel source
    if (typeof document !== 'undefined' && document.createElement && (img instanceof Element || img.naturalWidth || img.src)) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const origWidth = img.naturalWidth || img.width || 120;
      const origHeight = img.naturalHeight || img.height || 40;
      targetWidth = Math.max(32, Math.floor(origWidth * (targetHeight / origHeight)));

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Fill white background to handle transparent PNGs
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imageData.data;
      rawGray = this.processRgbaBuffer(data, targetWidth, targetHeight, options);
    } else if (img && img.data && img.width) {
      // Direct RGBA buffer (Node.js test harness or ImageData)
      targetWidth = img.width;
      targetHeight = img.height || 64;
      rawGray = this.processRgbaBuffer(img.data, targetWidth, targetHeight, options);
    } else if (img && img.rawGray && img.width) {
      // Direct pixel buffer (Node.js test harness)
      targetWidth = img.width;
      targetHeight = img.height || 64;
      rawGray = img.rawGray;
    } else {
      throw new Error('Unsupported image input type for preprocessImage');
    }

    // Pure, stable bilinear grayscale normalization (in [0, 1])
    // Avoids fragile single-pixel extrema contrast stretching and noise-connecting dilation
    const inputData = new Float32Array(rawGray.length);
    for (let i = 0; i < rawGray.length; i++) {
      const v = rawGray[i];
      inputData[i] = v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
    }

    return {
      tensor: (typeof ort !== 'undefined' && ort.Tensor)
        ? new ort.Tensor('float32', inputData, [1, 1, targetHeight, targetWidth])
        : null,
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

      for (let i = 0; i < VALID_CLASSES.length; i++) {
        const c = VALID_CLASSES[i];
        const prob = outputData[offset + c];
        if (prob > maxProb) {
          maxProb = prob;
          maxIndex = c;
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

  /**
   * Typographic case calibration (v1.3.4).
   *
   * The underlying model reliably identifies WHICH letter is present but its
   * upper/lower-case choice is close to random for homoglyph pairs (c/C, s/S,
   * v/V, w/W, z/Z, ...). Case is instead decided from glyph geometry on the
   * preprocessed (noise-filtered) image:
   *   - Letters whose lowercase form has no ascender (XH_LETTERS): lowercase if
   *     the glyph top sits clearly below the cap line, otherwise uppercase.
   *   - h/k/b/d: lowercase if the region between cap line and x-height on the
   *     stem-free side is empty (lowercase h has no top-right arm, etc.).
   *   - l/L: uppercase if the glyph is wide (L has a foot), lowercase if narrow.
   *   - j/i: lowercase if a separate dot sits above the body.
   *   - t/T: uppercase if the top rows are as wide as the glyph (T's top bar).
   * The cap line comes from glyphs that reach it in either case (digits and
   * b/d/f/h/k/l/t). When no such glyph exists, options.capHeightRatio (the cap
   * height previously measured on the same site) is used instead.
   * Touching glyphs are split using the CTC alignment positions
   * (requires options.timeSteps). If glyphs cannot be matched one-to-one with
   * the decoded characters, the model output is returned unchanged.
   *
   * @returns {{ text: string, capHeightRatio: number|null }} capHeightRatio is the
   *   cap height / image height measured from this image, for reuse on the same site.
   */
  calibrateCaseDetailed(text, alignments, rawGray, targetWidth, targetHeight, options = {}) {
    const unchanged = { text, capHeightRatio: null };
    if (!text || !rawGray || rawGray.length !== targetWidth * targetHeight) return unchanged;

    const W = targetWidth;
    const H = targetHeight;
    const XH_LETTERS = 'acegmnopqrsuvwxyz';
    const TALL_CHARS = 'bdfhklt0123456789';
    const DESCENDERS = 'gjpqy';
    const LOWER_THRESHOLD = 0.13; // glyph top below cap line by >13% of text height => lowercase
    const ink = (x, y) => rawGray[y * W + x] < 0.5;
    const chars = Array.from(text);

    // 1. Segment glyphs by vertical ink projection
    const colInk = new Array(W).fill(0);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (ink(x, y)) colInk[x]++;
    let runs = [];
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const hasInk = x < W && colInk[x] > 0;
      if (hasInk && start < 0) start = x;
      if (!hasInk && start >= 0) { runs.push([start, x]); start = -1; }
    }
    runs = runs.filter(([s, e]) => {
      let total = 0;
      for (let x = s; x < e; x++) total += colInk[x];
      return total >= 6; // drop residual specks
    });
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      // Merge slivers (i/j dots, split strokes) into their neighbour
      if (last && (r[1] - r[0] < 5 || last[1] - last[0] < 5) && r[0] - last[1] <= 3) {
        last[1] = r[1];
      } else {
        merged.push([r[0], r[1]]);
      }
    }
    if (merged.length === 0) return unchanged;

    // 2. Match glyphs to characters. With CTC alignments, each character is assigned
    //    to the nearest run, and a run holding several characters (touching glyphs)
    //    is split at the lowest-ink column between them.
    let segs = null;
    const T = options.timeSteps;
    if (T > 0 && Array.isArray(alignments) && alignments.length === chars.length) {
      const sx = W / T;
      const centers = alignments.map((a) => (a.t + 0.5) * sx);
      const assigned = merged.map(() => []);
      centers.forEach((cx, i) => {
        let best = 0;
        let bestDist = Infinity;
        merged.forEach(([s, e], r) => {
          const d = (cx >= s && cx < e) ? 0 : Math.min(Math.abs(cx - s), Math.abs(cx - (e - 1)));
          if (d < bestDist) { bestDist = d; best = r; }
        });
        assigned[best].push(i);
      });
      segs = new Array(chars.length).fill(null);
      for (let r = 0; r < merged.length && segs; r++) {
        const [s, e] = merged[r];
        const idx = assigned[r];
        if (idx.length === 0) continue; // noise run
        const cuts = [s];
        for (let k = 0; k + 1 < idx.length; k++) {
          const lo = Math.floor(Math.max(s + 1, Math.min(centers[idx[k]], centers[idx[k + 1]]) + 1));
          const hi = Math.floor(Math.min(e - 1, Math.max(centers[idx[k]], centers[idx[k + 1]])));
          if (hi <= lo) { segs = null; break; }
          let cut = lo;
          for (let x = lo; x < hi; x++) if (colInk[x] < colInk[cut]) cut = x;
          cuts.push(cut);
        }
        if (!segs) break;
        cuts.push(e);
        idx.forEach((i, k) => { segs[i] = [cuts[k], cuts[k + 1]]; });
      }
      if (segs && segs.some((sg) => !sg)) segs = null;
    } else if (merged.length === chars.length) {
      segs = merged;
    }
    if (!segs) return unchanged;

    // 3. Vertical extent of each glyph, ignoring isolated noise rows
    const boxes = segs.map(([s, e]) => {
      const cnt = new Array(H).fill(0);
      for (let y = 0; y < H; y++) for (let x = s; x < e; x++) if (ink(x, y)) cnt[y]++;
      let top = -1;
      let bottom = -1;
      for (let y = 0; y + 2 < H; y++) {
        if (cnt[y] >= 2 && cnt[y + 1] >= 1 && cnt[y + 2] >= 1) { top = y; break; }
      }
      for (let y = H - 1; y >= 2; y--) {
        if (cnt[y] >= 2 && cnt[y - 1] >= 1 && cnt[y - 2] >= 1) { bottom = y; break; }
      }
      return top >= 0 && bottom >= 0 ? { top, bottom } : null;
    });
    if (boxes.some((b) => !b)) return unchanged;

    const median = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    // 4. Reference lines: baseline from non-descender glyphs, cap line from tall glyphs
    const baselineSamples = boxes.filter((_, i) => !DESCENDERS.includes(chars[i].toLowerCase())).map((b) => b.bottom);
    if (baselineSamples.length === 0) return unchanged;
    const baseline = median(baselineSamples);

    // Height-based rules assume glyphs share one baseline. Captchas with strongly
    // rotated or vertically jittered glyphs break that assumption, so keep the model output.
    const maxGlyphHeight = Math.max(...boxes.map((b) => b.bottom - b.top));
    if (baselineSamples.length >= 2 &&
        Math.max(...baselineSamples) - Math.min(...baselineSamples) > 0.15 * maxGlyphHeight) {
      return unchanged;
    }

    const tallTops = boxes.filter((_, i) => TALL_CHARS.includes(chars[i].toLowerCase())).map((b) => b.top);
    const xhTops = boxes.filter((_, i) => XH_LETTERS.includes(chars[i].toLowerCase())).map((b) => b.top);
    let capLine;
    let measured = false;
    if (tallTops.length > 0) {
      capLine = Math.min(median(tallTops), ...boxes.map((b) => b.top));
      measured = true;
    } else if (xhTops.length > 0 &&
               (Math.max(...xhTops) - Math.min(...xhTops)) > LOWER_THRESHOLD * (baseline - Math.min(...xhTops))) {
      capLine = Math.min(...xhTops); // no tall reference, but tops clearly split into two levels
      measured = true;
    } else if (options.capHeightRatio > 0) {
      capLine = baseline - options.capHeightRatio * H; // cap height learned earlier on this site
    } else {
      return unchanged; // all glyphs at one level with no reference: case is undecidable
    }
    const textHeight = baseline - capLine;
    if (textHeight < 10) return unchanged;

    // 5. Decide case per character
    const calibrated = chars.map((ch, i) => {
      const lower = ch.toLowerCase();
      const [s, e] = segs[i];
      if (XH_LETTERS.includes(lower)) {
        return (boxes[i].top - capLine) / textHeight > LOWER_THRESHOLD ? lower : ch.toUpperCase();
      }
      if ('hkbd'.includes(lower)) {
        const w = e - s;
        const y0 = Math.max(0, Math.floor(capLine + 0.08 * textHeight));
        const y1 = Math.max(0, Math.floor(capLine + 0.25 * textHeight));
        const x0 = lower === 'd' ? s : s + Math.floor(w * 0.6);
        const x1 = lower === 'd' ? s + Math.floor(w * 0.4) : e;
        let filled = 0;
        let area = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) { area++; if (ink(x, y)) filled++; }
        }
        if (area > 0) return filled / area < 0.08 ? lower : ch.toUpperCase();
      }
      if (lower === 'j' || lower === 'i') {
        // A separate dot above the body means lowercase; otherwise keep the model's
        // choice (a missed dot under noise must not turn j into J)
        const { top, bottom } = boxes[i];
        const rowInk = [];
        let total = 0;
        for (let y = top; y <= bottom; y++) {
          let n = 0;
          for (let x = s; x < e; x++) if (ink(x, y)) n++;
          rowInk.push(n);
          total += n;
        }
        const limit = Math.floor(0.45 * (bottom - top));
        let seen = false;
        for (let y = 0; y < limit; y++) {
          if (rowInk[y] > 0) {
            seen = true;
          } else if (seen) {
            let dot = 0;
            for (let k = 0; k < y; k++) dot += rowInk[k];
            if (dot >= 3 && dot < 0.25 * total) return lower;
            break;
          }
        }
        return ch;
      }
      if (lower === 't') {
        // T has a full-width bar at the very top; t only shows its stem there
        const { top, bottom } = boxes[i];
        const spans = [];
        for (let y = top; y <= bottom; y++) {
          let first = -1;
          let last = -1;
          for (let x = s; x < e; x++) if (ink(x, y)) { if (first < 0) first = x; last = x; }
          spans.push(first >= 0 ? last - first + 1 : 0);
        }
        const k = Math.max(1, Math.floor(0.12 * (bottom - top)));
        const topSpan = spans.slice(0, k).reduce((a, b) => a + b, 0) / k;
        return topSpan / Math.max(...spans) < 0.6 ? 't' : 'T';
      }
      if (lower === 'l') {
        // Width of columns holding >= 2 ink pixels: L has a foot, l is a bare stem
        let first = -1;
        let last = -1;
        for (let x = s; x < e; x++) {
          let n = 0;
          for (let y = 0; y < H; y++) if (ink(x, y)) n++;
          if (n >= 2) { if (first < 0) first = x; last = x; }
        }
        const glyphWidth = first >= 0 ? last - first + 1 : 0;
        return glyphWidth > 0.33 * textHeight ? 'L' : 'l';
      }
      return ch;
    }).join('');

    return { text: calibrated, capHeightRatio: measured ? textHeight / H : null };
  }

  calibrateCase(text, alignments, rawGray, targetWidth, targetHeight, options = {}) {
    return this.calibrateCaseDetailed(text, alignments, rawGray, targetWidth, targetHeight, options).text;
  }

  /**
   * @returns {Promise<{ text: string, capHeightRatio: number|null }>}
   */
  async classify(imageElement, options = {}) {
    await this.init();

    const preprocessed = this.preprocessImage(imageElement, options);
    const tensor = preprocessed.tensor;

    const inputName = this.session.inputNames[0] || 'input1';
    const feeds = { [inputName]: tensor };

    const results = await this.session.run(feeds);
    const outputTensor = Object.values(results)[0];

    const beamWidth = (options && typeof options.beamWidth === 'number') ? options.beamWidth : 20;
    let decoded = this.decodeBeamSearch(outputTensor, beamWidth);
    if (!decoded.text || decoded.text.trim() === '') {
      decoded = this.decodeGreedy(outputTensor);
    }

    return this.calibrateCaseDetailed(
      decoded.text,
      decoded.alignments,
      preprocessed.rawGray,
      preprocessed.width,
      preprocessed.height,
      { ...options, timeSteps: outputTensor.dims[0] }
    );
  }
}

const EXTENSION_VERSION = '1.3.5';
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

          const { text, capHeightRatio } = await engine.classify(img, {
            caseSensitive: !!request.caseSensitive,
            capHeightRatio: request.capHeightRatio
          });
          console.log(`[Universal-OCR Offscreen v${EXTENSION_VERSION}] Recognized text:`, text);
          sendResponse({ success: true, text, capHeightRatio, version: EXTENSION_VERSION });
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


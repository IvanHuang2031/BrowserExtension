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
      const modelUrl = chrome.runtime.getURL('models/common_q8.onnx');
      console.log('[Universal-OCR] Loading ONNX model from:', modelUrl);
      this.session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm']
      });
      console.log('[Universal-OCR] Model loaded successfully. Input names:', this.session.inputNames);
      return this.session;
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

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imageData.data;
    const inputData = new Float32Array(targetWidth * targetHeight);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const grayscale = 0.299 * r + 0.587 * g + 0.114 * b;
      inputData[i / 4] = grayscale / 255.0;
    }

    return new ort.Tensor('float32', inputData, [1, 1, targetHeight, targetWidth]);
  }

  decodeBeamSearch(outputTensor, beamWidth = 3) {
    const outputData = outputTensor.data;
    const sequenceLength = outputTensor.dims[0];
    const numClasses = outputTensor.dims[2];

    let paths = [{ text: '', score: 0, prev: -1 }];

    for (let t = 0; t < sequenceLength; t++) {
      const nextPaths = [];
      const offset = t * numClasses;

      for (const path of paths) {
        // Collect top candidates for current timestep
        const candidates = [];
        for (let j = 0; j < numClasses; j++) {
          const prob = outputData[offset + j];
          if (candidates.length < beamWidth) {
            candidates.push({ prob, index: j });
            candidates.sort((a, b) => b.prob - a.prob);
          } else if (prob > candidates[candidates.length - 1].prob) {
            candidates[candidates.length - 1] = { prob, index: j };
            candidates.sort((a, b) => b.prob - a.prob);
          }
        }

        for (const { prob, index } of candidates) {
          const char = CHARSET[index] || '';
          const logProb = Math.log(Math.max(prob, 1e-12));

          let newText = path.text;
          if (index !== 0 && index !== path.prev) {
            newText += char;
          }

          nextPaths.push({
            text: newText,
            score: path.score + logProb,
            prev: index
          });
        }
      }

      // Retain top paths
      paths = nextPaths.sort((a, b) => b.score - a.score).slice(0, beamWidth);
    }

    return paths.length > 0 ? paths[0].text : '';
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

    let text = this.decodeBeamSearch(outputTensor, 3);
    if (!text || text.trim() === '') {
      text = this.decodeGreedy(outputTensor);
    }

    return text;
  }
}

const engine = new UniversalOcrEngine();

// Message listener for OCR classification requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target !== 'offscreen' && request.type !== 'OCR_CLASSIFY') {
    return false;
  }

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
      console.log('[Universal-OCR] Recognized text:', text);
      sendResponse({ success: true, text });
    } catch (err) {
      console.error('[Universal-OCR] Classification error:', err);
      sendResponse({ success: false, error: err.message || String(err) });
    }
  })();

  return true; // Keep message channel open for async response
});

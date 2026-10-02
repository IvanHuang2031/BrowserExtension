/**
 * Universal Captcha OCR Case-Sensitivity Test Suite
 * Validates fixes for:
 * 1. dgEL (d vs D)
 * 2. JGWv (v vs V, charset index 1073 fix)
 * 3. hjbc (h vs H, c vs C)
 * 4. General homoglyphs and geometric calibration
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  UniversalOcrEngine,
  CHARSET,
  VALID_CLASSES,
  EXTENSION_VERSION
} = require('../offscreen.js');

test('Charset & Token Mapping Integrity', async (t) => {
  await t.test('token 1073 is lowercase v and 6887 is uppercase V', () => {
    assert.strictEqual(CHARSET['1073'], 'v', 'CHARSET must contain 1073: v');
    assert.strictEqual(CHARSET['6887'], 'V', 'CHARSET must contain 6887: V');
    assert.notStrictEqual(CHARSET['1072'], 'v', '1072 should not be mapped to v (1072 is Chinese character)');
  });

  await t.test('token 1151 is lowercase c and 7961 is uppercase C', () => {
    assert.strictEqual(CHARSET['1151'], 'c', 'CHARSET must contain 1151: c');
    assert.strictEqual(CHARSET['7961'], 'C', 'CHARSET must contain 7961: C');
  });

  await t.test('token 6810 is lowercase d and 3128 is uppercase D', () => {
    assert.strictEqual(CHARSET['6810'], 'd', 'CHARSET must contain 6810: d');
    assert.strictEqual(CHARSET['3128'], 'D', 'CHARSET must contain 3128: D');
  });

  await t.test('token 7412 is lowercase h and 1965 is uppercase H', () => {
    assert.strictEqual(CHARSET['7412'], 'h', 'CHARSET must contain 7412: h');
    assert.strictEqual(CHARSET['1965'], 'H', 'CHARSET must contain 1965: H');
  });

  await t.test('VALID_CLASSES contains exactly 62 alphanumeric characters + blank (0)', () => {
    assert.strictEqual(Object.keys(CHARSET).length, 62, 'Total alphanumeric charset must be 62');
    assert.strictEqual(VALID_CLASSES.length, 63, 'VALID_CLASSES must be 63 (0 + 62)');
    assert.strictEqual(VALID_CLASSES[0], 0, 'First class must be CTC blank 0');
  });
});

test('Beam Search Alphanumeric Filtering', () => {
  const engine = new UniversalOcrEngine();
  // Simulate a 3-timestep tensor with 8210 classes
  const T = 3;
  const B = 1;
  const C = 8210;
  const data = new Float32Array(T * B * C);

  // t=0: class 0 (blank)
  data[0 * C + 0] = 10.0;
  // t=1: class 1073 ('v') has logit 8.0, while an unused Chinese char (e.g. 500) has logit 9.0
  data[1 * C + 500] = 9.0;
  data[1 * C + 1073] = 8.0;
  // t=2: class 0 (blank)
  data[2 * C + 0] = 10.0;

  const fakeTensor = {
    dims: [T, B, C],
    data
  };

  const decoded = engine.decodeBeamSearch(fakeTensor, 10);
  assert.strictEqual(decoded.text, 'v', 'Beam search must only decode valid alphanumeric classes, filtering out Chinese characters');
});

function expandTensor(item) {
  if (item.data) return new Float32Array(item.data);
  const [T, B, C] = item.dims;
  const data = new Float32Array(T * B * C);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < VALID_CLASSES.length; i++) {
      data[t * C + VALID_CLASSES[i]] = item.validLogits[t][i];
    }
  }
  return data;
}

test('Universal Captcha Real Case Recognition & Geometric Calibration', async (t) => {
  const engine = new UniversalOcrEngine();
  const casesJsonPath = path.join(__dirname, 'fixtures', 'onnx_cases.json');

  if (!fs.existsSync(casesJsonPath)) {
    t.skip('onnx_cases.json fixture not found, skipping fixture inference test');
    return;
  }

  const items = JSON.parse(fs.readFileSync(casesJsonPath, 'utf8'));

  for (const item of items) {
    await t.test(`Fixture Case: ${item.expected}`, () => {
      const fakeTensor = {
        dims: item.dims,
        data: expandTensor(item)
      };

      const decoded = engine.decodeBeamSearch(fakeTensor, 20);
      const rawGray = new Float32Array(item.rawGray);

      // 1. Case-sensitive calibration
      const calibrated = engine.calibrateCase(
        decoded.text,
        decoded.alignments,
        rawGray,
        item.width,
        item.height,
        { caseSensitive: true }
      );

      assert.strictEqual(
        calibrated,
        item.expected,
        `Expected ${item.expected} after case calibration, but got ${calibrated} (raw beam was: ${decoded.text})`
      );

      // 2. Case-insensitive mode preserves decoded text untouched
      const uncalibrated = engine.calibrateCase(
        decoded.text,
        decoded.alignments,
        rawGray,
        item.width,
        item.height,
        { caseSensitive: false }
      );
      assert.strictEqual(
        uncalibrated,
        decoded.text,
        'When caseSensitive is false, calibrateCase must not modify raw text'
      );
    });
  }
});

test('Direct Misprediction Calibration Stress Tests', async (t) => {
  const engine = new UniversalOcrEngine();
  const casesJsonPath = path.join(__dirname, 'fixtures', 'onnx_cases.json');
  if (!fs.existsSync(casesJsonPath)) return;

  const items = JSON.parse(fs.readFileSync(casesJsonPath, 'utf8'));
  const dgEL = items.find((x) => x.expected === 'dgEL');
  const JGWv = items.find((x) => x.expected === 'JGWv');
  const hjbc = items.find((x) => x.expected === 'hjbc');

  await t.test('Corrects DgEL -> dgEL via left-bowl right-ascender geometry', () => {
    const rawGray = new Float32Array(dgEL.rawGray);
    const decoded = engine.decodeBeamSearch({ dims: dgEL.dims, data: expandTensor(dgEL) }, 20);
    // Explicitly test correcting mispredicted uppercase 'D'
    const result = engine.calibrateCase('DgEL', decoded.alignments, rawGray, dgEL.width, dgEL.height, { caseSensitive: true });
    assert.strictEqual(result, 'dgEL', 'DgEL must be corrected to dgEL based on letter d geometry');
  });

  await t.test('Corrects JGWV -> JGWv via x-height homoglyph geometry', () => {
    const rawGray = new Float32Array(JGWv.rawGray);
    const decoded = engine.decodeBeamSearch({ dims: JGWv.dims, data: expandTensor(JGWv) }, 20);
    // Explicitly test correcting mispredicted uppercase 'V'
    const result = engine.calibrateCase('JGWV', decoded.alignments, rawGray, JGWv.width, JGWv.height, { caseSensitive: true });
    assert.strictEqual(result, 'JGWv', 'JGWV must be corrected to JGWv based on letter v x-height');
  });

  await t.test('Corrects HjbC -> hjbc via left-stem asymmetry and c x-height', () => {
    const rawGray = new Float32Array(hjbc.rawGray);
    const decoded = engine.decodeBeamSearch({ dims: hjbc.dims, data: expandTensor(hjbc) }, 20);
    // Explicitly test correcting mispredicted H and C
    const result = engine.calibrateCase('HjbC', decoded.alignments, rawGray, hjbc.width, hjbc.height, { caseSensitive: true });
    assert.strictEqual(result, 'hjbc', 'HjbC must be corrected to hjbc based on h and c geometry');
  });

  await t.test('Safely preserves all-lowercase homoglyph strings (e.g. vwso) without false uppercasing', () => {
    const width = 140, height = 42;
    const rawGray = new Float32Array(width * height).fill(1.0);
    for (let i = 0; i < 4; i++) {
      const xStart = 20 + i * 25;
      for (let x = xStart; x < xStart + 15; x++) {
        for (let y = 17; y <= 31; y++) {
          rawGray[y * width + x] = 0.0;
        }
      }
    }
    const text = 'vwso';
    const alignments = [
      { char: 'v', t: 3 },
      { char: 'w', t: 6 },
      { char: 's', t: 9 },
      { char: 'o', t: 12 }
    ];
    const result = engine.calibrateCase(text, alignments, rawGray, width, height, { caseSensitive: true });
    assert.strictEqual(result, 'vwso', 'All-lowercase homoglyphs must not be converted to uppercase due to empty tallTops');
  });
});


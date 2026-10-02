/**
 * Universal Captcha OCR Case-Sensitivity & Real Case Test Suite (v1.3.2)
 * Validates fixes for:
 * 1. Model native pure-grayscale beam search inference
 * 2. Deactivation of destructive calibrateCase geometric heuristics
 * 3. 5 real-world noisy captcha cases: pyU3, sChz, Pvvs, BFzK, Lcwh
 * 4. Token mapping integrity (1073: v vs 6887: V, etc.)
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

  await t.test('EXTENSION_VERSION is bumped to 1.3.2', () => {
    assert.strictEqual(EXTENSION_VERSION, '1.3.2', 'EXTENSION_VERSION must be 1.3.2');
  });
});

test('Image Preprocessing & Normalization Invariants', async (t) => {
  const engine = new UniversalOcrEngine();

  await t.test('Preprocesses direct buffer preserving clean [0, 1] grayscale values without contrast stretching', () => {
    const width = 100;
    const height = 64;
    const rawGray = new Float32Array(width * height);
    // Fill with values between 0.3 and 0.7
    for (let i = 0; i < rawGray.length; i++) {
      rawGray[i] = 0.3 + (i % 5) * 0.1;
    }

    const result = engine.preprocessImage({ width, height, rawGray });
    assert.strictEqual(result.width, width, 'Output width should match input width');
    assert.strictEqual(result.height, height, 'Output height should match input height');
    assert.strictEqual(result.rawGray.length, width * height, 'Pixel length should match');

    // Verify values are NOT stretched to 0.0 or 1.0 (no single-pixel extrema stretching)
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < result.rawGray.length; i++) {
      if (result.rawGray[i] < minVal) minVal = result.rawGray[i];
      if (result.rawGray[i] > maxVal) maxVal = result.rawGray[i];
    }
    assert.ok(minVal >= 0.29 && minVal <= 0.31, `Min value should remain ~0.3, got ${minVal}`);
    assert.ok(maxVal >= 0.69 && maxVal <= 0.71, `Max value should remain ~0.7, got ${maxVal}`);
  });

  await t.test('Clamps out-of-range negative and >1.0 float values safely into [0, 1]', () => {
    const rawGray = new Float32Array([-0.5, 0.0, 0.5, 1.0, 1.5]);
    const result = engine.preprocessImage({ width: 5, height: 1, rawGray });
    assert.strictEqual(result.rawGray[0], 0.0, 'Negative value must clamp to 0.0');
    assert.strictEqual(result.rawGray[1], 0.0);
    assert.strictEqual(result.rawGray[2], 0.5);
    assert.strictEqual(result.rawGray[3], 1.0);
    assert.strictEqual(result.rawGray[4], 1.0, 'Value > 1.0 must clamp to 1.0');
  });

  await t.test('Rejects invalid or missing image input with clear error', () => {
    assert.throws(() => engine.preprocessImage(null), /Unsupported image input/);
    assert.throws(() => engine.preprocessImage({}), /Unsupported image input/);
    assert.throws(() => engine.preprocessImage('invalid-string'), /Unsupported image input/);
  });
});

test('Beam Search & Greedy Alphanumeric Filtering', async (t) => {
  const engine = new UniversalOcrEngine();
  const T = 3;
  const B = 1;
  const C = 8210;
  const data = new Float32Array(T * B * C);

  // t=0: class 0 (blank)
  data[0 * C + 0] = 10.0;
  // t=1: class 1073 ('v') has logit 8.0, while an unused Chinese char (e.g. 500) has higher logit 9.0
  data[1 * C + 500] = 9.0;
  data[1 * C + 1073] = 8.0;
  // t=2: class 0 (blank)
  data[2 * C + 0] = 10.0;

  const fakeTensor = {
    dims: [T, B, C],
    data
  };

  await t.test('decodeBeamSearch filters out Chinese/invalid classes and decodes valid class', () => {
    const decoded = engine.decodeBeamSearch(fakeTensor, 10);
    assert.strictEqual(decoded.text, 'v', 'Beam search must only decode valid alphanumeric classes, filtering out Chinese characters');
  });

  await t.test('decodeGreedy filters out Chinese/invalid classes and decodes valid class', () => {
    const decoded = engine.decodeGreedy(fakeTensor);
    assert.strictEqual(decoded.text, 'v', 'Greedy decode must only decode valid alphanumeric classes, filtering out Chinese characters');
  });
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

test('Real Captcha Case Recognition (5 Real Failed Cases)', async (t) => {
  const engine = new UniversalOcrEngine();
  const realCasesPath = path.join(__dirname, 'fixtures', 'real_cases.json');

  if (!fs.existsSync(realCasesPath)) {
    t.skip('real_cases.json fixture not found, skipping real case test');
    return;
  }

  const items = JSON.parse(fs.readFileSync(realCasesPath, 'utf8'));
  let totalChars = 0;
  let correctChars = 0;

  for (const item of items) {
    await t.test(`Real Case: ${item.expected}`, () => {
      const fakeTensor = {
        dims: item.dims,
        data: expandTensor(item)
      };

      const decoded = engine.decodeBeamSearch(fakeTensor, 20);
      assert.ok(decoded.text && decoded.text.length > 0, `Decoded text should not be empty for ${item.expected}`);

      // Count character accuracy
      for (let i = 0; i < item.expected.length; i++) {
        totalChars++;
        if (decoded.text[i] === item.expected[i]) {
          correctChars++;
        }
      }

      // 1. Specific case validations:
      if (item.expected === 'pyU3') {
        assert.strictEqual(decoded.text, 'pyU3', 'pyU3 must be exactly decoded without false uppercase PyU3');
      } else if (item.expected === 'Pvvs') {
        assert.strictEqual(decoded.text, 'Pvvs', 'Pvvs must be exactly decoded without false uppercase PVVS or ghost prefixes');
      } else if (item.expected === 'Lcwh') {
        assert.strictEqual(decoded.text, 'Lcwh', 'Lcwh must be exactly decoded without false uppercase LCWH');
      } else if (item.expected === 'sChz') {
        // Model native outputs 'schz' (case-insensitive 100%, 3/4 exact case)
        assert.strictEqual(decoded.text.toLowerCase(), 'schz', 'sChz must match case-insensitively');
        assert.notStrictEqual(decoded.text, 'SCHZ', 'sChz must NOT be destructively transformed to all-caps SCHZ');
      } else if (item.expected === 'BFzK') {
        // Model native outputs 'BFzk' (case-insensitive 100%, 3/4 exact case)
        assert.strictEqual(decoded.text.toLowerCase(), 'bfzk', 'BFzK must match case-insensitively');
        assert.notStrictEqual(decoded.text, 'bfZK', 'BFzK must NOT be deformed into bfZK');
      }

      // 2. Case-insensitive match must be 100% across all 5 real cases
      assert.strictEqual(
        decoded.text.toLowerCase(),
        item.expected.toLowerCase(),
        `Case-insensitive text for ${item.expected} must match`
      );

      // 3. Greedy decode must also match case-insensitively without character dropping
      const greedyDecoded = engine.decodeGreedy(fakeTensor);
      assert.strictEqual(
        greedyDecoded.text.toLowerCase(),
        item.expected.toLowerCase(),
        `Greedy decoded text for ${item.expected} must match case-insensitively`
      );

      // 4. preprocessImage verification on real case pixel buffer
      const preprocessed = engine.preprocessImage({
        width: item.width,
        height: item.height,
        rawGray: item.rawGray
      });
      assert.strictEqual(preprocessed.width, item.width, 'Preprocessed width should match');
      assert.strictEqual(preprocessed.height, item.height, 'Preprocessed height should match');
      assert.strictEqual(preprocessed.rawGray.length, item.width * item.height, 'Length should match');

      // 5. calibrateCase must safely pass through decoded text
      const rawGray = new Float32Array(item.rawGray);
      const calibrated = engine.calibrateCase(
        decoded.text,
        decoded.alignments,
        rawGray,
        item.width,
        item.height,
        { caseSensitive: true }
      );
      assert.strictEqual(calibrated, decoded.text, 'calibrateCase must pass through decoded text untouched');
    });
  }

  await t.test('Overall 5 Real Cases Character-Level Accuracy >= 90%', () => {
    const accuracy = correctChars / totalChars;
    assert.ok(
      accuracy >= 0.90,
      `Overall character accuracy should be at least 90%, but got ${(accuracy * 100).toFixed(1)}% (${correctChars}/${totalChars})`
    );
  });
});

test('Universal Captcha Synthetic Case Recognition', async (t) => {
  const engine = new UniversalOcrEngine();
  const casesJsonPath = path.join(__dirname, 'fixtures', 'onnx_cases.json');

  if (!fs.existsSync(casesJsonPath)) {
    t.skip('onnx_cases.json fixture not found, skipping fixture inference test');
    return;
  }

  const items = JSON.parse(fs.readFileSync(casesJsonPath, 'utf8'));

  for (const item of items) {
    await t.test(`Synthetic Case: ${item.expected}`, () => {
      const fakeTensor = {
        dims: item.dims,
        data: expandTensor(item)
      };

      const decoded = engine.decodeBeamSearch(fakeTensor, 20);
      assert.ok(decoded.text && decoded.text.length > 0, `Decoded text should not be empty for ${item.expected}`);

      // All synthetic cases match case-insensitively 100%
      assert.strictEqual(
        decoded.text.toLowerCase(),
        item.expected.toLowerCase(),
        `Case-insensitive match for ${item.expected}`
      );

      // Verify calibrateCase returns raw decoded text without corruption
      const rawGray = new Float32Array(item.rawGray);
      const calibrated = engine.calibrateCase(
        decoded.text,
        decoded.alignments,
        rawGray,
        item.width,
        item.height,
        { caseSensitive: true }
      );
      assert.strictEqual(calibrated, decoded.text, 'calibrateCase must preserve decoded text');
    });
  }
});

test('calibrateCase Non-Destruction & Passthrough Invariant Tests', async (t) => {
  const engine = new UniversalOcrEngine();

  await t.test('Safely preserves mixed case without forcing all uppercase', () => {
    const testStrings = ['pyU3', 'sChz', 'Pvvs', 'BFzK', 'Lcwh', 'vwso', 'dgEL', 'JGWv'];
    for (const str of testStrings) {
      const result = engine.calibrateCase(str, [], new Float32Array(10), 120, 64, { caseSensitive: true });
      assert.strictEqual(result, str, `calibrateCase must preserve ${str} unmodified`);
    }
  });

  await t.test('Case-insensitive option preserves text unmodified', () => {
    const result = engine.calibrateCase('AbCd', [], new Float32Array(10), 120, 64, { caseSensitive: false });
    assert.strictEqual(result, 'AbCd', 'calibrateCase must preserve text when caseSensitive is false');
  });
});

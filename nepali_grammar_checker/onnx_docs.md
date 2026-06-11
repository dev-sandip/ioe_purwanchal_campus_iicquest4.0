# ONNX Frontend Integration Documentation

This document explains how to load, run, and integrate the ONNX-serialized models directly inside the browser using `onnxruntime-web`.

---

## 1. Why is the Corrector Model Split?

A standard sequence-to-sequence model (like the `Seq2SeqCorrector`) generates output character-by-character:
1. The **Encoder** runs once on the entire input sequence to generate context representations.
2. The **Decoder** runs inside a loop, utilizing the encoder's output and the previously generated characters to predict the next character.

If we exported the entire model as a single ONNX file, ONNX would have to handle dynamic looping control flow, which is extremely difficult to optimize, compile, and run on different hardware (especially in browser environments). 

By splitting the model into **Encoder** (`corrector_encoder.onnx`) and **Decoder** (`corrector_decoder.onnx`) sub-models:
- The frontend loads both models.
- The frontend runs the encoder *once* per misspelled word.
- The frontend manages the generation loop (e.g. Beam Search or Greedy Search) in JavaScript, passing the decoder inputs step-by-step. This is highly performant and extremely robust.

---

## 2. Setting Up ONNX Runtime in Frontend

Install the required library in your frontend project:
```bash
npm install onnxruntime-web
```

---

## 3. Frontend Integration Example (JavaScript)

Here is a full example demonstrating how to run inference for both the Detector and Corrector models.

### Step 1: Tokenizer Mapping
Before running inference, convert input strings to character token indices (using the vocabulary from `tokenizers.zip`).

```javascript
// A simple character tokenizer implementation
class CharTokenizer {
  constructor(char2idx) {
    this.char2idx = char2idx;
    this.idx2char = Object.fromEntries(
      Object.entries(char2idx).map(([c, i]) => [i, c])
    );
  }

  encode(text, maxLen = 30, addSos = false, addEos = false) {
    let ids = [];
    if (addSos) ids.push(this.char2idx["<SOS>"]);
    for (let c of text) {
      ids.push(this.char2idx[c] ?? this.char2idx["<UNK>"]);
    }
    if (addEos) ids.push(this.char2idx["<EOS>"]);
    
    // Padding
    while (ids.length < maxLen) {
      ids.push(this.char2idx["<PAD>"]);
    }
    return ids.slice(0, maxLen);
  }
}
```

### Step 2: Running the Detector Model
The Detector classifies if a word is correct or wrong.

```javascript
import * as ort from 'onnxruntime-web';

async function checkWord(word, tokenizer) {
  const session = await ort.InferenceSession.create('/models/detector.onnx');
  
  const indices = tokenizer.encode(word, 30);
  const inputTensor = new ort.Tensor('int64', BigInt64Array.from(indices.map(BigInt)), [1, 30]);

  const feeds = { input: inputTensor };
  const results = await session.run(feeds);
  
  // Output P(word is correct)
  const probability = results.output.data[0];
  return {
    word,
    correct: probability > 0.5,
    confidence: probability
  };
}
```

### Step 3: Running the Corrector (Seq2Seq Generation)
Runs the encoder once, then loops the decoder step-by-step.

```javascript
async function correctWord(wrongWord, tokenizer) {
  const encSession = await ort.InferenceSession.create('/models/corrector_encoder.onnx');
  const decSession = await ort.InferenceSession.create('/models/corrector_decoder.onnx');

  const maxLen = 30;
  const embedDim = 128;
  const SOS_IDX = BigInt(tokenizer.char2idx["<SOS>"]);
  const EOS_IDX = BigInt(tokenizer.char2idx["<EOS>"]);

  // 1. Run Encoder
  const srcIndices = tokenizer.encode(wrongWord, maxLen);
  const srcTensor = new ort.Tensor('int64', BigInt64Array.from(srcIndices.map(BigInt)), [1, maxLen]);
  
  const encOutputs = await encSession.run({ x: srcTensor });
  const encOut = encOutputs.enc_out; // shape: [1, 30, 128]
  let h = encOutputs.h;             // shape: [1, 128]
  let c = encOutputs.c;             // shape: [1, 128]

  // 2. Generation Loop (Greedy Decoding Example)
  let currentToken = SOS_IDX;
  let decodedChars = [];

  for (let step = 1; step < maxLen; step++) {
    const tokenTensor = new ort.Tensor('int64', BigInt64Array.from([currentToken]), [1]);
    
    // Run Decoder Step
    const decOutputs = await decSession.run({
      token: tokenTensor,
      h: h,
      c: c,
      enc_out: encOut
    });

    const predLogits = decOutputs.pred.data; // Array of vocab size logits
    
    // Argmax selection
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < predLogits.length; i++) {
      if (predLogits[i] > maxVal) {
        maxVal = predLogits[i];
        maxIdx = i;
      }
    }

    if (BigInt(maxIdx) === EOS_IDX) {
      break;
    }

    const nextChar = tokenizer.idx2char[maxIdx];
    if (nextChar && nextChar !== "<PAD>" && nextChar !== "<SOS>") {
      decodedChars.push(nextChar);
    }

    currentToken = BigInt(maxIdx);
    h = decOutputs.new_h;
    c = decOutputs.new_c;
  }

  return decodedChars.join("");
}
```

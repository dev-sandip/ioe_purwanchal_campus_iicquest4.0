# Nepali Grammar Checker — Complete System Documentation

> Covers architecture, all files, all API routes, FL training, ONNX inference, and frontend integration.

> Current correction runtime: the active model is `models/nepali_correction_best.pth` from `models/nepali_correction_from_csv.ipynb`. The previous `models/seq2seq_best.pth` corrector is retained only as a legacy artifact and is not the default API/FL model.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [File Structure](#2-file-structure)
3. [Models](#3-models)
4. [Federated Learning](#4-federated-learning)
5. [API Routes — Hosted Backend (port 8000)](#5-api-routes--hosted-backend-port-8000)
6. [API Routes — FL Bridge (port 8082)](#6-api-routes--fl-bridge-port-8082)
7. [ONNX Export & Frontend Inference](#7-onnx-export--frontend-inference)
8. [Frontend Client (fl_client.js)](#8-frontend-client-fl_clientjs)
9. [How to Run](#9-how-to-run)
10. [Data Format](#10-data-format)

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER / FRONTEND                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Grammar Checker UI  +  onnxruntime-web  +  fl_client.js │  │
│  └────────┬──────────────────────────┬───────────────────────┘  │
│           │                          │                           │
│    Standard inference          Local FL + ONNX                  │
│    POST /detect                GET  /model/detector/onnx        │
│    POST /correct               GET  /weights/best               │
│    POST /check                 GET  /status                     │
└───────────┼──────────────────────────┼───────────────────────────┘
            │                          │
            ▼                          ▼
┌───────────────────┐       ┌─────────────────────────────────────┐
│  Hosted FastAPI   │       │  Local Machine                      │
│  (HuggingFace)   │       │                                     │
│  port 8000/7860   │       │  FL Bridge API    port 8082         │
│                   │       │  Flower Server    port 8080/8081    │
│  /health          │       │  FL Clients       (Python)          │
│  /detect          │       └──────────────────┬──────────────────┘
│  /correct         │                          │
│  /check           │              FedAvg aggregation
└───────────────────┘              saves best .pth
                                   exports .onnx
```

**Two separate servers:**

| Server | Where | Port | Purpose |
|--------|-------|------|---------|
| Hosted FastAPI | HuggingFace / cloud | 8000 | Production inference |
| FL Bridge API | Local machine | 8082 | ONNX download, FL coordination |
| Flower FL Server | Local machine | 8080/8081 | gRPC FL training |

---

## 2. File Structure

```
ioe_purwanchal/
│
├── core/
│   ├── models.py               Detector + Corrector model definitions
│   └── tokenizer.py            CharTokenizer (Devanagari + Latin)
│
├── new_fl/  (or fl/)
│   ├── __init__.py
│   ├── main.py                 ← Entry point: starts FL server + Bridge API
│   ├── server.py               ← Flower gRPC server + FedAvg + ONNX export
│   ├── routes.py               ← Bridge API (FastAPI, port 8082)
│   ├── client.py               ← Flower training client (run per machine)
│   ├── data_utils.py           ← Load CSV, build datasets, IID split
│   └── simulate.py             ← Local simulation (no separate clients needed)
│
├── api/
│   └── main.py                 Hosted FastAPI app (inference endpoints)
│
├── data/
│   ├── right_wrong.csv         Training pairs: correct,wrong Nepali words
│   ├── detect_char_tokenizer.json
│   └── seq2seq_char_tokenizer.json
│
├── models/
│   ├── detector_best.pth       Best detector weights (PyTorch)
│   ├── nepali_correction_best.pth
│   │                           Notebook corrector weights (PyTorch)
│   ├── nepali_correction_tokenizer.json
│   ├── weights/
│   │   ├── round_0001.npy      Aggregated weights per FL round
│   │   ├── round_0002.npy
│   │   └── best.npy            Copy of best round weights
│   └── onnx/
│       ├── detector.onnx       Exported for frontend inference
│       └── corrector.onnx      Exported for frontend inference
│
├── logs/
│   └── fl_metrics.jsonl        One JSON line per completed FL round
│
├── main.py                     Top-level runner (api / fl / both modes)
└── fl_client.js                Frontend ONNX.js client
```

---

## 3. Models

### CharTransformerDetector (`core/models.py`)

Binary classifier — detects if a Nepali word is wrong.

```
Input:  (batch, seq_len=30)   char indices int64
Output: (batch,)              P(word is correct) float32  [0–1]
```

Architecture:
- Char embedding + positional embedding
- Transformer encoder (3 layers, 4 heads, ff_dim=256)
- Masked mean pooling
- Linear(64) → ReLU → Linear(1) → Sigmoid

Hyperparameters used in FL:
```python
vocab_size = tokenizer.vocab_size
embed_dim  = 64
num_heads  = 4
num_layers = 3
ff_dim     = 256
max_len    = 30
dropout    = 0.3  # training  /  0.0  inference + ONNX export
```

---

### Seq2SeqCorrector (`core/models.py`)

Corrects a misspelled Nepali word.

```
Input:  src (batch, 30)       wrong word char indices
        tgt (batch, 32)       target sequence with SOS prepended
Output: (batch, 32, vocab_size) logits
```

Architecture:
- **TransformerEncoder**: char embedding + positional + 3-layer transformer
- **BahdanauAttention**: attention between encoder output and decoder hidden state
- **LSTMDecoder**: single-step LSTM with attention context

Hyperparameters:
```python
vocab_size = tokenizer.vocab_size
embed_dim  = 128
hidden_dim = 128
enc_layers = 3
dropout    = 0.1  # training  /  0.0  ONNX export
```

---

## 4. Federated Learning

### How It Works

```
Round N:

1. Server sends current aggregated weights to all clients
          ↓
2. Each client (fl/client.py):
   - loads weights into local model
   - trains on its partition of data/right_wrong.csv
   - sends updated weights back
          ↓
3. Server (fl/server.py NepaliGrammarFedAvg):
   - aggregates using FedAvg
   - saves weights/round_XXXX.npy
   - if new best loss → overwrites detector_best.pth
   - if new best loss → exports models/onnx/detector.onnx
          ↓
4. Repeat for num_rounds
```

### Key Files

**`fl/server.py`**
- `NepaliGrammarFedAvg` — custom Flower strategy
  - `aggregate_fit()` — saves round weights to `.npy`
  - `aggregate_evaluate()` — tracks best loss, calls `_save_best()`
  - `_save_best()` — writes `.pth` + exports `.onnx`
- `run_detector_server(host, port, num_rounds, min_clients)`
- `run_corrector_server(host, port, num_rounds, min_clients)`

**`fl/client.py`**
- `DetectorClient` — `fit()` with BCELoss, `evaluate()` returns accuracy
- `CorrectorClient` — `fit()` with CrossEntropyLoss + teacher forcing, `evaluate()` returns word_accuracy
- Connects to Flower gRPC server at `host:port`

**`fl/data_utils.py`**
- `load_pairs(csv_path)` — loads `right_wrong.csv`
- `build_detection_dataset(df, tokenizer)` — builds `TensorDataset` for detector
- `build_correction_dataset(df, tokenizer)` — builds `TensorDataset` for corrector
- `split_iid(dataset, n_clients)` — splits dataset equally across clients

**`fl/routes.py`** (Bridge API)
- FastAPI app running on port 8082
- Serves `.onnx` files and weights to frontend

**`fl/main.py`**
- Starts Bridge API (port 8082) in background thread
- Starts Flower gRPC server(s) in foreground

### FL Round Metrics (`logs/fl_metrics.jsonl`)

One JSON line appended after each round:
```json
{
  "round": 3,
  "timestamp": "2024-01-15T10:30:00",
  "agg_loss": 0.312,
  "agg_accuracy": 0.89,
  "num_clients": 2,
  "is_best": true
}
```

---

## 5. API Routes — Hosted Backend (port 8000)

Base URL: `http://your-server:8000` or `https://your-hf-space.hf.space`

---

### GET `/health`

Check if models are loaded.

**Response:**
```json
{
  "status": "healthy",
  "device": "cpu",
  "detector_loaded": true,
  "corrector_loaded": true
}
```

---

### POST `/detect`

Detect if a single Nepali word is wrong.

**Request:**
```json
{ "word": "कलमम" }
```

**Response:**
```json
{
  "word": "कलमम",
  "correct": false,
  "confidence": 0.1284
}
```

`confidence` = P(word is correct). Below 0.5 = wrong word.

---

### POST `/correct`

Get correction suggestions for a wrong word.

**Request:**
```json
{ "word": "कलमम" }
```

**Response:**
```json
{
  "word": "कलमम",
  "suggestions": [
    { "word": "कलम",  "score": 0.9421 },
    { "word": "कमल",  "score": 0.8124 }
  ]
}
```

---

### POST `/check`

Check and correct an entire Nepali sentence.

**Request:**
```json
{
  "sentence": "नेपालल राजधानी काठमाडौँ हो",
  "threshold": 0.5,
  "beam_width": 5
}
```

**Response:**
```json
{
  "input":  "नेपालल राजधानी काठमाडौँ हो",
  "output": "नेपाल राजधानी काठमाडौँ हो",
  "status": "corrected",
  "details": [
    {
      "word": "नेपालल",
      "status": "wrong",
      "confidence": 0.08,
      "suggestions": [{ "word": "नेपाल", "score": 0.94 }],
      "corrected": "नेपाल"
    },
    {
      "word": "राजधानी",
      "status": "correct",
      "confidence": 0.99,
      "suggestions": [],
      "corrected": "राजधानी"
    }
  ]
}
```

---

## 6. API Routes — FL Bridge (port 8082)

Base URL: `http://localhost:8082`

Started automatically by `python fl/main.py`.

---

### GET `/health`

Check which model files exist locally.

**Response:**
```json
{
  "status": "ok",
  "detector_pth":   true,
  "corrector_pth":  true,
  "detector_onnx":  true,
  "corrector_onnx": false,
  "best_weights":   true
}
```

---

### GET `/model/{model_type}/onnx`

Download ONNX model for in-browser inference.

`model_type`: `detector` or `corrector`

**Response:** Binary `.onnx` file stream

**Frontend usage:**
```javascript
const buf  = await fetch("http://localhost:8082/model/detector/onnx")
                   .then(r => r.arrayBuffer())
const sess = await ort.InferenceSession.create(buf)
```

**Error responses:**
- `400` — invalid model_type
- `404` — ONNX file not found (run FL training first)

---

### GET `/weights/best`

Download best aggregated weights as `.npy`.

**Response:** Binary `.npy` file

**Frontend usage:** Load these weights before local training round.

---

### GET `/weights/round/{round_num}`

Download weights from a specific FL round.

**Response:** Binary `.npy` file

---

### GET `/metrics`

Get metrics from all completed FL rounds.

**Response:**
```json
[
  {
    "round": 1,
    "timestamp": "2024-01-15T10:30:00",
    "agg_loss": 0.51,
    "agg_accuracy": 0.81,
    "num_clients": 2,
    "is_best": false
  },
  {
    "round": 2,
    "timestamp": "2024-01-15T10:31:00",
    "agg_loss": 0.31,
    "agg_accuracy": 0.89,
    "num_clients": 2,
    "is_best": true
  }
]
```

---

### GET `/status`

Overall FL status — rounds completed, latest round, ONNX readiness.

**Response:**
```json
{
  "detector_onnx_ready":  true,
  "corrector_onnx_ready": true,
  "best_weights_ready":   true,
  "rounds_completed":     5,
  "latest_round":         5
}
```

---

## 7. ONNX Export & Frontend Inference

### Why ONNX?

PyTorch models can't run in a browser directly. ONNX Runtime Web (`onnxruntime-web`) runs `.onnx` files in the browser using WebAssembly or WebGL.

### Export happens automatically

`fl/server.py` exports ONNX every time a new best model is saved:
```
New best round → overwrites detector_best.pth → exports models/onnx/detector.onnx
```

### ONNX Input/Output Shapes

**Detector (`detector.onnx`)**

| Name | Type | Shape | Description |
|------|------|-------|-------------|
| `char_ids` | int64 | `[batch, 30]` | Encoded char indices |
| `prob` | float32 | `[batch]` | P(word is correct) |

**Corrector (`corrector.onnx`)**

| Name | Type | Shape | Description |
|------|------|-------|-------------|
| `src` | int64 | `[batch, 30]` | Wrong word char indices |
| `tgt` | int64 | `[batch, 32]` | Target with SOS prepended |
| `logits` | float32 | `[batch, 32, vocab_size]` | Output logits |

### Tokenizer

Characters are encoded using `CharTokenizer` (loaded from `detect_char_tokenizer.json`).

Special tokens:
```
<PAD> = 0
<SOS> = 1
<EOS> = 2
<UNK> = 3
```

Encoding example:
```javascript
// "नेपाल" → [idx1, idx2, idx3, idx4, idx5, 0, 0, ..., 0]  (padded to 30)
function encode(text, char2idx, maxLen = 30) {
  const PAD = char2idx["<PAD>"] ?? 0
  const UNK = char2idx["<UNK>"] ?? 3
  const ids = Array.from(text).map(c => char2idx[c] ?? UNK)
  while (ids.length < maxLen) ids.push(PAD)
  return ids.slice(0, maxLen)
}
```

### Running Detector in Browser

```javascript
import * as ort from 'onnxruntime-web'

// Load once
const sess = await ort.InferenceSession.create('/models/detector.onnx')

// Inference
const ids   = encode("नेपालल", char2idx, 30)
const input = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, 30])
const out   = await sess.run({ char_ids: input })
const prob  = out["prob"].data[0]        // P(correct)
const isError = prob < 0.5
```

### Running Corrector in Browser

```javascript
const sess = await ort.InferenceSession.create('/models/corrector.onnx')

const src  = encode("नेपालल", char2idx, 30)
const tgt  = new Array(32).fill(0)
tgt[0]     = char2idx["<SOS>"]          // prepend SOS

const srcT = new ort.Tensor("int64", BigInt64Array.from(src.map(BigInt)), [1, 30])
const tgtT = new ort.Tensor("int64", BigInt64Array.from(tgt.map(BigInt)), [1, 32])

const out    = await sess.run({ src: srcT, tgt: tgtT })
const logits = out["logits"].data        // float32 [1 * 32 * vocab_size]
const vocabSz = logits.length / 32

// Greedy decode
const chars = []
for (let t = 1; t < 32; t++) {
  const slice  = logits.slice(t * vocabSz, (t + 1) * vocabSz)
  const argmax = [...slice].indexOf(Math.max(...slice))
  if (argmax === EOS_IDX || argmax === PAD_IDX) break
  chars.push(idx2char[argmax])
}
const corrected = chars.join("")         // "नेपाल"
```

---

## 8. Frontend Client (`fl_client.js`)

Drop-in class for any JS framework (React, Vue, plain HTML).

### Setup

```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
<script type="module">
  import { NepaliFL } from './fl_client.js'
  const fl = new NepaliFL("http://localhost:8082")
  await fl.loadModel("both")
</script>
```

### API

```javascript
const fl = new NepaliFL("http://localhost:8082")

// Load ONNX models from bridge server
await fl.loadModel("both")            // "detector", "corrector", or "both"

// Detect single word
const { isError, confidence } = await fl.detect("नेपालल")
// → { isError: true, confidence: 0.08 }

// Correct single word
const fixed = await fl.correct("नेपालल")
// → "नेपाल"

// Check full sentence
const result = await fl.checkSentence("नेपालल राजधानी काठमाडौँ हो")
// → {
//     input:   "नेपालल राजधानी काठमाडौँ हो",
//     output:  "नेपाल राजधानी काठमाडौँ हो",
//     details: [
//       { word: "नेपालल", isError: true,  confidence: 0.08, corrected: "नेपाल" },
//       { word: "राजधानी", isError: false, confidence: 0.99, corrected: "राजधानी" },
//       ...
//     ]
//   }

// Reload model after new FL round completes
await fl.reloadModel("detector")

// FL monitoring
const status  = await fl.flStatus()   // rounds_completed, onnx_ready etc.
const metrics = await fl.flMetrics()  // [{round, agg_loss, agg_accuracy}, ...]
const health  = await fl.health()     // which files exist
```

### React Example

```jsx
import { useState, useEffect } from 'react'
import { NepaliFL } from './fl_client.js'

const fl = new NepaliFL("http://localhost:8082")

export default function GrammarChecker() {
  const [ready, setReady]   = useState(false)
  const [input, setInput]   = useState("")
  const [result, setResult] = useState(null)

  useEffect(() => {
    fl.loadModel("both").then(() => setReady(true))
  }, [])

  async function check() {
    const res = await fl.checkSentence(input)
    setResult(res)
  }

  return (
    <div>
      <textarea value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={check} disabled={!ready}>Check</button>
      {result && (
        <div>
          <p>Output: {result.output}</p>
          {result.details.map(d => (
            <span key={d.word}
              style={{ color: d.isError ? "red" : "green" }}>
              {d.word} → {d.corrected}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

## 9. How to Run

### Local FL Training

```bash
# from project root

# Terminal 1 — FL server + Bridge API (port 8080 + 8082)
python new_fl/main.py --model detector --rounds 10 --clients 2

# Terminal 2 — FL client 0
python new_fl/client.py --model detector --client-id 0 --total-clients 2

# Terminal 3 — FL client 1
python new_fl/client.py --model detector --client-id 1 --total-clients 2
```

**Options for `fl/main.py`:**

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | `both` | `detector`, `corrector`, or `both` |
| `--rounds` | `10` | Number of FL rounds |
| `--clients` | `2` | Min clients required per round |
| `--port-detector` | `8080` | Flower gRPC port for detector |
| `--port-corrector` | `8081` | Flower gRPC port for corrector |
| `--port-bridge` | `8082` | Bridge API port (frontend) |

**Options for `fl/client.py`:**

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | `detector` | `detector` or `corrector` |
| `--client-id` | `0` | Client index (0, 1, 2...) |
| `--total-clients` | `2` | Total number of clients |
| `--host` | `127.0.0.1` | FL server host |
| `--port` | auto | 8080 for detector, 8081 for corrector |
| `--data-path` | `data/right_wrong.csv` | Training data path |

### Local Simulation (No separate clients)

```bash
python new_fl/simulate.py --model detector --rounds 5 --clients 3
```

### Hosted API Only

```bash
python main.py --mode api --port 8000
```

### Both (API + FL)

```bash
python main.py --mode both
```

---

## 10. Data Format

### `data/right_wrong.csv`

Two columns, no header required (code sets them to `correct, wrong`):

```
correct,wrong
नेपाल,नेपालल
काठमाडौँ,काठमाडौँल
कलम,कलमम
घर,घरर
```

### Tokenizer JSON (`detect_char_tokenizer.json`)

```json
{
  "char2idx": {
    "<PAD>": 0,
    "<SOS>": 1,
    "<EOS>": 2,
    "<UNK>": 3,
    "क": 4,
    "ख": 5,
    "...": "..."
  },
  "vocab_size": 128
}
```

---

## Quick Reference

### Ports

| Port | Service | Who uses it |
|------|---------|-------------|
| 8000 | Hosted FastAPI (inference) | Frontend production |
| 8080 | Flower gRPC — Detector | `fl/client.py` only |
| 8081 | Flower gRPC — Corrector | `fl/client.py` only |
| 8082 | FL Bridge API | Frontend (ONNX download) |

### Files Generated During FL

| File | When | Used by |
|------|------|---------|
| `models/weights/round_XXXX.npy` | After every round | Server |
| `models/weights/best.npy` | When new best round | Frontend download |
| `models/detector_best.pth` | When new best round | API server + ONNX export |
| `models/onnx/detector.onnx` | When new best round | Frontend inference |
| `logs/fl_metrics.jsonl` | After every round | Bridge API `/metrics` |

### Inference Flow

```
User types sentence
       ↓
fl.checkSentence("नेपालल राजधानी")
       ↓
for each word:
  fl.detect(word)  →  runs detector.onnx  →  isError?
  if isError:
    fl.correct(word)  →  runs corrector.onnx  →  fixed word
       ↓
return { input, output, details }
```

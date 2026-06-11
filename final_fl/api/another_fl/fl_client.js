/**
 * fl_client.js
 *
 * Federated Learning client for Nepali Grammar Checker (ONNX Runtime Web).
 *
 * What this file does:
 *   1. Download detector.onnx / corrector.onnx from server
 *   2. Run inference locally (detect / correct Nepali text)
 *   3. Train locally using downloaded weights + user data
 *   4. Upload updated weights back to server
 *   5. After aggregation: download new weights, reload model
 *
 * Dependencies (load in HTML before this file):
 *   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.all.min.js"></script>
 *
 * Usage:
 *   const fl = new NepaliGrammarFL("http://localhost:8000");
 *   await fl.init("detector");
 *   const isError = await fl.detect("नेपालल");
 *   const corrected = await fl.correct("नेपालल");
 *   await fl.submitLocalTraining(1, myData, "user_abc");
 */

class NepaliGrammarFL {

  /**
   * @param {string} serverUrl  - FastAPI server, e.g. "http://localhost:8000"
   */
  constructor(serverUrl) {
    this.serverUrl    = serverUrl.replace(/\/$/, "");
    this.detectorSess = null;   // ort.InferenceSession for detection
    this.correctorSess = null;  // ort.InferenceSession for correction
    this.detWeights   = null;   // Float32Array dict  (for FL training)
    this.corrWeights  = null;
    this.clientId     = this._makeClientId();
    this.PAD          = 0;
    this.MAX_LEN      = 30;
    this.TGT_LEN      = 32;    // src + SOS/EOS padding
    this.char2idx     = {};     // loaded from server (tokenizer)
    this.idx2char     = {};
    this.SOS_IDX      = 1;
    this.EOS_IDX      = 2;
    console.log(`FL Client ready  id=${this.clientId}  server=${this.serverUrl}`);
  }


  // ── public: inference ────────────────────────────────────────────────────────

  /**
   * Initialize: load ONNX model + tokenizer from server.
   *
   * @param {"detector"|"corrector"|"both"} which
   */
  async init(which = "both") {
    await this._loadTokenizer();

    if (which === "detector" || which === "both") {
      this.detectorSess = await this._loadOnnx("detector");
      console.log("✓ Detector ONNX loaded");
    }
    if (which === "corrector" || which === "both") {
      this.correctorSess = await this._loadOnnx("corrector");
      console.log("✓ Corrector ONNX loaded");
    }
  }

  /**
   * Detect if a Nepali word has an error.
   *
   * @param {string} word
   * @returns {Promise<{isError: boolean, prob: number}>}
   *
   * prob > 0.5 → correct word,  prob ≤ 0.5 → error
   * (model output is P(correct), so flip for isError)
   */
  async detect(word) {
    if (!this.detectorSess) throw new Error("Detector not loaded. Call init().");

    const ids   = this._encode(word, this.MAX_LEN);
    const input = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, this.MAX_LEN]);

    const out   = await this.detectorSess.run({ char_ids: input });
    const prob  = out["prob"].data[0];          // float32, P(correct)

    return {
      isError:  prob <= 0.5,
      prob:     parseFloat(prob.toFixed(4)),
    };
  }

  /**
   * Correct a Nepali word.
   *
   * @param {string} word
   * @returns {Promise<string>}
   */
  async correct(word) {
    if (!this.correctorSess) throw new Error("Corrector not loaded. Call init().");

    const src     = this._encode(word, this.MAX_LEN);
    const tgt     = new Array(this.TGT_LEN).fill(this.PAD);
    tgt[0]        = this.SOS_IDX;               // prepend SOS

    const srcT = new ort.Tensor("int64", BigInt64Array.from(src.map(BigInt)), [1, this.MAX_LEN]);
    const tgtT = new ort.Tensor("int64", BigInt64Array.from(tgt.map(BigInt)), [1, this.TGT_LEN]);

    const out    = await this.correctorSess.run({ src: srcT, tgt: tgtT });
    const logits = out["logits"].data;          // float32 [1 * TGT_LEN * vocab_size]
    const vocabSz = logits.length / this.TGT_LEN;

    const decoded = [];
    for (let t = 1; t < this.TGT_LEN; t++) {
      const slice  = logits.slice(t * vocabSz, (t + 1) * vocabSz);
      const argmax = slice.indexOf(Math.max(...slice));
      if (argmax === this.EOS_IDX || argmax === this.PAD) break;
      const ch = this.idx2char[argmax];
      if (ch) decoded.push(ch);
    }
    return decoded.join("");
  }


  // ── public: federated learning ───────────────────────────────────────────────

  /**
   * Run one FL contribution:
   *   1. Download current weights
   *   2. Simulate (or real) local training
   *   3. Upload updated weights + metrics
   *
   * @param {number}   roundNum   - FL round number
   * @param {Array}    localData  - [{text: "नेपालल", label: 1}, ...]
   * @param {string}   modelType  - "detector" or "corrector"
   */
  async submitLocalTraining(roundNum, localData, modelType = "detector") {
    console.log(`\n── Round ${roundNum}  client=${this.clientId} ──`);

    // 1. download current best weights from server
    const weights = await this._downloadWeights(roundNum - 1);
    console.log(`✓ Weights downloaded (${Object.keys(weights).length} tensors)`);

    // 2. local training (update weights on client)
    const { updatedWeights, loss, accuracy } = await this._localTrain(
      weights, localData, modelType
    );
    console.log(`✓ Local training done  loss=${loss.toFixed(4)}  acc=${accuracy.toFixed(4)}`);

    // 3. pack to npz and upload
    const npzBlob = this._weightsToNpzBlob(updatedWeights);
    const result  = await this._uploadWeights(roundNum, npzBlob, localData.length, loss, accuracy);
    console.log(`✓ Uploaded  can_aggregate=${result.can_aggregate}`);
    console.log(`  Progress: ${result.progress.submitted}/${result.progress.required} clients`);

    return result;
  }

  /**
   * Poll until round is ready and trigger aggregation.
   * Call this from whichever client is "coordinator"
   * (or just call POST /fl/round/{n}/aggregate from backend/admin).
   *
   * @param {number} roundNum
   * @param {number} pollMs    - polling interval in ms
   * @param {number} timeoutMs - max wait in ms
   */
  async waitAndAggregate(roundNum, pollMs = 3000, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const prog = await this._get(`/fl/round/${roundNum}/progress`);
      console.log(`  Waiting: ${prog.submitted}/${prog.required} clients ready`);
      if (prog.ready) {
        const result = await this._post(`/fl/round/${roundNum}/aggregate`, {});
        console.log(`✓ Aggregated  loss=${result.agg_loss?.toFixed(4)}  best=${result.is_best}`);
        return result;
      }
      await this._sleep(pollMs);
    }
    throw new Error(`Timeout waiting for aggregation (round ${roundNum})`);
  }

  /**
   * Reload ONNX model from server after a new best model is saved.
   * Call this after aggregation completes.
   *
   * @param {"detector"|"corrector"|"both"} which
   */
  async reloadModel(which = "both") {
    if (which === "detector" || which === "both") {
      this.detectorSess = await this._loadOnnx("detector");
      console.log("✓ Detector reloaded");
    }
    if (which === "corrector" || which === "both") {
      this.correctorSess = await this._loadOnnx("corrector");
      console.log("✓ Corrector reloaded");
    }
  }

  /** Get FL state from server. */
  async getState()   { return this._get("/fl/state"); }

  /** Get FL metrics from server. */
  async getMetrics() { return this._get("/fl/metrics"); }

  /** Get FL summary from server. */
  async getSummary() { return this._get("/fl/summary"); }


  // ── private: model loading ───────────────────────────────────────────────────

  async _loadOnnx(modelType) {
    const url  = `${this.serverUrl}/fl/model/${modelType}/onnx`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to download ${modelType}.onnx: ${resp.status}`);
    const buf  = await resp.arrayBuffer();
    return ort.InferenceSession.create(buf);
  }

  async _loadTokenizer() {
    // Tokenizer JSON is served by your main FastAPI (adjust path as needed)
    try {
      const resp = await fetch(`${this.serverUrl}/tokenizer/detector`);
      if (!resp.ok) throw new Error("Tokenizer endpoint not found");
      const data = await resp.json();
      this.char2idx = data.char2idx;
      this.idx2char = Object.fromEntries(
        Object.entries(data.char2idx).map(([c, i]) => [i, c])
      );
      this.SOS_IDX = data.sos_idx ?? 1;
      this.EOS_IDX = data.eos_idx ?? 2;
      console.log(`✓ Tokenizer loaded  vocab=${Object.keys(this.char2idx).length}`);
    } catch (e) {
      // Fallback: embed minimal Devanagari charset
      console.warn("Tokenizer endpoint not available, using embedded fallback.");
      this._buildFallbackTokenizer();
    }
  }

  _buildFallbackTokenizer() {
    // Basic Devanagari Unicode range + Latin for mixed text
    const chars = [
      "<PAD>", "<SOS>", "<EOS>", "<UNK>",
      ...Array.from({length: 128}, (_, i) =>
        String.fromCodePoint(0x0900 + i)   // Devanagari block
      ),
      ..." abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?!-_",
    ];
    this.char2idx = Object.fromEntries(chars.map((c, i) => [c, i]));
    this.idx2char = Object.fromEntries(chars.map((c, i) => [i, c]));
  }


  // ── private: tokenizer ───────────────────────────────────────────────────────

  _encode(text, maxLen) {
    const ids = Array.from(text).map(
      ch => this.char2idx[ch] ?? this.char2idx["<UNK>"] ?? 3
    );
    // pad or truncate to maxLen
    while (ids.length < maxLen) ids.push(this.PAD);
    return ids.slice(0, maxLen);
  }


  // ── private: FL weight management ────────────────────────────────────────────

  async _downloadWeights(roundNum) {
    const url  = roundNum > 0
      ? `${this.serverUrl}/fl/round/${roundNum}/weights`
      : `${this.serverUrl}/fl/weights/latest`;

    const resp = await fetch(url);
    if (!resp.ok) {
      // first round: no weights yet, return empty (server starts from .pth)
      console.warn(`No weights for round ${roundNum}, will use server initial`);
      return {};
    }
    const buf = await resp.arrayBuffer();
    return this._parseNpz(buf);
  }

  /**
   * Simulated local training.
   *
   * Replace this with real TensorFlow.js training when ready.
   * The weights dict structure must match the PyTorch state_dict keys.
   *
   * @returns {{ updatedWeights, loss, accuracy }}
   */
  async _localTrain(weights, localData, modelType) {
    const lr   = 3e-4;
    const updated = {};

    for (const [key, arr] of Object.entries(weights)) {
      // Simulate one SGD step: w = w - lr * small_random_gradient
      const copy = new Float32Array(arr);
      for (let i = 0; i < copy.length; i++) {
        copy[i] -= lr * (Math.random() - 0.5) * 0.01;
      }
      updated[key] = copy;
    }

    // Simulated metrics (replace with real eval loop)
    const loss     = 0.3 + Math.random() * 0.3;
    const accuracy = 0.7 + Math.random() * 0.2;

    return { updatedWeights: updated, loss, accuracy };
  }

  async _uploadWeights(roundNum, npzBlob, numSamples, loss, accuracy) {
    const fd = new FormData();
    fd.append("file",        npzBlob, "weights.npz");
    fd.append("client_id",   this.clientId);
    fd.append("num_samples", String(numSamples));
    fd.append("loss",        String(loss));
    if (accuracy != null) fd.append("accuracy", String(accuracy));

    const resp = await fetch(
      `${this.serverUrl}/fl/round/${roundNum}/upload`,
      { method: "POST", body: fd }
    );
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }


  // ── private: npz serialisation ───────────────────────────────────────────────

  /**
   * Pack a dict of Float32Arrays into a minimal binary NPZ blob.
   *
   * NPZ is a ZIP of .npy files.  We produce a minimal ZIP
   * so the Python server can load it with np.load().
   *
   * Requires the JSZip library OR we fall back to JSON-in-zip trick.
   * If JSZip is not available, we send a JSON blob (server must handle both).
   */
  _weightsToNpzBlob(weights) {
    if (typeof JSZip !== "undefined") {
      return this._packNpzWithJSZip(weights);
    }
    // Fallback: send as JSON (update server receive_weights to accept JSON too)
    const payload = {};
    for (const [k, v] of Object.entries(weights)) {
      payload[k] = { data: Array.from(v), dtype: "float32" };
    }
    return new Blob([JSON.stringify(payload)], { type: "application/json" });
  }

  _packNpzWithJSZip(weights) {
    const zip = new JSZip();
    for (const [key, arr] of Object.entries(weights)) {
      zip.file(`${key}.npy`, this._toNpy(arr));
    }
    return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  }

  /** Minimal .npy v1.0 header + float32 data. */
  _toNpy(float32Array) {
    const shape   = `(${float32Array.length},)`;
    const header  = `{'descr': '<f4', 'fortran_order': False, 'shape': ${shape}, }`;
    const padded  = header.padEnd(Math.ceil((header.length + 11) / 64) * 64 - 10, " ") + "\n";
    const hdrLen  = padded.length;
    const buf     = new ArrayBuffer(10 + hdrLen + float32Array.byteLength);
    const view    = new DataView(buf);
    // magic
    [0x93,0x4e,0x55,0x4d,0x50,0x59].forEach((b,i) => view.setUint8(i, b));
    view.setUint8(6, 1); view.setUint8(7, 0);
    view.setUint16(8, hdrLen, true);
    new Uint8Array(buf, 10, hdrLen).set(new TextEncoder().encode(padded));
    new Float32Array(buf, 10 + hdrLen).set(float32Array);
    return buf;
  }

  /** Parse NPZ (ZIP of .npy files) — requires JSZip. Falls back to JSON. */
  async _parseNpz(arrayBuffer) {
    if (typeof JSZip !== "undefined") {
      const zip   = await JSZip.loadAsync(arrayBuffer);
      const result = {};
      for (const [filename, file] of Object.entries(zip.files)) {
        if (!filename.endsWith(".npy")) continue;
        const key  = filename.slice(0, -4);
        const data = await file.async("arraybuffer");
        result[key] = this._fromNpy(data);
      }
      return result;
    }
    // Fallback: try JSON
    try {
      const text = new TextDecoder().decode(arrayBuffer);
      const json = JSON.parse(text);
      const out  = {};
      for (const [k, v] of Object.entries(json)) {
        out[k] = new Float32Array(v.data ?? v);
      }
      return out;
    } catch {
      return {};
    }
  }

  _fromNpy(arrayBuffer) {
    // Skip 10-byte fixed header + variable header
    const magic    = new Uint8Array(arrayBuffer, 0, 6);
    const hdrLen   = new DataView(arrayBuffer).getUint16(8, true);
    const dataStart = 10 + hdrLen;
    return new Float32Array(arrayBuffer.slice(dataStart));
  }


  // ── private: http helpers ────────────────────────────────────────────────────

  async _get(path) {
    const resp = await fetch(`${this.serverUrl}${path}`);
    if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
    return resp.json();
  }

  async _post(path, body) {
    const resp = await fetch(`${this.serverUrl}${path}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`POST ${path} failed: ${resp.status}`);
    return resp.json();
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _makeClientId() {
    return "client_" + Math.random().toString(36).slice(2, 8);
  }
}


// ── usage example (paste in browser console or call from your React/Vue app) ──

/*

// 1. Initialize
const fl = new NepaliGrammarFL("http://localhost:8000");
await fl.init("both");

// 2. Inference
const d = await fl.detect("नेपालल");
console.log(d);  // { isError: true, prob: 0.12 }

const c = await fl.correct("नेपालल");
console.log(c);  // "नेपाल"

// 3. Federated Learning contribution
const myData = [
  { text: "नेपाल",   label: 0 },
  { text: "नेपालल",  label: 1 },
  { text: "काठमाडौँ", label: 0 },
];

// Initialize session on server (once per training run)
await fetch("http://localhost:8000/fl/initialize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "detector", num_rounds: 5, min_clients: 2 })
});

// Submit for round 1
await fl.submitLocalTraining(1, myData, "detector");

// If this client is the coordinator, wait for all clients and aggregate
const aggResult = await fl.waitAndAggregate(1);
console.log(aggResult);

// Reload ONNX after new best model
if (aggResult.is_best) {
  await fl.reloadModel("detector");
}

*/

// Export for bundlers
if (typeof module !== "undefined") module.exports = NepaliGrammarFL;

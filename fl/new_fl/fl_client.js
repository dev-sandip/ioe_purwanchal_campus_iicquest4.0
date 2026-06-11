/**
 * fl_client.js
 *
 * Frontend FL client for Nepali Grammar Checker.
 * Talks to Bridge API on http://localhost:8082
 *
 * Dependencies (add to your HTML):
 *   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
 *
 * Usage (React/Vue/plain JS):
 *   import { NepaliFL } from './fl_client.js'
 *
 *   const fl = new NepaliFL("http://localhost:8082")
 *   await fl.loadModel("detector")
 *   const { isError, confidence } = await fl.detect("नेपालल")
 *   const corrected = await fl.correct("नेपालल")
 */

export class NepaliFL {

  /**
   * @param {string} bridgeUrl  - Bridge API URL, default http://localhost:8082
   */
  constructor(bridgeUrl = "http://localhost:8082") {
    this.bridgeUrl      = bridgeUrl.replace(/\/$/, "")
    this.detectorSess   = null   // ort.InferenceSession
    this.correctorSess  = null
    this.char2idx       = {}
    this.idx2char       = {}
    this.PAD            = 0
    this.SOS            = 1
    this.EOS            = 2
    this.UNK            = 3
    this.MAX_LEN        = 30
    this.TGT_LEN        = 32
  }

  // ── setup ────────────────────────────────────────────────────────────────────

  /**
   * Load ONNX model from bridge API.
   * Call this once on app startup.
   *
   * @param {"detector"|"corrector"|"both"} which
   */
  async loadModel(which = "both") {
    await this._loadTokenizer()

    if (which === "detector" || which === "both") {
      this.detectorSess = await this._fetchOnnx("detector")
      console.log("✓ Detector loaded")
    }
    if (which === "corrector" || which === "both") {
      this.correctorSess = await this._fetchOnnx("corrector")
      console.log("✓ Corrector loaded")
    }
  }

  /**
   * Reload model after FL round completes (new best model exported).
   * Call this after aggregation finishes.
   */
  async reloadModel(which = "both") {
    await this.loadModel(which)
    console.log("✓ Model reloaded with latest FL weights")
  }

  // ── inference ─────────────────────────────────────────────────────────────────

  /**
   * Detect if a Nepali word has an error.
   *
   * @param   {string} word
   * @returns {Promise<{ isError: boolean, confidence: number }>}
   *
   * confidence = P(correct word)
   * isError    = confidence < 0.5
   */
  async detect(word) {
    if (!this.detectorSess) throw new Error("Detector not loaded. Call loadModel() first.")

    const ids   = this._encode(word, this.MAX_LEN)
    const input = new ort.Tensor("int64",
      BigInt64Array.from(ids.map(BigInt)), [1, this.MAX_LEN]
    )

    const out        = await this.detectorSess.run({ char_ids: input })
    const confidence = out["prob"].data[0]   // float32, P(correct)

    return {
      isError:    confidence < 0.5,
      confidence: parseFloat(confidence.toFixed(4)),
    }
  }

  /**
   * Correct a Nepali word using seq2seq model.
   *
   * @param   {string} word
   * @returns {Promise<string>}
   */
  async correct(word) {
    if (!this.correctorSess) throw new Error("Corrector not loaded. Call loadModel() first.")

    const src   = this._encode(word, this.MAX_LEN)
    const tgt   = new Array(this.TGT_LEN).fill(this.PAD)
    tgt[0]      = this.SOS

    const srcT  = new ort.Tensor("int64", BigInt64Array.from(src.map(BigInt)), [1, this.MAX_LEN])
    const tgtT  = new ort.Tensor("int64", BigInt64Array.from(tgt.map(BigInt)), [1, this.TGT_LEN])

    const out     = await this.correctorSess.run({ src: srcT, tgt: tgtT })
    const logits  = out["logits"].data      // float32 flat [1 * TGT_LEN * vocab]
    const vocabSz = logits.length / this.TGT_LEN

    const chars = []
    for (let t = 1; t < this.TGT_LEN; t++) {
      const slice  = logits.slice(t * vocabSz, (t + 1) * vocabSz)
      const argmax = [...slice].indexOf(Math.max(...slice))
      if (argmax === this.EOS || argmax === this.PAD) break
      const ch = this.idx2char[argmax]
      if (ch && ch !== "<UNK>") chars.push(ch)
    }
    return chars.join("")
  }

  /**
   * Check full sentence — detects and corrects each word.
   *
   * @param   {string} sentence
   * @param   {number} threshold   - confidence below this = wrong word (default 0.5)
   * @returns {Promise<{
   *   input:   string,
   *   output:  string,
   *   details: Array<{ word, isError, confidence, corrected }>
   * }>}
   */
  async checkSentence(sentence, threshold = 0.5) {
    const words   = sentence.trim().split(/\s+/)
    const details = []
    const output  = []

    for (const word of words) {
      const { isError, confidence } = await this.detect(word)
      let corrected = word

      if (isError) {
        corrected = await this.correct(word)
        if (!corrected) corrected = word   // fallback if model returns empty
      }

      details.push({ word, isError, confidence, corrected })
      output.push(corrected)
    }

    return {
      input:   sentence,
      output:  output.join(" "),
      details,
    }
  }

  // ── bridge API helpers ────────────────────────────────────────────────────────

  /** Check bridge API health + which files exist. */
  async health() {
    const r = await fetch(`${this.bridgeUrl}/health`)
    return r.json()
  }

  /** Get FL training status. */
  async flStatus() {
    const r = await fetch(`${this.bridgeUrl}/status`)
    return r.json()
  }

  /** Get FL round metrics. */
  async flMetrics() {
    const r = await fetch(`${this.bridgeUrl}/metrics`)
    return r.json()
  }

  // ── private ───────────────────────────────────────────────────────────────────

  async _fetchOnnx(modelType) {
    const url  = `${this.bridgeUrl}/model/${modelType}/onnx`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Failed to download ${modelType}.onnx: ${resp.status}`)
    const buf  = await resp.arrayBuffer()
    return ort.InferenceSession.create(buf)
  }

  async _loadTokenizer() {
    // Try to fetch tokenizer from your main API
    // Adjust this URL to match your actual tokenizer endpoint
    try {
      const resp = await fetch(`${this.bridgeUrl}/tokenizer`)
      if (!resp.ok) throw new Error("no tokenizer endpoint")
      const data      = await resp.json()
      this.char2idx   = data.char2idx
      this.idx2char   = Object.fromEntries(
        Object.entries(data.char2idx).map(([c, i]) => [i, c])
      )
      this.SOS = data.sos_idx ?? 1
      this.EOS = data.eos_idx ?? 2
      console.log(`✓ Tokenizer loaded  vocab=${Object.keys(this.char2idx).length}`)
    } catch {
      // fallback: build Devanagari tokenizer inline
      this._buildDevanagariTokenizer()
    }
  }

  _buildDevanagariTokenizer() {
    // Devanagari Unicode block: U+0900–U+097F (128 chars)
    const specials = ["<PAD>", "<SOS>", "<EOS>", "<UNK>"]
    const devanagari = Array.from({ length: 128 }, (_, i) =>
      String.fromCodePoint(0x0900 + i)
    )
    const latin = Array.from(" abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?!-")
    const all   = [...specials, ...devanagari, ...latin]

    this.char2idx = Object.fromEntries(all.map((c, i) => [c, i]))
    this.idx2char = Object.fromEntries(all.map((c, i) => [i, c]))
    console.log(`✓ Fallback Devanagari tokenizer  vocab=${all.length}`)
  }

  _encode(text, maxLen) {
    const ids = Array.from(text).map(ch => this.char2idx[ch] ?? this.UNK)
    while (ids.length < maxLen) ids.push(this.PAD)
    return ids.slice(0, maxLen)
  }
}


// ── default export for non-module environments ─────────────────────────────────
if (typeof window !== "undefined") window.NepaliFL = NepaliFL

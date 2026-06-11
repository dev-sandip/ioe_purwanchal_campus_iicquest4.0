// Nepali word corrector backed by nepali_correction_encoder.onnx.
//
// Model spec (from the exported graph):
//   input  "src"     : int64 [batch, seq] -> character IDs of a word
//   output "add_324" : float32 encoder memory  [batch, seq, d_model=64]
//   output "tanh"    : float32 decoder init hidden h0
//   output "tanh_1"  : float32 decoder init cell   c0
//   embedding vocab  : 82, max sequence length: 100
//
// IMPORTANT: this file is the ENCODER ONLY. To generate the corrected word you
// must also export the matching LSTM decoder to ONNX and drop it in at
// /public/model/correction_decoder.onnx. Expected decoder signature (adjust the
// names in DECODER_IO below to match your export):
//
//   inputs:
//     "input"  int64   [batch, 1]                 previous output token (start with <sos>)
//     "h"      float32 [layers, batch, hidden]     hidden state
//     "c"      float32 [layers, batch, hidden]     cell state
//     "memory" float32 [batch, seq, d_model]       encoder output (add_324)
//   outputs:
//     "logits" float32 [batch, vocab]              next-token scores
//     "h"      float32 ...                          updated hidden state
//     "c"      float32 ...                          updated cell state

import { getSession, ort } from "./session";
import { getTokenizer, Tokenizer } from "./tokenizer";

const ENCODER_MODEL_URL = "/model/nepali_correction_encoder.onnx";
const DECODER_MODEL_URL = "/model/correction_decoder.onnx"; // optional
const CORRECTION_VOCAB_URL = "/model/nepali_tokenizer_vocab_research.json";
const CORRECTION_MAX_LEN = 100;

// Verified encoder output names (via onnxruntime): encoder_out, h, c.
const ENCODER_OUT_MEMORY = "encoder_out";
const ENCODER_OUT_H = "h";
const ENCODER_OUT_C = "c";

// Decoder I/O names — edit to match your exported decoder.
const DECODER_IO = {
  inputToken: "input",
  inputH: "h",
  inputC: "c",
  inputMemory: "memory",
  outLogits: "logits",
  outH: "h",
  outC: "c",
};

export interface CorrectionResult {
  /** Corrected word, or null when no decoder model is available. */
  correction: string | null;
  /** Human-readable status for the UI tooltip. */
  status: "ok" | "no-decoder" | "error";
  message?: string;
  usingPlaceholderVocab: boolean;
}

export async function getCorrectionTokenizer(): Promise<Tokenizer> {
  return getTokenizer(CORRECTION_VOCAB_URL);
}

let decoderAvailable: boolean | null = null;

async function hasDecoderModel(): Promise<boolean> {
  if (decoderAvailable !== null) return decoderAvailable;
  try {
    const res = await fetch(DECODER_MODEL_URL, { method: "HEAD" });
    decoderAvailable = res.ok;
  } catch {
    decoderAvailable = false;
  }
  return decoderAvailable;
}

/** Run the encoder for a word, returning memory + initial decoder states. */
async function runEncoder(word: string, tokenizer: Tokenizer) {
  const session = await getSession(ENCODER_MODEL_URL);
  const ids = tokenizer.encode(word, {
    addSos: true,
    addEos: true,
    maxLen: CORRECTION_MAX_LEN,
  });
  const data = BigInt64Array.from(ids.map((v) => BigInt(v)));
  const src = new ort.Tensor("int64", data, [1, ids.length]);
  const outputs = await session.run({ [session.inputNames[0]]: src });
  // The exported signature names (add_324/tanh/tanh_1) differ from the actual
  // ORT binding names, so prefer those names but fall back to output order:
  // [0]=encoder memory, [1]=h0, [2]=c0. VERIFY this order against your export
  // once the encoder .data + decoder are present.
  const names = session.outputNames;
  const memory = outputs[ENCODER_OUT_MEMORY] ?? outputs[names[0]];
  const h = outputs[ENCODER_OUT_H] ?? outputs[names[1]];
  const c = outputs[ENCODER_OUT_C] ?? outputs[names[2]];

  console.log("[CORRECT/encoder]", JSON.stringify(word), {
    ids,
    inputName: session.inputNames[0],
    outputNames: names,
    memoryDims: memory?.dims,
    hDims: h?.dims,
    cDims: c?.dims,
    hPreview: h ? Array.from(h.data as Float32Array).slice(0, 8) : null,
  });

  return { memory, h, c };
}

/**
 * Correct a single word. Always runs the encoder; runs the decoder (greedy)
 * only if /public/model/correction_decoder.onnx is present.
 */
export async function correctWord(word: string): Promise<CorrectionResult> {
  const tokenizer = await getCorrectionTokenizer();

  let encoded: Awaited<ReturnType<typeof runEncoder>>;
  try {
    encoded = await runEncoder(word, tokenizer);
  } catch (err) {
    return {
      correction: null,
      status: "error",
      message: `Encoder failed: ${(err as Error).message}`,
      usingPlaceholderVocab: tokenizer.placeholder,
    };
  }

  if (!(await hasDecoderModel())) {
    return {
      correction: null,
      status: "no-decoder",
      message:
        "Encoder ran successfully, but no decoder model was found. Add /public/model/correction_decoder.onnx to generate corrections.",
      usingPlaceholderVocab: tokenizer.placeholder,
    };
  }

  try {
    const correction = await greedyDecode(encoded, tokenizer);
    return {
      correction,
      status: "ok",
      usingPlaceholderVocab: tokenizer.placeholder,
    };
  } catch (err) {
    return {
      correction: null,
      status: "error",
      message: `Decoder failed (check DECODER_IO names): ${(err as Error).message}`,
      usingPlaceholderVocab: tokenizer.placeholder,
    };
  }
}

async function greedyDecode(
  encoded: Awaited<ReturnType<typeof runEncoder>>,
  tokenizer: Tokenizer,
  maxSteps = CORRECTION_MAX_LEN,
): Promise<string> {
  const decoder = await getSession(DECODER_MODEL_URL);
  let h = encoded.h;
  let c = encoded.c;
  const memory = encoded.memory;

  const outIds: number[] = [];
  let prev = tokenizer.sosId;

  for (let step = 0; step < maxSteps; step++) {
    const token = new ort.Tensor("int64", BigInt64Array.from([BigInt(prev)]), [1, 1]);
    const feeds: Record<string, ort.Tensor> = {
      [DECODER_IO.inputToken]: token,
      [DECODER_IO.inputH]: h,
      [DECODER_IO.inputC]: c,
      [DECODER_IO.inputMemory]: memory,
    };
    const out = await decoder.run(feeds);
    const logits = out[DECODER_IO.outLogits].data as Float32Array;

    // argmax over vocab
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i] > bestVal) {
        bestVal = logits[i];
        best = i;
      }
    }

    if (best === tokenizer.eosId) break;
    outIds.push(best);
    prev = best;
    h = out[DECODER_IO.outH] ?? h;
    c = out[DECODER_IO.outC] ?? c;
  }

  return tokenizer.decode(outIds);
}

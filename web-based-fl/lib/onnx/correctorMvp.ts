// Real correction using the encoder + step decoder (corrector.ts untouched).
//
// Returns the top-3 probable corrected words via beam search.
//
// Pipeline (verified against the exported models):
//   encoder: src[1,100] (padded with <PAD>) -> encoder_out[1,100,64], h0[1,128], c0[1,128]
//   decoder (one step per char): token[1], h_in, c_in, encoder_out
//                                -> logits[1,vocab], h_out, c_out
//   beam search keeps the 3 best sequences; IDs -> characters via idx2char.

import { getSession, ort } from "./session";

const ENCODER_MODEL_URL = "/model/nepali_correction_encoder.onnx";
const DECODER_MODEL_URL = "/model/nepali_correction_decoder_step.onnx";
const TOKENIZER_URL = "/model/nepali_correction_tokenizer.json";
const ENCODER_SEQ_LEN = 100; // encoder exported with a fixed length
const MAX_DECODE_STEPS = 60;
const BEAM_WIDTH = 3;
const NUM_CANDIDATES = 3;

export interface MvpCorrectionResult {
  /** Best candidate (top-1), or null on error. */
  correction: string | null;
  /** Up to 3 probable corrected words, best first. */
  candidates: string[];
  status: "ok" | "error";
  message?: string;
  usingPlaceholderVocab: boolean;
}

interface Tok {
  char2idx: Record<string, number>;
  idx2char: Record<string, string>;
  pad: number;
  sos: number;
  eos: number;
  unk: number;
}

let tokPromise: Promise<Tok> | null = null;

function getTok(): Promise<Tok> {
  if (tokPromise) return tokPromise;
  tokPromise = fetch(TOKENIZER_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${TOKENIZER_URL}: ${r.status}`);
      return r.json() as Promise<{ char2idx: Record<string, number>; idx2char: Record<string, string> }>;
    })
    .then((j) => ({
      char2idx: j.char2idx,
      idx2char: j.idx2char,
      pad: j.char2idx["<PAD>"],
      sos: j.char2idx["<SOS>"],
      eos: j.char2idx["<EOS>"],
      unk: j.char2idx["<UNK>"],
    }))
    .catch((e) => {
      tokPromise = null;
      throw e;
    });
  return tokPromise;
}

function encodeSrc(word: string, tok: Tok): number[] {
  const chars = Array.from(word).slice(0, ENCODER_SEQ_LEN - 2);
  const ids = [tok.sos, ...chars.map((c) => tok.char2idx[c] ?? tok.unk), tok.eos];
  while (ids.length < ENCODER_SEQ_LEN) ids.push(tok.pad);
  return ids.slice(0, ENCODER_SEQ_LEN);
}

/** log-softmax over a logits array. */
function logSoftmax(logits: Float32Array): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - max);
  const logSum = Math.log(sum) + max;
  const out = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) out[i] = logits[i] - logSum;
  return out;
}

/** Indices of the top-k values in a typed array. */
function topKIndices(arr: Float32Array, k: number): number[] {
  const idx = Array.from(arr.keys());
  idx.sort((a, b) => arr[b] - arr[a]);
  return idx.slice(0, k);
}

interface Beam {
  ids: number[];
  score: number; // sum of log-probs
  h: ort.Tensor;
  c: ort.Tensor;
  prev: number;
  done: boolean;
}

function decodeIds(ids: number[], tok: Tok): string {
  let s = "";
  for (const id of ids) {
    const ch = tok.idx2char[String(id)];
    if (ch && ch !== "<PAD>" && ch !== "<SOS>" && ch !== "<EOS>" && ch !== "<UNK>") s += ch;
  }
  return s;
}

/** Correct a single word, returning the top-3 candidates via beam search. */
export async function correctWord(word: string): Promise<MvpCorrectionResult> {
  try {
    const [encoder, decoder, tok] = await Promise.all([
      getSession(ENCODER_MODEL_URL),
      getSession(DECODER_MODEL_URL),
      getTok(),
    ]);

    // Encode.
    const srcIds = encodeSrc(word, tok);
    const src = new ort.Tensor("int64", BigInt64Array.from(srcIds.map((v) => BigInt(v))), [1, ENCODER_SEQ_LEN]);
    const enc = await encoder.run({ [encoder.inputNames[0]]: src });
    const encoderOut = enc["encoder_out"] ?? enc[encoder.outputNames[0]];
    const h0 = enc["h0"] ?? enc[encoder.outputNames[1]];
    const c0 = enc["c0"] ?? enc[encoder.outputNames[2]];

    // Beam search over the step decoder.
    let beams: Beam[] = [{ ids: [], score: 0, h: h0, c: c0, prev: tok.sos, done: false }];

    for (let step = 0; step < MAX_DECODE_STEPS; step++) {
      if (beams.every((b) => b.done)) break;
      const expanded: Beam[] = [];

      for (const b of beams) {
        if (b.done) {
          expanded.push(b);
          continue;
        }
        const token = new ort.Tensor("int64", BigInt64Array.from([BigInt(b.prev)]), [1]);
        const dec = await decoder.run({ token, h_in: b.h, c_in: b.c, encoder_out: encoderOut });
        const logp = logSoftmax(dec["logits"].data as Float32Array);
        const hOut = dec["h_out"];
        const cOut = dec["c_out"];

        for (const id of topKIndices(logp, BEAM_WIDTH)) {
          const done = id === tok.eos;
          expanded.push({
            ids: done ? b.ids : [...b.ids, id],
            score: b.score + logp[id],
            h: hOut,
            c: cOut,
            prev: id,
            done,
          });
        }
      }

      // Keep the best beams (length-normalized score to avoid favouring short ones).
      expanded.sort(
        (a, b) => b.score / Math.max(1, b.ids.length) - a.score / Math.max(1, a.ids.length),
      );
      beams = expanded.slice(0, BEAM_WIDTH);
    }

    // Rank final beams, decode to unique candidate strings.
    beams.sort((a, b) => b.score / Math.max(1, b.ids.length) - a.score / Math.max(1, a.ids.length));
    const candidates: string[] = [];
    for (const b of beams) {
      const text = decodeIds(b.ids, tok);
      if (text && !candidates.includes(text)) candidates.push(text);
      if (candidates.length >= NUM_CANDIDATES) break;
    }

    console.log("[CORRECT]", JSON.stringify(word), "-> candidates:", candidates);
    return {
      correction: candidates[0] ?? null,
      candidates,
      status: "ok",
      usingPlaceholderVocab: false,
    };
  } catch (err) {
    return {
      correction: null,
      candidates: [],
      status: "error",
      message: (err as Error).message,
      usingPlaceholderVocab: false,
    };
  }
}

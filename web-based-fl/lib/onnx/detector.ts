// Incorrect-word detector backed by detector_best.onnx.
//
// Model spec (verified via onnxruntime):
//   input  "input"  : int64 [batch, seq]  -> character IDs of a word
//   output "output" : float32, sigmoid probability that the word is CORRECT
//   embedding vocab : 74, max sequence length (pos embedding): 30
// (We bind by session.inputNames/outputNames so the exact names don't matter.)

import { getSession, ort } from "./session";
import { getTokenizer, Tokenizer } from "./tokenizer";

const DETECTOR_MODEL_URL = "/model/detector_best.onnx";
const DETECTOR_VOCAB_URL = "/model/detector_vocab.json";
const DETECTOR_MAX_LEN = 30;

export interface DetectorResult {
  /** Raw model output: probability in [0,1] that the word is CORRECT. */
  probCorrect: number;
  incorrect: boolean;
  /** True when the active vocab is the placeholder (results not meaningful). */
  usingPlaceholderVocab: boolean;
}

export async function getDetectorTokenizer(): Promise<Tokenizer> {
  return getTokenizer(DETECTOR_VOCAB_URL);
}

/**
 * Run the detector on a single word.
 * The model emits P(correct); a word is flagged incorrect when that probability
 * is below `threshold`.
 */
export async function detectWord(word: string, threshold = 0.5): Promise<DetectorResult> {
  const [session, tokenizer] = await Promise.all([
    getSession(DETECTOR_MODEL_URL),
    getDetectorTokenizer(),
  ]);

  const ids = tokenizer.encode(word, { maxLen: DETECTOR_MAX_LEN });
  // Guard against empty input (e.g. whitespace) producing a zero-length tensor.
  if (ids.length === 0) {
    return { probCorrect: 1, incorrect: false, usingPlaceholderVocab: tokenizer.placeholder };
  }

  const seq = ids.length;
  const data = BigInt64Array.from(ids.map((v) => BigInt(v)));
  const input = new ort.Tensor("int64", data, [1, seq]);

  const outputs = await session.run({ [session.inputNames[0]]: input });
  const out = outputs[session.outputNames[0]];
  const raw = out.data as Float32Array;
  const probCorrect = Number(raw[0]);
  const incorrect = probCorrect < threshold;

  console.log("[DETECT]", JSON.stringify(word), {
    ids,
    outputName: session.outputNames[0],
    dims: out.dims,
    raw: Array.from(raw),
    probCorrect,
    incorrect,
  });

  return {
    probCorrect,
    incorrect,
    usingPlaceholderVocab: tokenizer.placeholder,
  };
}

/** Detect a batch of words sequentially (one inference per word). */
export async function detectWords(
  words: string[],
  threshold = 0.5,
): Promise<DetectorResult[]> {
  const results: DetectorResult[] = [];
  for (const w of words) {
    results.push(await detectWord(w, threshold));
  }
  return results;
}

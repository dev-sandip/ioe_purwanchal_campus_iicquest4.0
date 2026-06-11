// Character-level tokenizer driven by a vocab JSON file.
//
// Both ONNX models consume integer character IDs. The mapping below is loaded
// from a JSON file you place in /public/model. Until you provide the REAL vocab
// produced during training, a placeholder Devanagari vocab is used and the
// `placeholder` flag is surfaced to the UI so results are clearly marked as
// not-yet-meaningful.
//
// Expected JSON shape:
// {
//   "placeholder": false,
//   "size": 74,
//   "pad": "<pad>", "unk": "<unk>", "sos": "<sos>", "eos": "<eos>",
//   "itos": ["<pad>", "<unk>", ...],   // index -> token
//   "stoi": { "<pad>": 0, ... }        // token -> index
// }

export interface VocabJson {
  placeholder?: boolean;
  size: number;
  pad: string;
  unk: string;
  sos: string;
  eos: string;
  itos: string[];
  stoi: Record<string, number>;
}

export class Tokenizer {
  readonly placeholder: boolean;
  readonly size: number;
  readonly padId: number;
  readonly unkId: number;
  readonly sosId: number;
  readonly eosId: number;
  private readonly stoi: Record<string, number>;
  private readonly itos: string[];

  constructor(vocab: VocabJson) {
    this.placeholder = Boolean(vocab.placeholder);
    this.size = vocab.size;
    this.itos = vocab.itos;
    this.stoi = vocab.stoi;
    this.padId = vocab.stoi[vocab.pad] ?? 0;
    this.unkId = vocab.stoi[vocab.unk] ?? 1;
    this.sosId = vocab.stoi[vocab.sos] ?? 2;
    this.eosId = vocab.stoi[vocab.eos] ?? 3;
  }

  /** Encode a single word into character IDs. */
  encode(
    text: string,
    opts: { addSos?: boolean; addEos?: boolean; maxLen?: number } = {},
  ): number[] {
    const ids: number[] = [];
    if (opts.addSos) ids.push(this.sosId);
    // Use Array.from to iterate by Unicode code points, not UTF-16 units.
    for (const ch of Array.from(text)) {
      const id = this.stoi[ch];
      ids.push(id === undefined ? this.unkId : id);
    }
    if (opts.addEos) ids.push(this.eosId);
    if (opts.maxLen && ids.length > opts.maxLen) {
      // Keep the leading content; preserve trailing EOS if requested.
      if (opts.addEos) {
        return ids.slice(0, opts.maxLen - 1).concat(this.eosId);
      }
      return ids.slice(0, opts.maxLen);
    }
    return ids;
  }

  /** Decode IDs back to a string, stopping at EOS and skipping special tokens. */
  decode(ids: number[]): string {
    const out: string[] = [];
    for (const id of ids) {
      if (id === this.eosId) break;
      if (id === this.padId || id === this.sosId) continue;
      const tok = this.itos[id];
      if (tok === undefined) continue;
      // Skip any remaining angle-bracket special tokens defensively.
      if (tok.startsWith("<") && tok.endsWith(">")) continue;
      out.push(tok);
    }
    return out.join("");
  }
}

const tokenizerCache = new Map<string, Promise<Tokenizer>>();

/** A raw char2idx/idx2char tokenizer (e.g. nepali_correction_tokenizer.json). */
interface CharMapJson {
  char2idx: Record<string, number>;
  idx2char?: Record<string, string>;
}

function isCharMap(json: unknown): json is CharMapJson {
  return Boolean(json && typeof json === "object" && "char2idx" in (json as object));
}

/** Pick the first special-token name present in stoi from a list of candidates. */
function pickSpecial(stoi: Record<string, number>, candidates: string[], fallback: string): string {
  for (const c of candidates) if (c in stoi) return c;
  return fallback;
}

/** Normalize either a VocabJson or a char2idx map into a VocabJson. */
function normalizeVocab(json: VocabJson | CharMapJson): VocabJson {
  if (!isCharMap(json)) return json;
  const stoi = json.char2idx;
  const entries = Object.entries(stoi);
  const size = entries.length;
  const itos = new Array<string>(size);
  for (const [ch, id] of entries) itos[id] = ch;
  return {
    placeholder: false,
    size,
    pad: pickSpecial(stoi, ["<PAD>", "<pad>"], "<PAD>"),
    unk: pickSpecial(stoi, ["<UNK>", "<unk>"], "<UNK>"),
    sos: pickSpecial(stoi, ["<SOS>", "<sos>", "<BOS>", "<bos>"], "<SOS>"),
    eos: pickSpecial(stoi, ["<EOS>", "<eos>"], "<EOS>"),
    itos,
    stoi,
  };
}

/**
 * Load and cache a tokenizer from a vocab JSON URL. Supports both the
 * {itos, stoi, ...} VocabJson shape and the {char2idx, idx2char} shape used by
 * nepali_correction_tokenizer.json.
 */
export function getTokenizer(vocabUrl: string): Promise<Tokenizer> {
  const existing = tokenizerCache.get(vocabUrl);
  if (existing) return existing;

  const created = fetch(vocabUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load vocab ${vocabUrl}: ${res.status}`);
      return res.json() as Promise<VocabJson | CharMapJson>;
    })
    .then((json) => new Tokenizer(normalizeVocab(json)))
    .catch((err) => {
      tokenizerCache.delete(vocabUrl);
      throw err;
    });

  tokenizerCache.set(vocabUrl, created);
  return created;
}

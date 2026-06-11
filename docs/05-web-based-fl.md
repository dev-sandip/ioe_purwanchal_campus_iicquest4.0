# 05 — Web-based FL Demo

`web-based-fl/` is a standalone **Next.js 16 / React 19** application that runs
the Nepali detector and corrector models **fully in the browser** with
`onnxruntime-web`. It also demonstrates triggering a federated-learning round
against the Grammar API.

## What it does

- A single page (`app/page.tsx`) with a Nepali textarea spell checker.
- As you type (debounced 600ms), each unique word is run through the detector;
  misspelled words are underlined in red.
- Hovering a flagged word fetches and shows the **top-3** correction candidates
  in a floating tooltip.
- A discreet menu toggles the **prediction source** between local ONNX inference
  and the remote Grammar API.
- A manual **light/dark theme** toggle (persisted in `localStorage`).
- After every **50 predictions** (counted in `localStorage`), it quietly fires a
  federated-learning round (`triggerFederatedRound`).

## Directory Map

```
web-based-fl/
├── app/
│   ├── page.tsx           # The spell-checker UI + FL trigger
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── onnx/
│   │   ├── session.ts      # ONNX session loader + cache + external-data
│   │   ├── detector.ts     # detector_best.onnx → P(correct)
│   │   ├── correctorMvp.ts # encoder + step-decoder beam search (top-3)
│   │   ├── corrector.ts    # encoder-only variant (greedy; needs decoder)
│   │   └── tokenizer.ts    # char-level tokenizer (two JSON shapes)
│   └── api/
│       └── client.ts       # Remote Grammar API client + FL trigger
└── public/model/           # ONNX models, tokenizers, vocabs
```

## ONNX Runtime Setup (`lib/onnx/session.ts`)

- `getSession(modelUrl)` lazily creates and caches an `InferenceSession` per
  model URL (concurrent callers share the in-flight promise).
- **WASM backend** is loaded from a CDN matching the installed version:
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/`.
- Runs **single-threaded** with no proxy worker (`numThreads = 1`,
  `proxy = false`) to avoid Worker construction errors and the need for
  cross-origin isolation (COOP/COEP).
- **External weights:** these models were exported in ONNX external-data format,
  so big tensors live in a sibling `<model>.onnx.data` file. `loadExternalData`
  fetches it and passes it to the session via the `externalData` option; a
  helpful error is thrown if it's missing.

## Detector (`lib/onnx/detector.ts`)

- Model: `/model/detector_best.onnx`; vocab: `/model/detector_vocab.json`.
- Max sequence length 30; input is `int64 [1, seq]` of character IDs.
- Output is a sigmoid **probability that the word is correct**.
- `detectWord(word, threshold = 0.5)` returns
  `{ probCorrect, incorrect, usingPlaceholderVocab }`; a word is flagged
  `incorrect` when `probCorrect < threshold`.
- Empty input (e.g. whitespace) short-circuits to "correct".

## Corrector — MVP (`lib/onnx/correctorMvp.ts`)

This is the corrector used by the demo UI:

- Encoder `/model/nepali_correction_encoder.onnx` →
  `encoder_out [1,100,64]`, `h0 [1,128]`, `c0 [1,128]`.
- Step decoder `/model/nepali_correction_decoder_step.onnx`: one char per step,
  inputs `token`, `h_in`, `c_in`, `encoder_out` → `logits`, `h_out`, `c_out`.
- **Beam search** (width 3, max 60 steps, length-normalized scores) produces up
  to **3 unique candidate** corrected words.
- Tokenizer: `/model/nepali_correction_tokenizer.json` (char2idx/idx2char with
  `<PAD>`, `<SOS>`, `<EOS>`, `<UNK>`). Encoder input is fixed length 100,
  padded.
- `correctWord(word)` → `{ correction, candidates, status, usingPlaceholderVocab }`.

## Corrector — legacy (`lib/onnx/corrector.ts`)

An earlier **encoder-only** variant kept for reference. It runs the encoder and
performs **greedy** decoding, but only if a separate
`/model/correction_decoder.onnx` is present (it HEAD-checks for the file). When
no decoder is found it returns a `no-decoder` status with guidance. The demo UI
uses `correctorMvp.ts` instead.

## Tokenizer (`lib/onnx/tokenizer.ts`)

- Character-level. Supports two JSON shapes:
  - the `{ itos, stoi, pad, unk, sos, eos, size, placeholder }` `VocabJson`, and
  - the `{ char2idx, idx2char }` map (normalized into a `VocabJson`).
- `encode(text, { addSos, addEos, maxLen })` iterates by Unicode code points and
  maps unknown chars to `unk`.
- `decode(ids)` stops at EOS and skips special/angle-bracket tokens.
- Tokenizers are cached per vocab URL.

## Remote API Client (`lib/api/client.ts`)

Mirrors the local detector/corrector return shapes so the UI can switch sources
transparently. `API_BASE = https://pujan-dev-ioe-purwanchal.hf.space`.

- `apiDetectWord(word)` → `POST /detect`; maps `{ correct, confidence }` to
  `{ probCorrect, incorrect }`.
- `apiCorrectWord(word)` → `POST /correct`; takes the top-3 suggestion words.
- `triggerFederatedRound()` → fire-and-forget `POST /fl/start` with
  `{ model: "detector", rounds: 1, clients: 2 }` (uses `keepalive`, never
  throws).

## Models in `public/model/`

| File | Role |
| --- | --- |
| `detector_best.onnx` (+ `.data`) | Spell detector |
| `detector_vocab.json` | Detector char vocab |
| `nepali_correction_encoder.onnx` (+ `.data`) | Corrector encoder |
| `nepali_correction_decoder_step.onnx` (+ `.data`) | Corrector step decoder |
| `nepali_correction_tokenizer.json` | Corrector tokenizer |
| `correction_vocab.json`, `correction_embedding.json` | Correction support assets |
| `nepali_tokenizer_vocab_research.json` | Research/legacy vocab |

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | ESLint |

> The demo's federated-learning behavior here is limited to **triggering** a
> round on the server (`/fl/start`). The richer client-side FL lifecycle
> (download/train/upload/aggregate) lives in the extension — see
> [07 — Federated Learning](./07-federated-learning.md).

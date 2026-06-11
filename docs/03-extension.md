# 03 — Browser Extension

The extension is built with **Plasmo** (Manifest V3) targeting Chrome and
Firefox, using **React 18**, **TypeScript**, **Tailwind CSS**, and
**onnxruntime-web**.

## Directory Map

```
extension/
├── content.ts                 # Plasmo content-script entrypoint
├── popup.tsx                  # Toolbar popup UI (settings, login, FL sync)
├── options.tsx                # Options/settings page
├── manifest.json              # (standalone manifest; see note below)
├── package.json               # Plasmo config incl. "manifest" overrides
├── style.css                  # Tailwind entry
├── tabs/
│   └── auth-callback.tsx       # Receives JWT after website login
├── features/content-script/
│   ├── controller.ts           # Orchestrates the suggestion lifecycle
│   ├── editable.ts             # Editable-field detection + word context
│   ├── prediction-api.ts       # Live word-at-caret prediction via API
│   ├── correction.ts           # Word-by-word text correction via API
│   ├── prediction.ts           # Local dictionary-based prediction (fallback)
│   ├── popover.ts              # Inline suggestion popover rendering
│   ├── insertion.ts            # Applies an accepted suggestion to the field
│   ├── caret.ts                # Caret rectangle / popover positioning
│   ├── debouncer.ts            # Input debounce helper
│   ├── dictionaries.ts         # Local NEXT_WORDS / COMMON_WORDS / CORRECTIONS
│   ├── constants.ts            # Regex patterns, IDs, limits
│   └── types.ts                # Shared types
├── lib/
│   ├── onnx.ts                 # ONNX worker bridge + model caching
│   ├── grammar-api.ts          # /detect & /correct client
│   ├── fl-client.ts            # Federated-learning client (FLClient)
│   ├── flower.ts               # "Send local data" helper
│   ├── auth.ts                 # JWT auth helpers
│   ├── storage.ts              # IndexedDB (samples + detections)
│   ├── stats.ts                # Usage-stats batching + reporting
│   └── settings.ts             # chrome.storage.sync settings
└── assets/
    ├── ort-worker.js           # ONNX Runtime worker (raw asset)
    ├── ort*.wasm / *.mjs        # ORT WASM backend (copied postinstall)
    └── model/
        ├── detector_best.onnx
        └── nepali_correction_encoder.onnx
```

> **Manifest note:** Plasmo generates the effective MV3 manifest from the
> `manifest` block in `package.json` (this is the authoritative one used by the
> build). A separate `manifest.json` also exists at the project root of the
> extension but the Plasmo `package.json` block is what configures permissions,
> CSP, and host permissions for the dev/prod builds.

## Manifest & Permissions (from `package.json`)

- `manifest_version: 3`
- **permissions:** `storage`, `tabs`, `identity`, `offscreen`
- **content_security_policy.extension_pages:**
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` — required for the
  ONNX WASM backend.
- **host_permissions:** `http://localhost:3000/*`, the Vercel app
  (`https://ioe-purwanchal-campus-iicquest4-0.vercel.app/*` and specific
  subpaths), and the Grammar API (`https://pujan-dev-ioe-purwanchal.hf.space/*`).
- **web_accessible_resources:** `tabs/auth-callback.html` and `assets/*`.

## Content Script Lifecycle

`content.ts` registers a Plasmo content script that matches `http://*/*` and
`https://*/*` across all frames. It guards against double-injection with a
window flag, then calls `startContentScript()`.

`controller.ts` wires up the in-page behavior:

- **State:** active editable element, current suggestions, a monotonically
  increasing `suggestionRequestId` (to discard stale async results), and the
  current settings.
- **Event listeners:**
  - `focusin` / `focusout` — track the active editable; hide popover on blur
    (unless focus moved into the popover).
  - `input` / `keyup` — re-run suggestions for the focused field.
  - `keydown` (capture) — `Tab` or `ArrowRight` accepts the top suggestion.
  - `selectionchange` — refresh when the caret moves in the active field.
  - `scroll` / `resize` — reposition the popover.
  - `chrome.storage.onChanged` — live-apply settings changes.
- **Debounce:** suggestion updates are debounced by **500ms**
  (`debouncedUpdateSuggestions`).

### `updateSuggestions()` — the core pass

1. Bail if disabled, no active field, empty text, or non-Nepali language.
2. Assign a new `requestId`; build a deduped `merged` list.
3. **Live prediction** (`predictCurrentWord`) for the word currently being
   typed (only while actively typing a word, max 3 suggestions).
4. **Word-by-word correction** (`checkTextCorrections`) for the rest of the
   text; flagged words get a `word → suggestion` entry with absolute replace
   offsets. Each flagged word also fires `trackError()` and `saveDetection()`.
5. Discard if a newer request started in the meantime.
6. `activeSuggestions = merged.slice(0, 6)` and render the popover.

### Accepting a suggestion

`applySuggestion()` calls `applySuggestionToEditable()` (see `insertion.ts`),
then records a prediction or correction stat and saves a training sample, and
re-runs the suggestion pass.

## Editable Detection & Word Context (`editable.ts`)

- **`isEditableElement`** matches `contentEditable` elements, `<textarea>`, and
  text-like `<input>` types (`text`, `search`, `tel`, `url`, empty), excluding
  disabled/readonly inputs.
- **`getSnapshot`** returns `{ caret, text }` for inputs/textareas, or for
  contenteditable computes the caret offset by measuring the selection range.
- **`getWordContext`** derives the current word, previous word, up to 10 context
  words, the text before the caret, and the **detected language**.
- **`detectLanguage`** counts Devanagari (`\u0900–\u097F`) vs. Latin characters
  and returns `nepali`, `english`, or `unknown`. The assistant only acts on
  Nepali.

## API-driven Prediction & Correction

### `prediction-api.ts` — live word at the caret
`predictCurrentWord(context)`:
- Only runs for a Nepali word of length ≥ 2 with no trailing space.
- Calls `detectWord()`; if the word is already correct, returns nothing.
- Otherwise calls `correctWord()` and returns up to 5 deduped candidates as
  `prediction`-type suggestions.

### `correction.ts` — whole-text, word-by-word
`checkTextCorrections(text)`:
- Tokenizes text into Unicode-aware word tokens with character offsets.
- Collects **unique** checkable Nepali words (length ≥ 2).
- Runs `/detect` on each unique word in parallel (failures treated as correct to
  avoid false positives).
- Runs `/correct` only on the words flagged wrong; results are fanned back out
  to every occurrence with absolute `start`/`end` offsets.
- A word is only reported incorrect when an actionable suggestion exists.

### `grammar-api.ts` — the API client
- `detectWord(word)` → `POST /detect { word }` → `{ word, correct, confidence }`
- `correctWord(word)` → `POST /correct { word }` → `{ word, suggestions: [{ word, score }] }`
- Base URL from `PLASMO_PUBLIC_GRAMMAR_API_URL` (default the hosted HF Space).
- 8-second timeout via `AbortController`; the sentence-level `/check` endpoint
  is intentionally not used.

## Popover & Insertion

- **`popover.ts`** creates a single fixed-position `div#pragya-lekh-suggestions`
  at `z-index: 2147483647`, renders each suggestion as a button (value + label),
  and positions it relative to the caret (preferring above, falling back below).
- **`caret.ts`** computes the caret rectangle: for inputs/textareas it builds a
  hidden mirror element with matching styles; for contenteditable it uses the
  selection range rect.
- **`insertion.ts`** resolves the replace range (explicit `replaceStart/End` for
  text corrections, or caret-relative `replaceLength` for completions) and
  rewrites the field. For inputs/textareas it uses the native value setter and
  dispatches an `input` event; for contenteditable it prefers
  `execCommand("insertText")` with a manual range fallback.

## On-device ONNX (`lib/onnx.ts` + `assets/ort-worker.js`)

- ORT runs in a **dedicated Web Worker** loaded from the extension origin
  (`assets/ort-worker.js`). This is deliberate: bundling ORT through Parcel
  breaks its dynamic backend import, and running in a worker keeps WASM out of
  the host page's CSP.
- **Model caching:** `loadModelBuffer()` checks IndexedDB (`pragya-lekh-db`,
  store `models`, key `detector_best`); on a miss it fetches
  `assets/model/detector_best.onnx` and caches the buffer.
- **Worker init:** sets `wasmPaths`, single-threaded, no proxy, creates an
  `InferenceSession` with the `wasm` execution provider.
- **`tokenize(text)`** maps characters to char codes, capped at 128 tokens.
- **`predictText(text)`** posts tokens to the worker and returns the output
  array.

> The `prediction.ts` module provides a local dictionary-based fallback
> (`predictLocally`) using `dictionaries.ts` (`NEXT_WORDS`, `COMMON_WORDS`,
> `CORRECTIONS`, and English variants). The live experience is driven by the API
> path in `controller.ts`; the dictionary path is a self-contained fallback.

## Popup & Options UI

- **`popup.tsx`** shows the enable toggle, account login/logout state, and a
  "Send Local Data" button (federated sync via `flower.ts`). It logs the ONNX
  model URL on mount and verifies any saved auth session.
- **`options.tsx`** exposes the four settings (enable, mark editable fields,
  next-word suggestions, correction suggestions) and shows the extension
  callback URL for configuring the website redirect.

## Settings (`lib/settings.ts`)

Stored in `chrome.storage.sync` under `pragyaLekhSettings`:

| Setting | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Master on/off |
| `autoMarkEditableFields` | `true` | Adds a debug data-attribute to the active field |
| `showNextWordSuggestions` | `true` | Enables live next-word/completion suggestions |
| `showCorrectionSuggestions` | `true` | Enables spelling correction suggestions |

## Authentication (`lib/auth.ts`)

- Session is stored in `chrome.storage.local` under `pragyaLekhAuthSession` as
  `{ token, tokenType: "Bearer", user }`.
- `loginWithWebsite()` opens the website login URL (with `source=extension` and
  a `redirect_uri` callback). If `PLASMO_PUBLIC_DEV_AUTH_TOKEN` is set, it
  verifies and stores that token directly instead.
- `verifyAuthSession()` calls `GET /api/extension/me` with the Bearer token and
  attaches the returned user.
- `authenticatedFetch()` adds the `Authorization: Bearer <token>` header.
- `tabs/auth-callback.tsx` reads `?token=` and calls `saveToken()`.

See [02 — Architecture](./02-architecture.md#2-authentication-flow) for the full
sequence.

## Stats Reporting (`lib/stats.ts`)

`trackPrediction`/`trackCorrection`/`trackError` increment in-memory counters,
batched and flushed every **30s** via `authenticatedFetch` to
`POST /api/extension/stats`. On failure the counts are re-added for the next
flush.

## Scripts (`package.json`)

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `dev:chrome` | Chrome MV3 dev build |
| `pnpm dev:firefox` | Firefox MV3 dev build |
| `pnpm build` / `build:chrome` | Chrome production build |
| `pnpm build:firefox` | Firefox production build |
| `pnpm package` | Create a store bundle |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` / `format:check` | Prettier |
| `postinstall` | Copies ORT `*.wasm` and `*.mjs` into `assets/` |

See [08 — Setup & Development](./08-setup.md) for full instructions.

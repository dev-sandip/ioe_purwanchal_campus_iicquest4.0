# 01 — Overview

## What is Pragya Lekh?

Pragya Lekh (प्रज्ञा लेख) is a Nepali writing assistant. As a user types Nepali
in any text field on the web, the browser extension detects misspelled or
incorrect words and offers ranked correction suggestions in an inline popover.
Word-level spell detection runs on an ONNX model, and the model is improved
collaboratively through federated learning, so the system can get better
without raw user text leaving the browser.

## Goals & Principles

- **Privacy-first.** Typed text is processed in the page (content script) and is
  not bulk-uploaded. Only word-level lookups go to the grammar API, and only
  model weight updates (not raw text) are exchanged for federated learning.
- **On-device inference.** The detector model runs locally via
  `onnxruntime-web` inside a dedicated Web Worker, keeping the WASM backend off
  the host page and out of its CSP.
- **Low-friction UX.** Suggestions appear inline near the caret; the top
  suggestion is accepted with `Tab` or `ArrowRight`.
- **Accounts & analytics.** A web client provides sign-in and a dashboard with
  usage statistics and service tiers.

## Feature List

- Real-time Nepali word detection and correction in inputs, textareas, and
  `contenteditable` editors on any HTTP/HTTPS page.
- Inline suggestion popover with ranked correction candidates.
- Live, word-at-the-caret prediction plus full-text word-by-word correction.
- Language detection (Devanagari vs. Latin) to avoid acting on English text.
- On-device ONNX detector with the model cached in IndexedDB after first load.
- A federated-learning client that trains locally and uploads only weight
  updates for server-side aggregation.
- Email/password authentication via the web client with JWT-based sign-in for
  the extension.
- Usage analytics (predictions, corrections, errors detected) surfaced in a
  dashboard, with free / pro / max service tiers and an admin user panel.
- A separate in-browser demo (`web-based-fl`) that runs both the detector and a
  beam-search corrector fully client-side.

## How a Suggestion is Produced (high level)

1. The user types in an editable field; the content script captures a text
   snapshot and the word context around the caret.
2. If the detected language is Nepali, the controller runs two passes:
   - **Live prediction** for the in-progress word at the caret.
   - **Word-by-word correction** for the rest of the text.
3. Each candidate word is checked with the grammar API's `/detect` endpoint;
   only words flagged incorrect are sent to `/correct` for ranked alternatives.
4. Suggestions are merged, de-duplicated, capped at six, and rendered in the
   inline popover.
5. Accepting a suggestion (click, `Tab`, or `ArrowRight`) rewrites the field and
   records usage stats and a local training sample.

See [02 — Architecture](./02-architecture.md) for the full flow and
[03 — Browser Extension](./03-extension.md) for the implementation.

## Glossary

| Term | Meaning |
| --- | --- |
| **Detector** | ONNX model that outputs the probability a word is spelled correctly. |
| **Corrector** | Encoder/decoder ONNX model (used in the web demo) that generates corrected word candidates via beam search. |
| **Grammar API** | Hosted service exposing `/detect` and `/correct` (and `/fl/*`) endpoints. |
| **Content script** | Code injected into web pages that powers the in-page assistant. |
| **FL client** | The federated-learning client embedded in the extension and triggered by the web demo. |
| **better-auth** | The authentication library used by the web client. |
| **JWT** | Signed token issued by the web client and used by the extension to call authenticated endpoints. |
| **Service tier** | The `free` / `pro` / `max` plan attached to a user account. |

## Modules and Their Responsibilities

| Module | Path | Responsibility |
| --- | --- | --- |
| Browser Extension | `extension/` | In-page assistant, on-device detector, FL client, auth handoff, stats reporting |
| Web Client | `client/` | Auth, JWT issuance, dashboard, usage stats API, admin panel |
| Web-based FL Demo | `web-based-fl/` | In-browser detect + correct demo, periodic FL trigger |
| Grammar API | hosted | Word-level detect/correct and FL round endpoints |

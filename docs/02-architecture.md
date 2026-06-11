# 02 — Architecture

## System Diagram

```
                          detect / correct (word-level)
   ┌───────────────────────┐  ───────────────────────────▶  ┌──────────────────────┐
   │   Browser Extension    │                                 │      Grammar API      │
   │  (Plasmo MV3 + React +  │ ◀───────────────────────────  │  (Hugging Face Space) │
   │   onnxruntime-web)      │   { correct, confidence },      │  /detect /correct     │
   │                         │   { suggestions: [...] }        │  /fl/start /fl/round  │
   └───────┬─────────┬──────┘                                 └───────────┬──────────┘
           │         │                                                    │
   auth    │         │ stats (Bearer JWT)        FL weights / aggregation │
   (JWT)   │         ▼                                                    ▼
           │  ┌──────────────────────┐                       ┌──────────────────────┐
           └▶ │      Web Client       │                       │   FL Server / Round   │
              │  (Next.js + better-   │                       │   coordinator         │
              │   auth + Drizzle/PG)  │                       │  (part of Grammar API)│
              └──────────┬───────────┘                       └──────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │     PostgreSQL        │
              │ user / session / jwks │
              │ usage_stats / ...     │
              └──────────────────────┘

   ┌──────────────────────┐    detect / correct + /fl/start
   │   Web-based FL Demo    │  ───────────────────────────▶  Grammar API
   │  (Next.js, in-browser  │   (also runs ONNX fully local) 
   │   ONNX detect+correct) │
   └──────────────────────┘
```

## Components

### Browser Extension (`extension/`)
- Runs a **content script** on all HTTP/HTTPS pages that watches editable
  fields, produces suggestions, and applies them.
- Calls the **Grammar API** for word-level detection and correction.
- Runs an **on-device ONNX detector** (`lib/onnx.ts`) inside a Web Worker.
- Hosts a **federated-learning client** (`lib/fl-client.ts`) and a simpler
  "send local data" helper (`lib/flower.ts`).
- Authenticates against the **Web Client** using a JWT, and reports usage stats.

### Web Client (`client/`)
- Provides email/password auth via **better-auth**, with `admin`, `bearer`, and
  `jwt` plugins.
- Issues JWTs (audience `pragya-lekh-browser-extension`) that the extension
  exchanges and verifies.
- Exposes extension endpoints: `/api/extension/me`, `/api/extension/stats`,
  `/api/extension/auth-callback`.
- Stores users, sessions, JWKS, and usage statistics in **PostgreSQL** via
  **Drizzle ORM**.
- Renders a landing page, login page, and a dashboard (with an admin user
  panel).

### Web-based FL Demo (`web-based-fl/`)
- A standalone Next.js page that runs the detector and corrector models fully
  **in the browser** with `onnxruntime-web`.
- Can switch between local ONNX inference and the remote Grammar API.
- Triggers a federated-learning round (`POST /fl/start`) after every 50
  predictions.

### Grammar API (hosted)
- A Hugging Face Space at `https://pujan-dev-ioe-purwanchal.hf.space`.
- Word-level `/detect` and `/correct`; federated-learning endpoints under
  `/fl/*`.

## Key Data Flows

### 1. Suggestion flow (extension)

```
user types
   │
   ▼
content script (controller.ts)
   │  getSnapshot + getWordContext (editable.ts)
   │  detect language (Devanagari vs Latin)
   ▼
debounce 500ms → updateSuggestions()
   ├─ predictCurrentWord()  → /detect → (if wrong) /correct   [live caret word]
   └─ checkTextCorrections() → /detect (unique words) → /correct (wrong ones)
   │
   ▼
merge + dedupe + slice(0,6)
   ▼
renderSuggestions() popover (popover.ts) positioned via caret.ts
   ▼
accept (click / Tab / ArrowRight)
   ├─ applySuggestionToEditable() (insertion.ts)
   ├─ trackPrediction()/trackCorrection() (stats.ts)
   └─ saveSample() (storage.ts, IndexedDB)
```

### 2. Authentication flow

```
extension popup "Login"
   │  loginWithWebsite() (auth.ts)
   ▼
opens website /login?source=extension&redirect_uri=<callback>
   │  user signs in (better-auth, email/password)
   ▼
LoginPage detects source=extension → /api/extension/auth-callback
   │  auth.api.getToken() → JWT
   ▼
redirect chrome-extension://<CHROME_EXTENSION_ID>/tabs/auth-callback.html?token=JWT
   │  auth-callback.tsx → saveToken()
   ▼
verifyAuthSession() → GET /api/extension/me (Bearer JWT) → user
   ▼
session stored in chrome.storage.local (pragyaLekhAuthSession)
```

For local development, setting `PLASMO_PUBLIC_DEV_AUTH_TOKEN` lets the popup
verify and store a JWT directly without opening the website.

### 3. Stats reporting

```
trackPrediction / trackCorrection / trackError (stats.ts)
   │  batched in memory, flushed every 30s
   ▼
authenticatedFetch POST /api/extension/stats  (Authorization: Bearer JWT)
   ▼
route verifies JWT (sub = userId) → upsert usage_stats row (Drizzle/PG)
   ▼
dashboard reads usage_stats (server actions)
```

### 4. Federated learning (extension client)

```
FLClient.runRound(n)
   ├─ initializeRound(n)  → downloadWeights(n-1) or initDefaultWeights()
   ├─ train()             → local samples + detections; (simulated gradients)
   ├─ uploadWeights()     → POST /fl/round/n/upload-weights (FormData weights.npz)
   └─ waitForAggregation()→ poll /fl/round/n/progress → POST /fl/round/n/aggregate
                            → downloadWeights(n)  (new global model)
```

See [07 — Federated Learning](./07-federated-learning.md) for details and
caveats.

## Cross-Cutting Concerns

- **CORS:** The web client attaches permissive CORS headers to all `/api/*`
  responses (see `client/middleware.ts`) so the extension and demo can call it.
- **CSP / WASM:** The extension declares `wasm-unsafe-eval` and runs ORT in a
  worker loaded from the extension origin to keep WASM off the host page CSP.
- **Caching:** The detector model is cached in IndexedDB (extension) and ONNX
  sessions/tokenizers are cached in memory (web demo).
- **Timeouts:** Grammar API calls time out at 8s (extension); FL requests at 30s.

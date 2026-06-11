# Pragya Lekh (प्रज्ञा लेख)

> A privacy-first Nepali writing assistant — real-time spelling/grammar detection
> and correction, powered by on-device inference and federated learning.

Built for **IIC Quest 4.0** at **IOE Purwanchal Campus**.

---

## Overview

Pragya Lekh helps people write better Nepali. As you type in any text field on
the web, the browser extension detects misspelled or incorrect words and offers
ranked correction suggestions in an inline popover. Inference runs **on-device**
using an ONNX model, and improvements to the model are learned collaboratively
through **federated learning** — so the model gets smarter without anyone's raw
text ever leaving their browser.

The project is made up of three cooperating parts plus a hosted grammar API:

1. **Browser Extension** — the user-facing writing assistant (Chrome & Firefox).
2. **Web Client** — landing page, authentication, dashboard, and usage stats.
3. **Web-based FL** — a browser demo of federated learning with ONNX runtime.
4. **Grammar API** — a hosted service exposing `/detect` and `/correct`
   endpoints (deployed on a Hugging Face Space).

---

## Features

- **Real-time Nepali detection & correction** in any editable field on the web.
- **On-device inference** via `onnxruntime-web` running inside a dedicated
  Web Worker (keeps the model and WASM backend off the host page and out of its
  CSP).
- **Inline suggestion popover** with ranked correction candidates.
- **Federated learning client** that trains locally on cached samples and
  uploads only model weight updates to the FL server for aggregation.
- **Authentication & accounts** through the web client, with JWT-based sign-in
  for the extension.
- **Usage analytics** (predictions, corrections, errors detected) surfaced in a
  dashboard, with free / pro / max service tiers.
- **Local-first storage** using IndexedDB for cached models and training
  samples.

---

## Architecture

```
        ┌──────────────────────┐        detect / correct        ┌─────────────────────┐
        │   Browser Extension   │  ───────────────────────────▶ │     Grammar API      │
        │  (Plasmo + React +    │ ◀─────────────────────────── │  (Hugging Face Space)│
        │   onnxruntime-web)    │     suggestions / labels       └─────────────────────┘
        └──────────┬───────────┘
                   │  auth (JWT)            weight updates / aggregation
                   ▼                                   │
        ┌──────────────────────┐                       ▼
        │      Web Client       │            ┌─────────────────────┐
        │  (Next.js + better-   │            │     FL Server        │
        │   auth + Drizzle/PG)  │            │ (aggregates rounds)  │
        └──────────────────────┘            └─────────────────────┘
```

- The extension performs **word-level** detection and correction against the
  Grammar API and runs an **ONNX detector** locally for fast predictions.
- The **FL client** (`extension/lib/fl-client.ts`) initializes per-round
  weights, trains on locally cached samples, uploads weight tensors, and waits
  for server-side aggregation before downloading the new global model.
- The **web client** issues JWTs that the extension exchanges to authenticate
  API calls and report usage stats.

---

## Tech Stack

| Area              | Technology                                                        |
| ----------------- | ----------------------------------------------------------------- |
| Extension         | Plasmo, React 18, TypeScript, Tailwind CSS, onnxruntime-web, idb  |
| Web client        | Next.js 16, React 19, better-auth, Drizzle ORM, PostgreSQL        |
| Web-based FL demo | Next.js 16, React 19, onnxruntime-web                             |
| Styling           | Tailwind CSS, shadcn/ui, lucide-react                            |
| Package manager   | pnpm                                                              |
| ML / Inference    | ONNX Runtime (WASM, multi-threaded), federated learning           |
| Grammar API       | Hosted Hugging Face Space (`/detect`, `/correct`)                 |

---

## Folder Structure

```
ioe_purwanchal_campus_iicquest4.0/
├── README.md                  # This file
├── demo.html                  # Standalone Nepali textarea demo page
│
├── extension/                 # Pragya Lekh browser extension (Plasmo, MV3)
│   ├── popup.tsx              # Extension popup UI
│   ├── options.tsx           # Settings / options page
│   ├── content.ts            # Content-script entrypoint
│   ├── manifest.json         # MV3 manifest
│   ├── features/
│   │   └── content-script/   # Core in-page logic
│   │       ├── controller.ts     # Orchestrates detect/correct lifecycle
│   │       ├── editable.ts       # Detects editable fields
│   │       ├── prediction.ts     # Prediction flow
│   │       ├── prediction-api.ts # Calls prediction backend
│   │       ├── correction.ts     # Correction flow
│   │       ├── popover.ts        # Inline suggestion popover
│   │       ├── insertion.ts      # Inserts accepted suggestions
│   │       ├── caret.ts          # Caret position tracking
│   │       ├── debouncer.ts      # Input debouncing
│   │       ├── dictionaries.ts   # Local dictionaries
│   │       ├── constants.ts
│   │       └── types.ts
│   ├── lib/
│   │   ├── onnx.ts           # ONNX worker, model caching (IndexedDB)
│   │   ├── fl-client.ts      # Federated learning client (rounds, upload)
│   │   ├── flower.ts         # Flower-style client update helper
│   │   ├── grammar-api.ts    # /detect & /correct API client
│   │   ├── auth.ts           # Extension auth (JWT) helpers
│   │   ├── storage.ts        # IndexedDB sample/detection storage
│   │   ├── stats.ts          # Usage stats reporting
│   │   └── settings.ts       # Shared settings storage
│   ├── tabs/
│   │   └── auth-callback.tsx # Receives JWT after website login
│   ├── assets/               # Icons, ONNX model & WASM runtime, worker
│   └── components/           # Shared UI components
│
├── client/                    # Web client (Next.js) — auth, dashboard, stats
│   ├── app/
│   │   ├── page.tsx          # Home / landing
│   │   ├── login/            # Login page
│   │   ├── dashboard/        # User dashboard
│   │   ├── demo/             # Demo route
│   │   └── api/
│   │       ├── auth/[...all] # better-auth handler
│   │       └── extension/    # Extension endpoints (me, stats, auth-callback)
│   ├── components/           # Dashboard, LoginPage, HomePage, ui/
│   ├── actions/              # Server actions (users, stats)
│   ├── db/                   # Drizzle schema & client
│   ├── drizzle/              # SQL migrations & metadata
│   ├── lib/                  # auth, auth-client, types, utils
│   └── middleware.ts         # Route middleware
│
└── web-based-fl/              # Browser-based federated learning demo (Next.js)
    ├── app/                  # Demo UI (page, layout, styles)
    ├── lib/
    │   ├── api/              # Grammar API client
    │   └── onnx/             # In-browser ONNX inference
    └── public/model/         # ONNX model assets
```

---

## Getting Started

Each module is a standalone package managed with **pnpm**.

### Browser Extension

```bash
cd extension
pnpm install
pnpm dev            # Chrome MV3 dev build
# pnpm dev:firefox  # Firefox MV3 dev build
```

Load `build/chrome-mv3-dev` from `chrome://extensions` with developer mode
enabled. Production builds: `pnpm build` (Chrome) / `pnpm build:firefox`, then
`pnpm package` to create a store bundle.

### Web Client

```bash
cd client
pnpm install
pnpm dev            # http://localhost:3000
```

Configure the database and auth secrets in `client/.env`, then run Drizzle
migrations as needed.

### Web-based FL Demo

```bash
cd web-based-fl
pnpm install
pnpm dev
```

---

## Configuration

Key environment variables (extension):

| Variable                          | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `PLASMO_PUBLIC_GRAMMAR_API_URL`   | Base URL for the grammar `/detect` & `/correct` API |
| `PLASMO_PUBLIC_FL_SERVER_URL`     | Federated learning server URL            |
| `PLASMO_PUBLIC_AUTH_LOGIN_URL`    | Website login URL                        |
| `PLASMO_PUBLIC_AUTH_ME_URL`       | Session verification endpoint            |
| `PLASMO_PUBLIC_DEV_AUTH_TOKEN`    | Dev-only JWT for local auth              |

---

## Built With AI Assistance

This project was developed with the help of AI coding agents:

- **OpenAI Codex** — used during development for code generation, refactoring,
  and iteration.
- **Anthropic Claude** — used during development for design discussion,
  implementation, debugging, and documentation.

All AI-generated code was reviewed and integrated by the team.

---

## Team

> **Team Name:** _IOE PURWANCHAL CAMPUS_

**Members:**

- **Sandip Sapkota** 
- **Sujal Karki** 
- **Pujan Neupane**
- **Raghav Upadhyay** 


---

## Acknowledgements

- **IOE Purwanchal Campus** and the **IIC Quest 4.0** organizers.
- Open-source tools that made this possible: Plasmo, Next.js, ONNX Runtime,
  Drizzle ORM, better-auth, and Tailwind CSS.

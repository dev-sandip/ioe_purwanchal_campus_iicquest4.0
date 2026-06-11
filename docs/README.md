# Pragya Lekh — Project Documentation

> A privacy-first Nepali writing assistant: real-time spelling detection and
> correction powered by on-device ONNX inference, with collaborative model
> improvement through federated learning.

Built for **IIC Quest 4.0** at **Itahari International College** by team
**IOE Purwanchal Campus**.

This `docs/` folder is the full technical documentation for the project. Start
with the overview, then dive into the module you care about.

## Table of Contents

| Doc | What it covers |
| --- | --- |
| [01 — Overview](./01-overview.md) | Product summary, goals, feature list, glossary |
| [02 — Architecture](./02-architecture.md) | How the four parts fit together, data & auth flows |
| [03 — Browser Extension](./03-extension.md) | Plasmo MV3 extension internals, content script, popup |
| [04 — Web Client](./04-web-client.md) | Next.js app: auth, dashboard, API routes, database |
| [05 — Web-based FL Demo](./05-web-based-fl.md) | In-browser ONNX spell checker + FL trigger demo |
| [06 — Grammar API](./06-grammar-api.md) | The hosted `/detect`, `/correct`, `/fl/*` endpoints |
| [07 — Federated Learning](./07-federated-learning.md) | FL client lifecycle, weight upload, aggregation |
| [08 — Setup & Development](./08-setup.md) | Installing, running, and building each module |
| [09 — Configuration](./09-configuration.md) | Environment variables and config reference |
| [10 — Data & Storage](./10-data-and-storage.md) | IndexedDB, chrome.storage, PostgreSQL schema |

## Repository Layout

```
ioe_purwanchal_campus_iicquest4.0/
├── README.md            # Top-level project README
├── demo.html            # Standalone Nepali textarea demo page
├── docs/                # ← You are here
├── extension/           # Browser extension (Plasmo, MV3)
├── client/              # Web client (Next.js: auth, dashboard, stats)
└── web-based-fl/        # Browser-based federated-learning demo (Next.js)
```

## The Four Parts at a Glance

1. **Browser Extension** (`extension/`) — the user-facing writing assistant for
   Chrome and Firefox. Detects and corrects Nepali words inline in any editable
   field, runs an on-device ONNX detector, and hosts a federated-learning client.
2. **Web Client** (`client/`) — landing page, email/password authentication
   (better-auth), JWT issuance for the extension, and a usage dashboard with
   admin controls.
3. **Web-based FL Demo** (`web-based-fl/`) — a standalone Next.js page that runs
   the detector and corrector models fully in-browser with `onnxruntime-web`,
   and triggers a federated-learning round periodically.
4. **Grammar API** — a hosted Hugging Face Space exposing word-level
   `/detect` and `/correct` endpoints plus federated-learning round endpoints.

## Tech Stack Summary

| Area | Technology |
| --- | --- |
| Extension | Plasmo 0.90, React 18, TypeScript, Tailwind CSS, onnxruntime-web 1.26, idb |
| Web client | Next.js 16, React 19, better-auth, Drizzle ORM, PostgreSQL (pg) |
| Web-based FL demo | Next.js 16, React 19, onnxruntime-web 1.26 |
| ML / inference | ONNX Runtime (WASM backend), char-level tokenizers |
| Styling | Tailwind CSS, shadcn/ui, lucide-react |
| Package manager | pnpm |

> Note: This documentation describes behavior observed in the source code as of
> the IIC Quest 4.0 submission. Where a feature is a demo/simulation rather than
> a production implementation (e.g. the extension's simulated FL training), the
> docs say so explicitly.

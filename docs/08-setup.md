# 08 — Setup & Development

Each module is a standalone package managed with **pnpm**. Install and run them
independently.

## Prerequisites

- **Node.js** 20+ (the packages target `@types/node` 20).
- **pnpm** (the repo uses pnpm workspaces per module and `pnpm-lock.yaml`).
- **PostgreSQL** (for the web client only).
- A Chromium-based browser and/or Firefox (for the extension).

## Browser Extension

```bash
cd extension
pnpm install        # also runs postinstall: copies ORT *.wasm / *.mjs into assets/
pnpm dev            # Chrome MV3 dev build
# pnpm dev:firefox  # Firefox MV3 dev build
```

Load the unpacked build:
- **Chrome:** open `chrome://extensions`, enable Developer Mode, "Load
  unpacked", select `extension/build/chrome-mv3-dev`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, "Load Temporary
  Add-on", select the manifest in `extension/build/firefox-mv3-dev`.

Production builds and packaging:
```bash
pnpm build          # Chrome
pnpm build:firefox  # Firefox
pnpm package        # Create a store bundle
```

Checks:
```bash
pnpm typecheck
pnpm format:check
```

Configure the extension `.env` (see [09 — Configuration](./09-configuration.md)).
For local auth without the website, set `PLASMO_PUBLIC_DEV_AUTH_TOKEN` to a
valid JWT.

## Web Client

```bash
cd client
pnpm install
# create .env with DATABASE_URL, CHROME_EXTENSION_ID, NEXT_PUBLIC_BASE_URL
pnpm dev            # http://localhost:3000
```

### Database / migrations
The schema lives in `db/schema.ts` and migrations in `drizzle/`. With Drizzle
Kit installed (`drizzle-kit` is a dev dependency), typical commands are:

```bash
pnpm exec drizzle-kit generate   # generate SQL from schema changes
pnpm exec drizzle-kit migrate    # apply migrations
# or push the schema directly during development:
pnpm exec drizzle-kit push
```

`drizzle.config.ts` reads `DATABASE_URL` (via `dotenv/config`) and targets
PostgreSQL, writing migrations to `./drizzle`.

Production:
```bash
pnpm build
pnpm start
```

### Connecting the extension to a local web client
1. Run the web client on `http://localhost:3000` (already in the extension's
   host permissions).
2. Set `CHROME_EXTENSION_ID` in the web client `.env` to your unpacked
   extension's ID (from `chrome://extensions`).
3. Point the extension's `PLASMO_PUBLIC_AUTH_LOGIN_URL` and
   `PLASMO_PUBLIC_AUTH_ME_URL` at the local client if you want to test the full
   login handoff, or just use `PLASMO_PUBLIC_DEV_AUTH_TOKEN`.

## Web-based FL Demo

```bash
cd web-based-fl
pnpm install
pnpm dev            # Next.js dev server
```

No environment configuration is required: the models are served from
`public/model/`, ORT's WASM binaries load from a CDN, and the Grammar API base
URL is built in. Open the page and type Nepali text.

> If you run both the web client and this demo locally, note both default to
> Next.js port 3000 — run one on a different port (e.g.
> `pnpm dev --port 3001`).

## Standalone Demo Page

`demo.html` at the repo root is a zero-dependency Nepali textarea you can open
directly in a browser to exercise the installed extension.

## Verifying a Change

- **Extension:** `pnpm typecheck` and reload the unpacked build; watch the
  page/service-worker console for `[Pragya]`, `[ONNX]`, `[Stats]`, and
  `[FLClient]` logs.
- **Web client:** `pnpm lint` and `pnpm build`.
- **Web demo:** `pnpm lint` and `pnpm build`.

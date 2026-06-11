# 09 — Configuration

Environment variables and configuration for each module.

## Extension (`extension/.env`)

Plasmo exposes variables prefixed with `PLASMO_PUBLIC_` to the bundle.

| Variable | Default (in code) | Purpose |
| --- | --- | --- |
| `PLASMO_PUBLIC_GRAMMAR_API_URL` | `https://pujan-dev-ioe-purwanchal.hf.space` | Base URL for `/detect` and `/correct` |
| `PLASMO_PUBLIC_FL_SERVER_URL` | `http://localhost:8000` | Federated-learning server (`FLClient`) |
| `PLASMO_PUBLIC_AUTH_LOGIN_URL` | Vercel app `/login` | Website login URL opened by the popup |
| `PLASMO_PUBLIC_AUTH_ME_URL` | Vercel app `/api/extension/me` | Session verification endpoint |
| `PLASMO_PUBLIC_AUTH_EXCHANGE_URL` | Vercel app `/api/auth/extension/exchange` | Code→session exchange endpoint (used by `exchangeCodeForSession`) |
| `PLASMO_PUBLIC_DEV_AUTH_TOKEN` | _(empty)_ | Dev-only JWT; when set, the popup verifies/stores it directly instead of opening the website |
| `PLASMO_PUBLIC_BROWSER_NAME` | set by scripts | `chrome` or `firefox` (set by the dev/build scripts) |

The committed `extension/.env` sets `PLASMO_PUBLIC_AUTH_LOGIN_URL`,
`PLASMO_PUBLIC_AUTH_ME_URL`, an empty `PLASMO_PUBLIC_DEV_AUTH_TOKEN`, and
`PLASMO_PUBLIC_GRAMMAR_API_URL` to the hosted Space.

### Hardcoded fallbacks
Some URLs default to the Vercel app
(`https://ioe-purwanchal-campus-iicquest4-0.vercel.app`) when the env var is
absent — see `lib/auth.ts` (`BASE_URL`) and `lib/stats.ts` (`STATS_URL`). If you
deploy your own web client, update these env vars (and, for the hardcoded stats
base, the source) accordingly.

### Manifest configuration (`package.json` → `manifest`)
- Permissions: `storage`, `tabs`, `identity`, `offscreen`.
- CSP (extension pages): `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
- Host permissions: `localhost:3000`, the Vercel app, and the Grammar API Space.
- Web-accessible resources: `tabs/auth-callback.html`, `assets/*`.

## Web Client (`client/.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Drizzle client and Drizzle Kit) |
| `CHROME_EXTENSION_ID` | Used to build the `chrome-extension://<id>/tabs/auth-callback.html` redirect in `/api/extension/auth-callback` (500 if missing) |
| `NEXT_PUBLIC_BASE_URL` | Base URL for the better-auth React client (`lib/auth-client.ts`) |

better-auth also typically requires a secret and base URL in deployment; provide
its standard configuration via environment as needed for your hosting.

### better-auth JWT settings (code, `lib/auth.ts`)
- Audience: `pragya-lekh-browser-extension`
- Expiration: `7 days`
- Payload fields: `email`, `name`, `role`, `serviceType`, `paid`, `sessionId`

## Web-based FL Demo

No environment variables are required. Notable in-code configuration:

| Setting | Location | Value |
| --- | --- | --- |
| Grammar API base | `lib/api/client.ts` | `https://pujan-dev-ioe-purwanchal.hf.space` |
| ORT WASM CDN | `lib/onnx/session.ts` | jsDelivr `onnxruntime-web@1.26.0` |
| Detector threshold | `app/page.tsx` / `detector.ts` | `0.5` |
| Detector max len | `detector.ts` | `30` |
| Corrector encoder seq len | `correctorMvp.ts` | `100` |
| Beam width / candidates | `correctorMvp.ts` | `3` / `3` |
| Debounce | `app/page.tsx` | `600ms` |
| FL trigger cadence | `app/page.tsx` | every `50` predictions |

## Timeouts & Cadences (reference)

| Concern | Value | Where |
| --- | --- | --- |
| Suggestion debounce (extension) | 500ms | `features/content-script/controller.ts` |
| Grammar API request timeout | 8s | `lib/grammar-api.ts` |
| FL request timeout | 30s | `lib/fl-client.ts`, `lib/flower.ts` |
| Stats flush interval | 30s | `lib/stats.ts` |
| FL aggregation max wait | 60s (poll 2s) | `lib/fl-client.ts` |

## Storage Keys (reference)

| Key | Store | Purpose |
| --- | --- | --- |
| `pragyaLekhSettings` | `chrome.storage.sync` | Extension settings |
| `pragyaLekhAuthSession` | `chrome.storage.local` | Auth session (JWT + user) |
| `pragya_fl_client_id` | `localStorage` | FL client id (`fl-client.ts`) |
| `pragya_client_id` | `localStorage` | Flower client id (`flower.ts`) |
| `np_pred_count` | `localStorage` | Web-demo prediction counter |
| `theme` | `localStorage` | Web-demo theme |

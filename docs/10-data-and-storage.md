# 10 — Data & Storage

This project stores data in four places: the extension's IndexedDB, the
extension's `chrome.storage`, `localStorage` (extension + web demo), and the web
client's PostgreSQL database.

## IndexedDB (extension)

### `pragya-db` (v2) — training data (`lib/storage.ts`)
Managed with `idb`. Two object stores, both auto-incrementing `id`:

**`samples`** — accepted-suggestion training samples (`saveSample`):
```ts
{
  id, createdAt,            // added automatically
  contextWords, currentWord, previousWord, textBeforeCaret,
  language,                 // "nepali" | "english" | "unknown"
  suggestion, suggestionKind, replaceLength
}
```

**`detections`** — detected spelling errors (`saveDetection`):
```ts
{
  id, createdAt,
  word,                     // the flagged word
  suggestions: string[],    // ranked corrections
  sentence                  // the full text it appeared in
}
```

Helpers: `saveSample`, `getSamples`, `clearSamples`, `saveDetection`,
`getDetections`. These records feed the federated-learning client (see
[07 — Federated Learning](./07-federated-learning.md)). `clearSamples()` is
called after a successful FL upload.

### `pragya-lekh-db` (v1) — model cache (`lib/onnx.ts`)
A separate database with a single `models` store. The detector model buffer is
cached under key `detector_best`, so the `.onnx` file is fetched from
`assets/model/` only once.

## `chrome.storage` (extension)

| Area | Key | Contents |
| --- | --- | --- |
| `sync` | `pragyaLekhSettings` | `{ enabled, autoMarkEditableFields, showNextWordSuggestions, showCorrectionSuggestions }` |
| `local` | `pragyaLekhAuthSession` | `{ token, tokenType: "Bearer", user }` |

Settings sync across the user's browsers; the auth session is local to the
device.

## `localStorage`

| Key | Where | Purpose |
| --- | --- | --- |
| `pragya_fl_client_id` | extension (`fl-client.ts`) | Stable FL client UUID |
| `pragya_client_id` | extension (`flower.ts`) | Stable Flower client UUID |
| `np_pred_count` | web demo | Prediction counter for FL trigger |
| `theme` | web demo | `light` / `dark` |

## PostgreSQL (web client)

Defined in `client/db/schema.ts` (Drizzle), with migrations under
`client/drizzle/`. Connection via `DATABASE_URL`.

### Enums
- `user_role`: `user` | `admin`
- `service_type`: `free` | `pro` | `max`

### `user`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null |
| `email` | text | unique, not null |
| `email_verified` | boolean | default false |
| `image` | text | |
| `role` | `user_role` | default `user` |
| `service_type` | `service_type` | default `free` |
| `paid` | boolean | default false |
| `banned` | boolean | default false |
| `ban_reason` | text | |
| `ban_expires` | timestamp | |
| `created_at` / `updated_at` | timestamp | |

### `session`
`id` (PK), `expires_at`, `token` (unique), `created_at`, `updated_at`,
`ip_address`, `user_agent`, `user_id` (FK → `user`, cascade), `impersonated_by`.

### `account`
better-auth account/provider records: `id` (PK), `account_id`, `provider_id`,
`user_id` (FK → `user`, cascade), `access_token`, `refresh_token`, `id_token`,
token expiries, `scope`, `password`, timestamps.

### `verification`
`id` (PK), `identifier`, `value`, `expires_at`, timestamps. Used for email
verification / token flows.

### `jwks`
`id` (PK), `public_key`, `private_key`, `created_at`, `expires_at`. Backs JWT
signing/verification for the `jwt` plugin.

### `usage_stats`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | PK, defaults to a UUID |
| `user_id` | text | FK → `user`, cascade |
| `predictions_count` | integer | default 0 |
| `corrections_count` | integer | default 0 |
| `errors_detected` | integer | default 0 |
| `created_at` / `updated_at` | timestamp | |

Written by `POST /api/extension/stats` (upsert/increment) and read by the
dashboard via the `getUserStats` / `getAllUsersStats` server actions.

## Data Privacy Notes

- Typed text is processed in-page; only individual **words** are sent to the
  Grammar API for detect/correct.
- Local training samples live only in the browser (IndexedDB) and are cleared
  after FL upload.
- For FL, only **weights and aggregate metrics** are uploaded, not raw text.
- The web client stores account info and aggregate usage **counts** only — not
  the content the user typed.

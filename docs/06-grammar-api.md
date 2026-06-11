# 06 — Grammar API

The Grammar API is a hosted service (a **Hugging Face Space**) that provides
word-level Nepali spell detection and correction, plus federated-learning round
coordination. It is consumed by both the extension and the web-based FL demo.

- **Base URL (default):** `https://pujan-dev-ioe-purwanchal.hf.space`
- **Configurable in the extension** via `PLASMO_PUBLIC_GRAMMAR_API_URL`.
- The web demo hardcodes the same base in `lib/api/client.ts`.

> This service is hosted externally; its server source is not part of this
> repository. The contract below is reconstructed from the client code that
> calls it (`extension/lib/grammar-api.ts`, `extension/lib/fl-client.ts`, and
> `web-based-fl/lib/api/client.ts`).

## Inference Endpoints

### `POST /detect`
Detect whether a single word is spelled correctly.

Request:
```json
{ "word": "नेपालि" }
```

Response:
```json
{ "word": "नेपालि", "correct": false, "confidence": 0.87 }
```

- `correct` — boolean, whether the word is spelled correctly.
- `confidence` — number in `[0, 1]`.

### `POST /correct`
Get ranked correction candidates for a single word.

Request:
```json
{ "word": "नेपालि" }
```

Response:
```json
{
  "word": "नेपालि",
  "suggestions": [
    { "word": "नेपाली", "score": 0.95 },
    { "word": "नेपाल",  "score": 0.40 }
  ]
}
```

- `suggestions` — ranked array of `{ word, score }`. Clients drop any candidate
  equal to the input and de-duplicate while preserving rank.

> The clients deliberately use **word-level** `/detect` + `/correct` only; a
> sentence-level `/check` endpoint is intentionally not used.

## Federated-Learning Endpoints

These are used by the extension's `FLClient` (`extension/lib/fl-client.ts`) and
the web demo's trigger.

### `POST /fl/start`
Start a federated-learning run. Used by the web demo's `triggerFederatedRound`.

Request:
```json
{ "model": "detector", "rounds": 1, "clients": 2 }
```

### `GET /fl/round/{n}/weights`
Download the global weights for round `n`. The extension decodes the response
body as JSON into its `Weights` structure (per-layer `{ data, shape }`).

### `POST /fl/round/{n}/upload-weights`
Upload a client's trained weights for round `n`. Sent as `multipart/form-data`:

| Field | Description |
| --- | --- |
| `file` | Blob named `weights.npz` (JSON payload of per-layer `{ data, shape, dtype }`) |
| `client_id` | Stable per-client UUID |
| `num_samples` | Number of local training samples |
| `loss` | Local training loss |
| `accuracy` | Local training accuracy |

Response (consumed as `UploadResult`):
```json
{ "round": 1, "progress": { "round": 1, "submitted": 1, "required": 2, "ready": false } }
```

### `GET /fl/round/{n}/progress`
Poll aggregation readiness.

Response:
```json
{ "progress": { "round": 1, "submitted": 2, "required": 2, "ready": true } }
```

### `POST /fl/round/{n}/aggregate`
Trigger aggregation for round `n` (the extension calls this once `ready` is
true).

Response (consumed as `AggregationResult`):
```json
{ "metrics": { "loss": 0.31, "accuracy": 0.82 }, "is_best": true }
```

## Client Behavior Notes

- **Timeouts:** the extension's grammar client aborts after **8s**; the FL
  client aborts after **30s**.
- **Failure handling:** detection failures during full-text correction are
  treated as "correct" so a flaky request never produces false-positive
  underlines.
- **CORS:** the API must allow the extension and demo origins. (The web client's
  own `/api/*` routes set permissive CORS; the Grammar API is separate and must
  do likewise to be callable from the browser.)

## Related Docs

- [07 — Federated Learning](./07-federated-learning.md) — full client lifecycle.
- [03 — Browser Extension](./03-extension.md#api-driven-prediction--correction)
  — how `/detect` and `/correct` are used in the suggestion flow.

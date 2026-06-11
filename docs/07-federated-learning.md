# 07 — Federated Learning

Pragya Lekh demonstrates federated learning (FL): clients train locally on
cached data and upload only model **weight updates**, which the server
aggregates into a new global model. Raw user text is never uploaded for FL.

There are two FL touch points in this repo:

1. **`extension/lib/fl-client.ts`** — a full client lifecycle (`FLClient`).
2. **`extension/lib/flower.ts`** — a simpler "send local data" helper.
3. The **web demo** (`web-based-fl`) also fires `POST /fl/start` periodically.

## `FLClient` Lifecycle (`extension/lib/fl-client.ts`)

```
runRound(n):
  initializeRound(n)
    ├─ if n > 1: downloadWeights(n-1)   # GET /fl/round/{n-1}/weights
    └─ else / on failure: initDefaultWeights()
  train(epochs=1, lr=0.0003)
    ├─ read local samples + detections (IndexedDB)
    └─ update weights   # (simulated gradients — see caveat)
  uploadWeights()
    └─ POST /fl/round/{n}/upload-weights  (multipart: weights.npz + metadata)
       then clearSamples()
  waitForAggregation(maxWaitMs=60000)
    ├─ poll GET /fl/round/{n}/progress every 2s
    ├─ when ready: POST /fl/round/{n}/aggregate
    └─ downloadWeights(n)   # adopt the new global model
```

### Configuration
- **Server:** `PLASMO_PUBLIC_FL_SERVER_URL` (default `http://localhost:8000`).
- **Model type:** `detector`.
- **Request timeout:** 30s per request.
- **Client id:** a UUID persisted in `localStorage` under `pragya_fl_client_id`.

### Model weight structure (`initDefaultWeights`)
A small transformer-style detector is represented as named tensors with
Glorot-style random initialization:

| Layer | Shape |
| --- | --- |
| `embedding.weight` | `[128, 64]` |
| `transformer.0.self_attn.weight` | `[64, 64]` |
| `transformer.0.ffn.0.weight` | `[64, 256]` |
| `transformer.0.ffn.2.weight` | `[256, 64]` |
| `transformer.1.self_attn.weight` | `[64, 64]` |
| `transformer.1.ffn.0.weight` | `[64, 256]` |
| `transformer.1.ffn.2.weight` | `[256, 64]` |
| `output.weight` | `[64, 1]` |

### Upload payload
`uploadWeights()` serializes each tensor to `{ data: number[], shape, dtype:
"float32" }`, wraps it in a Blob named `weights.npz`, and posts it as
`multipart/form-data` alongside `client_id`, `num_samples`, `loss`, and
`accuracy`. Local samples are cleared after a successful upload.



## "Send Local Data" Helper (`extension/lib/flower.ts`)

The popup's **"Send Local Data"** button calls `sendToFlowerServer()`:

- Reads cached samples from IndexedDB.
- `POST http://localhost:8080/client-update` with
  `{ clientId, samples }` (JSON), 30s timeout.
- Clears samples on success.
- Uses a separate client id persisted under `localStorage` key
  `pragya_client_id`.

This is a Flower-style client-update endpoint distinct from the `/fl/round/*`
flow above. Both are present in the codebase.

## Web Demo Trigger (`web-based-fl`)

The in-browser demo counts predictions in `localStorage` (`np_pred_count`) and,
crossing each multiple of **50**, fires a fire-and-forget
`POST /fl/start { model: "detector", rounds: 1, clients: 2 }`. It does not run
the client training lifecycle itself.

## Local Training Data

The data used for FL comes from the extension's IndexedDB store
(`pragya-db`): accepted-suggestion **samples** and detected-error
**detections**. See
[10 — Data & Storage](./10-data-and-storage.md#indexeddb-extension) for the
shapes.

## Privacy Summary

- For FL, clients upload **weight tensors and aggregate metrics**, not raw text.
- Word-level detect/correct lookups do send individual words to the Grammar API;
  full documents are not bulk-uploaded.
- Local samples are cleared after they are uploaded.

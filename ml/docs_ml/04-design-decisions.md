# 04 - Design Decisions

## 1. Keep `ml/` as the Research Workspace

`ml/` keeps experiments, notebooks, generated datasets, and quick API wrapping
close together. This makes model iteration fast. The tradeoff is that notebooks
and artifacts are less clean than a production package, so the runnable backend
was separated into `../nepali_grammar_checker` and later
`../fed learniing/final_fl`.

## 2. Store Intermediate Datasets

The project keeps `clean.csv`, `right_wrong.csv`, labeled data, and token files
instead of only raw data. This was created to make training repeatable without
re-extracting every source archive each time.

Tradeoff: intermediate CSVs are large, but they make debugging and rerunning
specific notebook stages easier.

## 3. Generate Wrong Words from Correct Nepali Tokens

The right/wrong dataset is built by taking correct Nepali words and creating
synthetic wrong variants. This gives a large supervised dataset even when
manually labeled Nepali spelling-error data is limited.

Tradeoff: synthetic errors may not cover every real user mistake, so accepted
corrections and FL are useful later.

## 4. Use Character-Level Models for Detection and Correction

Nepali spelling errors often happen at character level. A char tokenizer lets
the model handle unseen words and partial word patterns better than a pure
word-vocabulary model.

The simpler `ml/api_` BiLSTM still exists because it is easy to load and test,
but the stronger backend path uses char-level transformer-style models.

## 5. Split Detection and Correction

The system first detects whether a word is wrong, then corrects only words that
look wrong.

Why:

- faster than correcting every token
- fewer unnecessary suggestions
- simpler API contract for clients
- easy to expose `/detect`, `/correct`, and `/check` separately

Tradeoff: if detection misses an error, correction will not run for that word.

## 6. Export ONNX for Browser Inference

ONNX artifacts exist so the extension and web demo can run model inference in
the browser with ONNX Runtime Web.

Why:

- lower latency for local checks
- fewer server calls
- better privacy for local inference
- easier offline or semi-offline demos

Tradeoff: browser inference requires careful model size, tokenizer compatibility,
and WASM/CSP handling.

## 7. Add FastAPI Backends

FastAPI was chosen because the API surface is small, Python-native, and easy to
connect directly to PyTorch model loading.

The simple `ml/api_` backend is for local binary checks. The sibling backends
are for full detection, correction, export, and FL operations.

## 8. Add Federated Learning

FL exists because grammar correction improves from user feedback, but raw user
writing can be private. The FL design uploads model updates and aggregate
metrics instead of centralizing writing samples.

Tradeoff: FL is more complex than normal centralized retraining. That is why the
repo contains both simulation flows and backend upload routes.

## 9. Keep Product Docs Separate from ML Docs

The main docs in `../docs` explain the complete app: extension, web client,
auth, stats, web demo, and hosted Grammar API.

This `docs_ml/` folder focuses only on the ML and FL side, then links outward
when a reader needs product integration details.

## 10. Current Recommended Reading Order

1. [`README.md`](./README.md)
2. [`01-system-architecture.md`](./01-system-architecture.md)
3. [`02-ml-pipeline.md`](./02-ml-pipeline.md)
4. [`03-federated-learning.md`](./03-federated-learning.md)
5. [`../../docs/02-architecture.md`](../../docs/02-architecture.md)
6. [`../../fed learniing/final_fl/overview.md`](../../fed%20learniing/final_fl/overview.md)

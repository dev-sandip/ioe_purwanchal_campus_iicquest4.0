# 01 - System Architecture

## Big Picture

The project is a Nepali writing assistant. The ML system detects incorrect
Nepali words, suggests corrections, can export models for browser inference,
and includes federated-learning experiments so clients can improve models
without sending raw writing data.

```text
Raw Nepali text archives
        |
        v
ml/utils + notebooks
clean, tokenize, label, train, export
        |
        +-----------------------------+
        |                             |
        v                             v
ml/api_ simple FastAPI          trained artifacts
BiLSTM word checker             .pth, tokenizer json, ONNX
        |
        v
local /predict API

Sibling production-shaped services:

extension / web demo
        |
        v
Grammar API in ../nepali_grammar_checker or ../fed learniing/final_fl
        |
        +--> /detect one word
        +--> /correct one word
        +--> /check sentence
        +--> /export model artifacts
        +--> /fl/* federated-learning routes
```

## Main Components

| Component | Path | Why it was created |
| --- | --- | --- |
| ML research workspace | `ml/` | Keeps datasets, notebooks, quick scripts, and trained artifacts together while experimenting. |
| Simple API wrapper | `ml/api_/` | Provides a minimal FastAPI service around `model/nepali_grammar_checker.pth` for quick local prediction. |
| Dataset builder | `ml/utils/build_clean_dataset.py` | Scans CSV sources, extracts text columns, normalizes whitespace, and writes `data_cleaned/clean.csv` and `clean.txt`. |
| Cleaned data | `ml/data_cleaned/` | Stores generated intermediate datasets used by notebooks and training. |
| Notebooks | `ml/notebooks/` | Records the experiment path from analysis to cleaning, tokenization, labeling, detection, correction, and ONNX export. |
| Grammar backend | `../nepali_grammar_checker/` | Turns the detector/corrector into a structured FastAPI backend with export and FL endpoints. |
| Final FL backend | `../fed learniing/final_fl/` | Contains the newer backend/FL runbook and current correction runtime path. |
| Main project docs | `../docs/` | Documents how the ML service connects to the extension, web client, and web-based FL demo. |

## Tech Stack

| Layer | Technology | Why |
| --- | --- | --- |
| Data processing | Python, pandas | Simple CSV loading, cleaning, merging, and labeling. |
| Model training | PyTorch | Flexible model definitions for LSTM, transformer, attention, and seq2seq experiments. |
| Federated learning | Flower (`flwr`) | Standard FedAvg simulation and client/server orchestration. |
| API serving | FastAPI, Pydantic, Uvicorn | Lightweight Python API around PyTorch inference and FL routes. |
| Browser/runtime export | ONNX, ONNX Runtime Web | Lets detector/corrector artifacts run outside Python, especially in browser demos/extensions. |
| Storage format | CSV, TXT, `.pth`, `.json`, `.onnx`, `.npz` | Keeps datasets inspectable and model/tokenizer artifacts portable. |

## Runtime Architecture

### Local `ml/api_` API

`ml/api_/main.py` creates a FastAPI app with:

- `GET /health` - confirms the model is loaded and reports device/vocab size.
- `POST /predict` - returns a per-token binary result.
- `POST /predict/batch` - runs the same logic for multiple texts.

The model loaded by this API is:

- checkpoint: `model/nepali_grammar_checker.pth`
- vocabulary: `model/nepali_tokenizer_vocab.json`
- architecture: BiLSTM with attention in `api_/model.py`

This API is useful for local testing and demonstration. It is simpler than the
full sibling grammar backend because it only returns binary word labels and does
not generate correction suggestions.

### Full Grammar API Shape

The fuller backend in `../nepali_grammar_checker` exposes:

- `/detect` - char-level detector for one word
- `/correct` - seq2seq correction suggestions
- `/check` - sentence-level detect plus correction
- `/export/*` - model/tokenizer downloads
- `/fl/*` and `/simulate` - federated-learning simulation or orchestration

The final FL backend in `../fed learniing/final_fl` keeps the same idea but
documents the current active correction model as the notebook-trained
`NepaliCorrectionModel` path.

## Product Integration

At product level, the browser extension and web demo call the Grammar API. The
extension can also cache local samples and participate in FL. The web client
handles user login, extension JWTs, and usage stats.

For the complete product architecture, read:

- [`../../docs/02-architecture.md`](../../docs/02-architecture.md)
- [`../../docs/06-grammar-api.md`](../../docs/06-grammar-api.md)
- [`../../docs/07-federated-learning.md`](../../docs/07-federated-learning.md)

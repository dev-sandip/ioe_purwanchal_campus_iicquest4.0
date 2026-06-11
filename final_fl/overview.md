# Project Overview

## Active Model Path

The production correction model is the notebook-trained Nepali correction model:

- Notebook: `models/nepali_correction_from_csv.ipynb`
- PyTorch weights: `models/nepali_correction_best.pth`
- Tokenizer: `models/nepali_correction_tokenizer.json`
- Config: `models/nepali_correction_config.json`
- ONNX encoder artifact: `models/nepali_correction_encoder.onnx`

The old correction checkpoint `models/seq2seq_best.pth` is no longer the default runtime model. Backend correction, FL simulation, and FL save paths now target `nepali_correction_best.pth`.

The sentence-level `/check` route still loads `models/detector_best.pth` for word detection before calling the notebook corrector. The FL paths only train/aggregate the notebook corrector.

## Runtime API

Start the FastAPI backend:

```bash
uvicorn api.main:app --reload
```

Main inference routes:

- `GET /health` - verifies detector/corrector startup status.
- `POST /detect` - checks one word with the detector.
- `POST /correct` - returns top correction suggestions from `NepaliCorrectionModel`.
- `POST /check` - detects wrong words in a sentence, then corrects them.
- `GET /export/corrector` - downloads `models/nepali_correction_best.pth`.
- `GET /export/tokenizers` - downloads detector and notebook corrector tokenizers.

## Federated Learning Routes

The backend exposes two FL surfaces:

- `POST /fl/start` - starts local Flower simulation in a background task. Use `{"model": "corrector", "rounds": 10, "clients": 3}`. `both` is accepted as an alias for corrector-only training.
- `GET /fl/status` - returns the current background FL status.
- `POST /fl/reload` - reloads model files after external training.
- `POST /fl/initialize` - initializes browser/client-upload FL for the notebook corrector.
- `POST /fl/round/{n}/upload` - uploads client `.npz` weights.
- `POST /fl/round/{n}/aggregate` - performs weighted FedAvg.
- `GET /fl/weights/latest` - downloads the latest/best `.npz` weights.
- `GET /fl/model/corrector/onnx` - downloads the exported corrector ONNX model.
- `POST /simulation/start` - starts `new_fl` local backend simulation from the bridge API.
- `POST /simulation/stop` - requests stop for a running or continuous simulation.
- `GET /simulation/status` - returns live simulation status and metrics.

## Flower CLI

Start the notebook corrector FL server:

```bash
python main.py server --port 8080 --rounds 10 --min-clients 2
```

Start clients:

```bash
python main.py client --server localhost:8080 --client-id 0
python main.py client --server localhost:8080 --client-id 1
```

Run a local simulation without separate client processes:

```bash
python new_fl/simulate.py --model corrector --rounds 5 --clients 3
python new_fl/main.py simulate --rounds 1 --clients 3 --continuous --delay 10
```

Defaults:

- CSV data: `data/right_wrong.csv`
- Tokenizer: `models/nepali_correction_tokenizer.json`
- Model architecture: `NepaliCorrectionModel(embed_dim=64, hidden_dim=128, num_layers=2, max_len=100)`

## Important Implementation Files

- `core/models.py` - detector, legacy seq2seq class, and notebook `NepaliCorrectionModel`.
- `core/inference.py` - beam search compatible with the notebook corrector.
- `api/dependencies.py` - runtime model/tokenizer loading and cache reloads.
- `api/routes/fl.py` - background FL simulation route.
- `api/another_fl/fl_routes.py` - browser/client-upload FL routes.
- `new_fl/server.py` - Flower server for notebook corrector aggregation.
- `new_fl/client.py` - Flower client for notebook corrector local training.
- `new_fl/simulate.py` - local backend Flower simulation with fixed or continuous mode.
- `fl/simulate.py` - local Flower simulation used by `/fl/start`.

## Notes

The current shell environment must have `torch`, `flwr`, `fastapi`, `uvicorn`, `pandas`, `numpy`, and `scikit-learn` installed before model loading or FL runs can be executed. Install them with:

```bash
pip install -r requirements.txt
```

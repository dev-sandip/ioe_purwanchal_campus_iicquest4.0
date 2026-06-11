# 03 - Federated Learning

## Why Federated Learning Exists

Federated learning was added so the writing assistant can improve from user
behavior without centralizing raw user text. Clients train or prepare updates
locally, upload weights or metrics, and the server aggregates those updates into
a better global model.

In this project, FL exists in three related forms:

| Place | Purpose |
| --- | --- |
| `ml/notebooks/7_Detection_best.ipynb` and FL notebooks | Research and proof-of-concept training experiments. |
| `../nepali_grammar_checker/fl/` | Flower-based simulation for detector and legacy corrector models. |
| `../fed learniing/final_fl/` | Final backend/FL implementation, including newer correction model paths and browser/client upload routes. |

## Flower Simulation Flow

The backend simulation uses Flower FedAvg:

```text
load right_wrong.csv
        |
        v
build detector or correction dataset
        |
        v
split data into N client partitions
        |
        v
each client trains locally for configured epochs
        |
        v
server aggregates weights with FedAvg
        |
        v
save round checkpoints and best model
```

In `../nepali_grammar_checker/fl/simulate.py`, the commands are:

```bash
python -m fl.simulate --model detector --rounds 10 --clients 3
python -m fl.simulate --model corrector --rounds 10 --clients 3
python -m fl.simulate --model both --rounds 10 --clients 3
```

The strategy in `../nepali_grammar_checker/fl/strategy.py` saves:

- `models/checkpoints/{model}_round_{n}.npz`
- `models/checkpoints/{model}_best.npz`
- best PyTorch checkpoint back into `models/detector_best.pth` or
  `models/seq2seq_best.pth`

## Final FL Backend

The final backend in `../fed learniing/final_fl` documents the active runtime
path:

- current correction checkpoint: `models/nepali_correction_best.pth`
- tokenizer: `models/nepali_correction_tokenizer.json`
- config: `models/nepali_correction_config.json`
- ONNX encoder: `models/nepali_correction_encoder.onnx`

Important routes include:

```text
POST /fl/start
GET  /fl/status
POST /fl/reload
POST /fl/initialize
POST /fl/round/{n}/upload
POST /fl/round/{n}/aggregate
GET  /fl/weights/latest
GET  /fl/model/corrector/onnx
```

Read the detailed runbook here:

- [`../../fed learniing/final_fl/overview.md`](../../fed%20learniing/final_fl/overview.md)
- [`../../fed learniing/final_fl/fl_docs.md`](../../fed%20learniing/final_fl/fl_docs.md)

## Browser/Product FL Flow

The product-level docs describe an extension client that:

1. Stores local accepted corrections and detections in browser storage.
2. Downloads or initializes model weights for a round.
3. Trains or simulates local updates.
4. Uploads weight tensors and metrics.
5. Waits for the server to aggregate a new global model.
6. Downloads the aggregated weights.

See:

- [`../../docs/07-federated-learning.md`](../../docs/07-federated-learning.md)
- [`../../docs/10-data-and-storage.md`](../../docs/10-data-and-storage.md)

## Design Goal

The FL design tries to balance:

- privacy: avoid sending raw writing samples for FL aggregation
- practicality: keep local training small enough for client machines
- demo value: support local simulations for judging/testing
- model freshness: let the backend save best aggregated checkpoints

## Current Caveats

- Some browser-side FL code is a demo/simulation path rather than full
  production-grade local gradient training.
- There are multiple FL surfaces because the project evolved from notebooks to
  backend simulations to the final FL backend.
- The newest correction runtime is documented in `final_fl/overview.md`; older
  files may still mention `seq2seq_best.pth`.
- Data splits in local simulation are IID-style for simplicity, which is easier
  to test but less realistic than real user distributions.

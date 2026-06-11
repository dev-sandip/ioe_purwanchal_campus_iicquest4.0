# ML Documentation

This folder explains the ML side of the Nepali grammar checker project in a
simple way: what exists, why it exists, how the model pipeline works, how
federated learning fits in, and where to read deeper docs.

## Start Here

| Doc | Purpose |
| --- | --- |
| [01 - System Architecture](./01-system-architecture.md) | How `ml`, the grammar checker backend, FL backend, extension, and web apps fit together. |
| [02 - ML Pipeline](./02-ml-pipeline.md) | Dataset flow, notebooks, model artifacts, API wrapper, and inference behavior. |
| [03 - Federated Learning](./03-federated-learning.md) | Why FL exists, the Flower simulation flow, browser/client upload flow, and current caveats. |
| [04 - Design Decisions](./04-design-decisions.md) | Important choices made in data, model, API, ONNX, and FL design. |

## Related Documentation

These docs connect this `ml/` folder with the rest of the repository:

| Location | Why it exists |
| --- | --- |
| [`../docs/README.md`](../../docs/README.md) | Main project documentation index for Pragya Lekh. |
| [`../docs/02-architecture.md`](../../docs/02-architecture.md) | Full product architecture across extension, web client, web FL demo, and Grammar API. |
| [`../docs/06-grammar-api.md`](../../docs/06-grammar-api.md) | API contract used by the extension and web demo. |
| [`../docs/07-federated-learning.md`](../../docs/07-federated-learning.md) | Product-level FL flow from the browser clients. |
| [`../nepali_grammar_checker/README.md`](../../nepali_grammar_checker/README.md) | Backend run commands and endpoint list for the grammar checker service. |
| [`../nepali_grammar_checker/fl_docs.md`](../../nepali_grammar_checker/fl_docs.md) | Backend FL details for the grammar checker service. |
| [`../nepali_grammar_checker/onnx_docs.md`](../../nepali_grammar_checker/onnx_docs.md) | ONNX export notes for browser/runtime inference. |
| [`../fed learniing/final_fl/overview.md`](../../fed%20learniing/final_fl/overview.md) | Current final FL/backend runbook and active model paths. |
| [`../fed learniing/final_fl/final_docs.md`](../../fed%20learniing/final_fl/final_docs.md) | Broader final backend documentation. |
| [`../fed learniing/final_fl/fl_docs.md`](../../fed%20learniing/final_fl/fl_docs.md) | Federated learning docs for the final FL implementation. |

## Folder Purpose

`ml/` is the research and model-building workspace. It contains:

- raw compressed Nepali text sources in `data/`
- cleaned and labeled datasets in `data_cleaned/`
- notebooks that show the dataset, detection, correction, FL, and ONNX path
- a small FastAPI inference wrapper in `api_/`
- trained checkpoints and tokenizers in `model/` and `notebooks/`
- helper scripts in `utils/`

The sibling folders `../nepali_grammar_checker` and `../fed learniing/final_fl`
are more backend-shaped versions of the same idea. They package the detector,
corrector, routes, exports, and federated-learning flows into runnable services.

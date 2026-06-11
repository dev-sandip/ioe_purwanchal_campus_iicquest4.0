# 02 - ML Pipeline

## Pipeline Summary

```text
data/*.zip
  |
  v
utils/build_clean_dataset.py
  |
  v
data_cleaned/clean.csv + clean.txt
  |
  v
notebooks/0..6
analysis, merge, clean, tokenize, create wrong words, label, deduplicate
  |
  v
data_cleaned/right_wrong.csv + labeled datasets
  |
  v
notebooks/7..9
train detector, train corrector, convert to ONNX
  |
  v
.pth checkpoints + tokenizer json + ONNX artifacts
  |
  v
FastAPI / browser ONNX / FL experiments
```

## Data Files

| File | Rows | Purpose |
| --- | ---: | --- |
| `data_cleaned/clean.csv` | 744,150 | Clean text with source file path. |
| `data_cleaned/clean.txt` | 744,150 | Same cleaned text as plain lines. |
| `data_cleaned/combined.csv` | 1,488,300 | Merged text dataset. |
| `data_cleaned/cleaned_data.csv` | 1,488,300 | Cleaned text-only dataset. |
| `data_cleaned/tokens.csv` | 2,376,763 | Token list used to build word examples. |
| `data_cleaned/right_wrong.csv` | 2,376,764 | Word pairs with `Right` and generated `Wrong`. |
| `data_cleaned/labeled.csv` | 4,753,528 | Balanced word/label dataset before later filtering. |
| `data_cleaned/cleaned_labeled.csv` | 4,626,415 | Cleaned labeled dataset. |
| `data_cleaned/labeledafterdroping.csv` | 1,472,996 | Deduplicated/filtered labeled dataset. |

The large `.zip` files in `data/` are raw source archives from Nepali text/news
sources. They are kept compressed because they are source material, not the
final training table.

## Notebook Map

| Notebook | Why it exists |
| --- | --- |
| `0_data_analysis.ipynb` | Inspects `clean.csv`, removes source-only columns, and explores the text corpus. |
| `1_Merging.ipynb` | Combines cleaned data sources into a larger training corpus. |
| `2_cleaning.ipynb` | Applies text cleaning and normalization rules. |
| `3_tokenization.ipynb` | Converts cleaned text into token-level data. |
| `4_right_wrong.ipynb` | Creates synthetic wrong words from correct tokens. |
| `5_labeling.ipynb` | Converts right/wrong pairs into labeled examples. |
| `6_dropingduplicate.ipynb` | Removes duplicate/noisy labeled examples. |
| `7_Detection_best.ipynb` | Trains the detector model and includes FL-oriented detector experiments. |
| `8_nepali_correction_from_csv.ipynb` | Trains the correction model from CSV word pairs. |
| `9_onnxconvert.ipynb` | Converts PyTorch checkpoints to ONNX for browser/runtime use. |
| `Nepali_Grammar_Checker_WORKING.ipynb` | Production-style inference notebook that defines tokenizers/models and handles checkpoint loading. |
| `Nepali_Grammar_Checker_FIXED2.ipynb` | Fixed FL notebook for detector and seq2seq correction experiments. |

Duplicated notebook names without numeric prefixes appear to be earlier or
alternate copies. The numeric `0_` to `9_` notebooks are the clearest pipeline.

## Model Families

### Simple `ml/api_` BiLSTM Checker

The local API uses `api_/model.py`:

- word/token vocabulary loaded from JSON
- embedding layer
- 2-layer bidirectional LSTM
- attention pooling over sequence positions
- small feed-forward classifier
- sigmoid output as probability

`api_/service.py` currently predicts each whitespace token independently by
encoding only that token, padding/truncating to `MAX_LEN = 20`, and returning
`1` when probability is greater than `0.5`.

### Full Char-Level Detector

The sibling backend uses `CharTransformerDetector`:

- character tokenizer
- character and position embeddings
- transformer encoder
- masked mean pooling
- sigmoid classifier

This is better for Nepali spelling because many errors are character-level and
the model can reason over subword shapes rather than relying only on whole-word
vocabulary matches.

### Correction Models

The correction path has two generations:

- legacy `Seq2SeqCorrector`: transformer encoder + LSTM decoder + Bahdanau
  attention
- newer notebook-trained `NepaliCorrectionModel` in the final FL backend,
  documented in `../../fed learniing/final_fl/overview.md`

The correction API returns ranked suggestions. Sentence checking first detects
wrong words, then corrects only those words.

## Important Artifacts

| Artifact | Why it exists |
| --- | --- |
| `model/nepali_grammar_checker.pth` | Checkpoint used by the simple `ml/api_` service. |
| `notebooks/detector_best.pth` | PyTorch checkpoint for the char-level detector. |
| `notebooks/detector_best.onnx` | ONNX export for browser or runtime inference. |
| `notebooks/detect_char_tokenizer.json` | Character tokenizer for the detector. |
| `notebooks/seq2seq_char_tokenizer.json` | Character tokenizer for seq2seq correction. |
| `notebooks/nepali_tokenizer_vocab.json` | Word/token vocabulary for the older grammar checker path. |
| `notebooks/seq2seq_best copy.pth` | Saved correction checkpoint copy from experiments. |

## Running the Simple API

From repository root, make sure Python dependencies such as `fastapi`, `uvicorn`,
and `torch` are installed, then run:

```bash
uvicorn ml.api_.main:app --reload
```

Expected endpoints:

```text
GET  /health
POST /predict
POST /predict/batch
```

Example request:

```json
{ "text": "नेपालि भाषा" }
```

Example response shape:

```json
{ "नेपालि": 0, "भाषा": 1 }
```

## Known Limitations

- The simple `ml/api_` service does not return correction suggestions.
- Tokenization is whitespace-based in `api_/service.py`.
- The local API expects `model/nepali_tokenizer_vocab.json`, but the current
  artifact list shows that vocab under `notebooks/`; copy or symlink it into
  `model/` before running this exact API path.
- Notebook paths contain some absolute paths from the original development
  machine, so rerunning notebooks may require path cleanup.

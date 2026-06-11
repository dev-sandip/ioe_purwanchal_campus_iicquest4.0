# Nepali Grammar Checker — Backend

## Setup

```bash
pip install -r requirements.txt
```

Place your files in:
```
data/right_wrong.csv
data/detect_char_tokenizer.json
data/seq2seq_char_tokenizer.json
models/detector_best.pth
models/seq2seq_best.pth
```

## Run API

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Docs at: http://localhost:8000/docs

## Run FL Simulation

```bash
# Both models, 10 rounds, 3 clients
python -m fl.simulate --model both --rounds 10 --clients 3

# Detector only
python -m fl.simulate --model detector --rounds 10 --clients 3
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/health` | Model status |
| POST | `/detect` | Detect if a word is wrong |
| POST | `/correct` | Get top-3 corrections for a word |
| POST | `/check` | Check and correct a full sentence |
| GET  | `/export/detector` | Download detector .pth |
| GET  | `/export/corrector` | Download corrector .pth |
| GET  | `/export/tokenizers` | Download tokenizers .zip |
| GET  | `/export/rounds` | List FL round checkpoints |
| GET  | `/export/rounds/{model}/{round}` | Download specific round weights |
| POST | `/simulate` | Start `fl.simulate` in the background |
| POST | `/fl/start` | Start FL training (background) |
| GET  | `/fl/status` | FL training status |
| POST | `/fl/reload` | Reload models from disk |

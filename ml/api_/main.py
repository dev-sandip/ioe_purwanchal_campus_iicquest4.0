from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from model import load_model
from service import GrammarService

MODEL_PATH = "model/nepali_grammar_checker.pth"
VOCAB_PATH = "model/nepali_tokenizer_vocab.json"

app = FastAPI(title="Nepali Grammar Checker API", version="1.0.0")

model, word2idx, device = load_model(MODEL_PATH, VOCAB_PATH)
service = GrammarService(model, word2idx, device)


class TextInput(BaseModel):
    text: str

class BatchInput(BaseModel):
    texts: list


@app.get("/health")
def health():
    return {"status": "ok", "device": str(device), "vocab_size": len(word2idx)}

@app.post("/predict")
def predict(data: TextInput):
    if not data.text.strip():
        raise HTTPException(status_code=400, detail="text field is empty")
    return service.predict(data.text)

@app.post("/predict/batch")
def predict_batch(data: BatchInput):
    if not data.texts:
        raise HTTPException(status_code=400, detail="texts list is empty")
    return {"results": service.predict_batch(data.texts)}
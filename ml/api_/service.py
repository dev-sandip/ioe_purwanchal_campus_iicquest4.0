import torch


class GrammarService:
    MAX_LEN = 20

    def __init__(self, model, word2idx: dict, device):
        self.model = model
        self.word2idx = word2idx
        self.device = device
        self.unk = word2idx.get("<UNK>", 1)

    def _encode(self, tokens: list) -> torch.Tensor:
        ids = [self.word2idx.get(t, self.unk) for t in tokens]
        if len(ids) < self.MAX_LEN:
            ids += [0] * (self.MAX_LEN - len(ids))
        else:
            ids = ids[:self.MAX_LEN]
        return torch.tensor([ids], dtype=torch.long)

    def predict(self, text: str) -> dict:
        if not text.strip():
            return {}

        tokens = text.strip().split()
        result = {}

        for i, token in enumerate(tokens):
            # build a single-token sequence centered on this token
            x = self._encode([token]).to(self.device)
            with torch.no_grad():
                prob = self.model(x).item()
            result[token] = 1 if prob > 0.5 else 0

        return result

    def predict_batch(self, texts: list) -> list:
        return [{"text": t, "result": self.predict(t)} for t in texts]
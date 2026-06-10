import json
from pathlib import Path


class CharTokenizer:
    PAD, SOS, EOS, UNK = "<PAD>", "<SOS>", "<EOS>", "<UNK>"

    def __init__(self):
        self.char2idx: dict = {}
        self.idx2char: dict = {}
        self.vocab_size: int = 0

    def build_vocab(self, texts: list[str]):
        chars = set()
        for t in texts:
            chars.update(list(str(t)))
        specials = [self.PAD, self.SOS, self.EOS, self.UNK]
        all_chars = specials + sorted(chars)
        self.char2idx = {c: i for i, c in enumerate(all_chars)}
        self.idx2char = {i: c for c, i in self.char2idx.items()}
        self.vocab_size = len(self.char2idx)

    def encode(self, text: str, max_len: int = 30,
               add_sos: bool = False, add_eos: bool = False) -> list[int]:
        ids = []
        if add_sos:
            ids.append(self.char2idx[self.SOS])
        for c in str(text):
            ids.append(self.char2idx.get(c, self.char2idx[self.UNK]))
        if add_eos:
            ids.append(self.char2idx[self.EOS])
        ids = ids[:max_len]
        ids += [self.char2idx[self.PAD]] * (max_len - len(ids))
        return ids

    def decode(self, ids: list[int]) -> str:
        out = []
        for i in ids:
            c = self.idx2char.get(i, self.UNK)
            if c in (self.PAD, self.SOS):
                continue
            if c == self.EOS:
                break
            out.append(c)
        return "".join(out)

    def save(self, path: str):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "char2idx": self.char2idx,
                "idx2char": {str(k): v for k, v in self.idx2char.items()}
            }, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: str) -> "CharTokenizer":
        tok = cls()
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Handle both formats
        if "char2idx" in data:
            tok.char2idx = data["char2idx"]
            tok.idx2char = {int(k): v for k, v in data["idx2char"].items()}
        elif "word2idx" in data:
            tok.char2idx = data["word2idx"]
            tok.idx2char = {int(k): v for k, v in data["idx2word"].items()}
        else:
            raise KeyError(f"Unknown format. Keys found: {list(data.keys())}")

        tok.vocab_size = len(tok.char2idx)
        return tok
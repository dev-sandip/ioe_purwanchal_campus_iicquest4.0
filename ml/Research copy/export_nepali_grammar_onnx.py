import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


MAX_SEQ_LEN = 20


class SimpleNepaliTokenizer:
    """Tokenizer compatible with nepali_tokenizer_vocab_research.json."""

    def __init__(self, vocab_path):
        vocab_path = Path(vocab_path)
        with vocab_path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        self.word2idx = data["word2idx"]
        self.idx2word = {int(k): v for k, v in data["idx2word"].items()}
        self.vocab_size = len(self.word2idx)

    def encode(self, text, max_len=MAX_SEQ_LEN):
        indices = [
            self.word2idx.get(word, self.word2idx["<UNK>"])
            for word in text.split()
        ]

        if len(indices) < max_len:
            indices = indices + [0] * (max_len - len(indices))
        else:
            indices = indices[:max_len]

        return indices

    def decode(self, indices):
        words = [self.idx2word.get(int(idx), "<UNK>") for idx in indices if int(idx) != 0]
        return " ".join(words)


class NepaliGrammarChecker(nn.Module):
    """BiLSTM classifier from Detection_Fixed_FL_UPDATED.ipynb."""

    def __init__(self, vocab_size, embedding_dim=64, hidden_dim=128, num_layers=2, dropout=0.3):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        self.lstm = nn.LSTM(
            embedding_dim,
            hidden_dim,
            num_layers=num_layers,
            bidirectional=True,
            batch_first=True,
            dropout=dropout,
        )
        self.attention = nn.Linear(hidden_dim * 2, 1)
        self.fc1 = nn.Linear(hidden_dim * 2, 64)
        self.relu = nn.ReLU()
        self.dropout_layer = nn.Dropout(dropout)
        self.fc2 = nn.Linear(64, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        emb = self.embedding(x)
        lstm_out, _ = self.lstm(emb)
        attn_weights = self.attention(lstm_out)
        attn_weights = torch.softmax(attn_weights, dim=1)
        context = torch.sum(lstm_out * attn_weights, dim=1)
        x = self.fc1(context)
        x = self.relu(x)
        x = self.dropout_layer(x)
        logits = self.fc2(x)
        return self.sigmoid(logits).squeeze(-1)


def load_model(checkpoint_path, vocab_size):
    model = NepaliGrammarChecker(vocab_size=vocab_size)
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    state_dict = checkpoint["state_dict"] if isinstance(checkpoint, dict) and "state_dict" in checkpoint else checkpoint
    model.load_state_dict(state_dict)
    model.eval()
    return model


def export_onnx(model, onnx_path):
    dummy_input = torch.zeros((1, MAX_SEQ_LEN), dtype=torch.long)
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        opset_version=18,
        input_names=["input_ids"],
        output_names=["correct_probability"],
        dynamic_axes={
            "input_ids": {0: "batch_size"},
            "correct_probability": {0: "batch_size"},
        },
        dynamo=False,
    )


def predict_with_pytorch(text, model, tokenizer):
    input_ids = torch.tensor([tokenizer.encode(text)], dtype=torch.long)
    with torch.no_grad():
        probability = float(model(input_ids).item())

    return {
        "input_text": text,
        "decoded_input": tokenizer.decode(input_ids[0].tolist()),
        "correct_probability": probability,
        "label": "Correct" if probability > 0.5 else "Incorrect",
        "confidence": max(probability, 1.0 - probability),
    }


def predict_with_onnx(text, onnx_path, tokenizer):
    import onnxruntime as ort

    input_ids = np.array([tokenizer.encode(text)], dtype=np.int64)
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    probability = float(session.run(None, {"input_ids": input_ids})[0][0])

    return {
        "input_text": text,
        "decoded_input": tokenizer.decode(input_ids[0]),
        "correct_probability": probability,
        "label": "Correct" if probability > 0.5 else "Incorrect",
        "confidence": max(probability, 1.0 - probability),
    }


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Export the existing Nepali grammar checker to ONNX. This checkpoint is "
            "a classifier, so it outputs a probability, not corrected text."
        )
    )
    parser.add_argument("--checkpoint", default="nepali_grammar_checker_research.pth")
    parser.add_argument("--vocab", default="nepali_tokenizer_vocab_research.json")
    parser.add_argument("--onnx", default="nepali_grammar_checker_research.onnx")
    parser.add_argument("--text", default="मेरो")
    parser.add_argument("--run-onnx", action="store_true")
    args = parser.parse_args()

    tokenizer = SimpleNepaliTokenizer(args.vocab)
    model = load_model(args.checkpoint, tokenizer.vocab_size)
    export_onnx(model, args.onnx)
    print(f"Exported classifier ONNX model to {args.onnx}")
    print(predict_with_pytorch(args.text, model, tokenizer))

    if args.run_onnx:
        print(predict_with_onnx(args.text, args.onnx, tokenizer))

    print(
        "Note: this model has no neural decoder. To output corrected Nepali text, "
        "train an encoder-decoder/seq2seq correction model on incorrect->correct pairs "
        "and export that decoder separately."
    )


if __name__ == "__main__":
    main()

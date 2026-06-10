import json
import torch
import torch.nn as nn


class NepaliGrammarChecker(nn.Module):
    def __init__(self, vocab_size, embedding_dim=64, hidden_dim=128, num_layers=2, dropout=0.3):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        self.lstm = nn.LSTM(
            embedding_dim,
            hidden_dim,
            num_layers=num_layers,
            bidirectional=True,
            batch_first=True,
            dropout=dropout,        # valid now since num_layers=2
        )
        self.attention = nn.Linear(hidden_dim * 2, 1)
        self.fc1 = nn.Linear(hidden_dim * 2, 64)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)
        self.fc2 = nn.Linear(64, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        emb = self.embedding(x)
        lstm_out, _ = self.lstm(emb)
        attn_weights = torch.softmax(self.attention(lstm_out), dim=1)
        context = torch.sum(lstm_out * attn_weights, dim=1)
        x = self.relu(self.fc1(context))
        x = self.dropout(x)
        return self.sigmoid(self.fc2(x)).squeeze(-1)


def load_vocab(vocab_path: str):
    with open(vocab_path, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    return vocab.get("word2idx", vocab)


def load_model(model_path: str, vocab_path: str, device=None):
    device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
    word2idx = load_vocab(vocab_path)
    model = NepaliGrammarChecker(vocab_size=len(word2idx))
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.to(device)
    model.eval()
    return model, word2idx, device

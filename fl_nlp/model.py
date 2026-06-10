import torch
import torch.nn as nn

class WordBiLSTM(nn.Module):
    def __init__(self, vocab_size, emb_dim=128, hidden_dim=64):
        super().__init__()

        self.embedding = nn.Embedding(vocab_size, emb_dim)

        self.lstm = nn.LSTM(
            emb_dim,
            hidden_dim,
            batch_first=True,
            bidirectional=True
        )

        self.fc = nn.Linear(hidden_dim * 2, 1)

    def forward(self, x):
        x = self.embedding(x)
        x, _ = self.lstm(x)
        x = self.fc(x)
        x = torch.sigmoid(x)
        return x.squeeze(-1)   # (batch, seq_len)
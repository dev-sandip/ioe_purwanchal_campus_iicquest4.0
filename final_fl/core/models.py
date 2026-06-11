import torch
import torch.nn as nn
import math


# ─────────────────────────────────────────────────────────────────────────────
# Detection model
# ─────────────────────────────────────────────────────────────────────────────

class CharTransformerDetector(nn.Module):
    """
    Transformer encoder for char-level wrong-word detection.
    Input : (B, seq_len) char indices
    Output: (B,) P(word is correct)
    """
    def __init__(self, vocab_size: int, embed_dim: int = 64, num_heads: int = 4,
                 num_layers: int = 3, ff_dim: int = 256,
                 max_len: int = 30, dropout: float = 0.3):
        super().__init__()
        self.embedding   = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.pos_embedding = nn.Embedding(max_len, embed_dim)
        encoder_layer    = nn.TransformerEncoderLayer(
            d_model=embed_dim, nhead=num_heads,
            dim_feedforward=ff_dim, dropout=dropout,
            batch_first=True, norm_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.dropout     = nn.Dropout(dropout)
        self.classifier  = nn.Sequential(
            nn.Linear(embed_dim, 64),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T     = x.shape
        pos      = torch.arange(T, device=x.device).unsqueeze(0).expand(B, T)
        out      = self.dropout(self.embedding(x) + self.pos_embedding(pos))
        pad_mask = (x == 0)
        out      = self.transformer(out, src_key_padding_mask=pad_mask)
        mask_f   = (~pad_mask).float().unsqueeze(-1)
        pooled   = (out * mask_f).sum(1) / mask_f.sum(1).clamp(min=1)
        return self.classifier(pooled).squeeze(-1)


# ─────────────────────────────────────────────────────────────────────────────
# Seq2Seq correction model
# ─────────────────────────────────────────────────────────────────────────────

class TransformerEncoder(nn.Module):
    def __init__(self, vocab_size: int, embed_dim: int = 128, num_heads: int = 4,
                 num_layers: int = 3, ff_dim: int = 512,
                 max_len: int = 30, dropout: float = 0.1):
        super().__init__()
        self.embed_dim   = embed_dim
        self.embedding   = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.pos_embed   = nn.Embedding(max_len + 2, embed_dim)
        layer            = nn.TransformerEncoderLayer(
            d_model=embed_dim, nhead=num_heads,
            dim_feedforward=ff_dim, dropout=dropout,
            batch_first=True, norm_first=True
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=num_layers)
        self.dropout     = nn.Dropout(dropout)
        self.fc_h        = nn.Linear(embed_dim, embed_dim)
        self.fc_c        = nn.Linear(embed_dim, embed_dim)

    def forward(self, x: torch.Tensor):
        B, T     = x.shape
        pos      = torch.arange(T, device=x.device).unsqueeze(0).expand(B, T)
        out      = self.dropout(self.embedding(x) + self.pos_embed(pos))
        pad_mask = (x == 0)
        enc_out  = self.transformer(out, src_key_padding_mask=pad_mask)
        mask_f   = (~pad_mask).float().unsqueeze(-1)
        mean_enc = (enc_out * mask_f).sum(1) / mask_f.sum(1).clamp(min=1)
        h        = torch.tanh(self.fc_h(mean_enc)).unsqueeze(0)
        c        = torch.tanh(self.fc_c(mean_enc)).unsqueeze(0)
        return enc_out, h, c


class BahdanauAttention(nn.Module):
    def __init__(self, hidden_dim: int, encoder_dim: int):
        super().__init__()
        self.W1 = nn.Linear(encoder_dim, hidden_dim)
        self.W2 = nn.Linear(hidden_dim, hidden_dim)
        self.v  = nn.Linear(hidden_dim, 1, bias=False)

    def forward(self, dec_h: torch.Tensor, enc_out: torch.Tensor):
        score   = self.v(torch.tanh(
            self.W1(enc_out) + self.W2(dec_h).unsqueeze(1)
        )).squeeze(-1)
        weights = torch.softmax(score, dim=1)
        context = torch.bmm(weights.unsqueeze(1), enc_out).squeeze(1)
        return context, weights


class LSTMDecoder(nn.Module):
    def __init__(self, vocab_size: int, embed_dim: int,
                 hidden_dim: int, encoder_dim: int, dropout: float = 0.1):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.attention = BahdanauAttention(hidden_dim, encoder_dim)
        self.lstm      = nn.LSTMCell(embed_dim + encoder_dim, hidden_dim)
        self.fc_out    = nn.Linear(hidden_dim + encoder_dim + embed_dim, vocab_size)
        self.dropout   = nn.Dropout(dropout)

    def forward_step(self, token, h, c, enc_out):
        emb              = self.dropout(self.embedding(token))
        context, weights = self.attention(h, enc_out)
        h, c             = self.lstm(torch.cat([emb, context], dim=1), (h, c))
        pred             = self.fc_out(torch.cat([h, context, emb], dim=1))
        return pred, h, c, weights


class Seq2SeqCorrector(nn.Module):
    """
    Transformer Encoder + LSTM Decoder + Bahdanau Attention.
    Input : (B, src_len) wrong word char indices
    Output: (B, tgt_len, vocab_size) logits
    """
    def __init__(self, vocab_size: int, embed_dim: int = 128,
                 hidden_dim: int = 128, enc_layers: int = 3, dropout: float = 0.1):
        super().__init__()
        self.encoder    = TransformerEncoder(
            vocab_size, embed_dim, num_heads=4,
            num_layers=enc_layers, ff_dim=512,
            max_len=30, dropout=dropout
        )
        self.decoder    = LSTMDecoder(
            vocab_size, embed_dim, hidden_dim,
            encoder_dim=embed_dim, dropout=dropout
        )
        self.vocab_size = vocab_size

    def forward(self, src: torch.Tensor, tgt: torch.Tensor,
                teacher_forcing_ratio: float = 0.5) -> torch.Tensor:
        B, tgt_len    = tgt.shape
        enc_out, h, c = self.encoder(src)
        h, c          = h.squeeze(0), c.squeeze(0)
        input_tok     = tgt[:, 0]
        outputs       = torch.zeros(B, tgt_len, self.vocab_size, device=src.device)
        for t in range(1, tgt_len):
            pred, h, c, _ = self.decoder.forward_step(input_tok, h, c, enc_out)
            outputs[:, t] = pred
            use_teacher   = torch.rand(1).item() < teacher_forcing_ratio
            input_tok     = tgt[:, t] if use_teacher else pred.argmax(dim=1)
        return outputs


# ─────────────────────────────────────────────────────────────────────────────
# Notebook correction model
# ─────────────────────────────────────────────────────────────────────────────

class NepaliTransformerEncoder(nn.Module):
    """Transformer encoder used by models/nepali_correction_from_csv.ipynb."""

    def __init__(self, vocab_size: int, embed_dim: int = 64,
                 num_heads: int = 4, num_layers: int = 2,
                 ff_dim: int = 256, max_len: int = 100,
                 dropout: float = 0.2):
        super().__init__()
        self.embed_dim = embed_dim
        self.vocab_size = vocab_size
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.pos_embed = nn.Embedding(max_len, embed_dim)
        layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=ff_dim,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=num_layers)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T = x.shape
        pos = torch.arange(T, device=x.device, dtype=torch.long).unsqueeze(0).expand(B, T)
        out = self.dropout(self.embedding(x) + self.pos_embed(pos))
        return self.transformer(out, src_key_padding_mask=(x == 0))


class NepaliAttentionDecoder(nn.Module):
    """Notebook LSTM decoder with multi-head attention."""

    def __init__(self, vocab_size: int, embed_dim: int = 64,
                 hidden_dim: int = 128, dropout: float = 0.2):
        super().__init__()
        self.embed_dim = embed_dim
        self.hidden_dim = hidden_dim
        self.vocab_size = vocab_size
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.lstm = nn.LSTMCell(embed_dim + embed_dim, hidden_dim)
        self.attn = nn.MultiheadAttention(
            embed_dim=embed_dim,
            num_heads=4,
            dropout=dropout,
            batch_first=True,
        )
        self.fc_out = nn.Sequential(
            nn.Linear(hidden_dim + embed_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, vocab_size),
        )
        self.dropout = nn.Dropout(dropout)

    def forward_step(self, token: torch.Tensor, h: torch.Tensor,
                     c: torch.Tensor, encoder_out: torch.Tensor):
        emb = self.dropout(self.embedding(token))
        context, _ = self.attn(emb.unsqueeze(1), encoder_out, encoder_out)
        context = context.squeeze(1)
        h, c = self.lstm(torch.cat([emb, context], dim=1), (h, c))
        output = self.fc_out(torch.cat([h, context], dim=1))
        return output, h, c


class NepaliCorrectionModel(nn.Module):
    """
    Production correction model from models/nepali_correction_from_csv.ipynb.

    Architecture:
      - char-level Transformer encoder
      - LSTM decoder
      - MultiheadAttention over encoder states
      - top-level fc_h/fc_c hidden-state initializers
    """

    def __init__(self, vocab_size: int, embed_dim: int = 64,
                 hidden_dim: int = 128, num_layers: int = 2,
                 dropout: float = 0.2):
        super().__init__()
        self.vocab_size = vocab_size
        self.embed_dim = embed_dim
        self.hidden_dim = hidden_dim
        self.encoder = NepaliTransformerEncoder(
            vocab_size=vocab_size,
            embed_dim=embed_dim,
            num_heads=4,
            num_layers=num_layers,
            ff_dim=256,
            max_len=100,
            dropout=dropout,
        )
        self.decoder = NepaliAttentionDecoder(
            vocab_size=vocab_size,
            embed_dim=embed_dim,
            hidden_dim=hidden_dim,
            dropout=dropout,
        )
        self.fc_h = nn.Linear(embed_dim, hidden_dim)
        self.fc_c = nn.Linear(embed_dim, hidden_dim)

    def forward(self, src: torch.Tensor, tgt: torch.Tensor,
                teacher_forcing_ratio: float = 0.5) -> torch.Tensor:
        B, _ = src.shape
        _, tgt_len = tgt.shape
        encoder_out = self.encoder(src)
        encoder_mean = encoder_out.mean(dim=1)
        h = torch.tanh(self.fc_h(encoder_mean))
        c = torch.tanh(self.fc_c(encoder_mean))

        outputs = torch.zeros(B, tgt_len, self.vocab_size, device=src.device)
        input_token = tgt[:, 0]
        for t in range(1, tgt_len):
            output, h, c = self.decoder.forward_step(input_token, h, c, encoder_out)
            outputs[:, t] = output
            use_teacher = torch.rand(1).item() < teacher_forcing_ratio
            input_token = tgt[:, t] if use_teacher else output.argmax(dim=1)
        return outputs

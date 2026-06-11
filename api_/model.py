import json
import torch
import torch.nn as nn
import math
import os
from typing import List, Tuple, Dict, Optional


# ============================================================================
# CHARACTER TOKENIZER
# ============================================================================

class CharTokenizer:
    PAD, SOS, EOS, UNK = "<PAD>", "<SOS>", "<EOS>", "<UNK>"

    def __init__(self):
        self.char2idx = {}
        self.idx2char = {}
        self.vocab_size = 0

    def build_vocab(self, texts):
        chars = set()
        for t in texts:
            chars.update(list(str(t)))
        specials = [self.PAD, self.SOS, self.EOS, self.UNK]
        all_chars = specials + sorted(chars)
        self.char2idx = {c: i for i, c in enumerate(all_chars)}
        self.idx2char = {i: c for c, i in self.char2idx.items()}
        self.vocab_size = len(self.char2idx)

    def encode(self, text, max_len=30, add_sos=False, add_eos=False):
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

    def decode(self, ids):
        out = []
        for i in ids:
            c = self.idx2char.get(i, self.UNK)
            if c in (self.PAD, self.SOS):
                continue
            if c == self.EOS:
                break
            out.append(c)
        return "".join(out)

    def save(self, filepath):
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump({
                "char2idx": self.char2idx,
                "idx2char": {str(k): v for k, v in self.idx2char.items()}
            }, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, filepath):
        tok = cls()
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        tok.char2idx = data["char2idx"]
        tok.idx2char = {int(k): v for k, v in data["idx2char"].items()}
        tok.vocab_size = len(tok.char2idx)
        return tok


# ============================================================================
# DETECTION MODEL
# ============================================================================

class CharTransformerDetector(nn.Module):
    """Transformer encoder for char-level wrong-word detection"""
    def __init__(self, vocab_size, embed_dim=64, num_heads=4,
                 num_layers=3, ff_dim=256, max_len=30, dropout=0.3):
        super().__init__()
        self.vocab_size = vocab_size
        self.embed_dim = embed_dim
        
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.pos_embedding = nn.Embedding(max_len, embed_dim)
        
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=ff_dim,
            dropout=dropout,
            batch_first=True,
            norm_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.dropout = nn.Dropout(dropout)
        self.classifier = nn.Sequential(
            nn.Linear(embed_dim, 64),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )

    def forward(self, x):
        B, T = x.shape
        positions = torch.arange(T, device=x.device).unsqueeze(0).expand(B, T)
        out = self.dropout(self.embedding(x) + self.pos_embedding(positions))
        pad_mask = (x == 0)
        out = self.transformer(out, src_key_padding_mask=pad_mask)
        mask_f = (~pad_mask).float().unsqueeze(-1)
        pooled = (out * mask_f).sum(dim=1) / mask_f.sum(dim=1).clamp(min=1)
        return self.classifier(pooled).squeeze(-1)


# ============================================================================
# SEQ2SEQ CORRECTION MODEL
# ============================================================================

class TransformerEncoder(nn.Module):
    def __init__(self, vocab_size, embed_dim=128, num_heads=4,
                 num_layers=3, ff_dim=512, max_len=30, dropout=0.1):
        super().__init__()
        self.embed_dim = embed_dim
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.pos_embed = nn.Embedding(max_len + 2, embed_dim)
        
        layer = nn.TransformerEncoderLayer(
            d_model=embed_dim, nhead=num_heads,
            dim_feedforward=ff_dim, dropout=dropout,
            batch_first=True, norm_first=True
        )
        self.transformer = nn.TransformerEncoder(layer, num_layers=num_layers)
        self.dropout = nn.Dropout(dropout)
        self.fc_h = nn.Linear(embed_dim, embed_dim)
        self.fc_c = nn.Linear(embed_dim, embed_dim)

    def forward(self, x):
        B, T = x.shape
        pos = torch.arange(T, device=x.device).unsqueeze(0).expand(B, T)
        out = self.dropout(self.embedding(x) + self.pos_embed(pos))
        pad_mask = (x == 0)
        enc_out = self.transformer(out, src_key_padding_mask=pad_mask)
        mask_f = (~pad_mask).float().unsqueeze(-1)
        mean_enc = (enc_out * mask_f).sum(1) / mask_f.sum(1).clamp(min=1)
        h = torch.tanh(self.fc_h(mean_enc)).unsqueeze(0)
        c = torch.tanh(self.fc_c(mean_enc)).unsqueeze(0)
        return enc_out, h, c


class BahdanauAttention(nn.Module):
    def __init__(self, hidden_dim, encoder_dim):
        super().__init__()
        self.W1 = nn.Linear(encoder_dim, hidden_dim)
        self.W2 = nn.Linear(hidden_dim, hidden_dim)
        self.v = nn.Linear(hidden_dim, 1, bias=False)

    def forward(self, dec_h, enc_out):
        score = self.v(torch.tanh(
            self.W1(enc_out) + self.W2(dec_h).unsqueeze(1)
        )).squeeze(-1)
        weights = torch.softmax(score, dim=1)
        context = torch.bmm(weights.unsqueeze(1), enc_out).squeeze(1)
        return context, weights


class LSTMDecoder(nn.Module):
    def __init__(self, vocab_size, embed_dim, hidden_dim, encoder_dim, dropout=0.1):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.attention = BahdanauAttention(hidden_dim, encoder_dim)
        self.lstm = nn.LSTMCell(embed_dim + encoder_dim, hidden_dim)
        self.fc_out = nn.Linear(hidden_dim + encoder_dim + embed_dim, vocab_size)
        self.dropout = nn.Dropout(dropout)

    def forward_step(self, token, h, c, enc_out):
        emb = self.dropout(self.embedding(token))
        context, weights = self.attention(h, enc_out)
        h, c = self.lstm(torch.cat([emb, context], dim=1), (h, c))
        pred = self.fc_out(torch.cat([h, context, emb], dim=1))
        return pred, h, c, weights


class Seq2SeqCorrector(nn.Module):
    def __init__(self, vocab_size, embed_dim=128, hidden_dim=128,
                 enc_layers=3, max_word_len=20, dropout=0.1):
        super().__init__()
        self.vocab_size = vocab_size
        self.encoder = TransformerEncoder(
            vocab_size, embed_dim, num_heads=4,
            num_layers=enc_layers, ff_dim=512,
            max_len=max_word_len, dropout=dropout
        )
        self.decoder = LSTMDecoder(
            vocab_size, embed_dim, hidden_dim,
            encoder_dim=embed_dim, dropout=dropout
        )

    def forward(self, src, tgt, teacher_forcing_ratio=0.5):
        B, tgt_len = tgt.shape
        enc_out, h, c = self.encoder(src)
        h, c = h.squeeze(0), c.squeeze(0)
        input_tok = tgt[:, 0]
        outputs = torch.zeros(B, tgt_len, self.vocab_size).to(src.device)
        for t in range(1, tgt_len):
            pred, h, c, _ = self.decoder.forward_step(input_tok, h, c, enc_out)
            outputs[:, t] = pred
            use_teacher = torch.rand(1).item() < teacher_forcing_ratio
            input_tok = tgt[:, t] if use_teacher else pred.argmax(dim=1)
        return outputs


# ============================================================================
# CHECKPOINT LOADER (Bulletproof)
# ============================================================================

def safe_load_checkpoint(filepath, device='cpu'):
    """
    Load checkpoint and inspect it.
    Returns: checkpoint dict or None if corrupted
    """
    if not os.path.exists(filepath):
        return None
    
    try:
        checkpoint = torch.load(filepath, map_location=device, weights_only=False)
        # If wrapped in a dict, extract state_dict
        if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
            return checkpoint["model_state_dict"]
        return checkpoint
    except Exception as e:
        print(f"Warning: Failed to load checkpoint: {str(e)[:100]}")
        return None


def get_checkpoint_vocab_size(state_dict):
    """
    Inspect checkpoint and extract vocab size from embedding layers.
    """
    if state_dict is None:
        return None
    
    try:
        if "embedding.weight" in state_dict:
            vocab_size = state_dict["embedding.weight"].shape[0]
            return vocab_size
        return None
    except:
        return None


# ============================================================================
# MODEL LOADING & INITIALIZATION
# ============================================================================

def load_tokenizers(data_dir: str):
    """
    Load saved tokenizers from data directory.
    Falls back to creating dummy tokenizers if files are missing.
    """
    detect_tok = None
    seq2seq_tok = None
    
    detect_path = os.path.join(data_dir, "detect_char_tokenizer.json")
    seq2seq_path = os.path.join(data_dir, "seq2seq_char_tokenizer.json")
    
    # Try to load detector tokenizer
    if os.path.exists(detect_path):
        try:
            detect_tok = CharTokenizer.load(detect_path)
        except Exception as e:
            print(f"Warning: Failed to load detector tokenizer: {e}")
    
    # Try to load seq2seq tokenizer
    if os.path.exists(seq2seq_path):
        try:
            seq2seq_tok = CharTokenizer.load(seq2seq_path)
        except Exception as e:
            print(f"Warning: Failed to load seq2seq tokenizer: {e}")
    
    # Fallback: Create dummy tokenizers with Nepali characters
    if detect_tok is None:
        detect_tok = CharTokenizer()
        nepali_chars = list("अआइईउऊऋएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहक्षत्रज्ञाइीुूृेैोौंः:ँ०१२३४५६७८९")
        detect_tok.build_vocab(nepali_chars + ["a", "b", "c", "d", "e", "f"])
    
    if seq2seq_tok is None:
        seq2seq_tok = CharTokenizer()
        nepali_chars = list("अआइईउऊऋएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहक्षत्रज्ञाइीुूृेैोौंः:ँ०१२३४५६७८९")
        seq2seq_tok.build_vocab(nepali_chars + ["a", "b", "c", "d", "e", "f"])
    
    return detect_tok, seq2seq_tok


def load_models(model_dir: str, data_dir: str, device=None):
    """
    Load detector and seq2seq models with their tokenizers.
    """
    device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # Load tokenizers
    detect_tok, seq2seq_tok = load_tokenizers(data_dir)
    
    # Load checkpoints
    detector_path = os.path.join(model_dir, "detector_best.pth")
    seq2seq_path = os.path.join(model_dir, "seq2seq_best.pth")
    
    detector_ckpt = safe_load_checkpoint(detector_path, device=device)
    seq2seq_ckpt = safe_load_checkpoint(seq2seq_path, device=device)
    
    # Create detector model
    detector = CharTransformerDetector(
        vocab_size=detect_tok.vocab_size,
        embed_dim=64,
        num_heads=4,
        num_layers=3,
        ff_dim=256,
        max_len=30,
        dropout=0.3
    ).to(device)
    
    if detector_ckpt is not None:
        try:
            detector.load_state_dict(detector_ckpt, strict=False)
        except Exception as e:
            print(f"Warning: Could not load detector checkpoint: {e}")
    
    detector.eval()
    
    # Create seq2seq model
    s2s_model = Seq2SeqCorrector(
        vocab_size=seq2seq_tok.vocab_size,
        embed_dim=128,
        hidden_dim=128,
        enc_layers=3,
        max_word_len=20,
        dropout=0.1
    ).to(device)
    
    if seq2seq_ckpt is not None:
        try:
            s2s_model.load_state_dict(seq2seq_ckpt, strict=False)
        except Exception as e:
            print(f"Warning: Could not load seq2seq checkpoint: {e}")
    
    s2s_model.eval()
    
    return detector, s2s_model, detect_tok, seq2seq_tok, device


# ============================================================================
# INFERENCE FUNCTIONS
# ============================================================================

def detect_word(word, detector, detect_tok, device, max_len=30, threshold=0.5):
    """
    Detect if a word is correct.
    Returns: (is_correct: bool, confidence: float)
    """
    detector.eval()
    indices = detect_tok.encode(word, max_len)
    x = torch.tensor([indices], dtype=torch.long).to(device)
    
    with torch.no_grad():
        prob = detector(x).item()
    
    is_correct = prob > threshold
    return is_correct, round(prob, 4)


def correct_word_beam(wrong_word, s2s_model, seq2seq_tok, device, beam_width=5, max_len=20):
    """
    Beam search for top-3 corrections.
    Returns: [(word, confidence), ...]
    """
    s2s_model.eval()
    src = torch.tensor(
        [seq2seq_tok.encode(str(wrong_word), max_len)], dtype=torch.long
    ).to(device)

    SOS = seq2seq_tok.char2idx[seq2seq_tok.SOS]
    EOS = seq2seq_tok.char2idx[seq2seq_tok.EOS]
    PAD = seq2seq_tok.char2idx[seq2seq_tok.PAD]

    with torch.no_grad():
        enc_out, h, c = s2s_model.encoder(src)
    h = h.squeeze(0)
    c = c.squeeze(0)

    beams = [(0.0, [], h, c)]
    completed = []

    for _ in range(max_len):
        if not beams:
            break
        candidates = []
        for lp, tokens, bh, bc in beams:
            if tokens and tokens[-1] == EOS:
                completed.append((lp, tokens))
                continue
            last = torch.tensor(
                [tokens[-1] if tokens else SOS], dtype=torch.long
            ).to(device)
            with torch.no_grad():
                pred, new_h, new_c, _ = s2s_model.decoder.forward_step(
                    last, bh, bc, enc_out
                )
            log_p = torch.log_softmax(pred[0], dim=-1)
            topk_lp, topk_idx = log_p.topk(beam_width)
            for tlp, tidx in zip(topk_lp.tolist(), topk_idx.tolist()):
                candidates.append((lp + tlp, tokens + [tidx], new_h, new_c))
        candidates.sort(key=lambda x: x[0], reverse=True)
        beams = candidates[:beam_width]

    for lp, tokens, _, _ in beams:
        completed.append((lp, tokens))
    completed.sort(key=lambda x: x[0], reverse=True)

    def decode_tokens(tokens):
        out = []
        for idx in tokens:
            ch = seq2seq_tok.idx2char.get(idx, seq2seq_tok.UNK)
            if ch == seq2seq_tok.EOS:
                break
            if ch not in (seq2seq_tok.PAD, seq2seq_tok.SOS):
                out.append(ch)
        return "".join(out)

    seen, results = set(), []
    for lp, tokens in completed:
        word = decode_tokens(tokens)
        if word and word not in seen:
            seen.add(word)
            norm_score = math.exp(lp / max(len(tokens), 1))
            results.append((word, round(norm_score, 4)))
        if len(results) == 3:
            break

    return results


def correct_sentence(text, detector, s2s_model, detect_tok, seq2seq_tok, device, threshold=0.5, beam_width=5):
    """
    Correct all words in a sentence.
    """
    words = text.split()
    corrected = []
    details = []
    
    for word in words:
        is_correct, conf = detect_word(word, detector, detect_tok, device, threshold=threshold)
        
        if is_correct:
            corrected.append(word)
            details.append((word, "correct", conf, []))
        else:
            suggestions = correct_word_beam(word, s2s_model, seq2seq_tok, device, beam_width=beam_width)
            best = suggestions[0][0] if suggestions else word
            corrected.append(best)
            details.append((word, "corrected", conf, suggestions))
    
    return {
        "input": text,
        "output": " ".join(corrected),
        "details": details
    }

"""
Load models once at startup and provide them via FastAPI Depends().
"""
import os
import torch
import torch.nn as nn
from pathlib import Path
from functools import lru_cache

from core.models import CharTransformerDetector, Seq2SeqCorrector
from core.tokenizer import CharTokenizer

DET_PTH      = os.getenv("DETECTOR_PATH",  "models/detector_best.pth")
S2S_PTH      = os.getenv("CORRECTOR_PATH", "models/seq2seq_best.pth")
DET_TOK_PATH = os.getenv("DET_TOK_PATH",   "data/detect_char_tokenizer.json")
S2S_TOK_PATH = os.getenv("S2S_TOK_PATH",   "data/seq2seq_char_tokenizer.json")


@lru_cache(maxsize=1)
def get_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


@lru_cache(maxsize=1)
def get_detect_tokenizer() -> CharTokenizer:
    return CharTokenizer.load(DET_TOK_PATH)


@lru_cache(maxsize=1)
def get_correct_tokenizer() -> CharTokenizer:
    return CharTokenizer.load(S2S_TOK_PATH)


@lru_cache(maxsize=1)
def get_detector() -> CharTransformerDetector:
    device    = get_device()
    tokenizer = get_detect_tokenizer()
    model     = CharTransformerDetector(
        vocab_size=tokenizer.vocab_size,
        embed_dim=64, num_heads=4, num_layers=3,
        ff_dim=256, max_len=30, dropout=0.0   # dropout=0 at inference
    ).to(device)
    model.load_state_dict(torch.load(DET_PTH, map_location=device))
    model.eval()
    return model


@lru_cache(maxsize=1)
def get_corrector() -> Seq2SeqCorrector:
    device    = get_device()
    tokenizer = get_correct_tokenizer()
    model     = Seq2SeqCorrector(
        vocab_size=tokenizer.vocab_size,
        embed_dim=128, hidden_dim=128,
        enc_layers=3, dropout=0.0
    ).to(device)
    # Load checkpoint and handle possible positional-embedding size mismatch
    state = torch.load(S2S_PTH, map_location=device)
    pos_key = "encoder.pos_embed.weight"
    if isinstance(state, dict) and pos_key in state:
        ck_sz, ck_dim = state[pos_key].shape
        mdl_sz, mdl_dim = model.encoder.pos_embed.weight.shape
        if ck_sz != mdl_sz:
            # recreate positional embedding to match checkpoint size
            model.encoder.pos_embed = nn.Embedding(ck_sz, mdl_dim).to(device)
    model.load_state_dict(state)
    model.eval()
    return model


def reload_models():
    """Call after FL round completes to reload updated weights."""
    get_detector.cache_clear()
    get_corrector.cache_clear()
    get_detect_tokenizer.cache_clear()
    get_correct_tokenizer.cache_clear()

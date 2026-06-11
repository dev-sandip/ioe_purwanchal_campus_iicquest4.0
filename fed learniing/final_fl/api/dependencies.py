"""
Load models once at startup and provide them via FastAPI Depends().
"""
import json
import os
import torch
from pathlib import Path
from functools import lru_cache

from core.models import CharTransformerDetector, NepaliCorrectionModel
from core.tokenizer import CharTokenizer

DET_PTH      = os.getenv("DETECTOR_PATH",  "models/detector_best.pth")
S2S_PTH      = os.getenv("CORRECTOR_PATH", "models/nepali_correction_best.pth")
DET_TOK_PATH = os.getenv("DET_TOK_PATH",   "data/detect_char_tokenizer.json")
S2S_TOK_PATH = os.getenv("S2S_TOK_PATH",   "models/nepali_correction_tokenizer.json")
S2S_CFG_PATH = os.getenv("S2S_CFG_PATH",   "models/nepali_correction_config.json")


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


def _load_corrector_config() -> dict:
    defaults = {
        "embed_dim": 64,
        "hidden_dim": 128,
        "num_layers": 2,
        "dropout": 0.0,
    }
    cfg_path = Path(S2S_CFG_PATH)
    if cfg_path.exists():
        with cfg_path.open("r", encoding="utf-8") as f:
            defaults.update(json.load(f))
    defaults["dropout"] = 0.0
    return defaults


@lru_cache(maxsize=1)
def get_corrector() -> NepaliCorrectionModel:
    device    = get_device()
    tokenizer = get_correct_tokenizer()
    cfg       = _load_corrector_config()
    model     = NepaliCorrectionModel(
        vocab_size=tokenizer.vocab_size,
        embed_dim=int(cfg["embed_dim"]),
        hidden_dim=int(cfg["hidden_dim"]),
        num_layers=int(cfg["num_layers"]),
        dropout=0.0,
    ).to(device)
    state = torch.load(S2S_PTH, map_location=device)
    model.load_state_dict(state)
    model.eval()
    return model


def reload_models():
    """Call after FL round completes to reload updated weights."""
    get_detector.cache_clear()
    get_corrector.cache_clear()
    get_detect_tokenizer.cache_clear()
    get_correct_tokenizer.cache_clear()

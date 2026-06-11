"""
fl_server.py

Federated Learning Server for Nepali Grammar Checker.

Responsibilities:
- Load nepali_correction_best.pth
- Accept weight uploads from browser clients (ONNX.js)
- FedAvg aggregation (sample-weighted)
- Save best aggregated weights back to .pth
- Export to ONNX for frontend use
"""

import io
import json
import shutil
import logging
import numpy as np
from pathlib import Path
from datetime import datetime
from collections import OrderedDict
from typing import Dict, List, Optional, Any

import torch
import torch.nn as nn

import sys
sys.path.append(str(Path(__file__).resolve().parents[2]))

from core.models import CharTransformerDetector, NepaliCorrectionModel
from core.tokenizer import CharTokenizer

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger(__name__)


# ── paths ──────────────────────────────────────────────────────────────────────
ROOT            = Path(__file__).resolve().parents[2]
MODELS_DIR      = ROOT / "models"
DETECTOR_PTH    = MODELS_DIR / "detector_best.pth"
CORRECTOR_PTH   = MODELS_DIR / "nepali_correction_best.pth"
DET_TOK_PATH    = ROOT / "data" / "detect_char_tokenizer.json"
S2S_TOK_PATH    = MODELS_DIR / "nepali_correction_tokenizer.json"
ONNX_DIR        = MODELS_DIR / "onnx"
CHECKPOINTS_DIR = MODELS_DIR / "fl_checkpoints"
CLIENT_W_DIR    = MODELS_DIR / "fl_client_weights"
LOGS_DIR        = ROOT / "logs"
METRICS_FILE    = LOGS_DIR / "fl_metrics.jsonl"
STATE_FILE      = LOGS_DIR / "fl_state.json"

for d in [ONNX_DIR, CHECKPOINTS_DIR, CLIENT_W_DIR, LOGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ── model factory ──────────────────────────────────────────────────────────────
def _build_detector(tok: CharTokenizer, dropout: float = 0.0) -> CharTransformerDetector:
    return CharTransformerDetector(
        vocab_size=tok.vocab_size,
        embed_dim=64, num_heads=4, num_layers=3,
        ff_dim=256, max_len=30, dropout=dropout,
    )

def _build_corrector(tok: CharTokenizer, dropout: float = 0.0) -> NepaliCorrectionModel:
    return NepaliCorrectionModel(
        vocab_size=tok.vocab_size,
        embed_dim=64, hidden_dim=128,
        num_layers=2, dropout=dropout,
    )


# ── ONNX export ────────────────────────────────────────────────────────────────
def export_detector_onnx(pth_path: Path, out_path: Path, tok: CharTokenizer) -> Path:
    """
    Export CharTransformerDetector to ONNX.
    Input  : char_ids   int64 [batch, 30]
    Output : prob       float32 [batch]
    """
    model = _build_detector(tok, dropout=0.0)
    model.load_state_dict(torch.load(str(pth_path), map_location="cpu"))
    model.eval()

    dummy = torch.zeros(1, 30, dtype=torch.long)

    torch.onnx.export(
        model, dummy, str(out_path),
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=["char_ids"],
        output_names=["prob"],
        dynamic_axes={"char_ids": {0: "batch"}, "prob": {0: "batch"}},
    )
    log.info(f"✓ Detector ONNX exported → {out_path}")
    return out_path


def export_corrector_onnx(pth_path: Path, out_path: Path, tok: CharTokenizer) -> Path:
    """
    Export the notebook NepaliCorrectionModel to ONNX.
    Inputs : src    int64 [batch, 100]
             tgt    int64 [batch, 100]  (with SOS token prepended)
    Output : logits float32 [batch, 100, vocab_size]
    """
    model = _build_corrector(tok, dropout=0.0)
    model.load_state_dict(torch.load(str(pth_path), map_location="cpu"))
    model.eval()

    dummy_src = torch.zeros(1, 100, dtype=torch.long)
    dummy_tgt = torch.zeros(1, 100, dtype=torch.long)

    torch.onnx.export(
        model, (dummy_src, dummy_tgt), str(out_path),
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=["src", "tgt"],
        output_names=["logits"],
        dynamic_axes={
            "src":    {0: "batch"},
            "tgt":    {0: "batch"},
            "logits": {0: "batch"},
        },
    )
    log.info(f"✓ Corrector ONNX exported → {out_path}")
    return out_path


# ── weight I/O helpers ─────────────────────────────────────────────────────────
def pth_to_npz(pth_path: Path, npz_path: Path):
    """State dict .pth → flat .npz  (for client download)."""
    sd = torch.load(str(pth_path), map_location="cpu")
    np.savez(str(npz_path), **{k: v.numpy() for k, v in sd.items()})
    log.info(f"✓ PTH→NPZ  {npz_path.name}")


def npz_to_pth(npz_path: Path, pth_path: Path, model: nn.Module):
    """Aggregated .npz → state dict .pth  (inference-ready)."""
    data = np.load(str(npz_path))
    sd   = OrderedDict({k: torch.tensor(data[k]) for k in data.files})
    model.load_state_dict(sd, strict=True)
    torch.save(model.state_dict(), str(pth_path))
    log.info(f"✓ NPZ→PTH  {pth_path.name}")


# ── FedAvg ─────────────────────────────────────────────────────────────────────
def fedavg(weight_files: List[Path], sample_counts: List[int]) -> Dict[str, np.ndarray]:
    """
    Sample-weighted FedAvg:  W_agg = Σ (n_i / N) * W_i
    """
    total = sum(sample_counts)
    agg: Dict[str, np.ndarray] = {}

    for path, n in zip(weight_files, sample_counts):
        w    = n / total
        data = np.load(str(path))
        for key in data.files:
            arr = data[key].astype(np.float64)
            agg[key] = agg.get(key, np.zeros_like(arr)) + w * arr

    return {k: v.astype(np.float32) for k, v in agg.items()}


# ── round state ────────────────────────────────────────────────────────────────
class RoundState:
    def __init__(self):
        self.model_type    = "corrector"
        self.num_rounds    = 0
        self.min_clients   = 2
        self.current_round = 0
        self.best_loss     = float("inf")
        self.best_round    = 0
        self.initialized   = False
        # round → {client_id: {npz, n, loss, accuracy}}
        self.submissions: Dict[int, Dict[str, dict]] = {}
        self._load()

    def _load(self):
        if STATE_FILE.exists():
            try:
                s = json.loads(STATE_FILE.read_text())
                for k in ("model_type","num_rounds","min_clients","current_round",
                          "best_loss","best_round","initialized"):
                    setattr(self, k, s.get(k, getattr(self, k)))
                if self.model_type != "corrector":
                    self.model_type = "corrector"
                    self.initialized = False
                log.info(f"✓ State loaded  round={self.current_round}")
            except Exception as e:
                log.warning(f"State load failed: {e}")

    def save(self):
        STATE_FILE.write_text(json.dumps({
            "model_type":    self.model_type,
            "num_rounds":    self.num_rounds,
            "min_clients":   self.min_clients,
            "current_round": self.current_round,
            "best_loss":     self.best_loss,
            "best_round":    self.best_round,
            "initialized":   self.initialized,
            "timestamp":     datetime.now().isoformat(),
        }, indent=2))

    def start(self, model_type: str, num_rounds: int, min_clients: int):
        self.model_type    = model_type
        self.num_rounds    = num_rounds
        self.min_clients   = min_clients
        self.current_round = 1
        self.best_loss     = float("inf")
        self.best_round    = 0
        self.initialized   = True
        self.submissions   = {1: {}}
        self.save()

    def add(self, round_num: int, client_id: str, npz_path: Path,
            n: int, loss: float, acc: Optional[float]):
        self.submissions.setdefault(round_num, {})[client_id] = {
            "npz": npz_path, "n": n, "loss": loss, "accuracy": acc
        }

    def ready(self, round_num: int) -> bool:
        return len(self.submissions.get(round_num, {})) >= self.min_clients

    def progress(self, round_num: int) -> dict:
        subs = self.submissions.get(round_num, {})
        return {
            "round": round_num, "submitted": len(subs),
            "required": self.min_clients,
            "ready": self.ready(round_num),
            "clients": list(subs.keys()),
        }

    def log_metrics(self, round_num: int, agg_loss: float,
                    agg_acc: Optional[float], num_clients: int):
        record = {
            "round": round_num, "timestamp": datetime.now().isoformat(),
            "agg_loss": agg_loss, "agg_accuracy": agg_acc,
            "num_clients": num_clients, "is_best": round_num == self.best_round,
        }
        with open(METRICS_FILE, "a") as f:
            f.write(json.dumps(record) + "\n")


# ── FL manager ─────────────────────────────────────────────────────────────────
class FLManager:

    def __init__(self):
        self.state = RoundState()

    # ── init ────────────────────────────────────────────────────────────────
    def initialize(self, model_type: str, num_rounds: int, min_clients: int) -> dict:
        self.state.start(model_type, num_rounds, min_clients)
        self._ensure_onnx(model_type)
        log.info(f"✓ FL initialized  model={model_type}  rounds={num_rounds}  "
                 f"min_clients={min_clients}")
        return {"status": "initialized", "model": model_type,
                "num_rounds": num_rounds, "min_clients": min_clients}

    # ── receive ─────────────────────────────────────────────────────────────
    def receive_weights(self, round_num: int, client_id: str,
                        npz_bytes: bytes, num_samples: int,
                        loss: float, accuracy: Optional[float]) -> dict:
        rdir = CLIENT_W_DIR / f"round_{round_num:04d}"
        rdir.mkdir(parents=True, exist_ok=True)
        npz_path = rdir / f"{client_id}.npz"
        npz_path.write_bytes(npz_bytes)

        self.state.add(round_num, client_id, npz_path, num_samples, loss, accuracy)
        log.info(f"✓ Received  round={round_num}  client={client_id}  "
                 f"n={num_samples}  loss={loss:.4f}")
        return {
            "status": "submitted", "round": round_num, "client_id": client_id,
            "can_aggregate": self.state.ready(round_num),
            "progress": self.state.progress(round_num),
        }

    # ── aggregate ───────────────────────────────────────────────────────────
    def aggregate(self, round_num: int) -> dict:
        if not self.state.ready(round_num):
            prog = self.state.progress(round_num)
            raise ValueError(
                f"Need {prog['required']} clients, have {prog['submitted']}"
            )

        subs    = self.state.submissions[round_num]
        paths   = [v["npz"]      for v in subs.values()]
        samples = [v["n"]        for v in subs.values()]
        losses  = [v["loss"]     for v in subs.values()]
        accs    = [v["accuracy"] for v in subs.values() if v["accuracy"] is not None]

        agg_w    = fedavg(paths, samples)
        agg_loss = float(np.mean(losses))
        agg_acc  = float(np.mean(accs)) if accs else None

        # save aggregated npz checkpoint
        agg_npz = CHECKPOINTS_DIR / f"agg_round_{round_num:04d}.npz"
        np.savez(str(agg_npz), **agg_w)

        is_best = agg_loss < self.state.best_loss
        if is_best:
            self.state.best_loss  = agg_loss
            self.state.best_round = round_num
            shutil.copy(str(agg_npz), str(CHECKPOINTS_DIR / "best.npz"))

            # write back to .pth
            mt  = self.state.model_type
            pth = CORRECTOR_PTH
            tok = CharTokenizer.load(str(S2S_TOK_PATH))
            m   = _build_corrector(tok)
            npz_to_pth(agg_npz, pth, m)

            # re-export ONNX
            self._ensure_onnx(mt, force=True)

        self.state.log_metrics(round_num, agg_loss, agg_acc, len(subs))

        # advance round counter
        nxt = round_num + 1
        if nxt <= self.state.num_rounds:
            self.state.current_round = nxt
            self.state.submissions.setdefault(nxt, {})
        self.state.save()

        log.info(f"✓ Aggregated  round={round_num}  loss={agg_loss:.4f}  "
                 f"is_best={is_best}")
        return {
            "status": "aggregated", "round": round_num,
            "agg_loss": agg_loss, "agg_accuracy": agg_acc,
            "is_best": is_best, "num_clients": len(subs),
        }

    # ── serve weights ────────────────────────────────────────────────────────
    def weights_npz_path(self, round_num: Optional[int] = None) -> Optional[Path]:
        """Return npz path for a given round (or best/initial fallback)."""
        if round_num is not None:
            p = CHECKPOINTS_DIR / f"agg_round_{round_num:04d}.npz"
            if p.exists():
                return p

        best = CHECKPOINTS_DIR / "best.npz"
        if best.exists():
            return best

        # convert initial .pth to npz on first request
        pth = CORRECTOR_PTH
        if pth.exists():
            init = CHECKPOINTS_DIR / "initial.npz"
            if not init.exists():
                pth_to_npz(pth, init)
            return init

        return None

    def onnx_path(self, model_type: str) -> Optional[Path]:
        p = ONNX_DIR / f"{model_type}.onnx"
        return p if p.exists() else None

    # ── info ─────────────────────────────────────────────────────────────────
    def get_state(self) -> dict:
        s = self.state
        return {
            "initialized":   s.initialized,
            "model":         s.model_type,
            "current_round": s.current_round,
            "num_rounds":    s.num_rounds,
            "min_clients":   s.min_clients,
            "best_round":    s.best_round,
            "best_loss":     s.best_loss,
        }

    def get_metrics(self) -> list:
        if not METRICS_FILE.exists():
            return []
        return [json.loads(l) for l in METRICS_FILE.read_text().splitlines() if l.strip()]

    # ── private ──────────────────────────────────────────────────────────────
    def _ensure_onnx(self, model_type: str, force: bool = False):
        if model_type != "corrector":
            return
        op, pp, tp = ONNX_DIR/"corrector.onnx", CORRECTOR_PTH, S2S_TOK_PATH
        fn = export_corrector_onnx

        if (force or not op.exists()) and pp.exists():
            tok = CharTokenizer.load(str(tp))
            fn(pp, op, tok)


# ── singleton ──────────────────────────────────────────────────────────────────
_manager: Optional[FLManager] = None

def get_fl_manager() -> FLManager:
    global _manager
    if _manager is None:
        _manager = FLManager()
    return _manager

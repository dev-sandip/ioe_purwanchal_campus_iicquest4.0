"""
fl/server.py

Flower FL Server for Nepali Grammar Correction.
Runs gRPC Flower server, aggregates weights (FedAvg),
saves best .pth, exports ONNX after each new best round.

Updated: Now uses nepali_correction_best.pth (seq2seq-only model)
from notebook training pipeline. No separate detector model.
"""

import sys
import shutil
import logging
from pathlib import Path
from collections import OrderedDict
from typing import Optional, List, Tuple, Dict

import numpy as np
import torch
import flwr as fl
from flwr.common import Parameters, Scalar, FitRes, EvaluateRes
from flwr.server.client_proxy import ClientProxy

# project root on path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from core.models import NepaliCorrectionModel
from core.tokenizer import CharTokenizer

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ── paths (relative to project root) ──────────────────────────────────────────
ROOT              = Path(__file__).resolve().parent.parent
MODELS_DIR        = ROOT / "models"
WEIGHTS_DIR       = MODELS_DIR / "weights"
ONNX_DIR          = MODELS_DIR / "onnx"
COR_PTH           = MODELS_DIR / "nepali_correction_best.pth"
S2S_TOK           = MODELS_DIR / "nepali_correction_tokenizer.json"

for d in [WEIGHTS_DIR, ONNX_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ── model builders ─────────────────────────────────────────────────────────────
def _build_corrector(tok: CharTokenizer, dropout=0.1) -> NepaliCorrectionModel:
    """
    Build Seq2Seq Corrector with hyperparams from notebook training.
    
    Args:
        tok: CharTokenizer instance
        dropout: Dropout rate (default 0.1)
    
    Returns:
        NepaliCorrectionModel instance
    """
    return NepaliCorrectionModel(
        vocab_size=tok.vocab_size,
        embed_dim=64,
        hidden_dim=128,
        num_layers=2,
        dropout=dropout,
    )



# ── ONNX export ────────────────────────────────────────────────────────────────
def export_onnx():
    """
    Export nepali_correction_best.pth → nepali_corrector.onnx
    for frontend deployment (ONNX Runtime Web).

    Model Input:
      src: int64[batch, max_len=100]   (wrong word char IDs)
      tgt: int64[batch, max_len=100]   (target char IDs with SOS/EOS)
    
    Model Output:
      logits: float32[batch, max_len, vocab_size]  (correction logits)
    """
    try:
        tok   = CharTokenizer.load(str(S2S_TOK))
        model = _build_corrector(tok)
        model.load_state_dict(torch.load(str(COR_PTH), map_location="cpu"))
        model.eval()
        
        d_src = torch.zeros(1, 100, dtype=torch.long)
        d_tgt = torch.zeros(1, 100, dtype=torch.long)
        out_p = ONNX_DIR / "nepali_corrector.onnx"
        
        torch.onnx.export(
            model,
            (d_src, d_tgt),
            str(out_p),
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
        log.info(f"✓ ONNX exported → {out_p.name}")
    except Exception as e:
        log.error(f"ONNX export failed: {e}")



# ── custom FedAvg strategy ─────────────────────────────────────────────────────
class NepaliCorrectionFedAvg(fl.server.strategy.FedAvg):
    """
    FedAvg for Seq2Seq Correction model (Transformer Encoder + LSTM Decoder).
    
    After every round:
      - saves aggregated weights/round_XXXX.npy
    
    On new best validation loss:
      - copies to weights/best.npy
      - overwrites nepali_correction_best.pth
      - re-exports nepali_corrector.onnx for frontend
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.best_loss  = float("inf")
        self.best_round = 0

    # called after clients finish fit()
    def aggregate_fit(
        self,
        server_round: int,
        results: List[Tuple[ClientProxy, FitRes]],
        failures,
    ) -> Tuple[Optional[Parameters], Dict[str, Scalar]]:

        aggregated, metrics = super().aggregate_fit(server_round, results, failures)

        if aggregated is not None:
            weights = fl.common.parameters_to_ndarrays(aggregated)
            path    = WEIGHTS_DIR / f"round_{server_round:04d}.npy"
            np.save(str(path), np.array(weights, dtype=object), allow_pickle=True)
            log.info(f"[Round {server_round}] weights saved → {path.name}")

        return aggregated, metrics

    # called after clients finish evaluate()
    def aggregate_evaluate(
        self,
        server_round: int,
        results: List[Tuple[ClientProxy, EvaluateRes]],
        failures,
    ) -> Tuple[Optional[float], Dict[str, Scalar]]:

        agg_loss, metrics = super().aggregate_evaluate(server_round, results, failures)

        if agg_loss is not None:
            log.info(f"[Round {server_round}] loss={agg_loss:.4f}  {metrics}")

            if agg_loss < self.best_loss:
                self.best_loss  = agg_loss
                self.best_round = server_round
                log.info(f"🏆 New best  round={server_round}  loss={agg_loss:.4f}")
                self._save_best(server_round)

        return agg_loss, metrics

    def _save_best(self, round_num: int):
        """Save best round weights to .pth and export ONNX."""
        src = WEIGHTS_DIR / f"round_{round_num:04d}.npy"
        if not src.exists():
            log.warn(f"Round file {src.name} not found")
            return
        
        try:
            # 1. copy aggregated weights to best.npy
            shutil.copy(str(src), str(WEIGHTS_DIR / "best.npy"))
            log.info(f"✓ Copied round weights → best.npy")

            # 2. load weight arrays from .npy
            weights = list(np.load(str(src), allow_pickle=True))

            # 3. rebuild seq2seq model
            tok   = CharTokenizer.load(str(S2S_TOK))
            model = _build_corrector(tok)

            # 4. map weights to state dict
            sd = OrderedDict({
                k: torch.tensor(v)
                for k, v in zip(model.state_dict().keys(), weights)
            })
            model.load_state_dict(sd, strict=True)
            torch.save(model.state_dict(), str(COR_PTH))
            log.info(f"✓ .pth saved → {COR_PTH.name}")

            # 5. export ONNX for frontend
            export_onnx()

        except Exception as e:
            log.error(f"_save_best failed: {e}", exc_info=True)


# ── public runner functions (called by fl/main.py) ────────────────────────────
def run_corrector_server(
    host: str = "0.0.0.0",
    port: int = 8080,
    num_rounds: int = 10,
    min_clients: int = 2,
    batch_size: int = 32,
):
    """
    Start Flower FL Server for Nepali Seq2Seq Correction.
    
    Args:
        host: Server address (default 0.0.0.0)
        port: Server port (default 8080)
        num_rounds: Number of federated learning rounds
        min_clients: Minimum clients per round
        batch_size: Training batch size (default 32)
    """
    strategy = NepaliCorrectionFedAvg(
        fraction_fit=1.0,
        fraction_evaluate=1.0,
        min_fit_clients=min_clients,
        min_evaluate_clients=min_clients,
        min_available_clients=min_clients,
        on_fit_config_fn=lambda r: {
            "lr": 1e-4,
            "epochs": 2,
            "batch_size": batch_size,
        },
    )
    log.info(
        f"[Nepali Correction] FL server → {host}:{port}  "
        f"rounds={num_rounds}  min_clients={min_clients}  batch_size={batch_size}"
    )
    fl.server.start_server(
        server_address=f"{host}:{port}",
        config=fl.server.ServerConfig(num_rounds=num_rounds),
        strategy=strategy,
    )
    log.info(
        f"[Nepali Correction] done  best_round={strategy.best_round}  "
        f"best_loss={strategy.best_loss:.4f}"
    )

"""
fl/routes.py

Bridge API — FastAPI app on port 8082.
Frontend (ONNX Runtime Web) talks ONLY to this.

Endpoints:
  GET  /health                     → status of all files
  GET  /model/{type}/onnx          → download detector.onnx / corrector.onnx
  GET  /weights/best               → download best aggregated weights
  GET  /weights/round/{n}          → download weights from round N
  GET  /metrics                    → FL round metrics
  GET  /status                     → overall FL status
"""

import sys
import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

sys.path.append(str(Path(__file__).resolve().parent.parent))

log = logging.getLogger(__name__)

ROOT        = Path(__file__).resolve().parent.parent
MODELS_DIR  = ROOT / "models"
WEIGHTS_DIR = MODELS_DIR / "weights"
ONNX_DIR    = MODELS_DIR / "onnx"
LOGS_DIR    = ROOT / "logs"
METRICS_F   = LOGS_DIR / "fl_metrics.jsonl"

# ── FastAPI app ────────────────────────────────────────────────────────────────
bridge_app = FastAPI(title="Nepali Grammar FL Bridge", version="1.0.0")

bridge_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── endpoints ──────────────────────────────────────────────────────────────────

@bridge_app.get("/health")
def health():
    """Check which files exist."""
    return {
        "status":           "ok",
        "detector_pth":     (MODELS_DIR / "detector_best.pth").exists(),
        "corrector_pth":    (MODELS_DIR / "seq2seq_best.pth").exists(),
        "detector_onnx":    (ONNX_DIR / "detector.onnx").exists(),
        "corrector_onnx":   (ONNX_DIR / "corrector.onnx").exists(),
        "best_weights":     (WEIGHTS_DIR / "best.npy").exists(),
    }


@bridge_app.get("/model/{model_type}/onnx")
def download_onnx(model_type: str):
    """
    Download ONNX model for in-browser inference.

    Frontend usage:
        const buf  = await fetch("http://localhost:8082/model/detector/onnx")
                           .then(r => r.arrayBuffer());
        const sess = await ort.InferenceSession.create(buf);
    """
    if model_type not in ("detector", "corrector"):
        raise HTTPException(400, "model_type must be detector or corrector")
    path = ONNX_DIR / f"{model_type}.onnx"
    if not path.exists():
        raise HTTPException(
            404,
            f"{model_type}.onnx not found — run FL training first."
        )
    return FileResponse(str(path), filename=f"{model_type}.onnx",
                        media_type="application/octet-stream")


@bridge_app.get("/weights/best")
def download_best_weights():
    """
    Download best aggregated weights (.npy).
    Frontend uses this to load weights before local training.
    """
    path = WEIGHTS_DIR / "best.npy"
    if not path.exists():
        raise HTTPException(404, "No best weights yet — complete at least one FL round.")
    return FileResponse(str(path), filename="best_weights.npy",
                        media_type="application/octet-stream")


@bridge_app.get("/weights/round/{round_num}")
def download_round_weights(round_num: int):
    """Download weights from a specific round."""
    path = WEIGHTS_DIR / f"round_{round_num:04d}.npy"
    if not path.exists():
        raise HTTPException(404, f"Weights for round {round_num} not found.")
    return FileResponse(str(path), filename=f"round_{round_num}_weights.npy",
                        media_type="application/octet-stream")


@bridge_app.get("/metrics")
def get_metrics():
    """Get metrics from all completed FL rounds."""
    if not METRICS_F.exists():
        return []
    return [
        json.loads(line)
        for line in METRICS_F.read_text().splitlines()
        if line.strip()
    ]


@bridge_app.get("/status")
def get_status():
    """Overall FL status — rounds completed, latest round number."""
    rounds = sorted(WEIGHTS_DIR.glob("round_*.npy"))
    latest = int(rounds[-1].stem.replace("round_", "")) if rounds else 0
    return {
        "detector_onnx_ready":  (ONNX_DIR / "detector.onnx").exists(),
        "corrector_onnx_ready": (ONNX_DIR / "corrector.onnx").exists(),
        "best_weights_ready":   (WEIGHTS_DIR / "best.npy").exists(),
        "rounds_completed":     len(rounds),
        "latest_round":         latest,
    }

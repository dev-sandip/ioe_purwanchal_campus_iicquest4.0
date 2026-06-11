"""
fl/routes.py

Bridge API — FastAPI app on port 8082.
Frontend (ONNX Runtime Web) talks ONLY to this.

Endpoints:
  GET  /health                     → status of all files
  GET  /model/corrector/onnx       → download notebook corrector ONNX
  GET  /weights/best               → download best aggregated weights
  GET  /weights/round/{n}          → download weights from round N
  GET  /metrics                    → FL round metrics
  GET  /status                     → overall FL status
  POST /simulation/start           → start local backend Flower simulation
  POST /simulation/stop            → request simulation stop
  GET  /simulation/status          → current simulation state
"""

import sys
import json
import logging
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.append(str(Path(__file__).resolve().parent.parent))

log = logging.getLogger(__name__)

ROOT        = Path(__file__).resolve().parent.parent
MODELS_DIR  = ROOT / "models"
WEIGHTS_DIR = MODELS_DIR / "weights"
ONNX_DIR    = MODELS_DIR / "onnx"
LOGS_DIR    = ROOT / "logs"
METRICS_F   = LOGS_DIR / "fl_metrics.jsonl"


class SimulationRequest(BaseModel):
    model: str = Field("corrector", description="corrector or both")
    rounds: int = Field(10, ge=1, le=100)
    clients: int = Field(3, ge=1, le=50)
    batch_size: int = Field(32, ge=1, le=1024)
    epochs: int = Field(2, ge=1, le=50)
    lr: float = Field(1e-4, gt=0)
    continuous: bool = False
    delay: float = Field(0.0, ge=0.0)
    csv: str = str(ROOT / "data" / "right_wrong.csv")
    tokenizer: str = str(MODELS_DIR / "nepali_correction_tokenizer.json")


_simulation_lock = threading.Lock()
_simulation_stop = threading.Event()
_simulation_thread: threading.Thread | None = None
_simulation_status = None

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
        "corrector_pth":    (MODELS_DIR / "nepali_correction_best.pth").exists(),
        "corrector_tokenizer": (MODELS_DIR / "nepali_correction_tokenizer.json").exists(),
        "corrector_onnx":   (ONNX_DIR / "nepali_corrector.onnx").exists(),
        "best_weights":     (WEIGHTS_DIR / "best.npy").exists(),
    }


@bridge_app.get("/model/{model_type}/onnx")
def download_onnx(model_type: str):
    """
    Download ONNX model for in-browser inference.

    Frontend usage:
        const buf  = await fetch("http://localhost:8082/model/corrector/onnx")
                           .then(r => r.arrayBuffer());
        const sess = await ort.InferenceSession.create(buf);
    """
    if model_type != "corrector":
        raise HTTPException(400, "model_type must be corrector")
    path = ONNX_DIR / "nepali_corrector.onnx"
    if not path.exists():
        raise HTTPException(
            404,
            "nepali_corrector.onnx not found — run FL training or export_onnx first."
        )
    return FileResponse(str(path), filename="nepali_corrector.onnx",
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
        "corrector_onnx_ready": (ONNX_DIR / "nepali_corrector.onnx").exists(),
        "best_weights_ready":   (WEIGHTS_DIR / "best.npy").exists(),
        "rounds_completed":     len(rounds),
        "latest_round":         latest,
    }


@bridge_app.post("/simulation/start")
def start_simulation(req: SimulationRequest):
    """Start a local Flower simulation in a background thread."""
    global _simulation_thread, _simulation_status

    if req.model not in ("corrector", "both"):
        raise HTTPException(400, "new_fl supports model='corrector' or model='both'")

    with _simulation_lock:
        if _simulation_thread is not None and _simulation_thread.is_alive():
            raise HTTPException(409, "simulation already running")

        from new_fl.simulate import SimulationStatus, run_simulation

        _simulation_stop.clear()
        _simulation_status = SimulationStatus(
            model=req.model,
            total_rounds=req.rounds,
            clients=req.clients,
            continuous=req.continuous,
        )

        def target():
            run_simulation(
                n_clients=req.clients,
                n_rounds=req.rounds,
                continuous=req.continuous,
                delay=req.delay,
                stop_event=_simulation_stop,
                status=_simulation_status,
                csv_path=req.csv,
                tokenizer_path=req.tokenizer,
                batch_size=req.batch_size,
                epochs=req.epochs,
                lr=req.lr,
            )

        _simulation_thread = threading.Thread(target=target, daemon=True)
        _simulation_thread.start()
        return _simulation_status.to_dict()


@bridge_app.post("/simulation/stop")
def stop_simulation():
    """
    Request simulation stop.

    Flower cannot be interrupted safely in the middle of a round from this thread,
    so the process stops at the next simulation boundary.
    """
    with _simulation_lock:
        if _simulation_thread is None or not _simulation_thread.is_alive():
            return {"running": False, "stop_requested": False}
        _simulation_stop.set()
        if _simulation_status is not None:
            _simulation_status.stop_requested = True
            return _simulation_status.to_dict()
        return {"running": True, "stop_requested": True}


@bridge_app.get("/simulation/status")
def simulation_status():
    """Get current background simulation status."""
    with _simulation_lock:
        if _simulation_status is None:
            return {
                "running": False,
                "stop_requested": False,
                "model": "corrector",
                "round": 0,
                "total_rounds": 0,
                "clients": 0,
                "continuous": False,
                "cycle": 0,
                "metrics": [],
                "error": None,
            }
        return _simulation_status.to_dict()

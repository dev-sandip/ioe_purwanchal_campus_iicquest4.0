"""
fl_routes.py

FastAPI routes for client-side Federated Learning (ONNX.js frontend).

All FL endpoints live under /fl/*

Endpoints:
  POST /fl/initialize                  → start FL session
  GET  /fl/state                       → current state
  GET  /fl/round/{n}/progress          → how many clients submitted
  POST /fl/round/{n}/upload            → client uploads weights (.npz)
  POST /fl/round/{n}/aggregate         → trigger FedAvg
  GET  /fl/round/{n}/weights           → download aggregated .npz
  GET  /fl/weights/latest              → download best .npz so far
  GET  /fl/model/{type}/onnx           → download .onnx file for frontend
  GET  /fl/metrics                     → training metrics list
  GET  /fl/summary                     → full summary
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.another_fl.fl_server import get_fl_manager

log = logging.getLogger(__name__)
router = APIRouter(prefix="/fl", tags=["federated_learning"])


# ── request / response models ──────────────────────────────────────────────────

class InitRequest(BaseModel):
    model: str      = Field("corrector", description="corrector")
    num_rounds: int = Field(10, ge=1, le=100)
    min_clients: int = Field(2, ge=1, le=50)


# ── endpoints ──────────────────────────────────────────────────────────────────

@router.post("/initialize")
async def initialize(req: InitRequest):
    """
    Start a new FL training session.

    Call once before clients begin training.

    Request:
        {"model": "detector", "num_rounds": 10, "min_clients": 2}

    Response:
        {"status": "initialized", "model": "detector", ...}
    """
    if req.model != "corrector":
        raise HTTPException(400, "model must be 'corrector'")
    try:
        return get_fl_manager().initialize(req.model, req.num_rounds, req.min_clients)
    except Exception as e:
        log.error(f"initialize error: {e}")
        raise HTTPException(500, str(e))


@router.get("/state")
async def state():
    """
    Get current FL training state.

    Response:
        {
          "initialized": true,
          "model": "detector",
          "current_round": 2,
          "num_rounds": 10,
          "min_clients": 2,
          "best_round": 1,
          "best_loss": 0.312
        }
    """
    return get_fl_manager().get_state()


@router.get("/round/{round_num}/progress")
async def round_progress(round_num: int):
    """
    How many clients have submitted for this round.

    Response:
        {
          "round": 1,
          "submitted": 1,
          "required": 2,
          "ready": false,
          "clients": ["client_0"]
        }
    """
    fl = get_fl_manager()
    return fl.state.progress(round_num)


@router.post("/round/{round_num}/upload")
async def upload_weights(
    round_num: int,
    file: UploadFile       = File(...,  description="NPZ file of model weights"),
    client_id: str         = Form(...,  description="Unique client ID"),
    num_samples: int       = Form(...,  description="Number of local training samples"),
    loss: float            = Form(...,  description="Local training loss"),
    accuracy: Optional[float] = Form(None, description="Local training accuracy"),
):
    """
    Client uploads locally-trained weights.

    The frontend (ONNX.js) trains locally, extracts weights,
    saves them as .npz, and posts here.

    Form fields:
        file        - weights.npz
        client_id   - e.g. "user_abc"
        num_samples - 100
        loss        - 0.45
        accuracy    - 0.88  (optional)

    Response:
        {
          "status": "submitted",
          "round": 1,
          "client_id": "user_abc",
          "can_aggregate": false,
          "progress": {"submitted": 1, "required": 2, ...}
        }
    """
    if not file.filename.endswith(".npz"):
        raise HTTPException(400, "File must be a .npz file")

    try:
        raw = await file.read()
        if not raw:
            raise HTTPException(400, "Empty file")

        return get_fl_manager().receive_weights(
            round_num, client_id, raw, num_samples, loss, accuracy
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"upload error: {e}")
        raise HTTPException(500, str(e))


@router.post("/round/{round_num}/aggregate")
async def aggregate(round_num: int):
    """
    Trigger FedAvg aggregation for a round.

    Call after all required clients have uploaded weights.
    Returns aggregated metrics and whether this is the best round so far.

    Response:
        {
          "status": "aggregated",
          "round": 1,
          "agg_loss": 0.312,
          "agg_accuracy": 0.89,
          "is_best": true,
          "num_clients": 2
        }
    """
    try:
        return get_fl_manager().aggregate(round_num)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.error(f"aggregate error: {e}")
        raise HTTPException(500, str(e))


@router.get("/round/{round_num}/weights")
async def download_round_weights(round_num: int):
    """
    Download aggregated weights for a specific round as .npz.

    Frontend loads this for the next round of local training.
    Falls back to best or initial weights if round not aggregated yet.
    """
    path = get_fl_manager().weights_npz_path(round_num)
    if path is None:
        raise HTTPException(404, "No weights available yet")
    return FileResponse(
        str(path),
        filename=f"weights_round_{round_num}.npz",
        media_type="application/octet-stream",
    )


@router.get("/weights/latest")
async def download_latest_weights():
    """
    Download the best aggregated weights so far as .npz.

    Use this to get the current best model weights.
    """
    path = get_fl_manager().weights_npz_path()
    if path is None:
        raise HTTPException(404, "No weights available yet")
    return FileResponse(
        str(path),
        filename="best_weights.npz",
        media_type="application/octet-stream",
    )


@router.get("/model/{model_type}/onnx")
async def download_onnx(model_type: str):
    """
    Download the ONNX model file for frontend inference.

    model_type: "detector" or "corrector"

    The frontend (ONNX Runtime Web) loads this to run inference in-browser.
    ONNX is also re-exported whenever a new best model is saved.
    """
    if model_type != "corrector":
        raise HTTPException(400, "model_type must be 'corrector'")

    path = get_fl_manager().onnx_path(model_type)
    if path is None:
        raise HTTPException(
            404,
            f"{model_type}.onnx not found. "
            f"Ensure {model_type}_best.pth exists and FL is initialized."
        )
    return FileResponse(
        str(path),
        filename=f"{model_type}.onnx",
        media_type="application/octet-stream",
    )


@router.get("/metrics")
async def metrics(skip: int = 0, limit: int = 100):
    """
    Get FL training metrics for all completed rounds.

    Response:
        [
          {
            "round": 1,
            "timestamp": "...",
            "agg_loss": 0.312,
            "agg_accuracy": 0.89,
            "num_clients": 2,
            "is_best": true
          }
        ]
    """
    all_m = get_fl_manager().get_metrics()
    return all_m[skip: skip + limit]


@router.get("/summary")
async def summary():
    """
    Full FL training summary: state + latest metrics.

    Response:
        {
          "state": {...},
          "latest_metrics": [...],
          "progress_current_round": {...}
        }
    """
    fl = get_fl_manager()
    s  = fl.get_state()
    m  = fl.get_metrics()
    return {
        "state":                   s,
        "latest_metrics":          m[-5:],
        "progress_current_round":  fl.state.progress(s["current_round"]),
    }


@router.get("/health")
async def health():
    return {"status": "ok", "service": "fl"}

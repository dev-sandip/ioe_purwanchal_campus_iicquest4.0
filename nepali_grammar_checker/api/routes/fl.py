"""
FL control routes — start training, check status, reload models.
Runs FL simulation in a background thread so the API stays responsive.
"""
import threading
from fastapi import APIRouter, HTTPException, BackgroundTasks
from api.schemas import FLRequest, FLStatusResponse
from api.dependencies import reload_models

router = APIRouter()

# Global FL state
_fl_state = {
    "running":      False,
    "model":        "",
    "round":        0,
    "total_rounds": 0,
    "metrics":      [],
    "error":        None,
}
_fl_lock = threading.Lock()


def _run_fl(model: str, rounds: int, clients: int):
    global _fl_state
    with _fl_lock:
        _fl_state["running"]      = True
        _fl_state["model"]        = model
        _fl_state["total_rounds"] = rounds
        _fl_state["round"]        = 0
        _fl_state["metrics"]      = []
        _fl_state["error"]        = None

    try:
        from fl.simulate import simulate_detector, simulate_corrector

        if model in ("detector", "both"):
            simulate_detector(n_clients=clients, n_rounds=rounds)
        if model in ("corrector", "both"):
            simulate_corrector(n_clients=clients, n_rounds=rounds)

        # Reload models in API after training
        reload_models()

    except Exception as e:
        with _fl_lock:
            _fl_state["error"] = str(e)
    finally:
        with _fl_lock:
            _fl_state["running"] = False


@router.post("/fl/start", response_model=FLStatusResponse)
def start_fl(req: FLRequest, background_tasks: BackgroundTasks):
    if _fl_state["running"]:
        raise HTTPException(status_code=409, detail="FL training already running")

    background_tasks.add_task(_run_fl, req.model, req.rounds, req.clients)

    return FLStatusResponse(
        running=True,
        model=req.model,
        round=0,
        total_rounds=req.rounds,
        metrics=[],
    )


@router.get("/fl/status", response_model=FLStatusResponse)
def fl_status():
    with _fl_lock:
        state = dict(_fl_state)
    return FLStatusResponse(
        running=state["running"],
        model=state["model"],
        round=state["round"],
        total_rounds=state["total_rounds"],
        metrics=state["metrics"],
    )


@router.post("/fl/reload")
def fl_reload():
    """Manually reload model weights from disk (e.g. after external training)."""
    reload_models()
    return {"status": "models reloaded"}

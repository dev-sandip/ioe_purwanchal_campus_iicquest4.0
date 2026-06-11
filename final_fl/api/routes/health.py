from fastapi import APIRouter
from api.schemas import HealthResponse
from api.dependencies import get_device, get_detector, get_corrector

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health():
    device = get_device()
    try:
        get_detector()
        det_loaded = True
    except Exception:
        det_loaded = False
    try:
        get_corrector()
        cor_loaded = True
    except Exception:
        cor_loaded = False

    return HealthResponse(
        status="ok",
        device=str(device),
        detector_loaded=det_loaded,
        corrector_loaded=cor_loaded,
    )

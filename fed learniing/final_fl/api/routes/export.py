import os
import zipfile
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from api.schemas import RoundInfo

router = APIRouter()

MODELS_DIR     = Path("models")
CHECKPOINTS    = MODELS_DIR / "checkpoints"
DET_PTH        = MODELS_DIR / "detector_best.pth"
DET_TOK        = Path("data/detect_char_tokenizer.json")
S2S_PTH        = MODELS_DIR / "nepali_correction_best.pth"
S2S_TOK        = MODELS_DIR / "nepali_correction_tokenizer.json"


@router.get("/export/detector")
def export_detector():
    """Download the current best detector weights (.pth)."""
    if not DET_PTH.exists():
        raise HTTPException(status_code=404, detail="Detector model not found")
    return FileResponse(
        path=str(DET_PTH),
        filename="detector_best.pth",
        media_type="application/octet-stream",
    )


@router.get("/export/corrector")
def export_corrector():
    """Download the current best corrector weights (.pth)."""
    if not S2S_PTH.exists():
        raise HTTPException(status_code=404, detail="Corrector model not found")
    return FileResponse(
        path=str(S2S_PTH),
        filename="nepali_correction_best.pth",
        media_type="application/octet-stream",
    )


@router.get("/export/tokenizers")
def export_tokenizers():
    """Download both tokenizer JSONs as a zip."""
    if not DET_TOK.exists() or not S2S_TOK.exists():
        raise HTTPException(status_code=404, detail="Tokenizer files not found")

    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(DET_TOK, "detect_char_tokenizer.json")
        zf.write(S2S_TOK, "nepali_correction_tokenizer.json")

    return FileResponse(
        path=tmp.name,
        filename="tokenizers.zip",
        media_type="application/zip",
    )


@router.get("/export/rounds", response_model=list[RoundInfo])
def list_rounds():
    """List all saved FL round checkpoints."""
    if not CHECKPOINTS.exists():
        return []
    results = []
    for f in sorted(CHECKPOINTS.glob("*.npz")):
        parts = f.stem.split("_round_")
        model_name = parts[0] if len(parts) == 2 else f.stem
        rnd        = int(parts[1]) if len(parts) == 2 else 0
        results.append(RoundInfo(
            round=rnd,
            model=model_name,
            path=str(f),
            size_bytes=f.stat().st_size,
        ))
    return results


@router.get("/export/rounds/{model}/{round_num}")
def download_round(model: str, round_num: int):
    """Download weights from a specific FL round."""
    if model not in ("detector", "corrector"):
        raise HTTPException(status_code=400, detail="model must be detector or corrector")
    path = CHECKPOINTS / f"{model}_round_{round_num}.npz"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Round {round_num} not found for {model}")
    return FileResponse(
        path=str(path),
        filename=f"{model}_round_{round_num}.npz",
        media_type="application/octet-stream",
    )

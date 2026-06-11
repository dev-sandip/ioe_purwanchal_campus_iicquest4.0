from fastapi import APIRouter
from api.schemas import SentenceRequest, CheckResponse, WordDetail, Suggestion
from api.dependencies import (
    get_detector, get_corrector,
    get_detect_tokenizer, get_correct_tokenizer, get_device
)
from core.inference import predict_sentence

router = APIRouter()


@router.post("/check", response_model=CheckResponse)
def check(req: SentenceRequest):
    result = predict_sentence(
        text=req.sentence,
        detector=get_detector(),
        corrector=get_corrector(),
        detect_tok=get_detect_tokenizer(),
        correct_tok=get_correct_tokenizer(),
        device=get_device(),
        threshold=req.threshold,
        beam_width=req.beam_width,
    )
    details = [
        WordDetail(
            word=d["word"],
            status=d["status"],
            confidence=d["confidence"],
            suggestions=[Suggestion(**s) for s in d["suggestions"]],
            corrected=d["corrected"],
        )
        for d in result["details"]
    ]
    return CheckResponse(
        input=result["input"],
        output=result["output"],
        status=result["status"],
        details=details,
    )

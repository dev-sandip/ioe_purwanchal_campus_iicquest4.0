from fastapi import APIRouter
from api.schemas import WordRequest, DetectResponse
from api.dependencies import get_detector, get_detect_tokenizer, get_device
from core.inference import detect_word

router = APIRouter()


@router.post("/detect", response_model=DetectResponse)
def detect(req: WordRequest):
    result = detect_word(
        word=req.word,
        model=get_detector(),
        tokenizer=get_detect_tokenizer(),
        device=get_device(),
    )
    return DetectResponse(**result)

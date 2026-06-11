from fastapi import APIRouter
from api.schemas import WordRequest, CorrectResponse, Suggestion
from api.dependencies import get_corrector, get_correct_tokenizer, get_device
from core.inference import correct_word_beam

router = APIRouter()


@router.post("/correct", response_model=CorrectResponse)
def correct(req: WordRequest):
    suggestions = correct_word_beam(
        wrong_word=req.word,
        model=get_corrector(),
        tokenizer=get_correct_tokenizer(),
        device=get_device(),
    )
    return CorrectResponse(
        word=req.word,
        suggestions=[Suggestion(**s) for s in suggestions],
    )

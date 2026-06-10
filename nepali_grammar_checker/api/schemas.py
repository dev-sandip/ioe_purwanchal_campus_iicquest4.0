from pydantic import BaseModel, Field


# ── Requests ──────────────────────────────────────────────────────────────────

class WordRequest(BaseModel):
    word: str = Field(..., example="ीसरय")

class SentenceRequest(BaseModel):
    sentence: str  = Field(..., example="ीसरय नेपालमा वतु्स पिबी")
    threshold: float = Field(0.5, ge=0.0, le=1.0)
    beam_width: int  = Field(5,   ge=1,   le=10)

class FLRequest(BaseModel):
    model:   str = Field("both", example="both")   # detector | corrector | both
    rounds:  int = Field(10, ge=1, le=100)
    clients: int = Field(3,  ge=2, le=10)


# ── Responses ─────────────────────────────────────────────────────────────────

class DetectResponse(BaseModel):
    word:       str
    correct:    bool
    confidence: float

class Suggestion(BaseModel):
    word:  str
    score: float

class CorrectResponse(BaseModel):
    word:        str
    suggestions: list[Suggestion]

class WordDetail(BaseModel):
    word:        str
    status:      str          # "correct" | "wrong"
    confidence:  float
    suggestions: list[Suggestion]
    corrected:   str

class CheckResponse(BaseModel):
    input:   str
    output:  str
    status:  str              # "ok" | "corrected"
    details: list[WordDetail]

class HealthResponse(BaseModel):
    status:           str
    device:           str
    detector_loaded:  bool
    corrector_loaded: bool

class FLStatusResponse(BaseModel):
    running:     bool
    model:       str
    round:       int
    total_rounds: int
    metrics:     list[dict]

class RoundInfo(BaseModel):
    round:      int
    model:      str
    path:       str
    size_bytes: int

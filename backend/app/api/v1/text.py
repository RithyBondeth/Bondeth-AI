from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.text.khmer_normalizer import normalize_khmer

router = APIRouter(prefix="/text", tags=["text"])


class NormalizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class NormalizeResponse(BaseModel):
    original: str
    normalized: str


@router.post("/normalize", response_model=NormalizeResponse)
def normalize(req: NormalizeRequest) -> NormalizeResponse:
    """Preview how text will be verbalized before it is sent to TTS."""
    return NormalizeResponse(original=req.text, normalized=normalize_khmer(req.text))

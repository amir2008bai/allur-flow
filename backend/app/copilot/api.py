"""API копилота."""
from fastapi import APIRouter
from pydantic import BaseModel, Field

from .agent import ask

router = APIRouter(prefix="/api/copilot")


class Ask(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    history: list[dict] = []
    offline: bool = False
    scenario: str = Field("paint_degradation", pattern="^(base|paint_degradation|conveyor_break|day:\d{4}-\d{2}-\d{2}|stress:[a-z_]+|chaos:[a-z_,]+|cfg:[a-z_,]*\|[a-z_,]*(\|[a-z_@+;0-9]*)?)$")
    seed: int = 7
    view: dict = {}


@router.post("")
def copilot(body: Ask) -> dict:
    res = ask(body.message, body.history, body.offline, body.scenario, body.seed, body.view)
    sources = sorted({str(t["result"].get("source")) for t in res["tools"] if isinstance(t.get("result"), dict) and t["result"].get("source")})
    return {**res, "sources": sources}

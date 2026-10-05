"""API самообучения: прогноз до факта, калибровка по вводу людей, тревоги «да/нет»."""
from __future__ import annotations

import time
from functools import lru_cache

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import connect
from .alerts import AlertLearner
from .calib import Calibrator
from .forecast import run_learning

router = APIRouter(prefix="/api/learn")
SHOWCASE_SEED = 11
_alerts: AlertLearner | None = None
_calib: Calibrator | None = None
_con = None


def alerts() -> AlertLearner:
    global _alerts
    if _alerts is None:
        _alerts = AlertLearner()
    return _alerts


def calib() -> Calibrator:
    global _calib
    if _calib is None:
        _calib = Calibrator()
    return _calib


def con():
    global _con
    if _con is None:
        _con = connect()
    return _con


@lru_cache(maxsize=1)
def forecast_payload() -> dict:
    show = run_learning(SHOWCASE_SEED)
    runs = [run_learning(s)["summary"] for s in range(11, 21)]
    agg = {k: float(np.mean([r[k]["mae_after_drift"] for r in runs])) for k in ("champion", "frozen", "naive", "plan")}
    show["multi_seed"] = {
        "seeds": 10, "mae_after_drift": agg,
        "beats_frozen": sum(r["champion"]["mae_after_drift"] < r["frozen"]["mae_after_drift"] for r in runs),
        "beats_naive": sum(r["champion"]["mae_after_drift"] < r["naive"]["mae_after_drift"] for r in runs),
        "gain_vs_frozen": 1 - agg["champion"] / agg["frozen"],
    }
    return show


@router.get("/forecast")
def forecast() -> dict:
    return forecast_payload()


class CalibIn(BaseModel):
    produced: int = Field(gt=0, le=1000)
    defects: int = Field(ge=0, le=1000)
    who: str = Field("", max_length=40)


@router.get("/calib")
def calib_state() -> dict:
    return calib().state()


@router.post("/calib")
def calib_add(body: CalibIn) -> dict:
    try:
        return calib().add(body.produced, body.defects, body.who)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/calib/undo")
def calib_undo() -> dict:
    return calib().undo()


class VoteIn(BaseModel):
    alert_id: str
    verdict: str = Field(pattern="^(confirm|reject)$")
    voter: str = Field("", max_length=40)


@router.get("/alerts/next")
def next_card(skip: str = "") -> dict:
    card = alerts().next_card(set(filter(None, skip.split(","))))
    return {"card": card}


@router.post("/alerts/vote")
def vote(body: VoteIn) -> dict:
    try:
        st = alerts().vote(body.alert_id, body.verdict, body.voter)
    except KeyError:
        raise HTTPException(404, "Нет такой тревоги")
    con().execute("INSERT INTO feedback (alert_id, verdict, reason, user_role, created_at) VALUES (?,?,?,?,?)",
                  (body.alert_id, body.verdict, None, body.voter or "jury", time.time()))
    con().commit()
    return st


@router.post("/alerts/simulate")
def simulate_votes(n: int = 10) -> dict:
    return alerts().simulate_votes(max(1, min(n, 50)))


@router.get("/alerts/state")
def alerts_state() -> dict:
    return alerts().state()


@router.post("/reset")
def reset() -> dict:
    alerts().reset()
    calib().reset()
    return {"ok": True}

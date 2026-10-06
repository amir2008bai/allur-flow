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
    agg = {k: float(np.mean([r[k]["mae_after_drift"] for r in runs])) for k in ("champion", "served", "frozen", "naive", "plan")}
    show["multi_seed"] = {
        "seeds": 10, "mae_after_drift": agg,
        "beats_frozen": sum(r["served"]["mae_after_drift"] < r["frozen"]["mae_after_drift"] for r in runs),
        "beats_naive": sum(r["served"]["mae_after_drift"] < r["naive"]["mae_after_drift"] for r in runs),
        "gain_vs_frozen": 1 - agg["served"] / agg["frozen"],
        "gain_vs_naive": 1 - agg["served"] / agg["naive"],
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


# ── Камера контроля ЛКП ─────────────────────────────────────────────────────
# Формат события совместим с камерой контроля окраски (идея из кейса Allur Challenge 2025 — распознавание
# дефектов ЛКП по фото). Мы НЕ интегрированы с их решением: принимаем события любой такой камеры.
import random as _random
from collections import deque as _deque
from typing import Literal

_camera_log: _deque = _deque(maxlen=30)
DEFECT_CLASSES = ["подтёк", "сорность", "кратер", "шагрень", "непрокрас"]


class CameraEvent(BaseModel):
    event_type: Literal["paint_defect", "paint_ok"]
    asset_id: str = Field("paint.booth02", max_length=60)
    body_id: str | None = Field(None, max_length=40)
    defect_class: str | None = Field(None, max_length=40)
    ts: float | None = None
    source: Literal["cv_camera", "sim_camera"] = "cv_camera"


def _ingest(ev: CameraEvent) -> None:
    ts = ev.ts or time.time()
    defect = ev.event_type == "paint_defect"
    calib().add_camera(defect, "feedback" if ev.source == "cv_camera" else "sim", f"{ev.source}:{ev.asset_id}:{ev.body_id or '-'}")
    _camera_log.appendleft({"ts": ts, "defect": defect, "defect_class": ev.defect_class, "body_id": ev.body_id, "source": ev.source})


@router.post("/camera/event", tags=["камера ЛКП"])
def camera_event(ev: CameraEvent) -> dict:
    """Вход для камеры контроля окраски: одно событие = один осмотренный кузов."""
    _ingest(ev)
    return {"ok": True, "seen": calib().camera_seen}


@router.post("/camera/demo")
def camera_demo(n: int = 20, true_rate: float = 0.06) -> dict:
    """Демо-поток камеры (симуляция): n кузовов со скрытой долей брака true_rate."""
    rnd = _random.Random(len(_camera_log) + calib().camera_seen)
    base = 70000 + calib().camera_seen
    for i in range(max(1, min(n, 100))):
        d = rnd.random() < true_rate
        _ingest(CameraEvent(event_type="paint_defect" if d else "paint_ok", body_id=f"K{base + i}",
                            defect_class=rnd.choice(DEFECT_CLASSES) if d else None, source="sim_camera"))
    return camera_state()


@router.get("/camera")
def camera_state() -> dict:
    return {"seen": calib().camera_seen, "defects": calib().camera_defects, "log": list(_camera_log), "calib": calib().state()}


@router.post("/reset")
def reset() -> dict:
    alerts().reset()
    calib().reset()
    _camera_log.clear()
    return {"ok": True}

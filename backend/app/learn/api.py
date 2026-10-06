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
    keys = [k for k in ("champion", "served", "frozen", "naive", "plan", "tsfm", "chronos", "lgbm", "ens") if all(k in r for r in runs)]
    agg = {k: float(np.mean([r[k]["mae_after_drift"] for r in runs])) for k in keys}
    show["multi_seed"] = {
        "seeds": 10, "mae_after_drift": agg,
        "beats_frozen": sum(r["served"]["mae_after_drift"] < r["frozen"]["mae_after_drift"] for r in runs),
        "beats_naive": sum(r["served"]["mae_after_drift"] < r["naive"]["mae_after_drift"] for r in runs),
        "gain_vs_frozen": 1 - agg["served"] / agg["frozen"],
        "gain_vs_naive": 1 - agg["served"] / agg["naive"],
        "interval": {"target": runs[0]["interval"]["target"],
                     "coverage": float(np.mean([r["interval"]["coverage"] for r in runs])),
                     "coverage_after_drift": float(np.mean([r["interval"]["coverage_after_drift"] for r in runs])),
                     "width": float(np.mean([r["interval"]["width"] for r in runs]))},
    }
    return show


TSFM_PATH = __import__("pathlib").Path(__file__).resolve().parents[3] / "data" / "tsfm_results.json"


def tsfm_summary() -> dict | None:
    """Foundation-модели как претенденты (посчитаны заранее scripts/tsfm_challengers.py)."""
    import json
    if not TSFM_PATH.exists():
        return None
    r = json.loads(TSFM_PATH.read_text(encoding="utf-8"))
    base = r["baselines"]
    models = []
    for m in r["models"]:
        if "error" in m:
            models.append({"model": m["model"], "error": m["error"]})
            continue
        models.append({"model": m["model"], "mae_after_drift": m["mae_after_drift"], "ms_per_forecast": m["ms_per_forecast"],
                       "vs_ours": 1 - m["mae_after_drift"] / base["served"],
                       "beats_naive": m["mae_after_drift"] < base["naive"],
                       "admitted": m["mae_after_drift"] < 0.95 * base["served"]})
    return {"device": r["device"], "seeds": len(r["seeds"]), "baselines": base, "models": models,
            "note": "Zero-shot: веса не меняются, модель видит только свежую историю. Прогноз до факта, те же 10 прогонов."}


@router.get("/forecast")
def forecast() -> dict:
    from . import global_model
    return {**forecast_payload(), "tsfm": tsfm_summary(), "global": global_model.status()}


@router.get("/retrain")
def retrain_status() -> dict:
    from . import global_model
    return global_model.status()


@router.post("/retrain")
def retrain(runs: int = 400) -> dict:
    """Дообучить глобальную модель на большом наборе смоделированных смен (в фоне)."""
    from . import global_model
    started = global_model.train_async(max(20, min(runs, 3000)), on_done=lambda e: forecast_payload.cache_clear())
    return {"started": started, **global_model.status()}


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

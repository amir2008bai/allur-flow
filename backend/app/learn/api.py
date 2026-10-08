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

from collections import deque as _deque_early

router = APIRouter(prefix="/api/learn")
_camera_log = _deque_early(maxlen=30)
SHOWCASE_SEED = 11
_alerts: AlertLearner | None = None
_calib: Calibrator | None = None
_con = None


def con():
    global _con
    if _con is None:
        _con = connect()
        _con.execute("""CREATE TABLE IF NOT EXISTS learning_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)""")
    return _con


# ── Журнал обучения: всё, чему люди и камера научили систему, хранится в SQLite и переживает перезапуск ──
def log_learning(kind: str, payload: dict) -> None:
    """kind: vote / calib_add / calib_undo / camera / reset. Пишем ДО применения — состояние восстанавливается проигрыванием."""
    import json as _json
    con().execute("INSERT INTO learning_log (ts, kind, payload) VALUES (?,?,?)", (time.time(), kind, _json.dumps(payload, ensure_ascii=False)))
    con().commit()


def _replay_rows() -> list[tuple[str, dict]]:
    import json as _json
    rows = con().execute("SELECT kind, payload FROM learning_log ORDER BY id").fetchall()
    last_reset = max((i for i, (k, _) in enumerate(rows) if k == "reset"), default=-1)
    return [(k, _json.loads(pl)) for k, pl in rows[last_reset + 1:]]


def alerts() -> AlertLearner:
    global _alerts
    if _alerts is None:
        a = AlertLearner()
        for kind, pl in _replay_rows():
            if kind == "vote":
                try:
                    a.vote(pl["alert_id"], pl["verdict"], pl.get("voter", ""), pl.get("simulated", False))
                except (KeyError, ValueError):
                    pass          # набор тревог изменился (другие данные) — старый ответ не к чему применить
        _alerts = a
    return _alerts


def calib() -> Calibrator:
    global _calib
    if _calib is None:
        c = Calibrator()
        _camera_log.clear()
        for kind, pl in _replay_rows():
            try:
                if kind == "calib_add":
                    c.add(pl["produced"], pl["defects"], pl.get("who", ""))
                elif kind == "calib_undo":
                    c.undo()
                elif kind == "camera":
                    c.add_camera(pl["defect"], pl["source"], pl["provenance"])
                    _camera_log.appendleft({k: pl.get(k) for k in ("ts", "defect", "defect_class", "body_id")} | {"source": pl.get("cam_source")})
            except (KeyError, ValueError):
                pass
        _calib = c
    return _calib


def learning_stats() -> dict:
    rows = _replay_rows()
    kinds = [k for k, _ in rows]
    return {"votes": kinds.count("vote"), "calib_inputs": kinds.count("calib_add"), "camera_events": kinds.count("camera"),
            "since": con().execute("SELECT MAX(ts) FROM learning_log WHERE kind='reset'").fetchone()[0]}


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
    if all("dip" in r for r in runs):
        from .global_model import DIP_COST_MISS
        d = [r["dip"] for r in runs]
        mean = lambda k: float(np.nanmean([x[k] for x in d if x[k] is not None]))  # noqa: E731
        show["multi_seed"]["dip"] = {"level": d[0]["level"], "threshold": d[0].get("threshold", 0.5), "warn_rate": mean("warn_rate"),
                                     "cost_miss": DIP_COST_MISS, "auc": mean("auc"), "auc_model_only": mean("auc_model_only"),
                                     "base_rate": mean("base_rate"), "precision": mean("precision"), "recall": mean("recall")}
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
        st = calib().add(body.produced, body.defects, body.who)
        log_learning("calib_add", {"produced": body.produced, "defects": body.defects, "who": body.who})
        return st
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/calib/undo")
def calib_undo() -> dict:
    log_learning("calib_undo", {})
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
        log_learning("vote", {"alert_id": body.alert_id, "verdict": body.verdict, "voter": body.voter})
    except KeyError:
        raise HTTPException(404, "Нет такой тревоги")
    con().execute("INSERT INTO feedback (alert_id, verdict, reason, user_role, created_at) VALUES (?,?,?,?,?)",
                  (body.alert_id, body.verdict, None, body.voter or "jury", time.time()))
    con().commit()
    return st


@router.post("/alerts/simulate")
def simulate_votes(n: int = 10) -> dict:
    a = alerts()
    before = len(a.votes)
    st = a.simulate_votes(max(1, min(n, 50)))
    for v in a.votes[before:]:
        log_learning("vote", {"alert_id": v["alert_id"], "verdict": v["verdict"], "voter": v["voter"], "simulated": True})
    return st


@router.get("/alerts/state")
def alerts_state() -> dict:
    return alerts().state()


# ── Камера контроля ЛКП ─────────────────────────────────────────────────────
# Формат события совместим с камерой контроля окраски (идея из кейса Allur Challenge 2025 — распознавание
# дефектов ЛКП по фото). Мы НЕ интегрированы с их решением: принимаем события любой такой камеры.
import random as _random
from collections import deque as _deque
from typing import Literal

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
    src, prov = ("feedback" if ev.source == "cv_camera" else "sim"), f"{ev.source}:{ev.asset_id}:{ev.body_id or '-'}"
    calib().add_camera(defect, src, prov)
    log_learning("camera", {"defect": defect, "source": src, "provenance": prov, "ts": ts, "defect_class": ev.defect_class,
                            "body_id": ev.body_id, "cam_source": ev.source})
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
    log_learning("reset", {})
    alerts().reset()
    calib().reset()
    _camera_log.clear()
    return {"ok": True}

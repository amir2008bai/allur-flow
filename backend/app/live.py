"""Живые данные с завода: приём событий датчиков / PLC / MES и текущее состояние линии.

Путь на заводе: PLC → OPC UA сервер (или MQTT) → шлюз (Node-RED / Kepware / свой скрипт) → POST /api/live/events.
Формат события простой и не зависит от поставщика оборудования (см. docs/INTEGRATION.md).

Для демо есть «эмулятор PLC»: он проигрывает смену симулятора и шлёт события в тот же вход, что и настоящий шлюз.
Все события пишутся в журнал (таблица events, source='fact', provenance='live:<источник>').
"""
from __future__ import annotations

import json
import threading
import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .db import connect
from .sim.params import STATION_ASSETS, STATION_RU, STATIONS

router = APIRouter(prefix="/api/live")
_con = None
_lock = threading.Lock()
STATE = {"stations": {s: {"state": None, "since": None} for s in STATIONS}, "good": 0, "defects": 0, "events": 0,
         "last_ts": None, "source": None, "started": None}
EMU = {"running": False, "speed": 0.0, "progress": 0.0}
STATES = ("working", "starved", "blocked", "down")


def con():
    global _con
    if _con is None:
        _con = connect()
    return _con


class LiveEvent(BaseModel):
    """Одно событие с линии. station — участок (welding/paint/assembly/qc) или asset_id оборудования из data/line.json."""
    ts: float | None = Field(None, description="время события, unix-секунды; нет — время приёма")
    station: str | None = Field(None, max_length=40)
    asset_id: str | None = Field(None, max_length=60)
    type: Literal["state", "good", "defect"]
    value: str | float | None = Field(None, description="state: working/starved/blocked/down; good: сколько годных (по умолчанию 1)")
    source: str = Field("gateway", max_length=40)


class Batch(BaseModel):
    events: list[LiveEvent] = Field(..., max_length=500)


def _station_of(ev: LiveEvent) -> str | None:
    if ev.station in STATIONS:
        return ev.station
    for st, assets in STATION_ASSETS.items():
        if ev.asset_id and ev.asset_id in assets:
            return st
    return None


def ingest(events: list[LiveEvent]) -> int:
    rows, n = [], 0
    now = time.time()
    with _lock:
        for ev in events:
            st = _station_of(ev)
            if st is None:
                continue
            ts = ev.ts or now
            if ev.type == "state":
                if ev.value not in STATES:
                    continue
                STATE["stations"][st] = {"state": ev.value, "since": ts}
            elif ev.type == "good":
                STATE["good"] += int(float(ev.value or 1))
            elif ev.type == "defect":
                STATE["defects"] += 1
            STATE["events"] += 1
            STATE["last_ts"] = ts
            STATE["source"] = ev.source
            STATE["started"] = STATE["started"] or ts
            rows.append((None, ts, ts, now, f"live_{ev.type}", ev.asset_id or st, None,
                         float(ev.value) if isinstance(ev.value, (int, float)) else None,
                         json.dumps({"station": st, "value": ev.value}, ensure_ascii=False), "fact", f"live:{ev.source}"))
            n += 1
    if rows:
        con().executemany("INSERT INTO events (run_id, ts_event, observable_at, ingested_at, event_type, asset_id, body_id, value, payload, source, provenance)"
                          " VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
        con().commit()
    return n


@router.post("/events")
def post_events(batch: Batch) -> dict:
    """Вход для шлюза завода: пачка событий. Неизвестные участки и состояния пропускаются (не ломают приём)."""
    n = ingest(batch.events)
    return {"accepted": n, "rejected": len(batch.events) - n}


@router.get("/status")
def status() -> dict:
    now = time.time()
    age = (now - STATE["last_ts"]) if STATE["last_ts"] else None
    return {"source": "fact" if STATE["events"] else None, "connected": age is not None and age < 30, "last_event_age_s": age,
            "feed": STATE["source"], "events": STATE["events"], "good": STATE["good"], "defects": STATE["defects"],
            "stations": [{"id": s, "name": STATION_RU[s], "assets": STATION_ASSETS.get(s, []), **STATE["stations"][s]} for s in STATIONS],
            "emulator": dict(EMU)}


# ── Эмулятор PLC: проигрывает смену симулятора событиями в тот же вход ─────────────────────────
def _emulate(speed: float) -> None:
    from .sim.api import run_payload
    run = run_payload("base", 7)
    frames = run["frames"]
    prev = {s: None for s in STATIONS}
    good_prev = 0
    EMU.update(running=True, speed=speed, progress=0.0)
    try:
        for i, f in enumerate(frames):
            if not EMU["running"]:
                break
            evs = [LiveEvent(station=s, type="state", value=v, source="эмулятор PLC") for s, v in f["states"].items() if v != prev[s]]
            prev.update(f["states"])
            if f["good"] > good_prev:
                evs.append(LiveEvent(station="qc", type="good", value=f["good"] - good_prev, source="эмулятор PLC"))
                good_prev = f["good"]
            if evs:
                ingest(evs)
            EMU["progress"] = i / max(1, len(frames) - 1)
            time.sleep(60.0 / speed)          # speed = минут смены в минуту реального времени
    finally:
        EMU["running"] = False


@router.post("/emulator/start")
def emulator_start(speed: float = Query(60, ge=1, le=600)) -> dict:
    """Запустить эмулятор PLC (имитация датчиков линии) — для демонстрации пути живых данных."""
    if EMU["running"]:
        raise HTTPException(409, "Эмулятор уже работает")
    with _lock:
        STATE.update(good=0, defects=0, events=0, last_ts=None, source=None, started=None)
        for s in STATIONS:
            STATE["stations"][s] = {"state": None, "since": None}
    threading.Thread(target=_emulate, args=(speed,), daemon=True, name="plc-emulator").start()
    return {"ok": True, "speed": speed}


@router.post("/emulator/stop")
def emulator_stop() -> dict:
    EMU["running"] = False
    return {"ok": True}

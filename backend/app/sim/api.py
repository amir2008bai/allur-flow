"""API симуляции: метаданные, прогон, сравнение действий, поток кадров (SSE)."""
from __future__ import annotations

import asyncio
import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..db import connect, log_run
from .engine import simulate
from .kpi import bottleneck, kpis
from .params import (ASSUMPTIONS, MONEY_DEFAULTS, BUFFER_RU, BUFFERS, INTERVENTIONS, SCENARIO_RU, SCENARIOS, STATION_RU,
                     STATIONS)
from .whatif import compare
from .params import model_mix
from ..dataset import active_facts

router = APIRouter(prefix="/api/sim")
IDEAL_LINE_CYCLE = 3.4  # допущение A7: план 120/смену ≈ цель OEE 85% → 0,85×480/120
_con = None


def con():
    global _con
    if _con is None:
        _con = connect()
    return _con


def _scenario(name: str):
    if name.startswith("chaos:"):
        from ..stress import BY_ID, combine
        ids = [i for i in name[6:].split(",") if i in BY_ID]
        if not ids:
            raise HTTPException(404, f"Нет сбоев {name}")
        return combine(ids)
    if name.startswith("stress:"):
        from ..stress import SCENARIOS as STRESS
        sc = next((s for s in STRESS if s["id"] == name[7:]), None)
        if sc is None:
            raise HTTPException(404, f"Нет сбоя {name}")
        return sc["params"]()
    if name not in SCENARIOS:
        raise HTTPException(404, f"Нет сценария {name}")
    return SCENARIOS[name]


def scenario_name(name: str) -> str:
    if name.startswith("chaos:"):
        from ..stress import BY_ID
        ids = [i for i in name[6:].split(",") if i in BY_ID]
        return f"Беспредел: {len(ids)} сбоя" if len(ids) > 1 else (f"Испытание: {BY_ID[ids[0]]['name']}" if ids else name)
    if name.startswith("stress:"):
        from ..stress import SCENARIOS as STRESS
        sc = next((s for s in STRESS if s["id"] == name[7:]), None)
        return f"Испытание: {sc['name']}" if sc else name
    return SCENARIO_RU.get(name, name)


@lru_cache(maxsize=64)
def run_payload(scenario: str, seed: int) -> dict:
    run = simulate(_scenario(scenario), seed)
    log_run(con(), f"{scenario}:{seed}", scenario, run)
    bn = bottleneck(run)
    stops = [e for e in run.events if e["type"] == "stop_start"]
    return {
        "source": "sim",
        "scenario": scenario, "scenario_name": scenario_name(scenario), "seed": seed, "horizon": run.horizon,
        "buffer_cap": run.params.buffer_cap,
        "kpi": kpis(run, IDEAL_LINE_CYCLE),
        "bottleneck": bn,
        "stops": stops,
        "defects": [e for e in run.events if e["type"] in ("defect", "scrap")],
        "frames": run.frames,
        "alerts": _alerts(run),
    }


def _alerts(run) -> list[dict]:
    from ..learn.alerts import BUCKET_RU, bucket, detect_run
    return [{"t": a.t, "title": BUCKET_RU.get(bucket(a), a.title), "text": a.text} for a in detect_run(run)]


@router.get("/meta")
def meta() -> dict:
    return {
        "stations": [{"id": s, "name": STATION_RU[s]} for s in STATIONS],
        "buffers": [{"id": b, "name": BUFFER_RU[b], "cap": SCENARIOS["base"].buffer_cap[b]} for b in BUFFERS],
        "scenarios": [{"id": k, "name": SCENARIO_RU[k]} for k in SCENARIOS],
        "interventions": [{"id": k, "name": v["name"], "detail": v["detail"], "money": v["money"]} for k, v in INTERVENTIONS.items()],
        "money": MONEY_DEFAULTS,
        "models": model_mix(active_facts()),
        "assumptions": ASSUMPTIONS,
    }


@router.get("/run")
def run(scenario: str = "base", seed: int = 7) -> dict:
    return run_payload(scenario, seed)


@lru_cache(maxsize=16)
def _whatif(scenario: str, reps: int) -> dict:
    res = compare(_scenario(scenario), list(INTERVENTIONS), reps=reps)
    res["baseline"]["bottleneck"] = str(res["baseline"]["bottleneck"])
    for o in res["options"]:
        o["bottleneck_after"] = str(o["bottleneck_after"])
        o["significant"] = bool(o["significant"]); o["closes_gap"] = bool(o["closes_gap"])
    if res.get("combo"):
        res["combo"]["closes_gap"] = bool(res["combo"]["closes_gap"])
    res["scenario"] = scenario
    res["source"] = "whatif"
    return res


@router.get("/whatif")
def whatif(scenario: str = "paint_degradation", reps: int = Query(20, ge=2, le=50)) -> dict:
    return _whatif(scenario, reps)


@router.get("/stream")
async def stream(scenario: str = "base", seed: int = 7, speed: float = Query(30, gt=0, le=600)):
    """Проигрывает прогон кадр за кадром: speed = симулированных минут в секунду."""
    payload = run_payload(scenario, seed)

    async def gen():
        for f in payload["frames"]:
            yield f"data: {json.dumps(f)}\n\n"
            await asyncio.sleep(1 / speed)
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@lru_cache(maxsize=32)
def futures_payload(scenario: str, action: str, seed: int) -> dict:
    """Два будущих одной смены: «ничего не делаем» и «вмешиваемся». Одинаковые случайные числа (CRN)."""
    if action not in INTERVENTIONS:
        raise HTTPException(404, f"Нет действия {action}")
    base = run_payload(scenario, seed)
    run = simulate(INTERVENTIONS[action]["apply"](_scenario(scenario)), seed)
    alt = {
        "source": "sim", "scenario": f"{scenario}+{action}", "seed": seed, "horizon": run.horizon,
        "buffer_cap": run.params.buffer_cap, "kpi": kpis(run, IDEAL_LINE_CYCLE), "bottleneck": bottleneck(run),
        "stops": [e for e in run.events if e["type"] == "stop_start"],
        "defects": [e for e in run.events if e["type"] in ("defect", "scrap")], "frames": run.frames,
    }
    return {"source": "sim", "action": {"id": action, "name": INTERVENTIONS[action]["name"], "detail": INTERVENTIONS[action]["detail"]},
            "scenario": scenario, "seed": seed, "do_nothing": base, "intervene": alt}


@router.get("/futures")
def futures(scenario: str = "paint_degradation", action: str = "paint_service", seed: int = 7) -> dict:
    return futures_payload(scenario, action, seed)

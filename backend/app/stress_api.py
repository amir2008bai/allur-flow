"""API вкладки «Испытания»: устроить сбой и посмотреть, как двойник реагирует."""
from functools import lru_cache

from fastapi import APIRouter, HTTPException

from .data_quality import check_frames
from .learn.alerts import BUCKET_RU, bucket, detect_run
from .sim.api import IDEAL_LINE_CYCLE
from .sim.engine import simulate
from .sim.kpi import bottleneck, kpis
from .sim.params import BASE
from .stress import DATA_FAULTS, SCENARIOS, _inject

router = APIRouter(prefix="/api/stress")
BY_ID = {s["id"]: s for s in SCENARIOS}


@router.get("/scenarios")
def scenarios() -> dict:
    return {"process": [{"id": s["id"], "name": s["name"], "detail": s["detail"], "zone": s["zone"], "window": s["window"]} for s in SCENARIOS],
            "data": [{"id": k, "name": n} for k, n, _ in DATA_FAULTS]}


@lru_cache(maxsize=64)
def _run(sid: str, seed: int) -> dict:
    sc = BY_ID[sid]
    run, base = simulate(sc["params"](), seed), simulate(BASE, seed)
    ok, seen, delay = sc["check"](run, base)
    a, b = sc["window"]
    alerts = [{"t": al.t, "title": BUCKET_RU.get(bucket(al), al.title), "text": al.text} for al in detect_run(run) if al.t >= max(0, a - 30)]
    return {
        "source": "sim", "scenario": sid, "seed": seed, "horizon": run.horizon, "buffer_cap": run.params.buffer_cap,
        "kpi": kpis(run, IDEAL_LINE_CYCLE), "bottleneck": bottleneck(run),
        "stops": [e for e in run.events if e["type"] == "stop_start"], "frames": run.frames,
        "fault": {"id": sid, "name": sc["name"], "detail": sc["detail"], "zone": sc["zone"], "window": [a, b]},
        "verdict": {"ok": ok, "seen": seen, "delay_min": delay},
        "alerts": alerts,
        "compare": {"good_fault": run.good_out, "good_base": base.good_out},
    }


@router.get("/run")
def run(id: str, seed: int = 101) -> dict:
    if id not in BY_ID:
        raise HTTPException(404, "нет такого сбоя")
    return _run(id, seed)


@router.get("/data")
def data_fault(id: str, seed: int = 101) -> dict:
    names = {k: n for k, n, _ in DATA_FAULTS}
    if id not in names:
        raise HTTPException(404, "нет такого сбоя данных")
    base = simulate(BASE, seed)
    issues = check_frames(_inject(id, base.frames), BASE.buffer_cap)
    return {"id": id, "name": names[id], "issues": issues[:8], "count": len(issues)}

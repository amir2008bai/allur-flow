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


def twin_context() -> dict:
    """Текущее состояние знаний двойника: брак окраски уточняется вводом людей и камерой (байес).
    Пока обратной связи нет — допущение из данных. Версия входит в ключи кешей: новые знания → новый расчёт."""
    import hashlib
    from ..learn.api import calib
    c = calib()
    learned = len(c.obs) > len(c.start)
    st = SCENARIOS["base"].stations
    p = float(c.history[-1]["mean"]) if learned else st["paint"].defect_p
    raw = f"{p:.4f}|" + "|".join(f"{k}:{v.cycle:.3f}:{v.defect_p:.4f}:{v.mtbf_work}:{v.mttr}" for k, v in st.items())
    return {"paint_defect_p": p, "learned": learned, "version": hashlib.sha1(raw.encode()).hexdigest()[:10],
            "source": "feedback" if learned else "assumption", "observations": len(c.obs) - len(c.start)}


def twin_overlay(p, ctx: dict | None = None):
    """Применить знания двойника к параметрам сценария (общий BASE не меняется)."""
    ctx = ctx or twin_context()
    if not ctx["learned"]:
        return p
    from dataclasses import replace
    return p.with_(stations={**p.stations, "paint": replace(p.stations["paint"], defect_p=ctx["paint_defect_p"])})


def parse_cfg(name: str) -> tuple[list[str], list[str]]:
    """cfg:<сбои через запятую>|<действия через запятую> → (сбои, действия)."""
    from ..stress import BY_ID
    parts = name[4:].split("|")
    f, a = parts[0], (parts[1] if len(parts) > 1 else "")
    return [i for i in f.split(",") if i in BY_ID], [i for i in a.split(",") if i in INTERVENTIONS]


EVENT_STATIONS = ("welding", "paint", "assembly")


def parse_events(name: str) -> list[tuple[str, int, int]]:
    """Остановки «прямо сейчас»: участок@минута+длительность через «;» (третья часть cfg)."""
    if not name.startswith("cfg:"):
        return []
    parts = name[4:].split("|")
    out = []
    for e in (parts[2] if len(parts) > 2 else "").split(";"):
        try:
            st, rest = e.split("@"); at, dur = rest.split("+")
            if st in EVENT_STATIONS and 0 <= int(at) < 960 and 1 <= int(dur) <= 240:
                out.append((st, int(at), int(dur)))
        except ValueError:
            continue
    return out[:6]


def _scenario(name: str):
    if name.startswith("cfg:"):
        from ..stress import combine
        from .params import ForcedDown
        faults, actions = parse_cfg(name)
        p = combine(faults) if faults else SCENARIOS["base"]
        for a in actions:
            p = INTERVENTIONS[a]["apply"](p)
        ev = parse_events(name)
        if ev:
            p = p.with_(forced_downs=p.forced_downs + tuple(ForcedDown(st, float(at), float(d), reason="остановка «сейчас» (что-если)") for st, at, d in ev))
        return p
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


def _clock(t: float) -> str:
    m = int(t) + 8 * 60
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def scenario_name(name: str) -> str:
    if name.startswith("cfg:"):
        from ..stress import BY_ID
        faults, actions = parse_cfg(name)
        parts = [BY_ID[i]["short"] for i in faults] + [INTERVENTIONS[a]["short"] for a in actions]
        parts += [f"{STATION_RU[st]} встала в {_clock(at)} на {d} мин" for st, at, d in parse_events(name)]
        return ", ".join(parts) if parts else "Обычная смена"
    if name.startswith("chaos:"):
        from ..stress import BY_ID
        ids = [i for i in name[6:].split(",") if i in BY_ID]
        return f"Беспредел: {len(ids)} сбоя" if len(ids) > 1 else (f"Испытание: {BY_ID[ids[0]]['name']}" if ids else name)
    if name.startswith("stress:"):
        from ..stress import SCENARIOS as STRESS
        sc = next((s for s in STRESS if s["id"] == name[7:]), None)
        return f"Испытание: {sc['name']}" if sc else name
    return SCENARIO_RU.get(name, name)


def run_payload(scenario: str, seed: int) -> dict:
    return _run_payload(scenario, seed, twin_context()["version"])


@lru_cache(maxsize=64)
def _run_payload(scenario: str, seed: int, ver: str) -> dict:
    ctx = twin_context()
    run = simulate(twin_overlay(_scenario(scenario), ctx), seed)
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
        "twin": ctx,
    }


run_payload.cache_clear = _run_payload.cache_clear  # type: ignore[attr-defined]


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


def _whatif(scenario: str, reps: int) -> dict:
    return _whatif_v(scenario, reps, twin_context()["version"])


@lru_cache(maxsize=16)
def _whatif_v(scenario: str, reps: int, ver: str) -> dict:
    ctx = twin_context()
    res = compare(twin_overlay(_scenario(scenario), ctx), list(INTERVENTIONS), reps=reps)
    res["baseline"]["bottleneck"] = str(res["baseline"]["bottleneck"])
    for o in res["options"]:
        o["bottleneck_after"] = str(o["bottleneck_after"])
        o["significant"] = bool(o["significant"]); o["closes_gap"] = bool(o["closes_gap"])
    if res.get("combo"):
        res["combo"]["closes_gap"] = bool(res["combo"]["closes_gap"])
    res["scenario"] = scenario
    res["source"] = "whatif"
    res["twin"] = ctx
    return res


_whatif.cache_clear = _whatif_v.cache_clear  # type: ignore[attr-defined]


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


def futures_payload(scenario: str, action: str, seed: int, at: float | None = None) -> dict:
    return _futures_v(scenario, action, seed, at, twin_context()["version"])


@lru_cache(maxsize=32)
def _futures_v(scenario: str, action: str, seed: int, at: float | None, ver: str) -> dict:
    """Два будущих одной смены: «ничего не делаем» и «вмешиваемся». Одинаковые случайные числа (CRN)."""
    if action not in INTERVENTIONS:
        raise HTTPException(404, f"Нет действия {action}")
    base = run_payload(scenario, seed)
    run = simulate(apply_action(action, twin_overlay(_scenario(scenario)), at), seed)
    alt = {
        "source": "sim", "scenario": f"{scenario}+{action}", "seed": seed, "horizon": run.horizon,
        "buffer_cap": run.params.buffer_cap, "kpi": kpis(run, IDEAL_LINE_CYCLE), "bottleneck": bottleneck(run),
        "stops": [e for e in run.events if e["type"] == "stop_start"],
        "defects": [e for e in run.events if e["type"] in ("defect", "scrap")], "frames": run.frames,
    }
    return {"source": "sim", "at": at, "action": {"id": action, "name": INTERVENTIONS[action]["name"], "detail": INTERVENTIONS[action]["detail"]},
            "scenario": scenario, "seed": seed, "do_nothing": base, "intervene": alt}


futures_payload.cache_clear = _futures_v.cache_clear  # type: ignore[attr-defined]


def apply_action(action: str, p, at: float | None = None):
    """Действие с учётом момента: обслуживание камеры — «сейчас» (в минуту at), а не в зашитую 200-ю."""
    if action == "paint_service" and at is not None:
        from .params import service_paint_at
        return service_paint_at(p, at)
    return INTERVENTIONS[action]["apply"](p)


@router.get("/futures")
def futures(scenario: str = "paint_degradation", action: str = "paint_service", seed: int = 7, at: float | None = Query(None, ge=0, le=930)) -> dict:
    return futures_payload(scenario, action, seed, round(at) if at is not None else None)


PLAN_PER_SHIFT = 120  # факт ТЗ: план 120 машин на линию за смену


@lru_cache(maxsize=128)
def _shift(faults: tuple[str, ...], actions: tuple[str, ...], reps: int, ver: str = "", events: str = "") -> dict:
    import numpy as np
    from ..stress import combine
    from .whatif import paired_ci
    seeds = [1000 + i for i in range(reps)]
    ctx = twin_context()
    base_p = twin_overlay(SCENARIOS["base"], ctx)
    p = twin_overlay(combine(list(faults)) if faults else SCENARIOS["base"], ctx)
    for a in actions:
        p = INTERVENTIONS[a]["apply"](p)
    ev = parse_events(f"cfg:||{events}") if events else []
    if ev:
        from .params import ForcedDown
        p = p.with_(forced_downs=p.forced_downs + tuple(ForcedDown(st, float(at), float(d), reason="остановка «сейчас» (что-если)") for st, at, d in ev))
    shifts = base_p.horizon / base_p.shift_minutes

    def stats(params):
        runs = [simulate(params, s) for s in seeds]
        ks = [kpis(r, IDEAL_LINE_CYCLE) for r in runs]
        good = np.array([r.good_out for r in runs]) / shifts
        down = np.array([sum(b - a for st in r.states for a, b, x in r.states[st] if x == "down") for r in runs]) / shifts
        from ..journal import unplanned_by
        days = params.horizon / (2 * params.shift_minutes)
        worst = [max(unplanned_by([e for e in r.events if e["type"] == "stop_start"], with_reason=False).values(), default=0.0) / days for r in runs]
        return good, {"good_per_shift": float(good.mean()), "lo": float(np.percentile(good, 10)), "hi": float(np.percentile(good, 90)),
                      "oee_pct": float(np.mean([k["oee_pct"] for k in ks])), "downtime_min": float(down.mean()),
                      "paint_defect_pct": float(np.mean([k["defect_pct"]["paint"] for k in ks])),
                      "worst_station_down_day": float(np.mean(worst))}

    g0, normal = stats(base_p)
    if faults or actions or ev:
        g1, forecast = stats(p)
        m, lo, hi = paired_ci(g1 - g0)
        forecast.update({"delta": m, "delta_ci": [lo, hi]})
    else:
        forecast = {**normal, "delta": 0.0, "delta_ci": [0.0, 0.0]}
    from ..stress import BY_ID
    shifts_month = MONEY_DEFAULTS["work_days_month"] * MONEY_DEFAULTS["shifts_per_day"]
    from ..journal import targets
    return {"source": "sim", "reps": reps, "plan_per_shift": PLAN_PER_SHIFT, "normal": normal, "forecast": forecast, "targets": targets(),
            "faults": [{"id": f, "name": BY_ID[f]["name"]} for f in faults],
            "actions": [{"id": a, "name": INTERVENTIONS[a]["name"], "cost_per_shift": INTERVENTIONS[a]["money"]["month"] / shifts_month,
                         "once": INTERVENTIONS[a]["money"]["once"]} for a in actions],
            "scenario": f"cfg:{','.join(faults)}|{','.join(actions)}", "twin": ctx}


@router.get("/shift")
def shift(faults: str = "", actions: str = "", reps: int = Query(20, ge=2, le=30), events: str = "") -> dict:
    """Одна смена: обычная (без сбоев и действий) против прогноза с выбранными сбоями и действиями. Одинаковые случайные числа."""
    from ..stress import BY_ID
    f = tuple(sorted(i for i in faults.split(",") if i in BY_ID))
    a = tuple(i for i in INTERVENTIONS if i in actions.split(","))
    ev = ";".join(f"{st}@{at}+{d}" for st, at, d in parse_events(f"cfg:||{events}"))
    return _shift(f, a, reps, twin_context()["version"], ev)


@router.get("/options")
def options() -> dict:
    """Что можно включить в симуляции смены: сбои и действия."""
    from ..stress import SCENARIOS as STRESS
    return {"faults": [{"id": s["id"], "short": s["short"], "name": s["name"], "detail": s["detail"]} for s in STRESS],
            "actions": [{"id": k, "short": v["short"], "name": v["name"], "detail": v["detail"], "do": v["do"], "money": v["money"]} for k, v in INTERVENTIONS.items()]}



# ── Прогноз «к концу смены», который пересчитывается по ходу смены ─────────────────────────────
ETA_REPS = 30
SHIFT = 480


@lru_cache(maxsize=32)
def _eta_runs(scenario: str, ver: str):
    """30 прогонов той же смены (те же сбои, действия и остановки): выпуск по минутам."""
    import numpy as np
    p = twin_overlay(_scenario(scenario))
    curves = []
    for i in range(ETA_REPS):
        r = simulate(p, 3000 + i)
        curves.append([f["good"] for f in r.frames] + [r.good_out])
    n = min(len(c) for c in curves)
    return np.array([c[:n] for c in curves], dtype=float)


@router.get("/eta")
def eta(scenario: str = "base", seed: int = 7, t: float = Query(0, ge=0, le=960)) -> dict:
    """Сколько годных будет к концу ТЕКУЩЕЙ смены, если сейчас минута t.
    Сделано — факт этого прогона до минуты t; остаток — разброс 30 прогонов той же смены от t до конца смены.
    Плюс прогноз, каким он был в начале смены — чтобы видеть, как изменилась картина."""
    import numpy as np
    run = run_payload(scenario, seed)
    frames = run["frames"]
    good = [f["good"] for f in frames]
    k = min(int(t), len(good) - 1)
    s0 = SHIFT if k >= SHIFT else 0
    s1 = min(s0 + SHIFT, len(good) - 1)
    curves = _eta_runs(scenario, twin_context()["version"])
    s1c = min(s1, curves.shape[1] - 1)
    done = good[k] - good[s0]
    rem = curves[:, s1c] - curves[:, min(k, s1c)]
    total = done + rem
    # утренний прогноз — БЕЗ остановок «сейчас»: утром о них ещё никто не знал
    morning = scenario
    if parse_events(scenario):
        f, a = parse_cfg(scenario)
        morning = f"cfg:{','.join(f)}|{','.join(a)}" if (f or a) else "base"
    mc = _eta_runs(morning, twin_context()["version"]) if morning != scenario else curves
    start = mc[:, min(s1, mc.shape[1] - 1)] - mc[:, s0]
    plan = PLAN_PER_SHIFT
    q = lambda v: [float(np.percentile(v, 10)), float(np.percentile(v, 90))]  # noqa: E731
    ended = k >= s1
    prev = None
    if s0 == SHIFT:
        pstart = mc[:, SHIFT] - mc[:, 0]
        prev = {"actual": float(good[SHIFT] - good[0]), "total_mean": float(pstart.mean()), "total_range": q(pstart), "p_plan": float((pstart >= plan).mean())}
    return {"prev": prev,"source": "forecast", "shift": 1 if s0 == 0 else 2, "t": k, "shift_start": s0, "shift_end": s1, "plan": plan,
            "done": float(done), "remaining_mean": float(rem.mean()), "remaining_range": q(rem),
            "total_mean": float(total.mean()), "total_range": q(total), "p_plan": float((total >= plan).mean()),
            "start": {"total_mean": float(start.mean()), "total_range": q(start), "p_plan": float((start >= plan).mean())},
            "ended": ended, "actual": float(good[s1] - good[s0]) if ended else None, "reps": ETA_REPS,
            "events": [{"station": st, "name": STATION_RU[st], "at": at, "minutes": d} for st, at, d in parse_events(scenario)]}

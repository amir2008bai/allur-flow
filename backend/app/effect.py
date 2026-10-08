"""Эффект решения для завода (ТЗ: «оценка потенциального эффекта для бизнеса»): что даст внедрение — в машинах,
минутах простоя, OEE и браке. Деньги считает экран из машин и маржи калькулятора (маржа — допущение A8).

Два рычага, оба посчитаны двойником на одинаковых случайных событиях (CRN), 20 смен:
  1) лучшие действия из «Как выполнить план» (лучшая пара, если она подтверждена, иначе лучшее одно);
  2) брак окраски снижен до нормы ТЗ 2% (цель разбора 8D). Затраты на меры по браку завод оценит сам — здесь их нет.
"""
from __future__ import annotations

from dataclasses import replace
from functools import lru_cache

import numpy as np
from fastapi import APIRouter

router = APIRouter(prefix="/api")
REPS = 20


def _side(params, seeds) -> dict:
    from .journal import unplanned_by
    from .sim.api import IDEAL_LINE_CYCLE
    from .sim.engine import simulate
    from .sim.kpi import kpis
    runs = [simulate(params, s) for s in seeds]
    shifts = params.horizon / params.shift_minutes
    ks = [kpis(r, IDEAL_LINE_CYCLE) for r in runs]
    down = [sum(unplanned_by([e for e in r.events if e["type"] == "stop_start"], with_reason=False).values()) / shifts for r in runs]
    return {"good": np.array([r.good_out for r in runs], dtype=float) / shifts, "down": np.array(down),
            "oee": np.array([k["oee_pct"] for k in ks]), "paint_defect": np.array([k["defect_pct"]["paint"] for k in ks])}


def _lever(name: str, base: dict, alt: dict, cost: dict | None, what: str) -> dict:
    from .sim.whatif import paired_ci
    d, lo, hi = paired_ci(alt["good"] - base["good"])
    return {"name": name, "what": what, "delta_per_shift": d, "ci": [lo, hi], "confirmed": lo > 0,
            "downtime_per_shift": {"before": float(base["down"].mean()), "after": float(alt["down"].mean())},
            "oee": {"before": float(base["oee"].mean()), "after": float(alt["oee"].mean())},
            "paint_defect": {"before": float(base["paint_defect"].mean()), "after": float(alt["paint_defect"].mean())},
            "cost": cost}


@lru_cache(maxsize=4)
def _effect(ver: str) -> dict:
    from .journal import targets
    from .sim.api import _whatif, twin_overlay
    from .sim.params import INTERVENTIONS, SCENARIOS
    seeds = [1000 + i for i in range(REPS)]
    p0 = twin_overlay(SCENARIOS["base"])
    base = _side(p0, seeds)
    w = _whatif("base", REPS)
    levers = []
    combo = w.get("combo")
    useful = [o for o in w["options"] if o["significant"] and o["delta_per_shift"] > 0]
    ids = combo["ids"] if combo and combo["ci95"][0] > 0 else ([useful[0]["id"]] if useful else [])
    if ids:
        p1 = p0
        for a in ids:
            p1 = INTERVENTIONS[a]["apply"](p1)
        cost = {k: sum(INTERVENTIONS[a]["money"][k] for a in ids) for k in ("month", "once")}
        levers.append(_lever(" + ".join(INTERVENTIONS[a]["name"] for a in ids), base, _side(p1, seeds), cost,
                             "действия из «Как выполнить план»"))
    norm = targets()["defect_max_pct"] / 100
    if p0.stations["paint"].defect_p > norm:
        p2 = p0.with_(stations={**p0.stations, "paint": replace(p0.stations["paint"], defect_p=norm)})
        levers.append(_lever(f"Брак окраски до нормы {100 * norm:g}%", base, _side(p2, seeds), None,
                             "цель разбора брака (8D); затраты на меры оценит завод"))
    return {"source": "sim", "reps": REPS, "base": {"good_per_shift": float(base["good"].mean()), "plan_per_shift": w["plan_per_shift"],
                                                    "gap_per_shift": w["gap_per_shift"], "downtime_per_shift": float(base["down"].mean()),
                                                    "oee": float(base["oee"].mean()), "paint_defect": float(base["paint_defect"].mean())},
            "levers": levers,
            "note": "Двойник, 20 одинаковых смен с вмешательством и без. Деньги — машины × маржа калькулятора (допущение); "
                    "пока план не выполняется, деньгами считаются машины до плана, сверх плана — только если есть спрос."}


@router.get("/effect")
def effect() -> dict:
    from .sim.api import twin_context
    return _effect(twin_context()["version"])

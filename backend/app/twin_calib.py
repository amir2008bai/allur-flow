"""Подгонка двойника под журналы завода: надёжность участков (MTBF/MTTR) по внеплановым простоям.

Метод (simulation-based calibration):
  1) из журнала простоев: по каждому участку — внеплановые минуты в сутки и средняя длительность остановки;
  2) MTTR участка = средняя длительность внеплановой остановки (если записей нет — остаётся допущение);
  3) MTBF (рабочее время между отказами) — начальная оценка по формуле «простой/сутки ≈ работа/MTBF × MTTR»,
     затем 3 итерации уточнения по самой симуляции (у SimPy-линии участок не работает, когда ждёт кузов);
  4) отчёт «факт против двойника» — по нему видно, насколько двойник совпадает с заводом.
Применяется автоматически при загрузке реальных данных. На тестовых 2 днях — только проверка (данных мало).
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from .schemas import Facts
from .sim.engine import simulate

AREAS = ("welding", "paint", "assembly")
DAY = 960.0
SEEDS = range(400, 424)
MIN_RECORDS = 2


def observed(facts: Facts) -> dict:
    days = max(1, len({r.date for r in facts.lines} | {r.date for r in facts.downtime}))
    out = {}
    for a in AREAS:
        rec = [r for r in facts.downtime if r.area == a and not r.planned]
        out[a] = {"records": len(rec), "down_per_day": sum(r.minutes for r in rec) / days,
                  "mttr": float(np.mean([r.minutes for r in rec])) if rec else None}
    return {"days": days, "areas": out}


def simulated(params) -> dict:
    """Внеплановые минуты простоя в сутки по участкам и годные за смену — среднее по 24 суткам."""
    down = {a: [] for a in AREAS}
    good = []
    for s in SEEDS:
        run = simulate(params.with_(horizon=DAY), s)
        for a in AREAS:
            down[a].append(sum(e["minutes"] for e in run.events if e["type"] == "stop_start" and e["station"] == a and not e.get("planned")))
        good.append(run.good_out / 2)
    return {"down_per_day": {a: float(np.mean(v)) for a, v in down.items()}, "good_per_shift": float(np.mean(good))}


def fit(facts: Facts, params, apply: bool = False) -> dict:
    """Подобрать MTBF/MTTR. apply=False — только отчёт (что было бы), параметры двойника не меняются."""
    obs = observed(facts)
    st = dict(params.stations)
    before = simulated(params)
    changes = []
    for a in AREAS:
        o = obs["areas"][a]
        if o["records"] == 0 or st[a].mtbf_work is None:
            continue
        mttr = o["mttr"]
        mtbf = DAY * 0.9 * mttr / max(1.0, o["down_per_day"])
        st[a] = replace(st[a], mttr=mttr, mtbf_work=mtbf)
    trial = params.with_(stations=st)
    for _ in range(5):   # уточнение по симуляции
        sim = simulated(trial)["down_per_day"]
        for a in AREAS:
            o = obs["areas"][a]
            if o["records"] == 0 or st[a].mtbf_work is None or sim[a] <= 0:
                continue
            k = float(np.clip(sim[a] / max(1.0, o["down_per_day"]), 0.5, 2.0))
            st[a] = replace(st[a], mtbf_work=st[a].mtbf_work * k)
        trial = params.with_(stations=st)
    after = simulated(trial)
    for a in AREAS:
        p0, p1 = params.stations[a], st[a]
        if (p0.mtbf_work, p0.mttr) != (p1.mtbf_work, p1.mttr):
            changes.append({"area": a, "mtbf_before": p0.mtbf_work, "mtbf_after": round(p1.mtbf_work), "mttr_before": p0.mttr, "mttr_after": round(p1.mttr, 1)})
    enough = obs["days"] >= 7 and all(obs["areas"][a]["records"] >= MIN_RECORDS for a in AREAS)
    if apply:
        params.stations.update(st)
    return {
        "days": obs["days"], "enough_data": enough, "applied": apply,
        "areas": [{"area": a, "records": obs["areas"][a]["records"], "fact_down": round(obs["areas"][a]["down_per_day"], 1),
                   "twin_before": round(before["down_per_day"][a], 1), "twin_after": round(after["down_per_day"][a], 1)} for a in AREAS],
        "good_per_shift": {"before": round(before["good_per_shift"], 1), "after": round(after["good_per_shift"], 1)},
        "changes": changes,
        "note": "Достаточно данных — подгонка надёжная." if enough else
                f"Данных {obs['days']} дн.: для надёжной подгонки нужно ≥7 дней и ≥{MIN_RECORDS} внеплановые остановки на участок.",
    }

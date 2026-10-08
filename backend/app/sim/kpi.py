"""KPI по событиям симуляции и поиск узкого места методом активных периодов (Roser).

Активное состояние = работает или в отказе/ремонте (станция «занята» и задерживает поток).
Неактивное = ждёт кузов (starved) или некуда отдать (blocked).
В каждый момент узкое место — станция с самым длинным текущим активным периодом.
Если активные периоды прежнего и нового узкого места перекрываются — это «блуждающее» узкое место.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from .engine import RunResult
from .params import STATIONS

ACTIVE = {"working", "down"}


def state_shares(run: RunResult) -> dict[str, dict[str, float]]:
    out = {}
    for s, ints in run.states.items():
        tot = defaultdict(float)
        for a, b, st in ints:
            tot[st] += b - a
        out[s] = {k: tot.get(k, 0.0) / run.horizon for k in ("working", "starved", "blocked", "down")}
    return out


def active_periods(intervals: list[tuple[float, float, str]]) -> list[tuple[float, float]]:
    periods: list[list[float]] = []
    for a, b, st in intervals:
        if st not in ACTIVE:
            continue
        if periods and abs(periods[-1][1] - a) < 1e-9:
            periods[-1][1] = b
        else:
            periods.append([a, b])
    return [(a, b) for a, b in periods]


def bottleneck(run: RunResult, step: float = 0.25) -> dict:
    """Доли времени, когда станция — единственное (sole) или блуждающее (shifting) узкое место."""
    per = {s: active_periods(run.states[s]) for s in STATIONS}
    grid = np.arange(0, run.horizon, step)
    current = {}
    for s in STATIONS:
        arr = np.zeros(len(grid), dtype=int)  # индекс периода, покрывающего момент, или -1
        arr[:] = -1
        for k, (a, b) in enumerate(per[s]):
            i0, i1 = int(np.ceil(a / step)), int(np.ceil(b / step))
            arr[i0:i1] = k
        current[s] = arr
    lengths = np.zeros((len(STATIONS), len(grid)))
    for j, s in enumerate(STATIONS):
        idx = current[s]
        L = np.array([b - a for a, b in per[s]] or [0.0])
        lengths[j] = np.where(idx >= 0, L[np.clip(idx, 0, None)], 0.0)
    bn = lengths.argmax(axis=0)
    none = lengths.max(axis=0) <= 0

    shifting = np.zeros(len(grid), dtype=bool)
    changes = np.nonzero(np.diff(bn) != 0)[0] + 1
    for c in changes:
        a_s, b_s = STATIONS[bn[c - 1]], STATIONS[bn[c]]
        pa, pb = current[a_s][c - 1], current[b_s][c]
        if pa < 0 or pb < 0:
            continue
        (a0, a1), (b0, b1) = per[a_s][pa], per[b_s][pb]
        lo, hi = max(a0, b0), min(a1, b1)
        if hi > lo:
            shifting[int(lo / step):int(np.ceil(hi / step))] = True

    sole = {s: 0.0 for s in STATIONS}
    shift = {s: 0.0 for s in STATIONS}
    for j, s in enumerate(STATIONS):
        mine = (bn == j) & ~none
        sole[s] = float((mine & ~shifting).mean())
        shift[s] = float((mine & shifting).mean())
    top = max(STATIONS, key=lambda s: sole[s] + shift[s])
    # временная линия узкого места (по 10-минутным окнам) — для «волны» на экране
    win = int(10 / step)
    timeline = []
    for i in range(0, len(grid), win):
        seg = bn[i:i + win][~none[i:i + win]]
        timeline.append({"t": float(grid[i]), "station": STATIONS[int(np.bincount(seg).argmax())] if len(seg) else None})
    return {"sole": sole, "shifting": shift, "top": top, "timeline": timeline}


EXIT = "assembly"        # последний участок перед ОТК: пока он не работает, линия не выпускает машины


def _mask(intervals, n: int, step: float) -> np.ndarray:
    m = np.zeros(n, dtype=bool)
    for a, b in intervals:
        m[int(a / step):int(np.ceil(b / step))] = True
    return m


def oee_parts(run: RunResult, ideal_line_cycle: float, step: float = 0.25) -> dict:
    """OEE линии = доступность × темп × качество (классическое разложение).

    Время смотрим на выходе линии (сборка): каждую минуту, когда она не работает, относим к причине —
      плановая остановка где-либо на линии → плановое время (в OEE не входит);
      внеплановая остановка где-либо на линии → потеря доступности;
      остальное (ждёт кузов из-за медленного участка, переделка окраски, разброс циклов) → потеря темпа.
    Качество = доля кузовов без дефекта с первого раза (RTY по участкам). Темп — остаток, так что A × P × Q = OEE точно.
    Причина «по одновременности» — допущение: эффект остановки, прошедшей через буфер позже, попадёт в темп."""
    n = int(np.ceil(run.horizon / step))
    stops = [e for e in run.events if e["type"] == "stop_start"]
    planned = _mask([(e["t"], e["t"] + e["minutes"]) for e in stops if e.get("planned")], n, step)
    down = {st: _mask([(a, b) for a, b, x in run.states[st] if x == "down"], n, step) for st in STATIONS}
    down_any = np.zeros(n, dtype=bool)
    for m in down.values():
        down_any |= m
    idle = ~_mask([(a, b) for a, b, x in run.states[EXIT] if x == "working"], n, step)
    planned_min = float((idle & planned).sum() * step)
    lost = idle & ~planned & down_any
    avail_loss = float(lost.sum() * step)
    # чья поломка: минута потери делится поровну между участками, которые в неё стояли
    k = np.maximum(sum(m.astype(int) for m in down.values()), 1)
    avail_by = {st: float(((lost & down[st]) / k).sum() * step) for st in STATIONS}
    loading = max(run.horizon - planned_min, 1e-9)
    good = run.good_out
    oee = good * ideal_line_cycle / loading
    a = (loading - avail_loss) / loading
    # качество = доля кузовов без дефекта с первого раза по всем участкам (RTY): переделка окраски — потеря качества,
    # даже если кузов потом исправили (её время иначе пряталось бы в «темпе»)
    q = float(np.prod([1 - run.defects[st] / run.produced[st] for st in STATIONS if run.produced[st]]))
    perf = oee / (a * q) if a * q else 0.0
    ideal_cars = loading / ideal_line_cycle
    # качество по участкам: доля каждого участка в общей потере (по −ln(1−доля брака), чтобы сумма сходилась)
    ql = {st: -np.log(1 - run.defects[st] / run.produced[st]) for st in STATIONS if run.produced[st] and run.defects[st] < run.produced[st]}
    ql_tot = sum(ql.values()) or 1.0
    q_cars = ideal_cars * a * perf * (1 - q)
    a_cars = ideal_cars * (1 - a)
    return {"oee": oee, "availability": a, "performance": perf, "quality": q,
            "cars_by": {"availability": {st: a_cars * m / avail_loss for st, m in avail_by.items() if avail_loss and m > 0},
                        "quality": {st: float(q_cars * v / ql_tot) for st, v in ql.items() if v > 0},
                        "planned_min": planned_min},
            "planned_min": planned_min, "loading_min": loading, "availability_loss_min": avail_loss,
            # в машинах: сколько не сделано из-за каждой потери (для каскада потерь) — каскад сходится к факту
            "cars": {"ideal": ideal_cars, "availability": ideal_cars * (1 - a), "performance": ideal_cars * a * (1 - perf),
                     "quality": ideal_cars * a * perf * (1 - q), "good": float(good)}}


def kpis(run: RunResult, ideal_line_cycle: float) -> dict:
    shifts = run.horizon / run.params.shift_minutes
    shares = state_shares(run)
    downtime = {s: sum(b - a for a, b, st in run.states[s] if st == "down") for s in STATIONS}
    unplanned = defaultdict(float)
    for e in run.events:
        if e["type"] == "stop_start" and not e["planned"]:
            unplanned[e["station"]] += e["minutes"]
    defect_pct = {s: 100 * run.defects[s] / run.produced[s] if run.produced[s] else 0.0 for s in STATIONS}
    good = run.good_out
    parts = oee_parts(run, ideal_line_cycle)
    oee = parts["oee"]
    return {
        "good_out": good,
        "good_per_shift": good / shifts,
        "plan_per_shift": 120,
        "scrapped": run.scrapped,
        "produced": run.produced,
        "defect_pct": defect_pct,
        "downtime_min": downtime,
        "unplanned_downtime_min_per_day": {s: unplanned[s] * (960 / run.horizon) for s in STATIONS},
        "state_shares": shares,
        "oee_pct": 100 * oee,
        "oee_parts": {k: (100 * parts[k] if k in ("availability", "performance", "quality") else parts[k]) for k in
                      ("availability", "performance", "quality", "planned_min", "availability_loss_min", "cars", "cars_by")},
        "oee_note": f"допущение: идеальный цикл линии {ideal_line_cycle} мин; плановые остановки в OEE не входят",
    }

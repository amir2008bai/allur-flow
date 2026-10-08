"""Журнал смен: что было в каждый день — план, факт по сменам, утренний прогноз против факта, что съело машины.

Запись дня делается один раз и хранится в SQLite (таблица journal): так журнал — это история, а не пересчёт.
Сейчас дни — симуляция (у каждой даты своя смена, метка «симуляция»). С реальными данными запись дня
будет строиться из выгрузки MES/учёта (выпуск, простои, брак) — формат записи тот же.
"""
from __future__ import annotations

import calendar
import json
import time
from collections import defaultdict
from datetime import date as Date

from fastapi import APIRouter, HTTPException, Query

from .db import connect
from .sim.params import STATION_RU

router = APIRouter(prefix="/api/journal")
PLAN_SHIFT = 120
SHIFT = 480
_con = None
SCHEMA = """CREATE TABLE IF NOT EXISTS journal (day TEXT PRIMARY KEY, record TEXT NOT NULL, saved_at REAL NOT NULL, source TEXT NOT NULL)"""


def con():
    global _con
    if _con is None:
        _con = connect()
        _con.execute(SCHEMA)
    return _con


def seed_from_date(d: Date) -> int:
    """Как во фронтенде (dates.ts): у каждой даты своя смена симуляции."""
    return ((d.year * 372 + (d.month - 1) * 31 + d.day) % 997) + 1


def day_scenario(d: Date) -> str:
    """Условия дня (детерминированно от даты): обычно смена идёт штатно, иногда — авария или засор фильтра.
    На заводе это заменят реальные события дня из MES."""
    import random
    r = random.Random(seed_from_date(d) * 7919)
    faults, events = [], []
    if r.random() < 0.15:
        faults.append("filter_clog")
    if r.random() < 0.35:
        st = r.choice(["welding", "paint", "assembly"])
        events.append(f"{st}@{r.randrange(60, 900)}+{r.choice([25, 40, 55, 75, 95])}")
    if not faults and not events:
        return "base"
    return f"cfg:{','.join(faults)}|" + (f"|{';'.join(events)}" if events else "")


def _build(d: Date) -> dict:
    import numpy as np
    from .sim.api import _eta_runs, run_payload, scenario_name, twin_context
    seed = seed_from_date(d)
    scenario = day_scenario(d)
    run = run_payload(scenario, seed)
    good = [f["good"] for f in run["frames"]]
    end = len(good) - 1
    curves = _eta_runs("base", twin_context()["version"])
    shifts = []
    for i, (s0, s1) in enumerate(((0, SHIFT), (SHIFT, min(2 * SHIFT, end)))):
        fact = good[s1] - good[s0]
        fc = curves[:, min(s1, curves.shape[1] - 1)] - curves[:, s0]
        lo, hi = float(np.percentile(fc, 10)), float(np.percentile(fc, 90))
        shifts.append({"shift": i + 1, "plan": PLAN_SHIFT, "fact": fact,
                       "forecast": {"mean": float(fc.mean()), "lo": lo, "hi": hi, "p_plan": float((fc >= PLAN_SHIFT).mean())},
                       "in_corridor": lo <= fact <= hi})
    # что съело машины: внеплановые остановки по участкам и причинам
    # интервалы остановок по участку и причине; перекрытия объединяем (у сварки два робота — одна авария пишется дважды)
    spans = defaultdict(list)
    for s in run["stops"]:
        if not s.get("planned"):
            reason = s.get("reason") or "отказ"
            spans[(s["station"], "авария" if "что-если" in reason else reason)].append((s["t"], s["t"] + s["minutes"]))
    by = {}
    for key, iv in spans.items():
        tot, cur = 0.0, None
        for a, b in sorted(iv):
            if cur and a <= cur[1]:
                cur = (cur[0], max(cur[1], b))
            else:
                if cur:
                    tot += cur[1] - cur[0]
                cur = (a, b)
        by[key] = tot + (cur[1] - cur[0] if cur else 0)
    losses = [{"station": st, "name": STATION_RU.get(st, st), "reason": r, "minutes": round(m)} for (st, r), m in sorted(by.items(), key=lambda x: -x[1])]
    fact = sum(s["fact"] for s in shifts)
    k = run["kpi"]
    return {"day": d.isoformat(), "seed": seed, "scenario": scenario, "conditions": scenario_name(scenario) if scenario != "base" else "штатная смена", "source": "sim", "plan": 2 * PLAN_SHIFT, "fact": fact, "pct": 100 * fact / (2 * PLAN_SHIFT),
            "shifts": shifts, "losses": losses[:5], "downtime_min": round(sum(by.values())),
            "paint_defect_pct": round(k["defect_pct"]["paint"], 1), "oee_pct": round(k["oee_pct"])}


def record(d: Date) -> dict:
    """Запись дня: из журнала, если уже есть; иначе собрать и сохранить."""
    row = con().execute("SELECT record, saved_at FROM journal WHERE day=?", (d.isoformat(),)).fetchone()
    if row:
        return {**json.loads(row[0]), "saved_at": row[1]}
    rec = _build(d)
    now = time.time()
    con().execute("INSERT OR IGNORE INTO journal VALUES (?,?,?,?)", (d.isoformat(), json.dumps(rec, ensure_ascii=False), now, rec["source"]))
    con().commit()
    return {**rec, "saved_at": now}


@router.get("/month")
def month(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    """Месяц: записи прошедших дней (по сегодня включительно) и итог «с начала месяца»."""
    y, m = map(int, month.split("-"))
    td = Date.fromisoformat(today)
    n = calendar.monthrange(y, m)[1]
    days = []
    for dd in range(1, n + 1):
        d = Date(y, m, dd)
        if d > td:
            break
        r = record(d)
        days.append({"day": r["day"], "fact": r["fact"], "plan": r["plan"], "pct": r["pct"], "scenario": r.get("scenario", "base"),
                     "hits": sum(s["in_corridor"] for s in r["shifts"]), "today": d == td})
    fact = sum(x["fact"] for x in days)
    plan_to_date = sum(x["plan"] for x in days)
    return {"month": month, "days_in_month": n, "first_weekday": Date(y, m, 1).weekday(), "days": days, "source": "sim",
            "fact": fact, "plan_to_date": plan_to_date, "plan_month": 5500, "plan_month_source": "fact",
            "corridor_hits": sum(x["hits"] for x in days), "shifts_total": 2 * len(days)}


@router.get("/day")
def day(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    try:
        return record(Date.fromisoformat(date))
    except ValueError as e:
        raise HTTPException(422, str(e))

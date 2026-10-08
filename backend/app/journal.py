"""Журнал смен и прогноз месяца.

Журнал: что было в каждый рабочий день — план, факт по сменам, утренний прогноз против факта, что съело машины,
нарушения норм ТЗ (брак ≤ 2%, простой оборудования ≤ 60 мин/сутки, OEE ≥ 85%). Запись дня делается один раз
и хранится в SQLite (таблица journal) — это история, а не пересчёт.

Прогноз месяца: факт с 1-го числа + будущие рабочие дни (двойник: 240 типичных дней — штатные, с авариями,
с засором фильтра; дни ТО — отдельно). Выходные по умолчанию сб/вс; любой будущий день можно отметить
«рабочий / выходной / ТО 4 ч» (таблица calendar_marks).

Сейчас дни — симуляция (метка «симуляция»). С реальными данными запись дня строится из выгрузки MES, формат тот же.
"""
from __future__ import annotations

import calendar
import json
import time
from collections import defaultdict
from datetime import date as Date
from datetime import timedelta
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import fact_days
from .db import connect
from .sim.params import STATION_RU

router = APIRouter(prefix="/api/journal")
PLAN_SHIFT = 120
PLAN_DAY = 2 * PLAN_SHIFT
SHIFT = 480
MAINT_MIN = 240           # ТО: линия стоит 4 часа в начале дня (плановая остановка)
_con = None
SCHEMA = """CREATE TABLE IF NOT EXISTS journal (day TEXT PRIMARY KEY, record TEXT NOT NULL, saved_at REAL NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_marks (day TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('work','off','maint')), saved_at REAL NOT NULL);"""


def con():
    global _con
    if _con is None:
        _con = connect()
        _con.executescript(SCHEMA)
    return _con


def seed_from_date(d: Date) -> int:
    """Как во фронтенде (dates.ts): у каждой даты своя смена симуляции."""
    return ((d.year * 372 + (d.month - 1) * 31 + d.day) % 997) + 1


def targets() -> dict:
    """Нормы из ТЗ (факт): OEE, брак, простой критического оборудования, план месяца."""
    from .dataset import active_facts
    t = active_facts().targets
    return {"oee_min_pct": t.oee_min_pct, "defect_max_pct": t.defect_max_pct,
            "downtime_max_min_per_day": t.critical_downtime_max_min_per_day, "monthly_output_min": t.monthly_output_min}


def models_plan() -> int:
    from .dataset import active_facts
    return sum(m.monthly_plan for m in active_facts().model_plan)


def day_kind(d: Date) -> str:
    """work / off / maint: отметка в календаре, иначе пн–пт рабочие, сб–вс выходные (допущение)."""
    row = con().execute("SELECT kind FROM calendar_marks WHERE day=?", (d.isoformat(),)).fetchone()
    if row:
        return row[0]
    if fact_days.has_facts(d):      # у завода есть данные за этот день — значит, он рабочий
        return "work"
    return "work" if d.weekday() < 5 else "off"


def day_scenario(d: Date) -> str:
    """Условия дня (детерминированно от даты): обычно смена идёт штатно, иногда — авария или засор фильтра.
    Если у завода есть данные за день — условия берутся из них (простои, брак), а не придумываются."""
    import random
    if fact_days.has_facts(d):
        return fact_days.scenario(d)
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


def unplanned_by(stops: list[dict], with_reason: bool = True) -> dict:
    """Минуты внеплановых остановок по участку (и причине). Перекрытия объединяем: у сварки два робота — одна авария пишется дважды."""
    spans = defaultdict(list)
    for s in stops:
        if s.get("planned"):
            continue
        reason = s.get("reason") or "отказ"
        key = (s["station"], "авария" if "что-если" in reason else reason) if with_reason else s["station"]
        spans[key].append((s["t"], s["t"] + s["minutes"]))
    out = {}
    for key, iv in spans.items():
        tot, cur = 0.0, None
        for a, b in sorted(iv):
            if cur and a <= cur[1]:
                cur = (cur[0], max(cur[1], b))
            else:
                if cur:
                    tot += cur[1] - cur[0]
                cur = (a, b)
        out[key] = tot + (cur[1] - cur[0] if cur else 0)
    return out


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
        shifts.append({"shift": i + 1, "plan": PLAN_SHIFT, "fact": fact, "source": "sim",
                       "forecast": {"mean": float(fc.mean()), "lo": lo, "hi": hi, "p_plan": float((fc >= PLAN_SHIFT).mean())},
                       "in_corridor": lo <= fact <= hi})
    tg = targets()
    fs = fact_days.summary(d, tg)
    if fs and fs["exit_fact"] is not None:
        # строка данных завода = смена 1 (допущение A1): её выпуск — факт; двойник остаётся рядом для сравнения
        s0 = shifts[0]
        s0.update({"twin": s0["fact"], "fact": fs["exit_fact"], "source": "fact",
                   "in_corridor": s0["forecast"]["lo"] <= fs["exit_fact"] <= s0["forecast"]["hi"]})
    by = unplanned_by(run["stops"])
    per_station = unplanned_by(run["stops"], with_reason=False)
    losses = [{"station": st, "name": STATION_RU.get(st, st), "reason": r, "minutes": round(m)} for (st, r), m in sorted(by.items(), key=lambda x: -x[1])]
    fact = sum(s["fact"] for s in shifts)
    k = run["kpi"]
    defect = round(k["defect_pct"]["paint"], 1)
    oee = round(k["oee_pct"])
    oee_parts = {x: round(k["oee_parts"][x]) for x in ("availability", "performance", "quality")}
    norms = []
    if fs:
        paint_q = next((q for q in fs["quality"] if q["station"] == "paint"), None)
        if paint_q:
            defect = paint_q["pct"]
        losses = [{"station": x["station"], "name": x["name"], "reason": f"{x['equipment']}: {x['reason']}", "minutes": x["minutes"],
                   "planned": x["planned"], "shift": x["shift"], "why": x["why"], "source": "fact"} for x in sorted(fs["downtime"], key=lambda x: (x["planned"], -x["minutes"]))]
        by = {(x["station"], x["reason"]): x["minutes"] for x in fs["downtime"] if not x["planned"]}
        norms = list(fs["norms"])
    elif defect > tg["defect_max_pct"]:
        norms.append({"kind": "defect", "text": f"брак окраски {str(defect).replace('.', ',')}% — выше нормы {tg['defect_max_pct']:g}%"})
    for st, m in sorted(per_station.items(), key=lambda x: -x[1]) if not fs else ():
        if m > tg["downtime_max_min_per_day"]:
            norms.append({"kind": "downtime", "text": f"{STATION_RU.get(st, st)} простаивала {round(m)} мин — лимит {tg['downtime_max_min_per_day']} мин/сутки"})
    if oee < tg["oee_min_pct"]:
        norms.append({"kind": "oee", "source": "sim", "text": f"OEE {oee}% — ниже цели {tg['oee_min_pct']:g}% (двойник)"})
    return {"day": d.isoformat(), "seed": seed, "scenario": scenario, "source": "fact+sim" if fs else "sim",
            "facts": fs, "facts_key": fact_days.key(d),
            "conditions": fact_days.describe(d) if fs else (scenario_name(scenario) if scenario != "base" else "штатная смена"),
            "plan": PLAN_DAY, "fact": fact, "pct": 100 * fact / PLAN_DAY,
            "shifts": shifts, "losses": losses[:5], "downtime_min": round(sum(by.values())),
            "paint_defect_pct": defect, "oee_pct": oee, "oee_parts": oee_parts, "norms": norms}


def record(d: Date) -> dict:
    """Запись дня: из журнала, если уже есть; иначе собрать и сохранить."""
    row = con().execute("SELECT record, saved_at FROM journal WHERE day=?", (d.isoformat(),)).fetchone()
    if row:
        rec = json.loads(row[0])
        # запись совпадает с данными завода за этот день (или их нет) — это история, отдаём как есть;
        # данные завода появились/изменились — день пересобирается из них
        if rec.get("facts_key") == fact_days.key(d):
            return {**rec, "saved_at": row[1]}
    rec = _build(d)
    now = time.time()
    con().execute("INSERT OR REPLACE INTO journal VALUES (?,?,?,?)", (d.isoformat(), json.dumps(rec, ensure_ascii=False), now, rec["source"]))
    con().commit()
    return {**rec, "saved_at": now}


# ── Прогноз будущих дней ─────────────────────────────────────────────────────────────────────
PARAM_SETS = 40          # «возможных заводов»: параметры двойника известны неточно — каждый набор их правдоподобных значений
DAYS_PER_SET = 10        # типичных дней на набор
MAINT_PER_SET = 3        # дней с ТО на набор
SIGMA_MAX = 0.35         # неточность надёжности (MTBF/MTTR), когда записей журнала мало (допущение)


def param_uncertainty() -> dict:
    """Насколько неточно известны параметры двойника — из объёма данных завода.
    Брак окраски: байес по выпущенным/бракованным (чем больше данных, тем уже). Надёжность участков: по числу
    записей внеплановых простоев n — относительная неточность ≈ 1/√(n+1), не больше SIGMA_MAX."""
    import math
    from .dataset import active_facts
    f = active_facts()
    paint = [q for q in f.quality if q.area == "paint"]
    n_paint = sum(q.produced for q in paint)
    rec = {a: sum(1 for r in f.downtime if r.area == a and not r.planned) for a in ("welding", "paint", "assembly")}
    return {"paint_produced": n_paint, "sigma": {a: min(SIGMA_MAX, 1 / math.sqrt(n + 1)) for a, n in rec.items()}, "records": rec,
            "days": len({r.date for r in f.lines} | {r.date for r in f.downtime} | {r.date for r in f.quality})}


def _perturb(p, rng, unc: dict):
    """Один правдоподобный вариант параметров: брак окраски из байесовской оценки, MTBF и MTTR — логнормальный разброс."""
    from dataclasses import replace
    st = dict(p.stations)
    n = max(unc["paint_produced"], 1)
    mean = st["paint"].defect_p
    st["paint"] = replace(st["paint"], defect_p=float(rng.beta(mean * n + 0.5, (1 - mean) * n + 0.5)))
    for a, s in unc["sigma"].items():
        if st[a].mtbf_work:
            st[a] = replace(st[a], mtbf_work=st[a].mtbf_work * float(rng.lognormal(0, s)), mttr=st[a].mttr * float(rng.lognormal(0, s)))
    return p.with_(stations=st)


@lru_cache(maxsize=4)
def _day_dist(ver: str):
    """Выпуск за день по наборам параметров: [набор][день]. В каждом наборе — типичные дни (те же правила условий,
    что у журнала) и дни с ТО 4 ч. Наборы различаются параметрами двойника в пределах их неточности —
    так прогноз месяца учитывает не только случайность дней, но и то, что двойник знает завод по немногим дням данных."""
    import numpy as np
    from .sim.api import _scenario, twin_overlay
    from .sim.engine import simulate
    from .sim.params import STATIONS, ForcedDown
    unc = param_uncertainty()
    typical, maint = [], []
    for k in range(PARAM_SETS):
        # одни и те же параметры для всех дней набора: генератор с тем же зерном даёт те же значения
        ty = []
        for j in range(DAYS_PER_SET):
            i = k * DAYS_PER_SET + j
            d = Date(2000, 1, 1) + timedelta(days=i)
            ty.append(simulate(_perturb(twin_overlay(_scenario(day_scenario(d))), np.random.default_rng(1000 + k), unc), 50_000 + i).good_out)
        base = _perturb(twin_overlay(_scenario("base")), np.random.default_rng(1000 + k), unc)
        maint_p = base.with_(forced_downs=tuple(ForcedDown(s, 0.0, float(MAINT_MIN), planned=True, reason="плановое ТО") for s in STATIONS))
        ma = [simulate(maint_p, 60_000 + k * MAINT_PER_SET + j).good_out for j in range(MAINT_PER_SET)]
        typical.append(ty); maint.append(ma)
    return np.array(typical, dtype=float), np.array(maint, dtype=float)


def _month_days(y: int, m: int):
    return [Date(y, m, dd) for dd in range(1, calendar.monthrange(y, m)[1] + 1)]


@router.get("/month")
def month(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    """Месяц: записи прошедших рабочих дней (по сегодня включительно), выходные/ТО и прогноз до конца месяца."""
    import numpy as np
    from .sim.api import twin_context
    y, m = map(int, month.split("-"))
    td = Date.fromisoformat(today)
    days, future = [], []
    for d in _month_days(y, m):
        kind = day_kind(d)
        if d < td:          # сегодня ещё идёт — не запись, а прогноз (итог запишется после конца дня)
            if kind == "off":
                days.append({"day": d.isoformat(), "kind": "off"})
                continue
            r = record(d)
            days.append({"day": r["day"], "kind": kind, "fact": r["fact"], "plan": r["plan"], "pct": r["pct"], "scenario": r.get("scenario", "base"),
                         "hits": sum(s["in_corridor"] for s in r["shifts"]), "norms": len(r.get("norms", [])),
                         "has_facts": bool(r.get("facts")),
                         "fact_hits": sum(s["in_corridor"] for s in r["shifts"] if s.get("source") == "fact"),
                         "fact_shifts": sum(1 for s in r["shifts"] if s.get("source") == "fact")})
        else:
            future.append((d, kind))
    past = [x for x in days if x["kind"] != "off"]
    fact = sum(x["fact"] for x in past)
    plan_to_date = PLAN_DAY * len(past)
    typical, maint = _day_dist(twin_context()["version"])
    rng = np.random.default_rng(7)
    sims = np.full(4000, float(fact))
    world = rng.integers(0, typical.shape[0], size=sims.size)   # у каждого «возможного месяца» — свой набор параметров на все дни
    fdays = []
    for d, kind in future:
        if kind == "off":
            fdays.append({"day": d.isoformat(), "kind": "off", "today": d == td})
            continue
        dist = maint if kind == "maint" else typical
        sims += dist[world, rng.integers(0, dist.shape[1], size=sims.size)]
        fdays.append({"day": d.isoformat(), "kind": kind, "today": d == td, "forecast": float(dist.mean()), "lo": float(np.percentile(dist, 10)), "hi": float(np.percentile(dist, 90))})
    tg = targets()
    work_days = len(past) + sum(1 for x in fdays if x["kind"] != "off")
    remaining_days = sum(1 for x in fdays if x["kind"] != "off")
    plan_month = tg["monthly_output_min"]
    return {"month": month, "days_in_month": calendar.monthrange(y, m)[1], "first_weekday": Date(y, m, 1).weekday(), "source": "sim",
            "days": days + fdays, "fact": fact, "plan_to_date": plan_to_date,
            "corridor_hits": sum(x["hits"] for x in past), "shifts_total": 2 * len(past),
            # сверка с ФАКТОМ завода (смены, где выпуск взят из данных) — отдельно от самопроверки двойника
            "corridor_fact": {"hits": sum(x["fact_hits"] for x in past), "shifts": sum(x["fact_shifts"] for x in past), "source": "fact"},
            "forecast": {"total_mean": float(sims.mean()), "total_range": [float(np.percentile(sims, 10)), float(np.percentile(sims, 90))],
                         "p_plan": float((sims >= plan_month).mean()), "remaining_days": remaining_days, "source": "forecast",
                         "param_uncertainty": {"sets": PARAM_SETS, "data_days": param_uncertainty()["days"]}},
            "plans": {"month": plan_month, "by_days": PLAN_DAY * work_days, "by_models": models_plan(), "work_days": work_days,
                      "need_per_day": ((plan_month - fact) / remaining_days) if remaining_days else None, "daily": PLAN_DAY}}


@router.get("/day")
def day(date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), today: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    """Запись прошедшего дня. Сегодня и будущее не записываются: день ещё не закончился."""
    try:
        d = Date.fromisoformat(date)
        td = Date.fromisoformat(today) if today else Date.today()
    except ValueError as e:
        raise HTTPException(422, str(e))
    if day_kind(d) == "off":
        return {"day": d.isoformat(), "kind": "off"}
    if d >= td:
        return {"day": d.isoformat(), "kind": day_kind(d), "in_progress": d == td, "future": d > td, "scenario": day_scenario(d)}
    return {**record(d), "kind": day_kind(d)}


class Mark(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    kind: str = Field(pattern=r"^(work|off|maint|auto)$")
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.post("/mark")
def mark(body: Mark) -> dict:
    """Отметить будущий день: рабочий / выходной / ТО 4 ч / по умолчанию. Прошедшие дни — история, их не меняем."""
    d, td = Date.fromisoformat(body.day), Date.fromisoformat(body.today)
    if d <= td:
        raise HTTPException(422, "Прошедшие дни — история: отметить можно только будущий день")
    if body.kind == "auto":
        con().execute("DELETE FROM calendar_marks WHERE day=?", (body.day,))
    else:
        con().execute("INSERT OR REPLACE INTO calendar_marks VALUES (?,?,?)", (body.day, body.kind, time.time()))
    con().commit()
    return {"ok": True, "day": body.day, "kind": day_kind(d)}

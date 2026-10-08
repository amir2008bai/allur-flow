"""Дни, по которым у завода есть данные (таблицы DOCX/Excel): журнал и двойник берут ФАКТ, а не выдуманные условия.

Что берём из данных за дату:
  - выпуск линии (строка участка сборки — последний участок перед ОТК) — факт смены (допущение A1: строка = смена);
  - простои оборудования (внеплановые и плановое ТО) — события дня;
  - брак участков — доля брака дня.
Чего в данных нет — время события. Ставим его по самим данным: строка участка говорит, сколько он работал в смене
(«время работы, ч»); недоработка = 8 ч − время работы. Простой, который в эту недоработку помещается, ставим в смену
08–16 (её выпуск записан); не помещается — значит, был в другой смене дня, ставим в 16–24. Пример: 02.10 сборка
работала 7,9 ч (недоработка 6 мин), а обрыв цепи — 55 мин: в смену с выпуском 119 он не мог попасть.
Двойник по этим событиям проигрывает день («day:ГГГГ-ММ-ДД») — так видно, как они прошли по линии.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from datetime import date as Date

from .dataset import active_facts

PREFIX = "day:"
RULES = 3                   # версия правил сборки дня: поменяли правила → записи дней с данными пересобираются
SHIFT = 480
EXIT_AREA = "assembly"     # выпуск линии в таблице — у последнего участка перед ОТК
GEN_RU = {"welding": "сварки", "paint": "окраски", "assembly": "сборки", "qc": "ОТК"}
TIME_NOTE = ("Времени простоя в данных нет: если он помещается в недоработку участка (8 ч − время работы), "
             "ставим в смену 08–16, иначе — в 16–24; внутри смены — равномерно (допущение)")
TOLERANCE_MIN = 15          # время работы в таблице округлено до 0,1 ч (6 мин); у сварки два робота — простой одного не всегда стопорит участок


def rows(d: Date) -> dict | None:
    """Строки данных завода за дату или None, если данных нет."""
    f = active_facts()
    lines = [r for r in f.lines if r.date == d]
    downtime = [r for r in f.downtime if r.date == d]
    quality = [r for r in f.quality if r.date == d]
    if not (lines or downtime or quality):
        return None
    return {"lines": lines, "downtime": downtime, "quality": quality}


def has_facts(d: Date) -> bool:
    return rows(d) is not None


def key(d: Date) -> str | None:
    """Отпечаток данных дня: данные поменялись (загрузили новые) → запись журнала пересобирается."""
    r = rows(d)
    if r is None:
        return None
    raw = json.dumps({k: [x.model_dump(mode="json", exclude={"provenance"}) for x in v] for k, v in r.items()}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(f"{RULES}|{raw}".encode()).hexdigest()[:12]


def shortfall(d: Date) -> dict[str, float]:
    """Недоработка участков в записанной смене, мин: 8 ч − «время работы» из таблицы линий."""
    r = rows(d) or {"lines": []}
    hours = active_facts().targets.shift_hours
    return {x.area: max(0.0, (hours - x.runtime_h) * 60) for x in r["lines"]}


def placed_events(d: Date) -> list[dict]:
    """Простои дня с местом во времени: смена — по недоработке участка, внутри смены — равномерно."""
    r = rows(d) or {"downtime": []}
    gap = shortfall(d)
    left = dict(gap)              # недоработка, ещё не занятая простоями
    out = []
    for e in r["downtime"]:
        g = left.get(e.area)
        if g is None:
            shift, why = 1, "времени работы участка в данных нет — ставим в 08–16"
        elif e.minutes <= g + TOLERANCE_MIN:
            shift, why = 1, f"помещается в недоработку участка в смене 08–16 ({round(gap[e.area])} мин)"
            left[e.area] = max(0.0, g - e.minutes)
        else:
            shift, why = 2, (f"в смене 08–16 участок недоработал только {round(gap[e.area])} мин — "
                             f"{e.minutes} мин туда не помещаются, значит простой был в 16–24")
        out.append({"station": e.area, "equipment": e.equipment, "reason": e.reason, "minutes": e.minutes,
                    "planned": e.planned, "shift": shift, "why": why})
    for sh in (1, 2):
        evs = [e for e in out if e["shift"] == sh]
        for i, e in enumerate(evs):
            pos = SHIFT * (i + 1) / (len(evs) + 1) - e["minutes"] / 2
            e["start"] = round((sh - 1) * SHIFT + max(0.0, min(SHIFT - e["minutes"], pos)))
    return out


def params(d: Date):
    """Параметры двойника на этот день: события и брак — из данных завода."""
    from .sim.params import BASE, ForcedDown
    r = rows(d)
    if r is None:
        return BASE
    downs = tuple(ForcedDown(e["station"], float(e["start"]), float(e["minutes"]), planned=e["planned"],
                             reason=f"{e['equipment']}: {e['reason']} (данные завода)") for e in placed_events(d) if e["station"] in BASE.stations)
    st = dict(BASE.stations)
    for q in r["quality"]:
        if q.area in st and q.produced:
            st[q.area] = replace(st[q.area], defect_p=q.defects / q.produced)
    return BASE.with_(stations=st, forced_downs=downs, fixed_defects=True)


def scenario(d: Date) -> str:
    return f"{PREFIX}{d.isoformat()}"


def parse(name: str) -> Date | None:
    if not name.startswith(PREFIX):
        return None
    try:
        return Date.fromisoformat(name[len(PREFIX):])
    except ValueError:
        return None


def describe(d: Date) -> str:
    evs = placed_events(d)
    if not evs:
        return f"данные завода за {d:%d.%m}: простоев нет"
    low = lambda t: t[:1].lower() + t[1:] if t[1:2].islower() else t  # noqa: E731 — «Плановое ТО» → «плановое ТО»
    parts = [f"{e['equipment']} — {low(e['reason'])} {e['minutes']} мин" + (" (плановое)" if e["planned"] and "план" not in e["reason"].lower() else "")
             + (" — в смене 16–24" if e["shift"] == 2 else "") for e in evs]
    return f"данные завода за {d:%d.%m}: " + ", ".join(parts)


def summary(d: Date, limits: dict) -> dict | None:
    """Факт дня для журнала: выпуск, простои, брак, нарушения норм — всё с меткой «факт»."""
    from .sim.params import STATION_RU
    r = rows(d)
    if r is None:
        return None
    exit_line = next((x for x in r["lines"] if x.area == EXIT_AREA), None)
    lines = [{"line": x.line, "area": x.area, "plan": x.plan, "fact": x.fact, "runtime_h": x.runtime_h} for x in r["lines"]]
    downtime = [{"station": e["station"], "name": STATION_RU.get(e["station"], e["station"]), "equipment": e["equipment"], "reason": e["reason"],
                 "minutes": e["minutes"], "planned": e["planned"], "shift": e["shift"], "why": e["why"]} for e in placed_events(d)]
    quality = [{"station": x.area, "name": STATION_RU.get(x.area, x.area), "produced": x.produced, "defects": x.defects,
                "pct": round(100 * x.defects / x.produced, 1) if x.produced else 0.0} for x in r["quality"]]
    norms = []
    for q in quality:
        if q["pct"] > limits["defect_max_pct"]:
            norms.append({"kind": "defect", "source": "fact",
                          "text": f"брак {GEN_RU.get(q['station'], q['name'].lower())} {str(q['pct']).replace('.', ',')}% — выше нормы {limits['defect_max_pct']:g}%"})
    by_station: dict[str, float] = {}
    for x in downtime:
        if not x["planned"]:
            by_station[x["station"]] = by_station.get(x["station"], 0) + x["minutes"]
    for st, m in sorted(by_station.items(), key=lambda kv: -kv[1]):
        if m > limits["downtime_max_min_per_day"]:
            norms.append({"kind": "downtime", "source": "fact",
                          "text": f"{STATION_RU.get(st, st)} простаивала {round(m)} мин — лимит {limits['downtime_max_min_per_day']} мин/сутки"})
    return {"source": "fact", "exit_fact": exit_line.fact if exit_line else None, "exit_plan": exit_line.plan if exit_line else None,
            "exit_line": exit_line.line if exit_line else None, "lines": lines, "downtime": downtime, "quality": quality, "norms": norms,
            "time_note": TIME_NOTE}

"""Дни, по которым у завода есть данные (таблицы DOCX/Excel): журнал и двойник берут ФАКТ, а не выдуманные условия.

Что берём из данных за дату:
  - выпуск линии (строка участка сборки — последний участок перед ОТК) — факт смены (допущение A1: строка = смена);
  - простои оборудования (внеплановые и плановое ТО) — события дня;
  - брак участков — доля брака дня.
Чего в данных нет — время события внутри смены. Ставим события равномерно в первую смену (допущение, помечено).
Двойник по этим событиям проигрывает день («day:ГГГГ-ММ-ДД») — так видно, как они прошли по линии.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from datetime import date as Date

from .dataset import active_facts

PREFIX = "day:"
SHIFT = 480
EXIT_AREA = "assembly"     # выпуск линии в таблице — у последнего участка перед ОТК
GEN_RU = {"welding": "сварки", "paint": "окраски", "assembly": "сборки", "qc": "ОТК"}
TIME_NOTE = "время события в данных не указано — в двойнике поставлено в первую смену (допущение)"


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
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def placed_events(d: Date) -> list[dict]:
    """Простои дня с местом в смене (равномерно по первой смене — времени в данных нет)."""
    r = rows(d) or {"downtime": []}
    evs = r["downtime"]
    out = []
    for i, e in enumerate(evs):
        start = max(0.0, min(SHIFT - e.minutes, SHIFT * (i + 1) / (len(evs) + 1) - e.minutes / 2))
        out.append({"station": e.area, "equipment": e.equipment, "reason": e.reason, "minutes": e.minutes,
                    "planned": e.planned, "start": round(start)})
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
    parts = [f"{e['equipment']} — {low(e['reason'])} {e['minutes']} мин" + (" (плановое)" if e["planned"] and "план" not in e["reason"].lower() else "") for e in evs]
    return f"данные завода за {d:%d.%m}: " + ", ".join(parts)


def summary(d: Date, limits: dict) -> dict | None:
    """Факт дня для журнала: выпуск, простои, брак, нарушения норм — всё с меткой «факт»."""
    from .sim.params import STATION_RU
    r = rows(d)
    if r is None:
        return None
    exit_line = next((x for x in r["lines"] if x.area == EXIT_AREA), None)
    lines = [{"line": x.line, "area": x.area, "plan": x.plan, "fact": x.fact, "runtime_h": x.runtime_h} for x in r["lines"]]
    downtime = [{"station": x.area, "name": STATION_RU.get(x.area, x.area), "equipment": x.equipment, "reason": x.reason,
                 "minutes": x.minutes, "planned": x.planned} for x in r["downtime"]]
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

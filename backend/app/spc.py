"""Контрольная карта брака окраски (p-карта Шухарта) — стандартный инструмент качества в автопроме (IATF 16949).

Отвечает на вопрос, которого нет у средней оценки брака и у тревоги «всплеск»:
  «брак сегодня — обычный разброс процесса или что-то изменилось (особая причина)?»
  - точка вне границ или особый рисунок точек → особая причина: разбираться с этим днём;
  - все точки внутри границ → процесс стабилен; если его средний уровень выше нормы 2% — это системная проблема:
    реагировать на отдельные дни бесполезно (это «дёргание» процесса), нужна мера для всего процесса.

Точки — рабочие дни: доля дефектов окраски (дефектов / окрашено). Дни с данными завода — факт, остальные — двойник.
Средняя линия p̄ — по всем точкам; границы p̄ ± 3·√(p̄(1−p̄)/n) — у каждого дня свои (разный объём n).
Правила Western Electric: 1) точка за границей 3σ; 2) 9 точек подряд по одну сторону средней; 3) 6 точек подряд растут или падают.
"""
from __future__ import annotations

import math
from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/spc")
POINTS = 20            # подгрупп на карте (стандартно 20–25)
LOOKBACK_DAYS = 60
RUN_SIDE, RUN_TREND = 9, 6


def _day_point(d: Date) -> dict | None:
    from . import fact_days, journal
    from .sim.api import run_payload
    if journal.day_kind(d) == "off":
        return None
    r = fact_days.rows(d)
    paint = next((q for q in r["quality"] if q.area == "paint"), None) if r else None
    if paint is not None:
        return {"day": d.isoformat(), "n": paint.produced, "defects": paint.defects, "source": "fact"}
    rec = journal.record(d)
    k = run_payload(rec["scenario"], rec["seed"])["kpi"]
    n = int(k["produced"]["paint"])
    return {"day": d.isoformat(), "n": n, "defects": int(round(k["defect_pct"]["paint"] * n / 100)), "source": "sim",
            "conditions": rec.get("conditions")}


def signals(points: list[dict]) -> None:
    """Отмечает у точек сигналы правил Western Electric (на месте: point['signals'])."""
    for p in points:
        p["signals"] = []
    for i, p in enumerate(points):
        if p["z"] > 3 or p["z"] < -3:
            p["signals"].append("выше верхней границы" if p["z"] > 0 else "ниже нижней границы")
        if i >= RUN_SIDE - 1:
            w = [q["z"] for q in points[i - RUN_SIDE + 1:i + 1]]
            if all(z > 0 for z in w) or all(z < 0 for z in w):
                p["signals"].append(f"{RUN_SIDE} точек подряд {'выше' if w[0] > 0 else 'ниже'} средней — уровень сдвинулся")
        if i >= RUN_TREND - 1:
            w = [q["p"] for q in points[i - RUN_TREND + 1:i + 1]]
            if all(b > a for a, b in zip(w, w[1:])) or all(b < a for a, b in zip(w, w[1:])):
                p["signals"].append(f"{RUN_TREND} точек подряд {'растут' if w[-1] > w[0] else 'падают'} — тренд")


def chart(points: list[dict], norm: float) -> dict:
    """Средняя, границы, сигналы и вывод для начальника смены."""
    def place(pbar: float) -> None:
        for p in points:
            p["p"] = p["defects"] / p["n"] if p["n"] else 0.0
            s = math.sqrt(pbar * (1 - pbar) / p["n"]) if p["n"] else 0.0
            p["ucl"], p["lcl"] = pbar + 3 * s, max(0.0, pbar - 3 * s)
            p["z"] = (p["p"] - pbar) / s if s else 0.0

    def pooled(pts: list[dict]) -> float:
        n_tot = sum(p["n"] for p in pts)
        return sum(p["defects"] for p in pts) / n_tot if n_tot else 0.0

    # средняя линия — по «обычным» дням: дни за границами (особые причины) из неё исключаются (одна ревизия, как принято)
    pbar = pooled(points)
    place(pbar)
    usual = [p for p in points if abs(p["z"]) <= 3]
    if usual and len(usual) < len(points):
        pbar = pooled(usual)
        place(pbar)
    signals(points)
    past = [p for p in points[:-5] if p["signals"]]
    recent = [p for p in points[-5:] if p["signals"]]
    if recent:
        last = recent[-1]
        verdict = {"kind": "special", "day": last["day"],
                   "title": "Особая причина: в процессе что-то изменилось",
                   "text": f"{last['day'][8:10]}.{last['day'][5:7]}: {'; '.join(last['signals'])}. Разбирайтесь с этим днём: что поменялось — "
                           "фильтр, краска, партия кузовов, режим камеры, смена людей. Это повод для разбора (8D), а не обычный разброс."}
    elif pbar > norm:
        before = (f" Последняя особая причина была {past[-1]['day'][8:10]}.{past[-1]['day'][5:7]} — после неё процесс вернулся к обычному уровню." if past else "")
        verdict = {"kind": "chronic",
                   "title": "Процесс стабилен, но его обычный уровень выше нормы",
                   "text": f"Последние дни внутри границ — всплесков нет.{before} Но средний брак {f"{100 * pbar:.1f}".replace(".", ",")}% при норме {100 * norm:g}%: "
                           "это не «плохие дни», а уровень самого процесса. Реагировать на отдельный день бесполезно — "
                           "нужна мера для всего процесса окраски (оборудование, материал, метод)."}
    else:
        verdict = {"kind": "ok", "title": "Процесс стабилен и в норме",
                   "text": "Последние дни внутри границ, средний брак в норме. Вмешиваться не нужно: подстройка процесса из-за обычного разброса только увеличит брак."}
    return {"pbar": pbar, "norm": norm, "points": points, "verdict": verdict}


@router.get("/paint")
def paint(today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    """p-карта брака окраски по последним рабочим дням (до вчера включительно)."""
    from .journal import targets
    td = Date.fromisoformat(today)
    pts = []
    for k in range(1, LOOKBACK_DAYS + 1):
        p = _day_point(td - timedelta(days=k))
        if p:
            pts.append(p)
        if len(pts) >= POINTS:
            break
    pts.reverse()
    res = chart(pts, targets()["defect_max_pct"] / 100)
    res.update({"source": "calc", "facts": sum(p["source"] == "fact" for p in pts),
                "note": "Точки с данными завода — факт; остальные дни — двойник (симуляция). Границы — 3σ биномиального разброса при объёме дня."})
    return res

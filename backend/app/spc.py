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

from fastapi import APIRouter, HTTPException, Query
from functools import lru_cache
from threading import RLock
import json

router = APIRouter(prefix="/api/spc")
POINTS = 20            # подгрупп на карте (стандартно 20–25)
LOOKBACK_DAYS = 60
RUN_SIDE, RUN_TREND = 9, 6


AREAS = {"welding": "Сварка", "paint": "Окраска", "assembly": "Сборка"}
_quality_lock = RLock()


@lru_cache(maxsize=128)
def _sim_quality(day: str, scenario: str, seed: int, version: str, facts_key: str | None) -> dict:
    from .sim.api import _scenario, twin_overlay
    from .sim.engine import simulate
    run = simulate(twin_overlay(_scenario(scenario)), seed)
    return {a: {"n": int(run.produced[a]), "defects": int(run.defects[a])} for a in AREAS}


def clear_cache() -> None:
    with _quality_lock:
        _sim_quality.cache_clear()


def _day_point(d: Date, area: str = "paint") -> dict | None:
    from . import fact_days, journal
    from .sim.api import twin_context, scenario_name
    if journal.day_kind(d) == "off":
        return None
    rows = fact_days.rows(d)
    quality = [q for q in rows["quality"] if q.area == area] if rows else []
    if quality:
        n = sum(q.produced for q in quality)
        if not n:
            return None
        return {"day": d.isoformat(), "n": n, "defects": sum(q.defects for q in quality), "source": "fact",
                "conditions": fact_days.describe(d)}
    # Для графика не строим журнал с прогнозами смен и не формируем 3D-кадры/KPI.
    # Уже сохранённый сценарий дня используется как прежде; один лёгкий прогон даёт все участки.
    saved = journal.con().execute("SELECT record FROM journal WHERE day=?", (d.isoformat(),)).fetchone()
    rec = json.loads(saved[0]) if saved else {}
    if rec.get("facts_key") != fact_days.key(d):
        rec = {}
    scenario = rec.get("scenario", journal.day_scenario(d))
    seed = rec.get("seed", journal.seed_from_date(d))
    with _quality_lock:
        stats = _sim_quality(d.isoformat(), scenario, seed, twin_context()["version"], fact_days.key(d))[area]
    if not stats["n"]:
        return None
    return {"day": d.isoformat(), **stats, "source": "sim",
            "conditions": rec.get("conditions") or (fact_days.describe(d) if rows else scenario_name(scenario))}


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


def chart(points: list[dict], norm: float, area: str = "paint") -> dict:
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
                           f"{CHECKS[area]}. Это повод для разбора (8D); причина пока не доказана."}
    elif pbar > norm:
        before = (f" Последняя особая причина была {past[-1]['day'][8:10]}.{past[-1]['day'][5:7]} — после неё процесс вернулся к обычному уровню." if past else "")
        verdict = {"kind": "chronic",
                   "title": "Процесс стабилен, но его обычный уровень выше нормы",
                   "text": f"Последние дни внутри границ — всплесков нет.{before} Но средний брак {f"{100 * pbar:.1f}".replace(".", ",")}% при норме {100 * norm:g}%: "
                           "это не «плохие дни», а уровень самого процесса. Реагировать на отдельный день бесполезно — "
                           f"нужна мера для участка «{AREAS[area]}» (оборудование, материал, метод)."}
    else:
        verdict = {"kind": "ok", "title": "Процесс стабилен и в норме",
                   "text": "Последние дни внутри границ, средний брак в норме. Вмешиваться не нужно: подстройка процесса из-за обычного разброса только увеличит брак."}
    return {"pbar": pbar, "norm": norm, "points": points, "verdict": verdict}


CHECKS = {
    "welding": "швы, электроды, настройки робота, геометрия кузова",
    "paint": "фильтр, краска, подготовка кузова, режим камеры",
    "assembly": "комплектующие, крепёж, инструмент, порядок операций",
}


def _control_chart(today: str, area: str) -> dict:
    from .journal import targets
    try:
        td = Date.fromisoformat(today)
    except ValueError as error:
        raise HTTPException(422, "Некорректная дата") from error
    pts = []
    for k in range(1, LOOKBACK_DAYS + 1):
        d = td - timedelta(days=k)
        p = _day_point(d) if area == "paint" else _day_point(d, area)
        if p:
            pts.append(p)
        if len(pts) >= POINTS:
            break
    pts.reverse()
    res = chart(pts, targets()["defect_max_pct"] / 100, area)
    res.update({"source": "calc", "area": area, "name": AREAS[area], "checks": CHECKS[area],
                "facts": sum(p["source"] == "fact" for p in pts),
                "note": "Точки с данными завода — факт; остальные дни — двойник. Границы — 3σ при объёме дня."})
    return res


@router.get("/paint")
def paint(today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    """Прежний адрес оставлен для брифинга, 8D и копилота."""
    return _control_chart(today, "paint")


@router.get("/quality")
def quality(today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
            area: str = Query("paint", pattern=r"^(welding|paint|assembly)$")) -> dict:
    return _control_chart(today, area)

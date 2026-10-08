"""Утренний брифинг начальника смены: всё важное на сегодня — на одной странице.

Новых расчётов здесь нет: брифинг собирает готовые результаты двойника —
прогноз смен (утренний, без событий дня: утром о них не знают), лучшее действие, цену простоя участков,
контрольную карту брака, итог вчерашнего дня из журнала, прогноз месяца и открытые разборы брака (8D).
У каждого блока — метка источника. Риски сортируются по важности.
"""
from __future__ import annotations

from datetime import date as Date
from datetime import timedelta

import numpy as np
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api")
SHIFT = 480
WD = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]


def _shift_forecast() -> dict:
    """Утренний прогноз двух смен и дня: 30 прогонов обычного дня (как утренний прогноз в журнале)."""
    from .journal import PLAN_DAY, PLAN_SHIFT
    from .sim.api import _eta_runs, twin_context
    c = _eta_runs("base", twin_context()["version"])
    end = c.shape[1] - 1
    out = []
    for i, (a, b) in enumerate(((0, SHIFT), (SHIFT, min(2 * SHIFT, end)))):
        v = c[:, b] - c[:, a]
        out.append({"shift": i + 1, "hours": "08–16" if i == 0 else "16–24", "plan": PLAN_SHIFT, "mean": float(v.mean()),
                    "lo": float(np.percentile(v, 10)), "hi": float(np.percentile(v, 90)), "p_plan": float((v >= PLAN_SHIFT).mean())})
    day = c[:, end] - c[:, 0]
    return {"shifts": out, "day": {"plan": PLAN_DAY, "mean": float(day.mean()), "lo": float(np.percentile(day, 10)),
                                   "hi": float(np.percentile(day, 90)), "p_plan": float((day >= PLAN_DAY).mean())},
            "reps": int(c.shape[0]), "source": "forecast"}


def _best_action() -> dict:
    from .sim.api import _whatif
    w = _whatif("base", 20)
    base = {"now_per_shift": w["baseline"]["good_per_shift"], "plan_per_shift": w["plan_per_shift"], "gap": w["gap_per_shift"], "source": "sim"}
    c = w.get("combo")
    good = [o for o in w["options"] if o["significant"] and o["delta_per_shift"] > 0]
    if c and c["closes_gap"]:
        return {**base, "names": c["names"], "delta": c["delta_per_shift"], "ci": c["ci95"], "closes_gap": True, "money": c["money"]}
    if good:
        o = good[0]
        return {**base, "names": [o["name"]], "delta": o["delta_per_shift"], "ci": o["ci95"], "closes_gap": o["closes_gap"], "money": o.get("money")}
    return {**base, "names": [], "delta": 0.0, "ci": [0.0, 0.0], "closes_gap": base["gap"] <= 0, "money": None}


def _yesterday(td: Date) -> dict | None:
    from .journal import day_kind, record
    for k in range(1, 8):
        d = td - timedelta(days=k)
        if day_kind(d) != "off":
            r = record(d)
            return {"day": d.isoformat(), "fact": r["fact"], "plan": r["plan"], "pct": r["pct"], "conditions": r["conditions"],
                    "norms": [n["text"] for n in r.get("norms", [])], "losses": r.get("losses", [])[:2],
                    "hits": sum(s["in_corridor"] for s in r["shifts"]), "shifts": len(r["shifts"]),
                    "source": r.get("source", "sim"), "has_facts": bool(r.get("facts"))}
    return None


def _risks(fc: dict, spc: dict, month: dict, yest: dict | None, value: dict, capa_items: list[dict]) -> list[dict]:
    """Риски дня простым языком: уровень (high/medium/low), короткий текст, подробности (detail) и куда смотреть."""
    out = []
    pc = lambda x: f"{100 * x:.1f}".replace(".", ",")  # noqa: E731
    sp = lambda x: f"{round(x):,}".replace(",", " ")  # noqa: E731
    s1 = fc["shifts"][0]
    if s1["p_plan"] < 0.8:
        out.append({"level": "high" if s1["p_plan"] < 0.5 else "medium",
                    "text": f"Смена 08–16 может не дотянуть до плана — шанс {round(100 * s1['p_plan'])}%",
                    "where": "shift-builder", "source": "forecast"})
    v = spc["verdict"]
    if v["kind"] == "special":
        out.append({"level": "high", "text": "Брак окраски резко вырос — в процессе что-то сломалось, разберитесь сегодня",
                    "detail": v["text"], "where": "paint-spc", "source": "calc"})
    elif v["kind"] == "chronic":
        out.append({"level": "medium", "text": f"Брак окраски держится около {pc(spc['pbar'])}% (норма {100 * spc['norm']:g}%) — это не случайность, нужна общая мера",
                    "detail": v["text"], "where": "paint-spc", "source": "calc"})
    f = month["forecast"]
    if f["p_plan"] < 0.5:
        pl = month["plans"]
        # план в ТЗ не согласован (правило №4): называем все цифры, а не «недовыпуск»
        out.append({"level": "high" if f["total_mean"] < pl["by_days"] else "medium",
                    "text": f"За месяц выйдет ≈ {sp(f['total_mean'])}, а цель {sp(pl['month'])}"
                            + (f" — нужно ≈ {round(pl['need_per_day'])} в день вместо {pl['daily']}" if pl["need_per_day"] else ""),
                    "note": f"План в ТЗ разный: «не менее {sp(pl['month'])}», по дням {sp(pl['by_days'])}, по моделям {sp(pl['by_models'])} — это несогласованность плана, а не недовыпуск.",
                    "where": "journal", "source": "forecast"})
    if yest and yest["norms"]:
        out.append({"level": "medium", "text": "Вчера нарушены нормы: " + "; ".join(n.split(" — ")[0] for n in yest["norms"][:2]),
                    "where": "journal", "source": yest["source"]})
    bad = [a for a in capa_items if a["check"]["verdict"] == "not_confirmed"]
    if bad:
        out.append({"level": "low", "text": f"«{bad[0]['action']}» пока не снизило брак — ищите другую причину", "where": "capa", "source": "calc"})
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda r: order[r["level"]])


@router.get("/briefing")
def briefing(today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    from . import capa, journal, spc
    from .sim.api import station_value
    td = Date.fromisoformat(today)
    kind = journal.day_kind(td)
    fc = _shift_forecast()
    chart = spc.paint(today)
    month = journal.month(today[:7], today)
    yest = _yesterday(td)
    value = station_value(12)
    caps = capa.list_actions(today)["actions"]
    stations = sorted(value["stations"], key=lambda r: -r["loss_per_min"])
    return {
        "date": today, "weekday": WD[td.weekday()], "kind": kind,
        "forecast": fc,
        "action": _best_action(),
        "repair_order": [{"station": r["station"], "name": r["name"], "loss_per_min": r["loss_per_min"], "loss_per_hour": r["loss_per_hour"],
                          "limits_output": r["limits_output"]} for r in stations],
        "quality": {"kind": chart["verdict"]["kind"], "title": chart["verdict"]["title"], "text": chart["verdict"]["text"],
                    "pbar": chart["pbar"], "norm": chart["norm"], "last": chart["points"][-1] if chart["points"] else None, "source": "calc"},
        "containment": capa.draft(td)["containment"] if chart["verdict"]["kind"] != "ok" else None,
        "yesterday": yest,
        "month": {"fact": month["fact"], "plan_to_date": month["plan_to_date"], "mean": month["forecast"]["total_mean"],
                  "range": month["forecast"]["total_range"], "p_plan": month["forecast"]["p_plan"], "plan": month["plans"]["month"],
                  "need_per_day": month["plans"]["need_per_day"], "daily": month["plans"]["daily"],
                  "by_days": month["plans"]["by_days"], "by_models": month["plans"]["by_models"], "remaining_days": month["forecast"]["remaining_days"],
                  "source": "forecast"},
        "capa": [{"action": a["action"], "start_day": a["start_day"], "verdict": a["check"]["verdict"], "title": a["check"]["title"], "demo": a["check"].get("demo", False)}
                 for a in caps[:3]],
        "risks": _risks(fc, chart, month, yest, value, caps),
        "note": "Утренний прогноз не знает о событиях дня: поломки и сбои появятся в прогнозе «к концу смены» по ходу смены.",
    }

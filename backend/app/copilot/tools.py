"""Функции, которые копилот может вызвать. Только чтение и одно UI-действие (показать участок в 3D).

Копилот не считает числа сам: он пересказывает результаты этих функций. У каждого результата есть метка источника.
"""
from __future__ import annotations

from ..findings import all_findings
from ..learn.api import alerts, calib, forecast_payload
from ..sim.api import _whatif, run_payload
from ..sim.params import MONEY_DEFAULTS, STATION_RU, avg_margin, model_mix

ZONES = {"warehouse_in": "Склад комплектующих", "welding": "Сварка", "paint": "Окраска", "assembly": "Сборка",
         "qc": "Контроль качества", "warehouse_out": "Склад готовой продукции"}


import contextvars

# Сценарий, открытый сейчас в интерфейсе: копилот говорит о том же, что видит пользователь
CURRENT_SCENARIO: contextvars.ContextVar[str] = contextvars.ContextVar("scenario", default="paint_degradation")
CURRENT_SEED: contextvars.ContextVar[int] = contextvars.ContextVar("seed", default=7)
CURRENT_VIEW: contextvars.ContextVar[dict] = contextvars.ContextVar("view", default={})


def _facts():
    from ..main import facts
    return facts()


def get_line_status() -> dict:
    scenario = CURRENT_SCENARIO.get()
    r = run_payload(scenario, CURRENT_SEED.get())
    k, bn = r["kpi"], r["bottleneck"]
    return {"source": "симуляция", "scenario": scenario,
            "годных_за_смену": round(k["good_per_shift"], 1), "план_за_смену": k["plan_per_shift"],
            "узкое_место": STATION_RU[bn["top"]], "узкое_место_доля_времени_pct": round(100 * (bn["sole"][bn["top"]] + bn["shifting"][bn["top"]])),
            "брак_окраски_pct": round(k["defect_pct"]["paint"], 1), "oee_pct": round(k["oee_pct"]),
            "oee_примечание": k["oee_note"],
            "простои_мин_за_смену": {STATION_RU[s]: round(v / 2) for s, v in k["downtime_min"].items()}}


def compare_actions() -> dict:
    scenario = CURRENT_SCENARIO.get()
    w = _whatif(scenario, 20)
    return {"source": "симуляция, 20 одинаковых прогонов", "scenario": scenario,
            "сейчас_годных_за_смену": round(w["baseline"]["good_per_shift"], 1), "план_за_смену": w["plan_per_shift"],
            "не_хватает_до_плана": round(w["gap_per_shift"], 1),
            "лучшая_пара": ({"действия": w["combo"]["names"], "прирост": round(w["combo"]["delta_per_shift"], 1), "план_выполнен": w["combo"]["closes_gap"]} if w.get("combo") else None),
            "действия": [{"действие": o["name"], "прирост_машин_за_смену": round(o["delta_per_shift"], 1),
                          "интервал_95": [round(o["ci95"][0], 1), round(o["ci95"][1], 1)],
                          "эффект_подтверждён": o["significant"], "выполняет_план": o["closes_gap"],
                          **_money(o["delta_per_shift"], o.get("money"))} for o in w["options"] if o["significant"] and o["delta_per_shift"] > 0],
            "деньги_допущения": {"средняя_маржа_с_машины_тг": round(avg_margin(_facts()), -3), "смен_в_месяц": _SHIFTS_MONTH,
                                 "модели": [{"модель": m["model"], "план_в_месяц": m["plan_month"], "цена_тг": m["price"], "маржа_тг": m["margin"]} for m in model_mix(_facts())],
                                 "примечание": "маржа и затраты — допущения A8; пользователь меняет их в калькуляторе"}}


_SHIFTS_MONTH = MONEY_DEFAULTS["work_days_month"] * MONEY_DEFAULTS["shifts_per_day"]


def _money(delta: float, cost: dict | None) -> dict:
    if not cost:
        return {}
    net = delta * _SHIFTS_MONTH * avg_margin(_facts()) - cost["month"]
    return {"затраты_в_месяц_тг": cost["month"], "разовые_вложения_тг": cost["once"], "чистый_эффект_в_месяц_тг": round(net, -4),
            "окупаемость_дней": (max(1, round(cost["once"] / (net / MONEY_DEFAULTS["work_days_month"]))) if cost["once"] and net > 0 else None)}


def get_paint_quality() -> dict:
    c = calib().state()
    cur = c["current"]
    f = {x.id: x for x in all_findings(_facts())}
    return {"source": "факт ТЗ + ввод людей и камеры",
            "брак_окраски_оценка_pct": round(100 * cur["mean"], 1),
            "интервал_90_pct": [round(100 * cur["lo90"], 1), round(100 * cur["hi90"], 1)],
            "вероятность_выше_нормы_pct": round(100 * cur["p_above_norm"]), "норма_pct": 2,
            "переделок_за_смену": round(cur["mean"] * 120, 1), "переделок_при_норме": round(0.02 * 120, 1),
            "брак_по_дням_из_ТЗ": f["quality.paint"].summary,
            "фильтр": "Замена фильтра Камеры-02 01.10 — совпадение по времени, причина брака не доказана",
            "камера_проверила_кузовов": c["camera"]["seen"]}


def get_data_findings() -> dict:
    items = all_findings(_facts())
    return {"source": "факты из ТЗ (Word-файл)",
            "выводы": [{"заголовок": f.title, "суть": f.plain or f.summary, "число": f.key, "важность": f.severity} for f in items if f.severity in ("critical", "warn", "info")][:10]}


def get_learning_status() -> dict:
    a = alerts().state()
    f = forecast_payload()["multi_seed"]
    return {"source": "самообучение (симуляция + ответы людей)",
            "точность_тревог_было_pct": round(100 * (a["start"]["precision"] or 0)),
            "точность_тревог_сейчас_pct": round(100 * (a["now"]["precision"] or 0)),
            "ответов_людей": a["human_votes"], "ложных_тревог_скрыто": a["now"]["false_suppressed"],
            "прогноз_ошибка_меньше_чем_без_обучения_pct": round(100 * f["gain_vs_frozen"])}


def get_current_view() -> dict:
    """Что пользователь видит на экране прямо сейчас: вкладка, дата, время, выбранный участок, состояния, инцидент, испытание."""
    v = dict(CURRENT_VIEW.get() or {})
    out = {"source": "экран пользователя", **{k: v[k] for k in ("tab", "date", "time", "scenario_name", "selected_zone", "incident", "stress") if v.get(k)}}
    t = v.get("t")
    if t is not None:
        r = run_payload(CURRENT_SCENARIO.get(), CURRENT_SEED.get())
        f = r["frames"][min(int(t), len(r["frames"]) - 1)]
        ru = {"working": "работает", "starved": "ждёт кузов", "blocked": "некуда отдать", "down": "стоит"}
        out["состояния_сейчас"] = {STATION_RU[s]: ru.get(st, st) for s, st in f["states"].items()}
        out["годных_к_этому_моменту"] = f["good"]
        out["буферы"] = f["buffers"]
    return out


def focus_3d(zone: str) -> dict:
    """UI-действие: показать участок в 3D. Возвращает подтверждение для интерфейса."""
    if zone not in ZONES:
        return {"ok": False, "error": f"нет участка {zone}"}
    return {"ok": True, "показан_участок": ZONES[zone], "action": {"type": "focus", "zone": zone}}


REGISTRY = {"get_current_view": get_current_view, "get_line_status": get_line_status, "compare_actions": compare_actions, "get_paint_quality": get_paint_quality,
            "get_data_findings": get_data_findings, "get_learning_status": get_learning_status, "focus_3d": focus_3d}

SCENARIO_ENUM = ["base", "paint_degradation", "conveyor_break"]
SCHEMAS = [
    {"type": "function", "function": {"name": "get_current_view", "description": "Что пользователь видит на экране сейчас: вкладка, дата и время смены, выбранный участок, состояния участков в этот момент, текущий инцидент, открытое испытание. Вызывай, когда спрашивают «что сейчас», «что происходит», «что на экране», «почему».",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_line_status", "description": "Текущее состояние линии в симуляции: годные за смену, план, узкое место, брак окраски, OEE, простои.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "compare_actions", "description": "Сравнить действия (обслужить камеру окраски, второй пост ремонта, +6 мест в буфере): прирост машин за смену с интервалом.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_paint_quality", "description": "Брак окраски: оценка, интервал, вероятность выше нормы, переделки за смену, данные ТЗ, про фильтр.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_data_findings", "description": "Главные выводы по данным из ТЗ: брак, план 4800/5500, почему OEE не считается, простои.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_learning_status", "description": "Как система учится: точность тревог до/после ответов людей, выигрыш прогноза от обучения.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "focus_3d", "description": "Показать участок на 3D-схеме завода (камера подлетит к нему). Вызывай, когда говоришь о конкретном участке.",
     "parameters": {"type": "object", "properties": {"zone": {"type": "string", "enum": list(ZONES)}}, "required": ["zone"]}}},
]

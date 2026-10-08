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
                          **_money(o["delta_per_shift"], o.get("money"), w["gap_per_shift"])} for o in w["options"] if o["significant"] and o["delta_per_shift"] > 0],
            "деньги_допущения": {"средняя_маржа_с_машины_тг": round(avg_margin(_facts()), -3), "смен_в_месяц": _SHIFTS_MONTH,
                                 "модели": [{"модель": m["model"], "план_в_месяц": m["plan_month"], "цена_тг": m["price"], "маржа_тг": m["margin"]} for m in model_mix(_facts())],
                                 "примечание": "маржа и затраты — допущения A8; пользователь меняет их в калькуляторе"}}


_SHIFTS_MONTH = MONEY_DEFAULTS["work_days_month"] * MONEY_DEFAULTS["shifts_per_day"]


def _money(delta: float, cost: dict | None, gap: float) -> dict:
    """Деньги считаем до плана: машины сверх плана приносят маржу, только если на них есть спрос."""
    if not cost:
        return {}
    m = _SHIFTS_MONTH * avg_margin(_facts())
    to_plan, above = min(delta, gap) * m, max(0.0, delta - gap) * m
    net = to_plan - cost["month"]
    return {"затраты_в_месяц_тг": cost["month"], "разовые_вложения_тг": cost["once"],
            "эффект_до_плана_в_месяц_тг": round(net, -4), "сверх_плана_в_месяц_тг_если_есть_спрос": round(above, -4),
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


# ── Новые возможности двойника: прогноз к концу смены, остановка «сейчас», журнал, месяц, нормы ТЗ ──
STATION_BY_WORD = {"сварк": "welding", "окрас": "paint", "сборк": "assembly", "конвейер": "assembly"}


def _now_t() -> int:
    v = CURRENT_VIEW.get() or {}
    return int(v.get("t") or 0)


def _today_iso() -> str:
    from datetime import date
    return date.today().isoformat()


def _view_date_iso() -> str:
    v = CURRENT_VIEW.get() or {}
    return v.get("date_iso") or _today_iso()


def _clock(t: float) -> str:
    m = int(t) + 8 * 60
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def get_shift_forecast() -> dict:
    """Сколько машин будет к концу текущей смены, если сейчас — время на шкале у пользователя."""
    from ..sim.api import eta
    t = _now_t()
    e = eta(CURRENT_SCENARIO.get(), CURRENT_SEED.get(), t)
    out = {"source": "прогноз двойника: факт до текущей минуты + 30 прогонов остатка смены",
           "сейчас": _clock(e["t"]), "смена": e["shift"], "конец_смены": _clock(e["shift_end"]), "план_смены": e["plan"],
           "сделано": int(e["done"]), "ещё_ожидается": round(e["remaining_mean"]),
           "к_концу_смены": round(e["total_mean"]), "коридор_к_концу_смены": [round(e["total_range"][0]), round(e["total_range"][1])],
           "вероятность_выполнить_план_pct": round(100 * e["p_plan"]),
           "утренний_прогноз": round(e["start"]["total_mean"]), "утренняя_вероятность_плана_pct": round(100 * e["start"]["p_plan"])}
    if e["ended"]:
        out["смена_закончилась_факт"] = int(e["actual"])
    if e["events"]:
        out["остановки_сейчас"] = [f"{x['name']} {_clock(x['at'])} на {x['minutes']} мин" for x in e["events"]]
    return out


def simulate_stop(zone: str, minutes: int = 30) -> dict:
    """Что будет к концу смены, если участок встанет прямо сейчас (в текущую минуту шкалы) на N минут."""
    from ..sim.api import eta, parse_cfg, parse_events
    if zone not in ("welding", "paint", "assembly"):
        return {"error": "остановить можно сварку (welding), окраску (paint) или сборку (assembly)"}
    minutes = int(max(5, min(240, minutes)))
    sc, seed, t = CURRENT_SCENARIO.get(), CURRENT_SEED.get(), _now_t()
    f, a = parse_cfg(sc) if sc.startswith("cfg:") else ([], [])
    ev = [f"{st}@{at}+{d}" for st, at, d in parse_events(sc)] + [f"{zone}@{min(959, t)}+{minutes}"]
    stop_sc = f"cfg:{','.join(f)}|{','.join(a)}|{';'.join(ev)}"
    before, after = eta(sc, seed, t), eta(stop_sc, seed, t)
    return {"source": "что-если двойника (30 прогонов остатка смены)", "участок": STATION_RU[zone], "остановка_с": _clock(t), "минут": minutes,
            "к_концу_смены_без_остановки": round(before["total_mean"]), "к_концу_смены_с_остановкой": round(after["total_mean"]),
            "потеря_машин": round(before["total_mean"] - after["total_mean"]),
            "вероятность_плана_без_остановки_pct": round(100 * before["p_plan"]), "вероятность_плана_с_остановкой_pct": round(100 * after["p_plan"]),
            "план_смены": after["plan"]}


def get_month_forecast() -> dict:
    """Выполним ли план месяца: факт с 1-го числа + прогноз будущих рабочих дней; несогласованность плана в ТЗ."""
    from ..journal import month
    today = _today_iso()
    m = month(today[:7], today)
    f, p = m["forecast"], m["plans"]
    return {"source": "журнал (симуляция) + прогноз двойника по 240 типичным дням", "месяц": m["month"],
            "сделано_с_начала_месяца": int(m["fact"]), "план_на_прошедшие_рабочие_дни": int(m["plan_to_date"]),
            "прогноз_к_концу_месяца": round(f["total_mean"]), "коридор": [round(f["total_range"][0]), round(f["total_range"][1])],
            "вероятность_выполнить_план_месяца_pct": round(100 * f["p_plan"]), "осталось_рабочих_дней": f["remaining_days"],
            "нужно_в_день_для_плана": round(p["need_per_day"]) if p["need_per_day"] else None, "дневной_план": p["daily"],
            "план_месяца_тз": p["month"], "план_по_дневному_плану": p["by_days"], "план_по_моделям": p["by_models"], "рабочих_дней": p["work_days"],
            "примечание": "Планы в ТЗ не сходятся — это несогласованность плана, а не недовыпуск"}


def get_day_report(date: str = "") -> dict:
    """Запись журнала за день: план, факт по сменам, утренний прогноз против факта, что съело машины, нарушения норм ТЗ."""
    from datetime import date as Date
    from ..journal import day as journal_day
    d = date or _view_date_iso()
    try:
        Date.fromisoformat(d)
    except ValueError:
        return {"error": "дата в формате ГГГГ-ММ-ДД"}
    r = journal_day(d, _today_iso())
    if r.get("kind") == "off":
        return {"source": "журнал смен", "день": d, "выходной": True}
    if r.get("in_progress") or r.get("future"):
        return {"source": "журнал смен", "день": d, "день_не_закончился": True,
                "примечание": "Итог дня записывается после его окончания; для сегодняшней смены — get_shift_forecast"}
    fs = r.get("facts")
    out = {"source": "журнал смен: данные завода + двойник" if fs else "журнал смен (симуляция)", "день": d, "условия": r["conditions"], "план": r["plan"], "факт": r["fact"],
            "выполнение_pct": round(r["pct"]), "смены": [{"смена": s["shift"], "факт": s["fact"],
                                                        "откуда_факт": "данные завода" if s.get("source") == "fact" else "симуляция двойника",
                                                        **({"двойник_по_событиям_дня": s["twin"]} if s.get("twin") is not None else {}),
                                                        "прогноз_утром": round(s["forecast"]["mean"]),
                                                        "коридор": [round(s["forecast"]["lo"]), round(s["forecast"]["hi"])], "в_коридоре": s["in_corridor"]} for s in r["shifts"]],
            "что_съело_машины": [f"{l['name']} — {l['reason']}: {l['minutes']} мин" for l in r["losses"][:3]],
            "нарушения_норм": [n["text"] for n in r.get("norms", [])], "брак_окраски_pct": r["paint_defect_pct"], "oee_pct": r["oee_pct"]}
    if fs:
        out["данные_завода"] = {"брак_по_участкам_pct": {q["name"]: q["pct"] for q in fs["quality"]},
                                "простои": [f"{x['equipment']}: {x['reason']} {x['minutes']} мин" + (" (плановое)" if x["planned"] else "") + f" — смена {'08–16' if x.get('shift', 1) == 1 else '16–24'}" for x in fs["downtime"]],
                                "примечание": fs["time_note"] + "; строка таблицы = смена 08–16 (допущение A1), смена 16–24 — двойник"}
    return out


def get_norms() -> dict:
    """Нормы ТЗ (факт) против текущей смены двойника: брак окраски, простой худшего участка, OEE."""
    from ..sim.api import parse_cfg, parse_events, shift
    sc = CURRENT_SCENARIO.get()
    f, a = parse_cfg(sc) if sc.startswith("cfg:") else ([], [])
    ev = ";".join(f"{st}@{at}+{d}" for st, at, d in parse_events(sc))
    r = shift(",".join(f), ",".join(a), 20, ev)
    side = r["forecast"] if (f or a or ev) else r["normal"]
    tg = r["targets"]
    return {"source": "нормы — факт ТЗ; значения — симуляция смены (20 прогонов)",
            "брак_окраски_pct": round(side["paint_defect_pct"], 1), "норма_брака_pct": tg["defect_max_pct"],
            "простой_худшего_участка_мин_в_сутки": round(side["worst_station_down_day"]), "лимит_простоя_мин_в_сутки": tg["downtime_max_min_per_day"],
            "oee_pct": round(side["oee_pct"]), "цель_oee_pct": tg["oee_min_pct"],
            **({"oee_из_чего": {"доступность_pct": round(side["oee_parts"]["availability"]), "темп_pct": round(side["oee_parts"]["performance"]),
                                "качество_с_первого_раза_pct": round(side["oee_parts"]["quality"])}} if side.get("oee_parts") else {})}


def get_paint_control_chart() -> dict:
    """Контрольная карта брака окраски: обычный разброс или особая причина, средний уровень против нормы."""
    from ..spc import paint
    c = paint(_today_iso())
    pts = c["points"]
    return {"source": "контрольная карта Шухарта (дни с данными завода — факт, остальные — двойник)",
            "вывод": c["verdict"]["title"], "пояснение": c["verdict"]["text"],
            "средний_уровень_брака_pct": round(100 * c["pbar"], 1), "норма_pct": round(100 * c["norm"], 1), "дней_на_карте": len(pts),
            "дни_с_особой_причиной": [{"день": p["day"], "брак_pct": round(100 * p["p"], 1), "сигнал": "; ".join(p["signals"])} for p in pts if p["signals"]],
            "последний_день": {"день": pts[-1]["day"], "брак_pct": round(100 * pts[-1]["p"], 1), "граница_разброса_pct": round(100 * pts[-1]["ucl"], 1)} if pts else None}


def get_downtime_cost() -> dict:
    """Цена минуты простоя каждого участка и проверка ограничителя «+1 час работы»."""
    from ..sim.api import station_value
    v = station_value(12)
    m = avg_margin(_facts())
    rows = sorted(v["stations"], key=lambda r: -r["loss_per_min"])
    return {"source": "симуляция двойника, одинаковые случайные события",
            "участки": [{"участок": r["name"], "потеря_машин_за_час_простоя": round(r["loss_per_hour"], 1),
                         "минута_простоя_тг": int(round(r["loss_per_min"] * m, -3)), "плюс_час_работы_машин_за_смену": round(r["gain_per_hour"], 1),
                         "ограничитель": r["limits_output"]} for r in rows],
            "ремонтировать_первым": rows[0]["name"], "средняя_маржа_с_машины_тг": int(round(m, -3)),
            "примечание": "маржа — допущение A8; «+1 час» даёт машины только ограничителю"}


def get_briefing() -> dict:
    """Утренний брифинг: прогноз смен и дня, главные риски, главное действие, порядок ремонта."""
    from ..briefing import briefing
    b = briefing(_today_iso())
    s1, day, a = b["forecast"]["shifts"][0], b["forecast"]["day"], b["action"]
    return {"source": "брифинг: прогноз двойника, журнал, контрольная карта",
            "смена_08_16": {"прогноз": round(s1["mean"]), "план": s1["plan"], "вероятность_плана_pct": round(100 * s1["p_plan"])},
            "день": {"прогноз": round(day["mean"]), "план": day["plan"], "вероятность_плана_pct": round(100 * day["p_plan"])},
            "риски": [r["text"] for r in b["risks"]],
            "главное_действие": {"действия": a["names"], "прирост_машин_за_смену": round(a["delta"], 1)} if a["names"] else None,
            "порядок_ремонта": [r["name"] for r in b["repair_order"]]}


REGISTRY = {"get_current_view": get_current_view, "get_line_status": get_line_status, "compare_actions": compare_actions, "get_paint_quality": get_paint_quality,
            "get_data_findings": get_data_findings, "get_learning_status": get_learning_status, "focus_3d": focus_3d,
            "get_shift_forecast": get_shift_forecast, "simulate_stop": simulate_stop, "get_month_forecast": get_month_forecast,
            "get_day_report": get_day_report, "get_norms": get_norms, "get_paint_control_chart": get_paint_control_chart,
            "get_downtime_cost": get_downtime_cost, "get_briefing": get_briefing}

SCENARIO_ENUM = ["base", "paint_degradation", "conveyor_break"]
SCHEMAS = [
    {"type": "function", "function": {"name": "get_current_view", "description": "Что пользователь видит на экране сейчас: вкладка, дата и время смены, выбранный участок, состояния участков в этот момент, текущий инцидент, открытое испытание. Вызывай, когда спрашивают «что сейчас», «что происходит», «что на экране», «почему».",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_line_status", "description": "Текущее состояние линии в симуляции: годные за смену, план, узкое место, брак окраски, OEE, простои.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "compare_actions", "description": "Сравнить 6 действий (обслужить камеру окраски, наладчик у линии, разгрузить сборку, ускорить роботов сварки, больше накопитель, второй пост ремонта): прирост машин за смену с интервалом, лучшая пара, разрыв до плана, деньги.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_paint_quality", "description": "Брак окраски: оценка, интервал, вероятность выше нормы, переделки за смену, данные ТЗ, про фильтр.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_data_findings", "description": "Главные выводы по данным из ТЗ: брак, план 4800/5500, почему OEE не считается, простои.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_learning_status", "description": "Как система учится: точность тревог до/после ответов людей, выигрыш прогноза от обучения.",
     "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "focus_3d", "description": "Показать участок на 3D-схеме завода (камера подлетит к нему). Вызывай, когда говоришь о конкретном участке.",
     "parameters": {"type": "object", "properties": {"zone": {"type": "string", "enum": list(ZONES)}}, "required": ["zone"]}}},
    {"type": "function", "function": {"name": "get_shift_forecast", "description": "Сколько машин будет к концу ТЕКУЩЕЙ смены (сделано + ожидается), вероятность выполнить план смены, как изменилось с утра. Вызывай на «успеем ли план», «сколько будет к концу смены».",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "simulate_stop", "description": "Что-если: участок встанет ПРЯМО СЕЙЧАС на N минут — сколько машин потеряем к концу смены и как изменится вероятность плана.",
        "parameters": {"type": "object", "properties": {"zone": {"type": "string", "enum": ["welding", "paint", "assembly"]}, "minutes": {"type": "integer", "minimum": 5, "maximum": 240}}, "required": ["zone"]}}},
    {"type": "function", "function": {"name": "get_month_forecast", "description": "Выполним ли план месяца: сделано с 1-го, прогноз к концу месяца, нужно в день, несогласованность плана в ТЗ (5500 / по дням / по моделям 4800).",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_day_report", "description": "Отчёт журнала за день: план, факт по сменам, утренний прогноз против факта, что съело машины, нарушения норм. Без даты — день на экране.",
        "parameters": {"type": "object", "properties": {"date": {"type": "string", "description": "ГГГГ-ММ-ДД"}}}}},
    {"type": "function", "function": {"name": "get_paint_control_chart", "description": "Контрольная карта брака окраски: брак дня — обычный разброс или особая причина; средний уровень против нормы 2%; дни с особой причиной.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_downtime_cost", "description": "Цена минуты простоя каждого участка (машины и тенге), какой ремонт делать первым, какой участок ограничивает выпуск (+1 час работы).",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_briefing", "description": "Утренний брифинг на сегодня: прогноз смен и дня с вероятностью плана, главные риски, главное действие, порядок ремонта.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_norms", "description": "Нормы ТЗ против текущей смены: брак окраски (норма 2%), простой худшего участка (лимит 60 мин/сутки), OEE (цель 85%).",
        "parameters": {"type": "object", "properties": {}}}},
]

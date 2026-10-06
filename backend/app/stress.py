"""Испытательный стенд: типичные сбои автозавода и «грязные» данные — замечает ли их двойник.

Каждый сбой прогоняется на нескольких сидах и сравнивается с той же сменой без сбоя (общие случайные числа).
Проверяем: правильный ли участок назван узким местом, сработала ли тревога и как быстро, видно ли падение
выпуска, не ломается ли система на плохих данных. Всё — на симуляции (реальных сбоев Allur у нас нет).
"""
from __future__ import annotations

import copy
from dataclasses import replace

import numpy as np

from .data_quality import check_frames, clean_frames
from .learn.alerts import bucket, detect_run
from .learn.stream import _state_minutes
from .sim.engine import simulate
from .sim.kpi import bottleneck
from .sim.params import BASE, STATION_RU, STATIONS, Degradation, ForcedDown

SEEDS = [101, 102, 103, 104, 105]


def _with_station(p, s, **kw):
    st = dict(p.stations)
    st[s] = replace(st[s], **kw)
    return p.with_(stations=st)


def _bn_in(run, a, b):
    """Самый частый участок-узкое место в окне [a, b)."""
    seg = [x["station"] for x in bottleneck(run)["timeline"] if a <= x["t"] < b and x["station"]]
    return max(set(seg), key=seg.count) if seg else None


def _good(run, a, b):
    return run.frames[min(int(b), len(run.frames) - 1)]["good"] - run.frames[int(a)]["good"]


def _first_alert(run, kinds, a, b):
    ts = [al.t for al in detect_run(run) if bucket(al) in kinds and a <= al.t <= b]
    return min(ts) if ts else None


# Каждый сценарий: название, как ломаем, окно сбоя, проверка (run, base) -> (прошёл?, что увидели, задержка обнаружения)
def _micro(run, base):
    bn, b0 = bottleneck(run), bottleneck(base)
    share = bn["sole"]["welding"] + bn["shifting"]["welding"]
    share0 = b0["sole"]["welding"] + b0["shifting"]["welding"]
    t = _first_alert(run, {"micro_stops"}, 0, 960)
    d = sum(b - a for a, b, st in run.states["welding"] if st == "down")
    d0 = sum(b - a for a, b, st in base.states["welding"] if st == "down")
    seen = (f"тревога «частые остановки» на {t:.0f}-й мин; " if t is not None else "нет тревоги; ") + f"простой сварки {d0:.0f}→{d:.0f} мин; доля узкого места {share0:.0%}→{share:.0%}"
    return t is not None and share >= share0 and d > d0, seen, t


def _conveyor(run, base):
    t = _first_alert(run, {"stop_asm"}, 600, 660)
    down = sum(e["minutes"] for e in run.events if e["type"] == "stop_start" and e["station"] == "assembly" and 600 <= e["t"] < 601)
    bn = _bn_in(run, 600, 650)
    return t is not None and bn == "assembly", f"тревога через {t - 600 if t else '—'} мин, простой {down:.0f} мин, узкое место — {STATION_RU.get(bn, bn).lower()}", (t - 600) if t else None


def _filter(run, base):
    bn = _bn_in(run, 360, 960)
    loss = _good(base, 360, 959) - _good(run, 360, 959)
    return bn == "paint", f"после 14:00 узкое место — {STATION_RU.get(bn, bn).lower()}, потеря {loss} машин за смену", None


def _shortage(run, base):
    starved = _state_minutes(run, "welding", 300, 345, "starved")
    t = _first_alert(run, {"shortage"}, 300, 345)
    buf, buf0 = run.frames[340]["buffers"]["b_weld_paint"], base.frames[340]["buffers"]["b_weld_paint"]
    seen = f"тревога через {t - 300 if t is not None else '—'} мин; сварка ждёт {starved:.0f} мин; буфер за сваркой {buf0}→{buf} — запас пока спасает выпуск"
    return starved >= 35 and t is not None, seen, (t - 300) if t is not None else None


def _burst(run, base):
    t = _first_alert(run, {"defect_burst"}, 300, 400)
    d = sum(1 for e in run.events if e["type"] == "defect" and e["station"] == "paint" and 300 <= e["t"] < 360)
    d0 = sum(1 for e in base.events if e["type"] == "defect" and e["station"] == "paint" and 300 <= e["t"] < 360)
    return t is not None, f"дефектов за час {d} (без сбоя {d0}), тревога через {t - 300 if t else '—'} мин", (t - 300) if t else None


def _shift(run, base):
    g, g0 = _good(run, 480, 520), _good(base, 480, 520)
    return g < g0, f"первые 40 мин смены: {g} машин против {g0}", None


def _power(run, base):
    f = run.frames[410]
    all_down = all(st == "down" for st in f["states"].values())
    out = _good(run, 401, 419)
    t = _first_alert(run, {"stop_paint", "stop_asm", "stop_other"}, 400, 425)
    return all_down and out == 0, (f"в 14:50 стоят все участки, выпуск за 18 мин — {out}" if all_down else f"в 14:50 стоят не все участки, выпуск — {out}"), (t - 400) if t else None


SCENARIOS = [
    {"id": "micro_stops", "zone": "welding", "window": (0, 960), "detail": "Датчик робота сварки сбоит каждые ~15 мин работы, остановки по 1–2 мин", "name": "Частые микроостановки робота сварки", "params": lambda: _with_station(BASE, "welding", mtbf_work=15, mttr=1.5, mttr_cv=0.3), "check": _micro},
    {"id": "conveyor_break", "zone": "assembly", "window": (600, 655), "detail": "В 18:00 рвётся цепь конвейера сборки — 55 мин простоя", "name": "Обрыв цепи конвейера сборки (55 мин)", "params": lambda: BASE.with_(forced_downs=(ForcedDown("assembly", 600, 55, reason="обрыв цепи"),)), "check": _conveyor},
    {"id": "filter_clog", "zone": "paint", "window": (120, 960), "detail": "С 10:00 фильтр камеры забивается: цикл и брак окраски растут", "name": "Засорение фильтра камеры окраски", "params": lambda: BASE.with_(degradations=(Degradation("paint", 120, 360, cycle_x=1.18, defect_x=2.3),)), "check": _filter},
    {"id": "parts_shortage", "zone": "welding", "window": (300, 340), "detail": "В 13:00 склад 40 мин не выдаёт комплектующие", "name": "Нехватка комплектующих (40 мин)", "params": lambda: BASE.with_(shortages=((300.0, 40.0),)), "check": _shortage},
    {"id": "quality_burst", "zone": "paint", "window": (300, 360), "detail": "В 13:00 брак окраски вырастает в 5 раз на час", "name": "Всплеск брака окраски (×5 на час)", "params": lambda: BASE.with_(degradations=(Degradation("paint", 300, 301, defect_x=5, reset_at=360),)), "check": _burst},
    {"id": "shift_change", "zone": "assembly", "window": (480, 510), "detail": "В 16:00 пересменка: первые 30 мин все участки на 30% медленнее", "name": "Пересменка: медленный старт (+30% цикла)", "params": lambda: BASE.with_(degradations=tuple(Degradation(s, 480, 481, cycle_x=1.3, reset_at=510) for s in STATIONS)), "check": _shift},
    {"id": "power_outage", "zone": "assembly", "window": (400, 420), "detail": "В 14:40 пропадает питание всей линии на 20 мин", "name": "Отключение электричества (20 мин)", "params": lambda: BASE.with_(forced_downs=tuple(ForcedDown(s, 400, 20, reason="нет питания") for s in STATIONS)), "check": _power},
]


def run_process_faults(seeds=SEEDS) -> list[dict]:
    out = []
    for sc in SCENARIOS:
        p = sc["params"]()
        rows = []
        for seed in seeds:
            run, base = simulate(p, seed), simulate(BASE, seed)
            ok, seen, delay = sc["check"](run, base)
            rows.append({"seed": seed, "ok": bool(ok), "seen": seen, "delay": delay})
        delays = [r["delay"] for r in rows if r["delay"] is not None]
        out.append({"id": sc["id"], "name": sc["name"], "passed": sum(r["ok"] for r in rows), "total": len(rows),
                    "median_delay_min": float(np.median(delays)) if delays else None, "example": rows[0]["seen"], "runs": rows})
    return out


# ── Сбои данных ──────────────────────────────────────────────────────────────
def _inject(kind: str, frames: list[dict]) -> list[dict]:
    f = copy.deepcopy(frames)
    if kind == "gap":
        return f[:200] + f[260:]
    if kind == "duplicate":
        return f[:300] + f[250:300] + f[300:]
    if kind == "stuck":
        v = f[300]["buffers"]["b_paint_asm"]
        for x in f[300:500]:
            x["buffers"]["b_paint_asm"] = v
        return f
    if kind == "out_of_range":
        f[100]["buffers"]["b_paint_asm"] = -3
        f[400]["buffers"]["b_weld_paint"] = 99
        return f
    if kind == "time_backwards":
        f[600]["t"] = 590.0
        return f
    if kind == "outlier":
        f[700]["good"] += 500
        return f
    raise ValueError(kind)


DATA_FAULTS = [
    ("gap", "Пропала связь на 60 мин", {"gap"}),
    ("duplicate", "Дубли 50 кадров", {"duplicate"}),
    ("stuck", "Залип датчик буфера (3 ч)", {"stuck"}),
    ("out_of_range", "Невозможные значения буфера (−3, 99)", {"out_of_range"}),
    ("time_backwards", "Сбой часов PLC: время назад", {"time_backwards"}),
    ("outlier", "Выброс счётчика выпуска (+500)", {"outlier"}),
]


def run_data_faults(seed: int = 101) -> list[dict]:
    base = simulate(BASE, seed)
    cap = BASE.buffer_cap
    clean_issues = {i["type"] for i in check_frames(base.frames, cap)}
    out = []
    for kind, name, expect in DATA_FAULTS:
        bad = _inject(kind, base.frames)
        found = {i["type"] for i in check_frames(bad, cap)}
        cleaned, removed = clean_frames(bad, cap)
        after = {i["type"] for i in check_frames(cleaned, cap)} - {"gap", "stuck"}  # пропуск и залипание не «чинятся» — только помечаются
        good_shift = cleaned[-1]["good"] / 2 if cleaned else 0
        out.append({"id": kind, "name": name, "detected": bool(expect & found), "found": sorted(found),
                    "clean_ok": not after, "removed": removed, "good_per_shift_after_clean": good_shift,
                    "false_alarm_on_clean_data": sorted(clean_issues)})
    return out

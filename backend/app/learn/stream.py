"""Поток данных для обучения: эмулятор завода со СКРЫТЫМИ параметрами.

Эмулятор — это «реальность» для демо (на заводе его заменит MES/OPC UA). Модели видят только
наблюдаемые события: выпуск, состояния, буферы, дефекты. Всё помечено как симуляция.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from ..sim.engine import RunResult, simulate
from ..sim.params import BASE, Degradation

DAY = 960.0
INTERVAL = 30            # мин — как часто выпускаем прогноз
HORIZON = 120            # мин — на сколько вперёд прогнозируем годный выпуск
DAYS = 5
DRIFT_AT = 2 * DAY + 120  # на 3-й день окраска начинает деградировать (скрыто от моделей)

EMULATOR = BASE.with_(horizon=DAYS * DAY,
                      degradations=(Degradation("paint", DRIFT_AT, DRIFT_AT + 300, cycle_x=1.18, defect_x=2.3),))

# Признаки «что происходит прямо сейчас» — только для глобальных моделей (онлайн-модели River их не видят)
NOW_FEATURES = ["down_now", "out_elapsed", "weld_down", "weld_starved_now", "asm_starved_now", "paint_slow"]

FEATURES = ["last_h", "last", "mean4", "buf_wp", "buf_pa", "buf_aq", "paint_work", "paint_down", "asm_down", "asm_starved",
            "paint_defects_60", "shift_pos"]


@lru_cache(maxsize=4)
def emulate(seed: int = 11) -> RunResult:
    return simulate(EMULATOR, seed)


def _state_minutes(run: RunResult, station: str, a: float, b: float, state: str) -> float:
    tot = 0.0
    for s0, s1, st in run.states[station]:
        if st == state and s1 > a and s0 < b:
            tot += min(s1, b) - max(s0, a)
    return tot


@dataclass
class Snapshot:
    t: int
    x: dict
    y: float | None
    z: dict = field(default_factory=dict)


def _state_at(run: RunResult, station: str, c: float) -> tuple[str, float]:
    """Состояние участка в минуту c и сколько минут оно уже длится."""
    for s0, s1, st in run.states[station]:
        if s0 <= c < s1:
            return st, c - s0
    return "working", 0.0


def interval_snapshots(run: RunResult) -> list[Snapshot]:
    """Каждые L минут: признаки на момент t (известны ДО горизонта) и факт — годные за следующие HORIZON минут."""
    good = np.array([f["good"] for f in run.frames] + [run.good_out])
    defects_t = np.array([e["t"] for e in run.events if e["type"] == "defect" and e["station"] == "paint"])
    L = INTERVAL
    out = []
    for c in range(4 * L, int(run.horizon) - HORIZON + 1, L):
        f = run.frames[c]
        x = {
            "last": float(good[c] - good[c - L]),
            "mean4": float(good[c] - good[c - 4 * L]) / 4,
            "buf_wp": f["buffers"]["b_weld_paint"],
            "buf_pa": f["buffers"]["b_paint_asm"],
            "buf_aq": f["buffers"]["b_asm_qc"],
            "paint_work": _state_minutes(run, "paint", c - L, c, "working") / L,
            "paint_down": _state_minutes(run, "paint", c - L, c, "down") / L,
            "asm_down": _state_minutes(run, "assembly", c - L, c, "down") / L,
            "asm_starved": _state_minutes(run, "assembly", c - L, c, "starved") / L,
            "paint_defects_60": float(((defects_t > c - 60) & (defects_t <= c)).sum()),
            "shift_pos": (c % 480) / 480,
        }
        x["last_h"] = float(good[c] - good[c - HORIZON])
        now = {st: _state_at(run, st, c) for st in ("welding", "paint", "assembly", "qc")}
        downs = [el for st, el in now.values() if st == "down"]
        z = {"down_now": float(len(downs)), "out_elapsed": float(max(downs) if downs else 0.0),
             "weld_down": _state_minutes(run, "welding", c - L, c, "down") / L,
             "weld_starved_now": float(now["welding"][0] == "starved"), "asm_starved_now": float(now["assembly"][0] == "starved"),
             "paint_slow": float(L / max(1.0, x["last"]) if x["last"] else 0.0) * x["paint_work"]}
        out.append(Snapshot(t=c, x=x, y=float(good[c + HORIZON] - good[c]), z=z))
    return out

"""Калибровка параметров двойника по наблюдениям людей (байес, Beta-Binomial).

Старт — реальные строки DOCX по окраске (10 дефектов на 231). Каждый ввод (например, член жюри называет
брак за смену) — новая версия параметров с источником `feedback` и возможностью отката.
После каждой версии пересчитывается прогноз годного выпуска двойника (20 прогонов SimPy).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, replace

import numpy as np
from scipy.stats import beta

from ..sim.engine import simulate
from ..sim.params import BASE

NORM = 0.02
PRIOR = (0.5, 0.5)  # Jeffreys


@dataclass
class Obs:
    produced: int
    defects: int
    source: str
    provenance: str
    who: str = ""
    at: float = field(default_factory=time.time)


DOCX_OBS = [Obs(115, 4, "fact", "docx:01.10:табл.4:стр.2"), Obs(116, 6, "fact", "docx:02.10:табл.4:стр.5")]


def posterior(obs: list[Obs]) -> dict:
    n = sum(o.produced for o in obs)
    d = sum(o.defects for o in obs)
    a, b = PRIOR[0] + d, PRIOR[1] + n - d
    return {"mean": a / (a + b), "lo90": float(beta.ppf(0.05, a, b)), "hi90": float(beta.ppf(0.95, a, b)),
            "p_above_norm": float(beta.sf(NORM, a, b)), "n": n, "defects": d}


def expected_output(defect_p: float, reps: int = 20) -> dict:
    """Прогноз двойника: годных за смену при текущей оценке брака окраски (общие случайные числа)."""
    st = dict(BASE.stations)
    st["paint"] = replace(st["paint"], defect_p=defect_p)
    p = BASE.with_(stations=st)
    good = np.array([simulate(p, 500 + s).good_out / 2 for s in range(reps)])
    return {"good_per_shift": float(good.mean()), "lo": float(np.percentile(good, 10)), "hi": float(np.percentile(good, 90))}


class Calibrator:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.obs: list[Obs] = list(DOCX_OBS)
        self.history: list[dict] = []
        self._snapshot("старт: данные ТЗ")

    def _snapshot(self, trigger: str) -> None:
        post = posterior(self.obs)
        self.history.append({"version": len(self.history) + 1, "trigger": trigger, **post,
                             "forecast": expected_output(post["mean"]), "n_obs": len(self.obs), "at": time.time()})

    def add(self, produced: int, defects: int, who: str = "") -> dict:
        if produced <= 0 or not 0 <= defects <= produced:
            raise ValueError("Брак должен быть от 0 до числа выпущенных")
        self.obs.append(Obs(produced, defects, "feedback", "manual:demo-day", who))
        self._snapshot(f"ввод: {defects} из {produced}" + (f" ({who})" if who else ""))
        return self.state()

    def undo(self) -> dict:
        if len(self.obs) > len(DOCX_OBS):
            self.obs.pop()
            self._snapshot("откат последнего ввода")
        return self.state()

    def state(self) -> dict:
        return {"source": "feedback", "norm": NORM, "current": self.history[-1], "history": self.history,
                "observations": [{"produced": o.produced, "defects": o.defects, "source": o.source, "provenance": o.provenance, "who": o.who} for o in self.obs]}

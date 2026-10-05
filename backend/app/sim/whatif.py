"""Сравнение действий на общих случайных числах (CRN) с парным 95% доверительным интервалом."""
from __future__ import annotations

import numpy as np
from scipy import stats

from .engine import simulate
from .kpi import bottleneck
from .params import INTERVENTIONS, LineParams


def paired_ci(diff: np.ndarray, level: float = 0.95) -> tuple[float, float, float]:
    n = len(diff)
    m = float(diff.mean())
    if n < 2:
        return m, m, m
    se = float(diff.std(ddof=1) / np.sqrt(n))
    h = float(stats.t.ppf(0.5 + level / 2, n - 1) * se)
    return m, m - h, m + h


def compare(base: LineParams, intervention_ids: list[str], reps: int = 20, seed0: int = 1000) -> dict:
    seeds = [seed0 + i for i in range(reps)]
    shifts = base.horizon / base.shift_minutes
    base_runs = [simulate(base, s) for s in seeds]
    b_good = np.array([r.good_out for r in base_runs]) / shifts
    b_wait = np.array([bottleneck(r)["top"] for r in base_runs])
    out = {
        "reps": reps,
        "baseline": {"good_per_shift": float(b_good.mean()), "bottleneck": max(set(b_wait), key=list(b_wait).count)},
        "options": [],
    }
    for iid in intervention_ids:
        spec = INTERVENTIONS[iid]
        runs = [simulate(spec["apply"](base), s) for s in seeds]
        good = np.array([r.good_out for r in runs]) / shifts
        m, lo, hi = paired_ci(good - b_good)
        tops = [bottleneck(r)["top"] for r in runs]
        out["options"].append({
            "id": iid, "name": spec["name"], "detail": spec["detail"],
            "good_per_shift": float(good.mean()),
            "delta_per_shift": m, "ci95": [lo, hi],
            "significant": lo > 0 or hi < 0,
            "bottleneck_after": max(set(tops), key=tops.count),
        })
    out["options"].sort(key=lambda o: -o["delta_per_shift"])
    return out

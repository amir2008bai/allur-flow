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


def param_changes(before: LineParams, after: LineParams) -> list[dict]:
    """Что именно меняется в двойнике: параметр было → стало (считается из модели, не пишется руками)."""
    from .params import BUFFER_RU, STATION_RU
    out = []
    for s, a in before.stations.items():
        b = after.stations[s]
        if abs(b.cycle - a.cycle) > 1e-9:
            out.append({"what": f"Цикл: {STATION_RU[s].lower()}", "before": round(a.cycle, 2), "after": round(b.cycle, 2), "unit": "мин", "source": "assumption"})
        if abs(b.mttr - a.mttr) > 1e-9 and a.mtbf_work:
            out.append({"what": f"Ремонт после отказа: {STATION_RU[s].lower()}", "before": round(a.mttr), "after": round(b.mttr), "unit": "мин", "source": "assumption"})
    for k, v in before.buffer_cap.items():
        if after.buffer_cap[k] != v:
            out.append({"what": f"Буфер {BUFFER_RU[k]}", "before": v, "after": after.buffer_cap[k], "unit": "мест", "source": "assumption"})
    if after.repair_servers != before.repair_servers:
        out.append({"what": "Посты точечного ремонта", "before": before.repair_servers, "after": after.repair_servers, "unit": "шт", "source": "assumption"})
    for d in after.degradations:
        if d.reset_at is not None and all(x.reset_at is None for x in before.degradations if x.station == d.station):
            out.append({"what": f"Брак и цикл окраски", "before": f"растут с {int(d.start // 60 + 8):02d}:00", "after": f"норма с {int(d.reset_at // 60 + 8):02d}:{int(d.reset_at % 60):02d}", "unit": "", "source": "sim"})
    for f in after.forced_downs:
        if f not in before.forced_downs:
            out.append({"what": f"Плановая остановка: {STATION_RU[f.station].lower()}", "before": "—", "after": f"{int(f.minutes)} мин", "unit": "", "source": "sim"})
    return out


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
            "id": iid, "short": spec.get("short", spec["name"]), "name": spec["name"], "detail": spec["detail"], "do": spec.get("do", ""), "cost": spec.get("cost", ""), "money": spec.get("money"),
            "changes": param_changes(base, spec["apply"](base)),
            "good_per_shift": float(good.mean()),
            "delta_per_shift": m, "ci95": [lo, hi],
            "significant": lo > 0 or hi < 0,
            "bottleneck_after": max(set(tops), key=tops.count),
        })
    out["options"].sort(key=lambda o: -o["delta_per_shift"])
    plan = 120.0
    out["plan_per_shift"] = plan
    out["gap_per_shift"] = max(0.0, plan - out["baseline"]["good_per_shift"])
    for o in out["options"]:
        o["closes_gap"] = o["significant"] and o["good_per_shift"] >= plan
    out["useful"] = [o["id"] for o in out["options"] if o["significant"] and o["delta_per_shift"] > 0]
    # лучшая пара действий: закрывает ли она разрыв до плана
    out["combo"] = None
    if len(out["useful"]) >= 2:
        a, b = out["useful"][:2]
        p2 = INTERVENTIONS[b]["apply"](INTERVENTIONS[a]["apply"](base))
        good = np.array([simulate(p2, s).good_out for s in seeds]) / shifts
        m, lo, hi = paired_ci(good - b_good)
        out["combo"] = {"ids": [a, b], "names": [INTERVENTIONS[a]["name"], INTERVENTIONS[b]["name"]], "shorts": [INTERVENTIONS[a]["short"], INTERVENTIONS[b]["short"]],
                        "good_per_shift": float(good.mean()), "delta_per_shift": m, "ci95": [lo, hi],
                        "closes_gap": lo > 0 and float(good.mean()) >= plan,
                        "money": {k: INTERVENTIONS[a]["money"][k] + INTERVENTIONS[b]["money"][k] for k in ("month", "once")}}
    return out

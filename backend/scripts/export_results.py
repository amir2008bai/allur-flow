"""Выгрузка результатов Allur Flow в JSON и CSV (папка results/) — для проверки без запуска интерфейса.

Запуск из папки backend:  .venv/Scripts/python scripts/export_results.py [ГГГГ-ММ-ДД]
Считает на временной базе (рабочие данные не трогаются). У каждого файла и числа — метка источника
(fact — данные заказчика, calc — расчёт по ним, sim — симуляция двойника, forecast — прогноз, assumption — допущение).
"""
from __future__ import annotations

import csv
import json
import os
import sys
import tempfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="allur_export_")
os.environ.setdefault("ALLUR_DB", os.path.join(TMP, "export.sqlite"))
os.environ.setdefault("ALLUR_STATE_DIR", TMP)
os.environ.setdefault("ALLUR_WARMUP", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.briefing import briefing  # noqa: E402
from app.dataset import active_facts  # noqa: E402
from app.effect import effect  # noqa: E402
from app.findings import all_findings  # noqa: E402
from app.journal import month  # noqa: E402
from app.sim.api import ASSUMPTIONS, run_payload, shift  # noqa: E402
from app.spc import paint  # noqa: E402

TODAY = sys.argv[1] if len(sys.argv) > 1 else "2026-10-08"
OUT = Path(__file__).resolve().parents[2] / "results"
OUT.mkdir(exist_ok=True)


def dump(name: str, data) -> None:
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1, default=float), encoding="utf-8")


def table(name: str, rows: list[dict]) -> None:
    if not rows:
        return
    keys = list(dict.fromkeys(k for r in rows for k in r))
    with open(OUT / f"{name}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=keys, delimiter=";")
        w.writeheader(); w.writerows(rows)


facts = active_facts()
dump("facts_normalized", {"source": "fact", **facts.model_dump(mode="json")})
fnd = [f.model_dump(mode="json") for f in all_findings(facts)]
dump("findings", {"source": "calc", "items": fnd})
table("findings", [{"id": f["id"], "severity": f["severity"], "title": f["title"], "plain": f["plain"], "caveat": f["caveat"] or ""} for f in fnd])

run = run_payload("base", 7)
k = run["kpi"]
table("kpi_by_station_sim", [{"station": s, "source": "sim", "utilization_pct": round(100 * (1 - k["state_shares"][s]["down"]), 1),
                              "working_pct": round(100 * k["state_shares"][s]["working"], 1), "downtime_min": round(k["downtime_min"][s], 1),
                              "unplanned_min_per_day": round(k["unplanned_downtime_min_per_day"][s], 1), "defect_pct": round(k["defect_pct"][s], 2)}
                             for s in k["state_shares"]])
dump("kpi_sim_base_day", {"source": "sim", "seed": 7, "good_per_shift": k["good_per_shift"], "oee_pct": k["oee_pct"], "oee_parts": k["oee_parts"],
                          "oee_note": k["oee_note"], "bottleneck": run["bottleneck"]["top"]})
dump("shift_forecast", {"source": "forecast", **shift("", "", 20, "")})
m = month(TODAY[:7], TODAY)
dump("month_forecast", m)
table("month_days", [{k2: d.get(k2) for k2 in ("day", "kind", "fact", "plan", "pct", "has_facts", "forecast", "lo", "hi")} for d in m["days"]])
c = paint(TODAY)
dump("paint_control_chart", c)
table("paint_control_chart", [{"day": p["day"], "source": p["source"], "n": p["n"], "defects": p["defects"], "p_pct": round(100 * p["p"], 2),
                               "ucl_pct": round(100 * p["ucl"], 2), "lcl_pct": round(100 * p["lcl"], 2), "signals": "; ".join(p["signals"])} for p in c["points"]])
e = effect()
dump("business_effect", e)
table("business_effect", [{"lever": l["name"], "delta_cars_per_shift": round(l["delta_per_shift"], 2), "ci95_lo": round(l["ci"][0], 2), "ci95_hi": round(l["ci"][1], 2),
                           "downtime_min_per_shift_before": round(l["downtime_per_shift"]["before"], 1), "downtime_min_per_shift_after": round(l["downtime_per_shift"]["after"], 1),
                           "oee_before": round(l["oee"]["before"], 1), "oee_after": round(l["oee"]["after"], 1),
                           "cost_month_kzt": (l["cost"] or {}).get("month", ""), "cost_once_kzt": (l["cost"] or {}).get("once", ""), "source": "sim"} for l in e["levers"]])
dump("briefing", briefing(TODAY))
dump("assumptions", {"source": "assumption", "items": ASSUMPTIONS})
table("assumptions", ASSUMPTIONS)
print("готово:", ", ".join(sorted(p.name for p in OUT.iterdir())))

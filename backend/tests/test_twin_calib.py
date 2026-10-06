"""Подгонка двойника: на синтетическом «заводе» с известной надёжностью двойник должен её восстановить."""
from dataclasses import replace
from datetime import date, timedelta

from app.dataset import active_facts
from app.schemas import DowntimeRecord, LineRecord, Provenance
from app.sim.engine import simulate
from app.sim.params import BASE
from app.twin_calib import fit


def _synthetic_plant(days: int = 21):
    """«Реальный» завод: окраска ломается чаще и чинится дольше, чем считает двойник."""
    hidden = dict(BASE.stations)
    hidden["paint"] = replace(hidden["paint"], mtbf_work=500, mttr=55)
    hidden["welding"] = replace(hidden["welding"], mtbf_work=1400, mttr=20)
    plant = BASE.with_(stations=hidden, horizon=960)
    pv = Provenance(file="synthetic", table=0, row=0)
    down, lines = [], []
    for d in range(days):
        day = date(2026, 9, 1) + timedelta(days=d)
        run = simulate(plant, 9000 + d)
        for e in run.events:
            if e["type"] == "stop_start" and e["station"] in ("welding", "paint", "assembly") and not e.get("planned"):
                down.append(DowntimeRecord(date=day, area=e["station"], asset_id=e["station"], equipment=e["station"], reason="отказ",
                                           minutes=max(1, round(e["minutes"])), planned=False, provenance=pv))
        lines.append(LineRecord(date=day, line="Сборка-1", area="assembly", plan=240, fact=run.good_out, runtime_h=16, utilization_pct=95, provenance=pv))
    return active_facts().model_copy(update={"downtime": down, "lines": lines})


def test_fit_recovers_hidden_reliability():
    facts = _synthetic_plant()
    rep = fit(facts, BASE, apply=False)
    assert rep["enough_data"] and not rep["applied"]
    paint = next(a for a in rep["areas"] if a["area"] == "paint")
    assert abs(paint["twin_after"] - paint["fact_down"]) <= 0.25 * paint["fact_down"]        # простои совпали
    assert abs(paint["twin_after"] - paint["fact_down"]) < abs(paint["twin_before"] - paint["fact_down"])
    ch = {c["area"]: c for c in rep["changes"]}
    assert 40 <= ch["paint"]["mttr_after"] <= 70                                              # MTTR ≈ скрытым 55
    assert BASE.stations["paint"].mtbf_work == 1100                                          # без apply параметры не тронуты

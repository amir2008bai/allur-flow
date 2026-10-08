"""Подгонка двойника: на синтетическом «заводе» с известной надёжностью двойник должен её восстановить."""
from dataclasses import replace
from datetime import date, timedelta

from app.dataset import active_facts
from app.schemas import DowntimeRecord, LineRecord, Provenance
from app.sim.engine import simulate
from app.sim.params import BASE
from app.twin_calib import fit


def _synthetic_plant(days: int = 21):
    from app.twin_calib import synthetic_plant
    return synthetic_plant(days)


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

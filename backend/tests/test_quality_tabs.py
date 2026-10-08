from datetime import date
from types import SimpleNamespace
from app import spc, fact_days, journal


def test_each_area_uses_its_own_factory_quality():
    d = date(2026, 10, 2)
    for area in spc.AREAS:
        expected = [q for q in fact_days.rows(d)["quality"] if q.area == area]
        point = spc._day_point(d, area)
        assert point["source"] == "fact"
        assert point["n"] == sum(q.produced for q in expected)
        assert point["defects"] == sum(q.defects for q in expected)


def test_tabs_share_one_simulation_without_building_shift_forecasts(monkeypatch):
    calls = []
    def simulate(params, seed):
        calls.append(seed)
        return SimpleNamespace(produced={a: 100 for a in spc.AREAS},
                               defects={"welding": 1, "paint": 5, "assembly": 2})
    def no_record(*args):
        raise AssertionError("Quality chart must not build a full journal record")
    monkeypatch.setattr("app.sim.api.twin_context", lambda: {"version": "quality-test"})
    monkeypatch.setattr("app.sim.api.twin_overlay", lambda params: params)
    monkeypatch.setattr("app.sim.engine.simulate", simulate)
    monkeypatch.setattr(journal, "record", no_record)
    spc.clear_cache()
    try:
        points = [spc._day_point(date(2026, 9, 10), a) for a in spc.AREAS]
        assert len(calls) == 1
        assert [p["defects"] for p in points] == [1, 5, 2]
        assert all(p["source"] == "sim" for p in points)
    finally:
        spc.clear_cache()

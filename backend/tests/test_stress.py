"""Испытательный стенд: двойник должен замечать типичные сбои завода и «грязные» данные."""
from app.data_quality import check_frames
from app.sim.engine import simulate
from app.sim.params import BASE
from app.stress import run_data_faults, run_process_faults


def test_all_process_faults_detected():
    for r in run_process_faults(seeds=[101, 102, 103]):
        assert r["passed"] == r["total"], (r["name"], [x["seen"] for x in r["runs"] if not x["ok"]])


def test_all_data_faults_detected_and_cleaned():
    for r in run_data_faults():
        assert r["detected"] and r["clean_ok"], r


def test_no_false_alarms_on_clean_data():
    for seed in (101, 102, 103):
        assert check_frames(simulate(BASE, seed).frames, BASE.buffer_cap) == []


def test_chaos_all_faults():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.stress import SCENARIOS
    c = TestClient(app)
    r = c.get("/api/stress/chaos", params={"ids": ",".join(s["id"] for s in SCENARIOS), "seed": 101}).json()
    s = r["summary"]
    assert s["good_fault"] < s["good_base"] and s["loss"] > 0 and s["oee_fault"] < s["oee_base"]
    assert s["detected"] >= len(SCENARIOS) - 1
    assert c.get("/api/sim/run", params={"scenario": "chaos:conveyor_break,power_outage", "seed": 5}).status_code == 200


def test_chaos_stats_honest_average_and_detection():
    # прогноз беспредела — среднее по многим сменам, а не одна смена; пример может отличаться от среднего
    from app.stress import BY_ID, chaos_stats
    st = chaos_stats(list(BY_ID), seeds=range(201, 211))
    assert st["shifts"] == 10 and st["loss_range"][0] <= st["loss_mean"] <= st["loss_range"][1]
    assert 15 < st["loss_mean"] < 60 and 6 <= st["detected_mean"] <= 7
    assert all(0 <= v <= 1 for v in st["detect_rate"].values())


def test_data_fault_reports_detection_and_action():
    from app.stress_api import data_fault
    for k in ("gap", "duplicate", "stuck", "out_of_range", "time_backwards", "outlier"):
        r = data_fault(k)
        assert r["detected"] and r["clean_ok"] and r["false_alarm_on_clean_data"] == []
    assert data_fault("duplicate")["removed"] == 50 and data_fault("gap")["marked_only"]

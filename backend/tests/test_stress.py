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

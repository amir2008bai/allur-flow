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

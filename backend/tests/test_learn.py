import numpy as np
from fastapi.testclient import TestClient

from app.learn.alerts import AlertLearner
from app.learn.calib import Calibrator
from app.learn.forecast import run_learning
from app.learn.stream import HORIZON, emulate, interval_snapshots
from app.main import app


def test_features_known_before_horizon():
    snaps = interval_snapshots(emulate(11))
    run = emulate(11)
    good = [f["good"] for f in run.frames]
    s = snaps[5]
    assert s.x["last_h"] == good[s.t] - good[s.t - HORIZON]   # прошлое
    assert s.y == good[s.t + HORIZON] - good[s.t]             # будущее — только как факт


def test_online_learning_beats_frozen_on_average():
    runs = [run_learning(s)["summary"] for s in range(11, 21)]
    champ = np.mean([r["champion"]["mae_after_drift"] for r in runs])
    frozen = np.mean([r["frozen"]["mae_after_drift"] for r in runs])
    assert champ < frozen


def test_no_explosion_and_sane_predictions():
    for seed in range(11, 21):
        tl = run_learning(seed)["timeline"]
        assert max(r["champion"] for r in tl) <= 60 and min(r["champion"] for r in tl) >= 0


def test_small_data_falls_back_to_simple_forecast():
    # на первых 12 часах модель ещё не доказала точность — пользователю показывается простой прогноз
    for seed in range(11, 21):
        tl = run_learning(seed, n_max=24)["timeline"]
        assert all(r["served"] == r["naive"] for r in tl[:20])


def test_served_forecast_not_worse_than_simple_on_average():
    runs = [run_learning(s)["summary"] for s in range(11, 21)]
    served = np.mean([r["served"]["mae_after_drift"] for r in runs])
    naive = np.mean([r["naive"]["mae_after_drift"] for r in runs])
    assert served <= naive


def test_alert_votes_improve_precision():
    L = AlertLearner()
    start = L.state()["start"]["precision"]
    st = L.simulate_votes(60, accuracy=0.9)
    assert st["now"]["precision"] > start
    assert any(t["muted"] for t in st["types"])
    assert all(v["simulated"] for v in L.votes)


def test_eval_pool_never_shown_for_voting():
    L = AlertLearner()
    ids = {a.id for a in L.eval_pool}
    for _ in range(30):
        card = L.next_card()
        assert card["id"] not in ids
        L.vote(card["id"], "confirm")


def test_calibration_update_and_undo():
    C = Calibrator()
    m0 = C.state()["current"]["mean"]
    m1 = C.add(118, 9, "жюри")["current"]["mean"]
    assert m1 > m0
    assert abs(C.undo()["current"]["mean"] - m0) < 1e-12


def test_learn_api():
    c = TestClient(app)
    f = c.get("/api/learn/forecast").json()
    assert f["source"] == "forecast" and f["multi_seed"]["seeds"] == 10
    card = c.get("/api/learn/alerts/next").json()["card"]
    st = c.post("/api/learn/alerts/vote", json={"alert_id": card["id"], "verdict": "reject"}).json()
    assert st["human_votes"] >= 1
    assert c.post("/api/learn/calib", json={"produced": 100, "defects": 200}).status_code == 422

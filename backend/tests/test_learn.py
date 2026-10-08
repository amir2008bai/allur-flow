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
    # без проверенной глобальной модели: на первых 12 часах онлайн-модель не доказала точность → простой прогноз
    for seed in range(11, 21):
        tl = run_learning(seed, n_max=24, use_global=False)["timeline"]
        assert all(r["served"] == r["naive"] for r in tl[:20])


def test_validated_global_model_served_from_start_and_interval_honest():
    # глобальная модель проверена на отложенных потоках (реестр) → показывается сразу; интервал покрывает ~90%
    from app.learn import global_model
    if global_model.current_booster() is None:
        global_model.train(30)
    runs = [run_learning(s) for s in range(11, 21)]
    assert all(r["timeline"][0]["served"] == r["timeline"][0]["lgbm"] for r in runs)
    cov = np.mean([r["summary"]["interval"]["coverage"] for r in runs])
    assert 0.8 <= cov <= 0.97
    lgbm = np.mean([r["summary"]["lgbm"]["mae_after_drift"] for r in runs])
    naive = np.mean([r["summary"]["naive"]["mae_after_drift"] for r in runs])
    assert lgbm < 0.85 * naive


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


def test_camera_events_update_calibration():
    c = TestClient(app)
    c.post("/api/learn/reset")
    m0 = c.get("/api/learn/calib").json()["current"]["mean"]
    for i in range(20):
        r = c.post("/api/learn/camera/event", json={"event_type": "paint_defect" if i < 5 else "paint_ok", "body_id": f"T{i}"})
        assert r.status_code == 200
    st = c.get("/api/learn/camera").json()
    assert st["seen"] == 20 and st["defects"] == 5
    assert st["calib"]["current"]["mean"] > m0          # 25% брака от камеры → оценка выросла
    assert c.post("/api/learn/camera/event", json={"event_type": "что-то"}).status_code == 422
    c.post("/api/learn/reset")


def test_learning_survives_server_restart():
    # ответы людей, ввод брака и события камеры хранятся в базе и восстанавливаются после перезапуска
    from app.learn import api
    api.reset()
    card = api.alerts().next_card()
    api.vote(api.VoteIn(alert_id=card["id"], verdict="reject", voter="мастер"))
    api.calib_add(api.CalibIn(produced=100, defects=9, who="ОТК"))
    api.camera_demo(n=20)
    before = (api.alerts().state()["votes"], round(api.calib().state()["current"]["mean"], 5), api.calib().camera_seen)
    api._alerts = None; api._calib = None                 # «перезапуск»: память стёрта
    after = (api.alerts().state()["votes"], round(api.calib().state()["current"]["mean"], 5), api.calib().camera_seen)
    assert before == after and before[0] == 1 and before[2] == 20
    api.reset()
    api._alerts = None; api._calib = None
    assert api.alerts().state()["votes"] == 0 and api.calib().camera_seen == 0   # сброс тоже сохраняется


def test_dip_threshold_is_chosen_by_error_cost():
    # Н3: порог тревоги «провал» — по цене ошибок (пропуск ×3), а не 50%
    import numpy as np
    from app.learn.global_model import choose_threshold
    rng = np.random.default_rng(0)
    y = (rng.random(4000) < 0.15).astype(int)
    p = np.clip(0.15 + 0.25 * (y - 0.15) + rng.normal(0, 0.1, 4000), 0, 1)   # слабая, но полезная модель
    t = choose_threshold(p, y)
    assert t < 0.5
    cost = lambda th: 3 * ((p < th) & (y == 1)).sum() + ((p >= th) & (y == 0)).sum()  # noqa: E731
    assert cost(t) <= cost(0.5)

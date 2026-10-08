import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.sim.engine import simulate
from app.sim.kpi import bottleneck, kpis
from app.sim.params import SCENARIOS, STATIONS


def test_deterministic_with_seed():
    a, b = simulate(SCENARIOS["base"], 3), simulate(SCENARIOS["base"], 3)
    assert a.good_out == b.good_out and a.events == b.events


def test_states_cover_horizon():
    r = simulate(SCENARIOS["base"], 1)
    for s in STATIONS:
        total = sum(b - a for a, b, _ in r.states[s])
        assert abs(total - r.horizon) < 1e-6


def test_flow_conservation():
    p = SCENARIOS["paint_degradation"]
    r = simulate(p, 2)
    # годный выпуск не больше, чем обработала ОТК; ОТК не больше сборки + стартовый запас перед ней
    assert r.good_out == r.produced["qc"]
    assert r.produced["qc"] <= r.produced["assembly"] + p.buffer_init["b_asm_qc"]


def test_calibrated_to_docx_output():
    good = np.mean([simulate(SCENARIOS["base"], s).good_out / 2 for s in range(20)])
    assert 113 <= good <= 123  # DOCX: 115–121 за смену


def test_paint_degradation_moves_bottleneck_to_paint():
    shares = np.mean([[bottleneck(simulate(SCENARIOS["paint_degradation"], s))["sole"][st] for st in STATIONS]
                      for s in range(10)], axis=0)
    assert STATIONS[int(shares.argmax())] == "paint"


def test_oee_labeled_as_assumption():
    k = kpis(simulate(SCENARIOS["base"], 0), 3.78)
    assert "допущение" in k["oee_note"] and 0 < k["oee_pct"] < 100


def test_api_sim():
    c = TestClient(app)
    assert len(c.get("/api/sim/meta").json()["interventions"]) == 6
    run = c.get("/api/sim/run", params={"scenario": "paint_degradation", "seed": 1}).json()
    assert run["source"] == "sim" and run["bottleneck"]["top"] == "paint"
    w = c.get("/api/sim/whatif", params={"reps": 10}).json()
    best = w["options"][0]
    assert best["id"] == "paint_service" and best["significant"] and best["delta_per_shift"] > 0


def test_actions_have_money_assumptions():
    from app.sim.api import _whatif, meta
    from app.sim.params import INTERVENTIONS, MONEY_DEFAULTS
    assert all({"month", "once"} <= set(v["money"]) for v in INTERVENTIONS.values())
    m = meta()
    assert m["money"]["margin_pct"] == MONEY_DEFAULTS["margin_pct"]
    assert [x["model"] for x in m["models"]] == ["Chevrolet Onix", "Chevrolet Cobalt", "JAC J7"]
    assert abs(sum(x["share"] for x in m["models"]) - 1) < 1e-9
    assert 300_000 < sum(x["share"] * x["margin"] for x in m["models"]) < 450_000
    w = _whatif("base", 20)
    assert all("money" in o for o in w["options"])
    if w["combo"]:
        a, b = w["combo"]["ids"]
        assert w["combo"]["money"]["once"] == INTERVENTIONS[a]["money"]["once"] + INTERVENTIONS[b]["money"]["once"]


def test_shift_builder_faults_and_actions():
    from app.sim.api import options, run_payload, shift
    o = options()
    assert len(o["faults"]) == 7 and len(o["actions"]) == 6 and all(x["short"] for x in o["faults"] + o["actions"])
    normal = shift("", "", 10)
    assert normal["plan_per_shift"] == 120 and normal["forecast"]["delta"] == 0
    bad = shift("filter_clog,power_outage", "", 10)
    assert bad["forecast"]["delta_ci"][1] < 0                     # сбои уверенно отнимают машины
    fixed = shift("filter_clog,power_outage", "paint_service", 10)
    assert fixed["forecast"]["good_per_shift"] > bad["forecast"]["good_per_shift"]   # действие возвращает часть
    assert fixed["actions"][0]["cost_per_shift"] > 0
    assert run_payload("cfg:filter_clog|paint_service", 7)["scenario_name"] == "Засор фильтра окраски, Обслужить камеру окраски"


def test_feedback_changes_twin_context_and_recalculates():
    # ввод людей меняет знания двойника → новая версия → новый расчёт (а не старый кеш)
    from app.learn.api import calib
    from app.sim.api import shift, twin_context
    calib().reset()
    v0 = twin_context()
    r0 = shift("", "", 10)
    calib().add(100, 20, "тест")
    v1 = twin_context()
    r1 = shift("", "", 10)
    calib().reset()
    assert not v0["learned"] and v1["learned"] and v0["version"] != v1["version"]
    assert r1["twin"]["version"] == v1["version"]
    assert r1["normal"]["good_per_shift"] < r0["normal"]["good_per_shift"]   # больше брака → меньше годных


def test_service_now_earlier_is_better():
    # «сейчас» — момент вмешательства важен: раннее обслуживание даёт больше машин
    from app.sim.api import futures_payload
    early = futures_payload("paint_degradation", "paint_service", 7, 200)
    late = futures_payload("paint_degradation", "paint_service", 7, 600)
    base = early["do_nothing"]["kpi"]["good_per_shift"]
    assert early["intervene"]["kpi"]["good_per_shift"] > late["intervene"]["kpi"]["good_per_shift"] >= base
    # до момента вмешательства будущие совпадают (одинаковые случайности)
    assert early["intervene"]["frames"][150]["good"] == early["do_nothing"]["frames"][150]["good"]


def test_eta_updates_during_shift_and_stop_now():
    # прогноз «к концу смены»: утром широкий, к 14:00 уже, остановка «сейчас» роняет его, утренний прогноз её не знает
    from app.sim.api import eta, parse_cfg, scenario_name
    morning = eta("base", 7, 0)
    noon = eta("base", 7, 360)
    stop = eta("cfg:||assembly@360+60", 7, 360)
    w = lambda r: r["total_range"][1] - r["total_range"][0]  # noqa: E731
    assert morning["done"] == 0 and noon["done"] > 0 and w(noon) < w(morning)
    assert stop["total_mean"] < noon["total_mean"] - 5 and stop["p_plan"] < noon["p_plan"]
    assert stop["start"] == noon["start"]          # утром о поломке не знали
    assert stop["done"] == noon["done"]            # до момента остановки смена та же
    assert parse_cfg("cfg:|fast_repair|assembly@360+60") == ([], ["fast_repair"])
    assert "Сборка встала в 14:00 на 60 мин" in scenario_name("cfg:||assembly@360+60")


def test_journal_day_record_saved_once_and_honest():
    from datetime import date
    from app import journal
    d = date(2026, 10, 6)
    journal.con().execute("DELETE FROM journal WHERE day=?", (d.isoformat(),))
    r1 = journal.record(d)
    r2 = journal.record(d)
    assert r1["saved_at"] == r2["saved_at"]                       # запись делается один раз
    assert r1["fact"] == sum(s["fact"] for s in r1["shifts"]) and r1["plan"] == 240
    weld = [l for l in r1["losses"] if l["station"] == "welding" and l["reason"] == "авария"]
    assert weld and weld[0]["minutes"] <= 96                       # авария 95 мин не задваивается
    m = journal.month("2026-10", "2026-10-08")
    assert len(m["days"]) == 8 and m["plan_to_date"] == 8 * 240

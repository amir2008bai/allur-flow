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

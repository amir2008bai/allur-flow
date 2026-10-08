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
    assert any("лимит 60" in n["text"] for n in r1["norms"])      # нормы ТЗ проверяются
    m = journal.month("2026-10", "2026-10-08")
    worked = [d for d in m["days"] if d["day"] < "2026-10-08" and d["kind"] != "off"]
    assert len(worked) == 5 and m["plan_to_date"] == 5 * 240         # сб/вс — выходные; сегодня ещё идёт — не в факте
    today = next(d for d in m["days"] if d["day"] == "2026-10-08")
    assert today.get("today") and "fact" not in today and today["forecast"] > 0
    assert journal.day("2026-10-08", "2026-10-08")["in_progress"]       # сегодняшний день не записывается
    assert m["plans"]["by_days"] == 240 * m["plans"]["work_days"] and m["plans"]["by_models"] == 4800
    f = m["forecast"]
    assert f["total_range"][0] <= f["total_mean"] <= f["total_range"][1] and f["total_mean"] > m["fact"]


def test_month_forecast_reacts_to_maintenance_mark():
    from app import journal
    base = journal.month("2026-10", "2026-10-08")["forecast"]["total_mean"]
    journal.mark(journal.Mark(day="2026-10-20", kind="maint", today="2026-10-08"))
    with_to = journal.month("2026-10", "2026-10-08")["forecast"]["total_mean"]
    journal.mark(journal.Mark(day="2026-10-20", kind="auto", today="2026-10-08"))
    assert with_to < base - 20


def test_line_is_described_by_config_file():
    # параметры двойника берутся из data/line.json, а не из кода
    from app.sim.api import line
    from app.sim.params import BASE, BUFFERS, STATIONS
    cfg = line()
    assert [s["id"] for s in cfg["stations"]] == STATIONS and [b["id"] for b in cfg["buffers"]] == BUFFERS
    for s in cfg["stations"]:
        assert BASE.stations[s["id"]].cycle == s["cycle"] and BASE.stations[s["id"]].mtbf_work == s["mtbf_work"]
    assert all(BASE.buffer_cap[b["id"]] == b["cap"] for b in cfg["buffers"])


def test_journal_days_with_factory_data_use_facts_not_invented_events():
    # Н1: 01.10 и 02.10 есть в данных завода — журнал берёт оттуда простои, брак и выпуск смены, а не выдумывает условия
    from datetime import date
    from app import journal
    r1 = journal.record(date(2026, 10, 1))
    assert r1["facts"]["source"] == "fact" and "ABB-01" in r1["conditions"] and "Камера-02" in r1["conditions"]
    assert r1["paint_defect_pct"] == 3.5                                  # брак окраски из таблицы 4, не из симуляции
    assert r1["shifts"][0]["source"] == "fact" and r1["shifts"][0]["fact"] == 121   # выпуск Сборки-1 за 01.10
    assert r1["shifts"][1]["source"] == "sim"
    r2 = journal.record(date(2026, 10, 2))
    assert {l["reason"] for l in r2["losses"]} == {"Конвейер-03: Обрыв цепи", "ABB-04: Плановое ТО"}
    assert next(l for l in r2["losses"] if "ТО" in l["reason"])["planned"]
    assert any("сварки 2,7%" in n["text"] for n in r2["norms"]) and any("окраски 5,2%" in n["text"] for n in r2["norms"])
    assert r2["downtime_min"] == 55                                        # плановое ТО не входит во внеплановые простои
    m = journal.month("2026-10", "2026-10-08")
    assert m["corridor_fact"]["shifts"] == 2                               # сверка с фактом — отдельно от самопроверки
    assert next(d for d in m["days"] if d["day"] == "2026-10-01")["has_facts"]
    # двойник проигрывает день с реальными событиями; брак дня — факт, обучение его не переписывает
    from app.sim.api import run_payload, scenario_name
    run = run_payload(r2["scenario"], 7)
    reasons = [s["reason"] for s in run["stops"]]
    assert any("Конвейер-03" in x for x in reasons) and any("ABB-04" in x for x in reasons)
    assert scenario_name("day:2026-10-02") == "День 02.10 по данным завода"


def test_oee_is_availability_times_performance_times_quality():
    # Н5: OEE раскладывается на три части, произведение точно равно OEE; поломка бьёт по доступности
    base = simulate(SCENARIOS["base"], 7)
    brk = simulate(SCENARIOS["conveyor_break"], 7)
    for run in (base, brk):
        k = kpis(run, 3.4)
        p = k["oee_parts"]
        assert abs(p["availability"] * p["performance"] * p["quality"] / 1e4 - k["oee_pct"]) < 1e-6
        c = p["cars"]
        assert abs(c["ideal"] - c["availability"] - c["performance"] - c["quality"] - c["good"]) < 1e-6   # каскад сходится к факту
    assert kpis(brk, 3.4)["oee_parts"]["availability"] < kpis(base, 3.4)["oee_parts"]["availability"]
    assert kpis(brk, 3.4)["oee_parts"]["availability_loss_min"] >= 50


def test_month_forecast_accounts_for_parameter_uncertainty():
    # Н4: неточность параметров двойника (2 дня данных) расширяет коридор месяца
    import numpy as np
    from app import journal
    from app.sim.api import twin_context
    unc = journal.param_uncertainty()
    assert unc["paint_produced"] == 231 and all(s == journal.SIGMA_MAX for s in unc["sigma"].values())
    typical, _ = journal._day_dist(twin_context()["version"])
    assert typical.shape == (journal.PARAM_SETS, journal.DAYS_PER_SET)
    between = np.var(typical.mean(axis=1))      # разброс между «возможными заводами» есть — неточность учтена
    assert between > 0
    f = journal.month("2026-10", "2026-10-08")["forecast"]
    assert f["param_uncertainty"]["sets"] == journal.PARAM_SETS


def test_factory_stop_placed_in_shift_where_it_fits():
    # находка: 02.10 сборка работала 7,9 ч (недоработка 6 мин), а обрыв цепи — 55 мин → он был в другой смене;
    # с этим двойник дня совпадает с фактом смены 08–16 (119), а не занижает его до ~102
    from datetime import date
    from app import fact_days, journal
    ev = {e["equipment"]: e for e in fact_days.placed_events(date(2026, 10, 2))}
    assert ev["Конвейер-03"]["shift"] == 2 and ev["Конвейер-03"]["start"] >= 480
    assert ev["ABB-04"]["shift"] == 1 and ev["ABB-04"]["start"] < 480
    r = journal.record(date(2026, 10, 2))
    s1 = r["shifts"][0]
    assert abs(s1["twin"] - s1["fact"]) <= 8 and s1["in_corridor"]


def test_paint_control_chart_separates_noise_from_special_cause():
    # контрольная карта: границы 3σ, сигналы Western Electric, вывод «хронически выше нормы» при стабильном процессе
    from app.spc import chart, paint
    flat = [{"day": f"2026-09-{i + 1:02d}", "n": 240, "defects": 11, "source": "sim"} for i in range(20)]
    c = chart([dict(p) for p in flat], 0.02)
    assert c["verdict"]["kind"] == "chronic" and not any(p["signals"] for p in c["points"])   # 4,6% стабильно — не «плохие дни»
    spike = [dict(p) for p in flat]
    spike[-1]["defects"] = 40                                                                    # 16,7% — далеко за границей
    c = chart(spike, 0.02)
    assert c["verdict"]["kind"] == "special" and "выше верхней границы" in c["points"][-1]["signals"][0]
    assert abs(c["pbar"] - 11 / 240) < 1e-9                                                     # особый день не тянет среднюю
    trend = [dict(p, defects=8 + i) for i, p in enumerate(flat[:6])]
    assert any("растут" in s for s in chart(trend, 0.02)["points"][-1]["signals"])
    r = paint("2026-10-08")
    assert r["facts"] == 2 and len(r["points"]) == 20                                          # 01–02.10 — из данных завода
    f = next(p for p in r["points"] if p["day"] == "2026-10-02")
    assert f["source"] == "fact" and (f["n"], f["defects"]) == (116, 6)


def test_downtime_cost_finds_constraint_by_extra_hour():
    # цена минуты простоя: час простоя любого участка стоит машин; «+1 час» даёт машины только ограничителю
    from app.sim.api import station_value
    v = station_value(6)
    rows = {r["station"]: r for r in v["stations"]}
    assert all(r["loss_per_hour"] > 0 for r in rows.values())
    assert v["constraint"] == "assembly" and rows["assembly"]["gain_ci"][0] > 0
    assert rows["assembly"]["loss_per_min"] == max(r["loss_per_min"] for r in rows.values())

from fastapi.testclient import TestClient

from app.copilot.agent import ask_offline, verify_numbers
from app.main import app


def test_verify_numbers_flags_invented():
    tools = [{"брак": 4.5, "годных": 116.2}]
    assert verify_numbers("Брак 4,5%, годных 116.2", tools) == []
    assert verify_numbers("Брак 7,9% и 300 машин", tools) == ["7,9", "300"]


def test_offline_answers_are_grounded():
    for q in ["Во что обходится брак окраски?", "Что сделать, чтобы выпустить больше?", "Где узкое место?", "Почему OEE не считается?"]:
        r = ask_offline(q)
        assert r["answer"] and r["unverified"] == [], (q, r["unverified"], r["answer"])


def test_offline_paint_focuses_3d():
    r = ask_offline("брак окраски")
    assert {"type": "focus", "zone": "paint"} in r["actions"]


def test_api_offline_mode():
    r = TestClient(app).post("/api/copilot", json={"message": "Где узкое место?", "offline": True}).json()
    assert r["mode"] == "offline" and r["sources"]


def test_verify_checks_unit_and_sign_not_only_value():
    # контрпримеры из исследования: число совпадает, но смысл другой (единица, знак, округление)
    from app.copilot.agent import verify_numbers
    facts = [{"брак_окраски_pct": 4.5, "прирост_машин_за_смену": -12.4, "годных_за_смену": 116.2}]
    for wrong in ("брак 116,2%", "прирост +12,4 машины", "прирост +7 машин", "выпуск 116,4 машины"):
        assert verify_numbers(wrong, facts), wrong
    assert verify_numbers("Брак 4,5%, годных 116,2 машины, прирост −12,4 машины, около 116 машин", facts) == []


def test_verified_card_is_built_by_server_with_honest_status():
    from app.copilot.agent import verified_facts
    log = [{"name": "compare_actions", "result": {"лучшая_пара": None, "действия": [
        {"действие": "A", "прирост_машин_за_смену": 3.1, "интервал_95": [1.0, 5.0]},
        {"действие": "B", "прирост_машин_за_смену": 0.3, "интервал_95": [-0.4, 1.0]}]}}]
    v = verified_facts(log)
    assert "подтверждён" in v[0]["note"] and "через 0" in v[1]["note"]
    assert verified_facts([{"name": "compare_actions", "result": {"лучшая_пара": None, "действия": []}}])[0]["label"] == "Ничего не менять"


def test_copilot_knows_new_twin_features_offline():
    from app.copilot.agent import ask
    view = {"t": 360, "date_iso": "2026-10-06"}
    cases = {"Успеем выполнить план смены?": "get_shift_forecast", "Что если сейчас встанет сборка на час?": "simulate_stop",
             "Выполним план месяца?": "get_month_forecast", "Соблюдаем нормы ТЗ?": "get_norms", "Что было в этот день?": "get_day_report"}
    for q, tool in cases.items():
        r = ask(q, offline=True, scenario="base", seed=7, view=view)
        assert tool in [t["name"] for t in r["tools"]], q
        assert r["unverified"] == [] and r["verified"], q


def test_offline_copilot_answers_control_chart_and_downtime_cost():
    from app.copilot.agent import ask
    a = ask("Брак окраски — случайность или проблема?", offline=True)
    assert any(t["name"] == "get_paint_control_chart" for t in a["tools"]) and not a["unverified"]
    b = ask("Что ремонтировать первым?", offline=True)
    assert any(t["name"] == "get_downtime_cost" for t in b["tools"]) and "Сборка" in b["answer"] and not b["unverified"]

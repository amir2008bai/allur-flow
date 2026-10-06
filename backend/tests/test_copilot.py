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

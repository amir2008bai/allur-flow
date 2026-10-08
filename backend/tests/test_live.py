"""Живые данные: шлюз завода шлёт события — двойник видит состояние участков и счётчики."""
from fastapi.testclient import TestClient

from app.main import app


def test_gateway_events_update_live_state():
    c = TestClient(app)
    r = c.post("/api/live/events", json={"events": [
        {"station": "paint", "type": "state", "value": "down", "source": "test-gw"},
        {"asset_id": "ABB-01", "type": "state", "value": "working", "source": "test-gw"},   # по оборудованию из line.json
        {"station": "qc", "type": "good", "value": 3, "source": "test-gw"},
        {"station": "нет-такого", "type": "state", "value": "down"},                        # пропускается
        {"station": "paint", "type": "state", "value": "сломалось"},                         # неизвестное состояние — пропуск
    ]}).json()
    assert r == {"accepted": 3, "rejected": 2}
    st = c.get("/api/live/status").json()
    by = {s["id"]: s for s in st["stations"]}
    assert by["paint"]["state"] == "down" and by["welding"]["state"] == "working"
    assert st["good"] >= 3 and st["connected"] and st["feed"] == "test-gw"

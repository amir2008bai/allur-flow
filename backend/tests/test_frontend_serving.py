"""Сервер отдаёт собранный интерфейс с того же адреса, что и API (PWA, деплой)."""
from fastapi.testclient import TestClient

from app.main import app


def _dist(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "bundles").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "sw.js").write_text("// sw", encoding="utf-8")
    (tmp_path / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "bundles" / "meta.json").write_text("{}", encoding="utf-8")
    return tmp_path


def test_spa_and_static(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLUR_FRONTEND_DIST", str(_dist(tmp_path)))
    c = TestClient(app)
    for url in ("/", "/vote", "/vote/"):
        r = c.get(url)
        assert r.status_code == 200 and "id=root" in r.text and r.headers["cache-control"] == "no-cache", url
    r = c.get("/sw.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"
    assert "immutable" in c.get("/assets/index-abc.js").headers["cache-control"]
    assert c.get("/bundles/meta.json").json() == {}
    assert c.get("/bundles/missing.json").status_code == 404      # не index.html вместо JSON
    assert c.get("/%2e%2e/%2e%2e/app/main.py").status_code == 404   # за пределы dist не выйти


def test_api_not_shadowed(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLUR_FRONTEND_DIST", str(_dist(tmp_path)))
    c = TestClient(app)
    assert c.get("/api/health").json() == {"status": "ok"}
    r = c.get("/api/nope")
    assert r.status_code == 404 and "id=root" not in r.text


def test_no_build_is_clear(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLUR_FRONTEND_DIST", str(tmp_path / "missing"))
    r = TestClient(app).get("/")
    assert r.status_code == 404 and "npm run build" in r.json()["detail"]

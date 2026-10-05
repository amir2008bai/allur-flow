"""Журнал событий — основа «самообучающегося датасета». SQLite (WAL) сейчас, TimescaleDB позже.

Правило: у каждой строки обязателен `source` (fact/plan/sim/whatif/forecast/feedback) и `provenance`.
Прогнозы пишутся ДО факта (issued_at < начала горизонта), факт дописывается позже.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "allur_flow.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, created_at REAL NOT NULL, scenario TEXT NOT NULL, seed INTEGER NOT NULL,
  params_json TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('sim','whatif'))
);
CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT, ts_event REAL NOT NULL, observable_at REAL, ingested_at REAL NOT NULL,
  event_type TEXT NOT NULL, asset_id TEXT, body_id INTEGER, value REAL, payload TEXT,
  source TEXT NOT NULL CHECK (source IN ('fact','plan','sim','whatif','forecast','feedback')),
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_run ON events(run_id, ts_event);
CREATE TABLE IF NOT EXISTS forecasts (
  forecast_id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, asset_id TEXT,
  issued_at REAL NOT NULL, feature_cutoff REAL NOT NULL, horizon_start REAL NOT NULL, horizon_end REAL NOT NULL,
  model_name TEXT NOT NULL, model_version TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('champion','challenger','baseline')),
  y_hat REAL NOT NULL, y_lo REAL, y_hi REAL, y_true REAL, abs_err REAL, treated INTEGER DEFAULT 0,
  CHECK (feature_cutoff <= issued_at AND issued_at <= horizon_start)
);
CREATE TABLE IF NOT EXISTS feedback (
  feedback_id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL, verdict TEXT NOT NULL
  CHECK (verdict IN ('confirm','reject','planned')), reason TEXT, user_role TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS twin_params (
  version INTEGER NOT NULL, asset_id TEXT NOT NULL, param TEXT NOT NULL, mean REAL, lo90 REAL, hi90 REAL,
  n_obs INTEGER, trigger TEXT, created_at REAL NOT NULL, PRIMARY KEY (version, asset_id, param)
);
CREATE TABLE IF NOT EXISTS model_versions (
  model_name TEXT NOT NULL, version TEXT NOT NULL, alias TEXT, parent_version TEXT, trigger TEXT,
  metrics_json TEXT, created_at REAL NOT NULL, PRIMARY KEY (model_name, version)
);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, check_same_thread=False)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def log_run(con: sqlite3.Connection, run_id: str, scenario: str, run, source: str = "sim") -> None:
    """Записать прогон в журнал. Повторная запись того же run_id ничего не дублирует."""
    if con.execute("SELECT 1 FROM runs WHERE run_id=?", (run_id,)).fetchone():
        return
    now = time.time()
    con.execute("INSERT INTO runs VALUES (?,?,?,?,?,?)",
                (run_id, now, scenario, run.seed, json.dumps(repr(run.params)), source))
    prov = f"sim:{run_id}:seed{run.seed}"
    rows = [(run_id, e["t"], e["t"], now, e["type"], f"{e['station']}", e.get("body"), e.get("minutes"),
             json.dumps({k: v for k, v in e.items() if k not in ("t", "type", "station", "body")}, ensure_ascii=False),
             source, prov) for e in run.events]
    con.executemany("INSERT INTO events (run_id, ts_event, observable_at, ingested_at, event_type, asset_id, body_id,"
                    " value, payload, source, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()

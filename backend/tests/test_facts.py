from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.findings import all_findings, defect_posterior
from app.ingest_docx import load_facts
from app.main import app

DATA = Path(__file__).resolve().parents[2] / "data" / "raw" / "test_data.docx"


@pytest.fixture(scope="module")
def facts():
    return load_facts(DATA)


def test_ingest_counts(facts):
    assert len(facts.lines) == 6
    assert len(facts.downtime) == 4
    assert len(facts.model_plan) == 3
    assert len(facts.quality) == 6
    assert [a.id for a in facts.route] == ["warehouse_in", "welding", "paint", "assembly", "qc", "warehouse_out"]


def test_targets(facts):
    t = facts.targets
    assert (t.shifts_per_day, t.shift_hours, t.oee_min_pct, t.defect_max_pct) == (2, 8, 85, 2)
    assert t.critical_downtime_max_min_per_day == 60
    assert t.monthly_output_min == 5500


def test_reported_defect_pct_matches(facts):
    for q in facts.quality:
        assert abs(round(100 * q.defects / q.produced, 1) - q.defect_pct_reported) <= 0.05


def test_planned_maintenance_flag(facts):
    planned = [d.equipment for d in facts.downtime if d.planned]
    assert planned == ["ABB-04"]


def test_paint_defect_posterior():
    post = defect_posterior(10, 231, 0.02)
    assert post["p_above"] > 0.98
    assert 0.025 < post["lo90"] < post["mean"] < post["hi90"] < 0.075


def test_findings_key_numbers(facts):
    by_id = {f.id: f for f in all_findings(facts)}
    assert by_id["quality.paint"].severity == "critical"
    assert by_id["quality.welding"].severity == "warn"
    assert by_id["quality.assembly"].severity == "ok"
    gap = next(m for m in by_id["plan.gap"].metrics if m.label == "Разрыв")
    assert gap.value == 700
    conv = by_id["downtime.assembly.conveyor03.1002"]
    assert any(m.label == "Недоработка линии" and m.value == 6 for m in conv.metrics)
    assert next(m for m in by_id["flow.balance"].metrics).value == 19
    assert all(m.source for f in by_id.values() for m in f.metrics)


def test_api():
    c = TestClient(app)
    assert c.get("/api/health").json() == {"status": "ok"}
    assert len(c.get("/api/facts").json()["lines"]) == 6
    assert c.get("/api/findings").json()[0]["severity"] == "critical"

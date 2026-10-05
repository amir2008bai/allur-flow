from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI

from .findings import all_findings
from .ingest_docx import load_facts
from .schemas import Facts, Finding

DATA = Path(__file__).resolve().parents[2] / "data" / "raw" / "test_data.docx"

app = FastAPI(title="Allur Flow API")


@lru_cache
def facts() -> Facts:
    return load_facts(DATA)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/facts", response_model=Facts)
def get_facts() -> Facts:
    return facts()


@app.get("/api/findings", response_model=list[Finding])
def get_findings() -> list[Finding]:
    return all_findings(facts())

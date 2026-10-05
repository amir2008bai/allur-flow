"""Контракт данных: нормализованные факты из DOCX и выводы по ним."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Source = Literal["fact", "calc", "assumption", "sim", "forecast", "feedback"]
AreaId = Literal["warehouse_in", "welding", "paint", "assembly", "qc", "warehouse_out"]


class Provenance(BaseModel):
    """Откуда взялось значение: файл, таблица, строка."""
    file: str
    table: int
    row: int


class LineRecord(BaseModel):
    date: date
    line: str
    area: AreaId
    plan: int
    fact: int
    runtime_h: float
    utilization_pct: float
    provenance: Provenance


class DowntimeRecord(BaseModel):
    date: date
    area: AreaId
    asset_id: str
    equipment: str
    reason: str
    minutes: int
    planned: bool = Field(description="Плановое ТО — не входит во внеплановую доступность")
    provenance: Provenance


class ModelPlan(BaseModel):
    model: str
    monthly_plan: int
    provenance: Provenance


class QualityRecord(BaseModel):
    date: date
    area: AreaId
    produced: int
    defects: int
    defect_pct_reported: float
    provenance: Provenance


class Targets(BaseModel):
    shifts_per_day: int
    shift_hours: float
    oee_min_pct: float
    defect_max_pct: float
    critical_downtime_max_min_per_day: int
    monthly_output_min: int


class Area(BaseModel):
    id: AreaId
    name: str
    order: int


class Facts(BaseModel):
    source_file: str
    route: list[Area]
    lines: list[LineRecord]
    downtime: list[DowntimeRecord]
    model_plan: list[ModelPlan]
    quality: list[QualityRecord]
    targets: Targets


Severity = Literal["ok", "info", "warn", "critical"]


class Metric(BaseModel):
    label: str
    value: float | str
    unit: str = ""
    source: Source


class Finding(BaseModel):
    id: str
    title: str
    severity: Severity
    area: AreaId | None = None
    summary: str
    metrics: list[Metric] = []
    caveat: str | None = None
    provenance: list[Provenance] = []

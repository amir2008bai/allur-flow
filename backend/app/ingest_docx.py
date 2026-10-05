"""Импорт тестовых данных кейса из DOCX в нормализованные факты.

Читаем таблицы по заголовкам, а не по позиции ячеек, и валидируем каждую строку.
Если структура документа изменится, импорт упадёт с понятной ошибкой, а не тихо исказит числа.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import docx

from .schemas import (
    Area, DowntimeRecord, Facts, LineRecord, ModelPlan, Provenance, QualityRecord, Targets,
)

ROUTE = [
    Area(id="warehouse_in", name="Склад комплектующих", order=0),
    Area(id="welding", name="Сварка", order=1),
    Area(id="paint", name="Окраска", order=2),
    Area(id="assembly", name="Сборка", order=3),
    Area(id="qc", name="Контроль качества", order=4),
    Area(id="warehouse_out", name="Склад готовой продукции", order=5),
]

AREA_BY_NAME = {"Сварка": "welding", "Окраска": "paint", "Сборка": "assembly"}

# Оборудование из DOCX → asset_id (иерархия в духе ISA-95: участок.актив)
ASSET_IDS = {"ABB-01": "welding.abb01", "ABB-04": "welding.abb04",
             "Камера-02": "paint.booth02", "Конвейер-03": "assembly.conveyor03"}

EXPECTED_HEADERS = {
    0: ["Дата", "Линия", "План", "Факт", "Время работы, ч", "Загрузка, %"],
    1: ["Дата", "Участок", "Оборудование", "Причина", "Длительность, мин"],
    2: ["Модель", "План на месяц"],
    3: ["Дата", "Участок", "Выпущено", "Брак", "% брака"],
}


class IngestError(ValueError):
    pass


def _num(s: str) -> float:
    return float(s.strip().replace(",", ".").replace(" ", "").replace(" ", ""))


def _date(s: str):
    return datetime.strptime(s.strip(), "%d.%m.%Y").date()


def _rows(table) -> list[list[str]]:
    return [[c.text.strip() for c in r.cells] for r in table.rows]


def _area_from_line(line: str) -> str:
    base = line.split("-")[0]
    if base not in AREA_BY_NAME:
        raise IngestError(f"Неизвестная линия: {line}")
    return AREA_BY_NAME[base]


def _parse_targets(paragraphs: list[str]) -> Targets:
    text = "\n".join(paragraphs)

    def find(pattern: str) -> str:
        m = re.search(pattern, text)
        if not m:
            raise IngestError(f"Не найдено в дополнительных вводных: {pattern}")
        return m.group(1)

    return Targets(
        shifts_per_day=int(find(r"(\d+)\s*смен")),
        shift_hours=_num(find(r"смен[а-я]*\s*по\s*(\d+)\s*час")),
        oee_min_pct=_num(find(r"OEE[^\d]*(\d+)\s*%")),
        defect_max_pct=_num(find(r"брака[^\d]*(\d+)\s*%")),
        critical_downtime_max_min_per_day=int(find(r"оборудования[^\d]*(\d+)\s*минут")),
        monthly_output_min=int(_num(find(r"План выпуска[^\d]*([\d\s ]+)\s*автомоб"))),
    )


def load_facts(path: str | Path) -> Facts:
    path = Path(path)
    d = docx.Document(str(path))
    if len(d.tables) < 4:
        raise IngestError(f"Ожидалось 4 таблицы, найдено {len(d.tables)}")

    tables = {i: _rows(d.tables[i]) for i in range(4)}
    for i, hdr in EXPECTED_HEADERS.items():
        if tables[i][0] != hdr:
            raise IngestError(f"Таблица {i + 1}: заголовки {tables[i][0]} не совпадают с {hdr}")

    fname = path.name
    prov = lambda t, r: Provenance(file=fname, table=t + 1, row=r)  # noqa: E731

    lines = [LineRecord(date=_date(r[0]), line=r[1], area=_area_from_line(r[1]), plan=int(_num(r[2])),
                        fact=int(_num(r[3])), runtime_h=_num(r[4]), utilization_pct=_num(r[5]),
                        provenance=prov(0, i))
             for i, r in enumerate(tables[0][1:], start=1)]

    downtime = []
    for i, r in enumerate(tables[1][1:], start=1):
        if r[1] not in AREA_BY_NAME:
            raise IngestError(f"Неизвестный участок: {r[1]}")
        downtime.append(DowntimeRecord(
            date=_date(r[0]), area=AREA_BY_NAME[r[1]], asset_id=ASSET_IDS.get(r[2], r[2].lower()),
            equipment=r[2], reason=r[3], minutes=int(_num(r[4])),
            planned="плановое" in r[3].lower(), provenance=prov(1, i)))

    model_plan = [ModelPlan(model=r[0], monthly_plan=int(_num(r[1])), provenance=prov(2, i))
                  for i, r in enumerate(tables[2][1:], start=1)]

    quality = []
    for i, r in enumerate(tables[3][1:], start=1):
        quality.append(QualityRecord(date=_date(r[0]), area=AREA_BY_NAME[r[1]], produced=int(_num(r[2])),
                                     defects=int(_num(r[3])), defect_pct_reported=_num(r[4]),
                                     provenance=prov(3, i)))

    paragraphs = [p.text for p in d.paragraphs if p.text.strip()]
    return Facts(source_file=fname, route=ROUTE, lines=lines, downtime=downtime,
                 model_plan=model_plan, quality=quality, targets=_parse_targets(paragraphs))

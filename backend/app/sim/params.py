"""Параметры модели линии. Всё, чего нет в ТЗ, — допущение и помечено в `ASSUMPTIONS`.

Время — в минутах. Калибровка по DOCX: брак участков (calc), выпуск ≈ 115–121 за смену 8 ч (fact).
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

STATIONS = ["welding", "paint", "assembly", "qc"]
STATION_RU = {"welding": "Сварка", "paint": "Окраска", "assembly": "Сборка", "qc": "Контроль качества"}
# буфер i стоит перед станцией STATIONS[i+1]
BUFFERS = ["b_weld_paint", "b_paint_asm", "b_asm_qc"]
BUFFER_RU = {"b_weld_paint": "Сварка → Окраска", "b_paint_asm": "Окраска → Сборка (PBS)", "b_asm_qc": "Сборка → ОТК"}


@dataclass(frozen=True)
class StationParams:
    cycle: float              # среднее время цикла, мин (допущение)
    cycle_cv: float           # разброс цикла
    defect_p: float           # вероятность дефекта на станции (calc из DOCX)
    rework_min: float         # время исправления в станции, мин
    mtbf_work: float | None   # среднее рабочее время между отказами, мин (None — без отказов)
    mttr: float = 30.0        # среднее время ремонта, мин
    mttr_cv: float = 0.5


@dataclass(frozen=True)
class Degradation:
    """Плавное ухудшение станции: от start до end множители растут линейно до cycle_x / defect_x."""
    station: str
    start: float
    end: float
    cycle_x: float = 1.0
    defect_x: float = 1.0
    reset_at: float | None = None   # момент, когда ухудшение устранено (например, обслуживание)


@dataclass(frozen=True)
class ForcedDown:
    """Принудительная остановка: авария из сценария или плановое обслуживание."""
    station: str
    start: float
    minutes: float
    planned: bool = False
    reason: str = ""


@dataclass(frozen=True)
class LineParams:
    stations: dict[str, StationParams]
    buffer_cap: dict[str, int]
    buffer_init: dict[str, int]
    spot_repair_p: float = 0.7      # доля дефектов окраски, исправляемых точечным ремонтом (иначе — перекраска)
    repair_mean: float = 6.0
    repair_servers: int = 1
    max_paint_passes: int = 2
    horizon: float = 960.0          # 2 смены × 8 ч
    shift_minutes: float = 480.0
    degradations: tuple[Degradation, ...] = ()
    forced_downs: tuple[ForcedDown, ...] = ()
    shortages: tuple[tuple[float, float], ...] = ()   # (начало, минут) — склад не выдаёт комплектующие

    def with_(self, **kw) -> "LineParams":
        return replace(self, **kw)


BASE = LineParams(
    stations={
        "welding": StationParams(cycle=3.62, cycle_cv=0.08, defect_p=5 / 229, rework_min=3.0, mtbf_work=900, mttr=28),
        "paint": StationParams(cycle=3.68, cycle_cv=0.10, defect_p=10 / 231, rework_min=0.0, mtbf_work=1100, mttr=35),
        "assembly": StationParams(cycle=3.78, cycle_cv=0.08, defect_p=3 / 240, rework_min=4.0, mtbf_work=1000, mttr=40),
        "qc": StationParams(cycle=3.0, cycle_cv=0.10, defect_p=0.0, rework_min=0.0, mtbf_work=None),
    },
    buffer_cap={"b_weld_paint": 8, "b_paint_asm": 12, "b_asm_qc": 4},
    buffer_init={"b_weld_paint": 4, "b_paint_asm": 8, "b_asm_qc": 2},
)

ASSUMPTIONS = [
    {"id": "A1", "text": "Одна строка DOCX = одна смена 8 ч; сутки = 2 смены = 960 мин", "source": "assumption"},
    {"id": "A2", "text": "Время цикла: сварка 3,62; окраска 3,68; сборка 3,78; ОТК 3,0 мин — подобраны под выпуск ~118 за смену", "source": "assumption"},
    {"id": "A3", "text": "Буферы: сварка→окраска 8, окраска→сборка 12, сборка→ОТК 4 места; стартовый запас 4/8/2", "source": "assumption"},
    {"id": "A4", "text": "Отказы: в среднем раз в 900–1100 мин работы, ремонт 28–40 мин (по порядку величин из журнала простоев)", "source": "assumption"},
    {"id": "A5", "text": "Брак участков взят из DOCX: сварка 2,18%, окраска 4,33%, сборка 1,25%", "source": "calc"},
    {"id": "A6", "text": "Дефект окраски: 70% — точечный ремонт (~6 мин, 1 пост), 30% — перекраска; после 2 проходов — списание", "source": "assumption"},
    {"id": "A7", "text": "Идеальный цикл линии для OEE = 3,4 мин: тогда план 120 машин за смену соответствует цели OEE 85%", "source": "assumption"},
]

# Демонстрационный сценарий: окраска постепенно деградирует (цикл и брак растут)
PAINT_DEGRADATION = Degradation(station="paint", start=120, end=420, cycle_x=1.18, defect_x=2.3)
CONVEYOR_BREAK = ForcedDown(station="assembly", start=600, minutes=55, reason="Конвейер-03: обрыв цепи (смоделированный инцидент)")

SCENARIOS: dict[str, LineParams] = {
    "base": BASE,
    "paint_degradation": BASE.with_(degradations=(PAINT_DEGRADATION,)),
    "conveyor_break": BASE.with_(forced_downs=(CONVEYOR_BREAK,)),
}
SCENARIO_RU = {
    "base": "Обычная работа",
    "paint_degradation": "Окраска деградирует",
    "conveyor_break": "Обрыв цепи Конвейера-03",
}


def _paint_service(p: LineParams) -> LineParams:
    """Обслужить окрасочную камеру в 200-ю минуту: 20 мин плановой остановки, деградация сброшена."""
    degs = tuple(replace(d, reset_at=220) if d.station == "paint" else d for d in p.degradations)
    stop = ForcedDown(station="paint", start=200, minutes=20, planned=True, reason="Плановое обслуживание камеры")
    return p.with_(degradations=degs, forced_downs=p.forced_downs + (stop,))


INTERVENTIONS = {
    "paint_service": {"name": "Обслужить камеру окраски сейчас", "detail": "20 мин плановой остановки, затем брак и цикл возвращаются к норме",
                      "apply": _paint_service},
    "second_repair_post": {"name": "Второй пост точечного ремонта", "detail": "2 поста вместо 1, ремонт быстрее",
                           "apply": lambda p: p.with_(repair_servers=2)},
    "pbs_buffer": {"name": "+6 мест в буфере перед сборкой", "detail": "буфер окраска → сборка 18 вместо 12",
                   "apply": lambda p: p.with_(buffer_cap={**p.buffer_cap, "b_paint_asm": p.buffer_cap["b_paint_asm"] + 6})},
}

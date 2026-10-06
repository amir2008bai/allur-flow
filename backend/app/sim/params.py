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
    {"id": "A8", "text": "Маржа завода 5% от розничной цены модели (Onix ~7,5 млн ₸, Cobalt ~7,3 млн, JAC J7 ~8,5 млн), средняя по плану моделей ≈ 375 тыс. ₸ с машины; 22 рабочих дня по 2 смены; затраты на действия — оценка. Всё меняется в калькуляторе", "source": "assumption"},
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


def service_paint_at(p: LineParams, at: float) -> LineParams:
    """Обслужить камеру окраски в минуту at: 20 мин плановой остановки, деградация окраски сброшена после."""
    degs = tuple(replace(d, reset_at=at + 20) if d.station == "paint" else d for d in p.degradations)
    stop = ForcedDown(station="paint", start=at, minutes=20, planned=True, reason="Плановое обслуживание камеры")
    return p.with_(degradations=degs, forced_downs=p.forced_downs + (stop,))


def _paint_service(p: LineParams) -> LineParams:
    """Обслужить окрасочную камеру в 200-ю минуту: 20 мин плановой остановки, деградация сброшена."""
    degs = tuple(replace(d, reset_at=220) if d.station == "paint" else d for d in p.degradations)
    stop = ForcedDown(station="paint", start=200, minutes=20, planned=True, reason="Плановое обслуживание камеры")
    return p.with_(degradations=degs, forced_downs=p.forced_downs + (stop,))


def _speed(station: str, k: float):
    def f(p: LineParams) -> LineParams:
        st = dict(p.stations)
        st[station] = replace(st[station], cycle=st[station].cycle * k)
        return p.with_(stations=st)
    return f


def _fast_repair(p: LineParams) -> LineParams:
    """Дежурный наладчик на линии: ремонт в 2 раза быстрее на всех участках."""
    return p.with_(stations={s: replace(sp, mttr=sp.mttr * 0.5) for s, sp in p.stations.items()})


# Деньги — ДОПУЩЕНИЯ (A8): пользователь меняет их в калькуляторе. money.month — затраты в месяц, money.once — разовые вложения, ₸.
# Цены — ориентир по рознице Казахстана 2025–26 (Onix от 6,99 млн, Cobalt 7,29 млн, JAC J7 Plus 7,99 млн; берём среднюю комплектацию).
# Маржа завода 5% от розничной цены: из цены вычитаются НДС 12%, наценка дилера, машинокомплект и логистика.
MODEL_PRICES = {"chevrolet onix": 7_500_000, "chevrolet cobalt": 7_300_000, "jac j7": 8_500_000}
DEFAULT_PRICE = 7_500_000
MARGIN_PCT = 5.0
MONEY_DEFAULTS = {"margin_pct": MARGIN_PCT, "work_days_month": 22, "shifts_per_day": 2,
                  "note": "Цены — ориентир по рознице Казахстана, маржа 5% и затраты на действия — допущения, замените своими цифрами"}


def price_of(model: str) -> int:
    return MODEL_PRICES.get(model.strip().lower(), DEFAULT_PRICE)


def model_mix(facts) -> list[dict]:
    """Модели из плана (факт) + цена и маржа (допущение). Нет плана по моделям — одна «средняя машина»."""
    plans = [(m.model, m.monthly_plan) for m in facts.model_plan if m.monthly_plan > 0]
    if not plans:
        plans = [("Средний автомобиль", 1)]
    total = sum(n for _, n in plans)
    return [{"model": name, "plan_month": n, "share": n / total, "price": price_of(name),
             "margin": round(price_of(name) * MARGIN_PCT / 100)} for name, n in plans]


def avg_margin(facts) -> float:
    return sum(m["share"] * m["margin"] for m in model_mix(facts))

# Библиотека действий. Для каждой смены сервис сам считает все и показывает самые полезные.
INTERVENTIONS = {
    "paint_service": {"short": "Обслужить камеру окраски", "name": "Обслужить камеру окраски сейчас", "detail": "20 мин плановой остановки, затем брак и цикл окраски возвращаются к норме",
                      "do": "Остановить Камеру-02 на 20 мин: заменить фильтры, очистить форсунки", "cost": "20 мин простоя окраски, расходники",
                      "money": {"month": 300000, "once": 0},
                      "apply": _paint_service, "target": "paint"},
    "speed_assembly": {"short": "Разгрузить сборку", "name": "Разгрузить самый загруженный пост сборки", "detail": "перенести одну операцию на предсборку — такт сборки короче на 5%",
                       "do": "Перебалансировка: одну операцию (например, жгут проводки) делать на предсборке, а не на линии", "cost": "без вложений, 1–2 смены на перенастройку",
                       "money": {"month": 0, "once": 500000},
                      "apply": _speed("assembly", 0.95), "target": "assembly"},
    "speed_welding": {"short": "Ускорить роботов сварки", "name": "Оптимизировать программы роботов сварки", "detail": "убрать лишние перемещения роботов ABB — цикл сварки короче на 5%",
                      "do": "Офлайн-программирование траекторий ABB-01/ABB-04: короче холостые ходы", "cost": "работа инженера-робототехника, без простоя",
                      "money": {"month": 0, "once": 2000000},
                      "apply": _speed("welding", 0.95), "target": "welding"},
    "fast_repair": {"short": "Наладчик у линии", "name": "Дежурный наладчик на линии", "detail": "наладчик стоит у линии — ремонт после отказа в 2 раза быстрее",
                    "do": "Закрепить одного наладчика в смену прямо на линии (сейчас его вызывают из ремзоны)", "cost": "+1 наладчик в смену",
                    "money": {"month": 1000000, "once": 0},
                      "apply": _fast_repair, "target": None},
    "pbs_buffer": {"short": "Больше накопитель", "name": "+6 мест в накопителе перед сборкой", "detail": "буфер окраска → сборка 18 вместо 12 — сборка реже ждёт",
                   "do": "Добавить 6 мест в накопитель окрашенных кузовов (PBS)", "cost": "место в цехе и рольганги — капзатраты",
                   "money": {"month": 0, "once": 25000000},
                      "apply": lambda p: p.with_(buffer_cap={**p.buffer_cap, "b_paint_asm": p.buffer_cap["b_paint_asm"] + 6}), "target": "assembly"},
    "second_repair_post": {"short": "Второй пост ремонта", "name": "Второй пост точечного ремонта", "detail": "2 поста вместо 1 — кузова с дефектом окраски быстрее возвращаются в поток",
                           "do": "Оборудовать второй пост точечного ремонта ЛКП", "cost": "пост и маляр в смену",
                           "money": {"month": 900000, "once": 15000000},
                      "apply": lambda p: p.with_(repair_servers=2), "target": "paint"},
}

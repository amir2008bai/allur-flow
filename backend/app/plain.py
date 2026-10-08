"""Короткие формулировки простым языком для главного экрана.

Подробности (формулы, оговорки, источник) остаются в summary/metrics/caveat и показываются по кнопке «Подробнее».
"""
from __future__ import annotations

from .schemas import Facts, Finding


def _n(x: float, nd: int = 1) -> str:
    return f"{x:.{nd}f}".replace(".", ",").replace(",0", "") if nd else f"{x:.0f}"


def _metric(f: Finding, label_start: str):
    v = next((m.value for m in f.metrics if m.label.startswith(label_start)), None)
    return int(v) if isinstance(v, float) and v.is_integer() else v


def simplify(items: list[Finding], facts: Facts) -> list[Finding]:
    norm = facts.targets.defect_max_pct
    limit = facts.targets.critical_downtime_max_min_per_day
    for f in items:
        if f.id.startswith("quality.") and f.id != "quality.rty":
            pct = _metric(f, "Брак за период")
            name = {"welding": "Сварка", "paint": "Окраска", "assembly": "Сборка"}[f.area]
            f.key, f.key_note = f"{_n(pct)}%", f"норма {_n(norm, 0)}%"
            if f.severity == "critical":
                f.title, f.plain = f"{name}: брак выше нормы", "Оба дня выше нормы — это не случайность."
            elif f.severity == "warn" and (_metric(f, "Дней выше нормы") or 0) > 0:
                days = [r for r in facts.quality if r.area == f.area and r.produced and 100 * r.defects / r.produced > norm]
                f.title = f"{name}: брак выше нормы {', '.join(f'{r.date:%d.%m}' for r in days)}"
                f.plain = (", ".join(f"{r.date:%d.%m} — {_n(100 * r.defects / r.produced)}%" for r in days)
                           + f" при норме {_n(norm, 0)}%. В среднем за период — на грани, данных мало, чтобы сказать, что так всегда.")
            elif f.severity == "warn":
                f.title, f.plain = f"{name}: брак на грани", "Данных мало — нужно больше смен, чтобы сказать точно."
            else:
                f.title, f.plain = f"{name}: брак в норме", "Проблемы нет."
        elif f.id == "plan.gap":
            gap = _metric(f, "Разрыв") or 0
            f.title, f.key, f.key_note = "План не сходится с целью", f"−{gap}", "машин в плане"
            f.plain = f"По моделям запланировано {sum(m.monthly_plan for m in facts.model_plan)}, а цель — {facts.targets.monthly_output_min}."
        elif f.id == "oee.not_computable":
            f.title, f.key, f.key_note = "OEE не посчитать", "н/д", f"цель ≥ {_n(facts.targets.oee_min_pct, 0)}%"
            f.plain = "Нет идеального времени цикла. Нужно запросить у завода."
        elif f.id.startswith("downtime."):
            mins = _metric(f, "Простой")
            dt = next(d for d in facts.downtime if f.title.startswith(d.equipment))
            f.title = f"{dt.equipment}: {dt.reason[0].lower()}{dt.reason[1:]}"
            f.key, f.key_note = f"{mins} мин", f"из {limit} допустимых"
            f.plain = "Плановое обслуживание, не авария." if dt.planned else f"{dt.date:%d.%m}, участок «{ {'welding': 'Сварка', 'paint': 'Окраска', 'assembly': 'Сборка'}[dt.area] }»."
        elif f.id == "flow.balance":
            f.title, f.key, f.key_note = "Сборка получила лишние кузова", f"+{_metric(f, 'Разница')}", "кузовов"
            f.plain = "Больше, чем годных вышло из окраски. Значит, был запас в буфере."
        elif f.id == "quality.rty":
            vals = [m.value for m in f.metrics]
            f.title, f.key, f.key_note = "Кузова без единого дефекта", f"{_n(min(vals), 0)}–{_n(max(vals), 0)}%", "по дням"
            f.plain = "Столько кузовов прошли все участки без брака."
        elif f.id == "utilization.definition":
            f.title, f.plain = "«Загрузка» = часы работы ÷ 8", "Это не OEE и не выполнение плана."
        elif f.id == "period.row_is_shift":
            f.title, f.plain = "Одна строка таблицы = одна смена", f.summary
        elif f.id == "paint.filter_hypothesis":
            d = next(x for x in facts.downtime if x.area == "paint")
            f.title = f"«{d.reason}» и брак — пока совпадение"
            f.plain = f"{d.equipment}, {d.date:%d.%m}: совпадает по времени с браком окраски. Причина не доказана."
        elif f.id == "plan.attainment":
            vals = [m.value for m in f.metrics]
            worst = min(f.metrics, key=lambda m: m.value)
            f.title, f.key, f.key_note = "Выполнение плана по сменам", f"{_n(min(vals), 0)}–{_n(max(vals), 0)}%", "от плана"
            f.plain = f"Хуже всего — {worst.label}: {_n(worst.value)}%."
    mm = _downtime_mismatch(facts)
    if mm and mm.key.split(" ≠ ")[0] != mm.key.split(" ≠ ")[1]:  # показываем, только если журналы реально расходятся
        items.append(mm)
    return items


def _downtime_mismatch(facts: Facts) -> Finding | None:
    cand = [d for d in facts.downtime if not d.planned] or list(facts.downtime)
    if not cand:
        return None
    conv = max(cand, key=lambda d: d.minutes)
    line = next((l for l in facts.lines if l.date == conv.date and l.area == conv.area), None)
    if line is None:
        return None
    lost = round((facts.targets.shift_hours - line.runtime_h) * 60)
    return Finding(
        id="downtime.mismatch", severity="info",
        title="Журнал простоев не сходится",
        key=f"{conv.minutes} ≠ {lost}", key_note="мин",
        plain=f"{conv.equipment} стоял {conv.minutes} мин, а участок потерял {lost} мин времени работы. Учёт ведётся по-разному.",
        summary="Время простоя оборудования и недоработка линии от 8 ч не совпадают ни в одной из 4 записей. Простой актива и время работы линии — разные уровни учёта.",
        caveat="Нужны точное время начала/конца остановок и признак критичности оборудования.",
        provenance=[conv.provenance, line.provenance],
    )

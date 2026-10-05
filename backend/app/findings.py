"""Выводы по фактам DOCX. Каждое число помечено источником, каждый вывод — оговоркой.

Здесь нет симуляции и прогнозов: только то, что честно следует из выданных таблиц.
"""
from __future__ import annotations

from collections import defaultdict

from scipy.stats import beta

from .schemas import Facts, Finding, Metric

AREA_RU = {"welding": "Сварка", "paint": "Окраска", "assembly": "Сборка"}


def defect_posterior(defects: int, produced: int, limit: float) -> dict:
    """Jeffreys prior Beta(0.5, 0.5): апостериорная доля брака, 90%-интервал, P(доля > нормы)."""
    a, b = defects + 0.5, produced - defects + 0.5
    return {
        "mean": a / (a + b),
        "lo90": float(beta.ppf(0.05, a, b)),
        "hi90": float(beta.ppf(0.95, a, b)),
        "p_above": float(beta.sf(limit, a, b)),
    }


def _pct(x: float, nd: int = 1) -> float:
    return round(100 * x, nd)


def quality_findings(f: Facts) -> list[Finding]:
    limit = f.targets.defect_max_pct / 100
    by_area: dict[str, list] = defaultdict(list)
    for q in f.quality:
        by_area[q.area].append(q)

    out = []
    for area, rows in by_area.items():
        n = sum(r.produced for r in rows)
        d = sum(r.defects for r in rows)
        post = defect_posterior(d, n, limit)
        p = post["p_above"]
        if p >= 0.95:
            sev, verdict = "critical", "надёжно выше нормы"
        elif p >= 0.5:
            sev, verdict = "warn", "на грани нормы, данных мало"
        else:
            sev, verdict = "ok", "в пределах нормы"
        daily = ", ".join(f"{r.date:%d.%m}: {r.defect_pct_reported}%" for r in rows)
        out.append(Finding(
            id=f"quality.{area}", area=area, severity=sev,
            title=f"Брак — {AREA_RU[area]}: {verdict}",
            summary=(f"Дефектов: {d} из {n} за {len(rows)} дня ({daily}). "
                     f"Вероятность, что истинный брак выше {f.targets.defect_max_pct:g}% — {_pct(p, 0)}%."),
            metrics=[
                Metric(label="Брак за период", value=_pct(d / n, 2), unit="%", source="calc"),
                Metric(label="Оценка брака (90% интервал)",
                       value=f"{_pct(post['lo90'])}–{_pct(post['hi90'])}", unit="%", source="calc"),
                Metric(label=f"P(брак > {f.targets.defect_max_pct:g}%)", value=round(p, 2), source="calc"),
                Metric(label="Норма", value=f.targets.defect_max_pct, unit="%", source="fact"),
            ],
            caveat="Байесовская оценка (Jeffreys prior) по 2 дням. Число бракованных машин из этого не следует: без VIN дефекты участков нельзя суммировать.",
            provenance=[r.provenance for r in rows],
        ))
    return out


def plan_gap(f: Facts) -> Finding:
    total = sum(m.monthly_plan for m in f.model_plan)
    target = f.targets.monthly_output_min
    gap = target - total
    return Finding(
        id="plan.gap", severity="warn" if gap > 0 else "ok",
        title="План по моделям не сходится с целью выпуска",
        summary=(f"Сумма плана по моделям — {total} авто/мес "
                 f"({', '.join(f'{m.model} {m.monthly_plan}' for m in f.model_plan)}), цель — не менее {target}. "
                 f"Разрыв {gap} авто ({_pct(gap / target)}% цели)."),
        metrics=[Metric(label="План по моделям", value=total, unit="авто/мес", source="calc"),
                 Metric(label="Цель", value=target, unit="авто/мес", source="fact"),
                 Metric(label="Разрыв", value=gap, unit="авто", source="calc")],
        caveat="Это несогласованность плана, а не доказанный недовыпуск: список моделей может быть неполным.",
        provenance=[m.provenance for m in f.model_plan],
    )


def oee_status(f: Facts) -> Finding:
    shift_h = f.targets.shift_hours
    ratios = []
    for l in f.lines:
        plan_rate = l.plan / shift_h  # авто/ч при плане на 8 ч
        ratios.append(l.fact / (l.runtime_h * plan_rate))
    return Finding(
        id="oee.not_computable", severity="info",
        title="OEE по выданным данным не вычисляется",
        summary=(f"Цель OEE ≥ {f.targets.oee_min_pct:g}%, но в данных нет идеального времени цикла. "
                 f"Если взять плановый темп за идеальный, Performance получается "
                 f"{_pct(min(ratios))}–{_pct(max(ratios))}% (больше 100%) во всех строках — значит, плановый темп не идеальный цикл."),
        metrics=[Metric(label="Performance при плановом темпе (мин)", value=_pct(min(ratios)), unit="%", source="calc"),
                 Metric(label="Performance при плановом темпе (макс)", value=_pct(max(ratios)), unit="%", source="calc"),
                 Metric(label="Цель OEE", value=f.targets.oee_min_pct, unit="%", source="fact")],
        caveat="Для OEE нужны: идеальное время цикла по участкам, плановое время смены, годный выпуск за тот же период. В симуляции OEE будет показан с меткой допущения.",
        provenance=[l.provenance for l in f.lines],
    )


def utilization_check(f: Facts) -> Finding:
    rows, mismatches = [], []
    for l in f.lines:
        calc = l.runtime_h / f.targets.shift_hours * 100
        rows.append(calc)
        if abs(round(calc) - l.utilization_pct) >= 1:
            mismatches.append(f"{l.line} {l.date:%d.%m}: {calc:.1f}% против {l.utilization_pct:g}% в таблице")
    return Finding(
        id="utilization.definition", severity="info",
        title="«Загрузка» = время работы / 8 ч",
        summary=("Загрузка в таблице совпадает с долей времени работы от 8-часовой смены — это не OEE и не план/факт. "
                 + (("Расхождение округления: " + "; ".join(mismatches) + ".") if mismatches else "")),
        metrics=[Metric(label="Строк проверено", value=len(rows), source="calc"),
                 Metric(label="Расхождений", value=len(mismatches), source="calc")],
        caveat="Вывод о базе 8 ч сделан по совпадению чисел; подтвердить у организаторов.",
        provenance=[l.provenance for l in f.lines],
    )


def downtime_findings(f: Facts) -> list[Finding]:
    limit = f.targets.critical_downtime_max_min_per_day
    line_by = {(l.date, l.area): l for l in f.lines}
    out = []
    for dt in f.downtime:
        line = line_by.get((dt.date, dt.area))
        deficit = round((f.targets.shift_hours - line.runtime_h) * 60) if line else None
        share = dt.minutes / limit
        sev = "info" if dt.planned else ("critical" if dt.minutes > limit else "warn" if share >= 0.75 else "ok")
        summary = (f"{dt.date:%d.%m} · {AREA_RU[dt.area]} · {dt.equipment} — «{dt.reason}», {dt.minutes} мин "
                   f"({_pct(share, 0)}% суточного лимита {limit} мин)."
                   + (" Плановое ТО — не входит во внеплановые простои." if dt.planned else ""))
        if deficit is not None:
            summary += f" Линия в тот день недоработала {deficit} мин от 8 ч — журналы не сходятся."
        out.append(Finding(
            id=f"downtime.{dt.asset_id}.{dt.date:%m%d}", area=dt.area, severity=sev,
            title=f"{dt.equipment}: {dt.reason}",
            summary=summary,
            metrics=[Metric(label="Простой", value=dt.minutes, unit="мин", source="fact"),
                     Metric(label="Лимит критического оборудования", value=limit, unit="мин/сутки", source="fact"),
                     *([Metric(label="Недоработка линии", value=deficit, unit="мин", source="calc")] if deficit is not None else [])],
            caveat="Критичность оборудования и время события в данных не указаны; простой актива и время работы линии — разные уровни учёта.",
            provenance=[dt.provenance] + ([line.provenance] if line else []),
        ))
    return out


def flow_balance(f: Facts) -> Finding:
    good = defaultdict(int)
    for q in f.quality:
        good[q.area] += q.produced - q.defects
    produced = defaultdict(int)
    for q in f.quality:
        produced[q.area] += q.produced
    excess = produced["assembly"] - good["paint"]
    return Finding(
        id="flow.balance", severity="info",
        title="Сборка получила больше кузовов, чем годных вышло из окраски",
        summary=(f"За 2 дня: сварка {produced['welding']} (годных {good['welding']}) → окраска {produced['paint']} "
                 f"(годных {good['paint']}) → сборка {produced['assembly']}. Сборка обработала на {excess} больше годного выпуска окраски."),
        metrics=[Metric(label="Разница", value=excess, unit="кузовов", source="calc")],
        caveat="Вероятно, есть запас кузовов в буфере или переделанные кузова вернулись в поток. В симуляции стартовый буфер — допущение.",
        provenance=[q.provenance for q in f.quality],
    )


def rty(f: Facts) -> Finding:
    by_date = defaultdict(lambda: 1.0)
    for q in f.quality:
        by_date[q.date] *= 1 - q.defects / q.produced
    parts = ", ".join(f"{d:%d.%m}: {_pct(v)}%" for d, v in sorted(by_date.items()))
    return Finding(
        id="quality.rty", severity="info",
        title="Сквозной выход годных (RTY)",
        summary=f"Доля кузовов, прошедших сварку, окраску и сборку без дефекта: {parts}.",
        metrics=[Metric(label=f"RTY {d:%d.%m}", value=_pct(v), unit="%", source="calc") for d, v in sorted(by_date.items())],
        caveat="Расчёт при допущении независимости дефектов на участках.",
        provenance=[q.provenance for q in f.quality],
    )


def period_assumption(f: Facts) -> Finding:
    per_line = f.lines[0].plan
    total_plan = sum(m.monthly_plan for m in f.model_plan)
    days = total_plan / (per_line * f.targets.shifts_per_day)
    return Finding(
        id="period.row_is_shift", severity="info",
        title="Строка таблицы — скорее смена, чем сутки",
        summary=(f"План {per_line} за строку × {f.targets.shifts_per_day} смены × {days:g} рабочих дней = {total_plan} — ровно сумма плана по моделям."),
        metrics=[Metric(label="Рабочих дней при этой трактовке", value=round(days, 1), source="assumption")],
        caveat="Shift_id в данных нет. Трактовку стоит подтвердить у организаторов.",
    )


def filter_hypothesis(f: Facts) -> Finding:
    return Finding(
        id="paint.filter_hypothesis", area="paint", severity="info",
        title="Замена фильтра и брак окраски — гипотеза, не причина",
        summary="Фильтр Камеры-02 меняли 01.10, брак окраски выше нормы и 01.10, и 02.10. Это совпадение по времени, которое стоит проверить, а не доказанная связь.",
        caveat="Для проверки нужны: классы дефектов, время замены, брак до замены фильтра.",
        provenance=[d.provenance for d in f.downtime if d.area == "paint"],
    )


def plan_attainment(f: Facts) -> Finding:
    metrics = [Metric(label=f"{l.line} {l.date:%d.%m}", value=_pct(l.fact / l.plan), unit="%", source="calc") for l in f.lines]
    return Finding(
        id="plan.attainment", severity="info",
        title="План/факт по линиям",
        summary="Выполнение плана по каждой строке. Выпуск участков не суммируется в «машины»: один кузов проходит все участки.",
        metrics=metrics,
        provenance=[l.provenance for l in f.lines],
    )


SEV_ORDER = {"critical": 0, "warn": 1, "info": 2, "ok": 3}


def all_findings(f: Facts) -> list[Finding]:
    items = [*quality_findings(f), plan_gap(f), oee_status(f), *downtime_findings(f), flow_balance(f),
             rty(f), utilization_check(f), period_assumption(f), filter_hypothesis(f), plan_attainment(f)]
    return sorted(items, key=lambda x: SEV_ORDER[x.severity])

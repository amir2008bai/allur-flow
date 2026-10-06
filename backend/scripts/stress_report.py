"""Отчёт испытаний: python scripts/stress_report.py → ../reports/stress_test.md"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.stress import SEEDS, run_data_faults, run_process_faults  # noqa: E402

out = Path(__file__).resolve().parents[2] / "reports" / "stress_test.md"
out.parent.mkdir(exist_ok=True)
P, D = run_process_faults(), run_data_faults()
lines = [f"# Испытания двойника на типичных сбоях завода ({date.today():%d.%m.%Y})", "",
         f"Всё на симуляции: реальных сбоев Allur у нас нет. Каждый сбой — {len(SEEDS)} разных прогонов, сравнение с той же сменой без сбоя.", "",
         "## Сбои производства", "", "| Сбой | Прошёл | Через сколько тревога | Что увидела система (пример) |", "|---|---|---|---|"]
for r in P:
    d = f"{r['median_delay_min']:.0f} мин" if r["median_delay_min"] is not None else "—"
    lines.append(f"| {r['name']} | {r['passed']}/{r['total']} | {d} | {r['example']} |")
lines += ["", "## Сбои данных (датчики и связь)", "", "| Сбой | Замечен | Очищен | Что нашла проверка |", "|---|---|---|---|"]
for r in D:
    lines.append(f"| {r['name']} | {'да' if r['detected'] else 'нет'} | {'да' if r['clean_ok'] else 'нет'} | {', '.join(r['found'])} |")
lines += ["", f"Ложных тревог проверки данных на чистом потоке: {'нет' if not D[0]['false_alarm_on_clean_data'] else D[0]['false_alarm_on_clean_data']}."]
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(out)

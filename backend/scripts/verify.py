"""Одна команда проверки: тесты → метрики против базовых подходов → результаты JSON/CSV.

Запуск из папки allur-flow:  verify.bat   (или  backend/.venv/Scripts/python backend/scripts/verify.py)
Всё считается на временной базе — рабочие данные не меняются. Итог: results/RESULTS.md и results/metrics.json.
Каждая метрика — с базовым подходом, на чём проверено (holdout / отложенные потоки / реальные данные) и меткой источника.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
TMP = tempfile.mkdtemp(prefix="allur_verify_")
os.environ.update({"ALLUR_DB": os.path.join(TMP, "verify.sqlite"), "ALLUR_STATE_DIR": TMP, "ALLUR_WARMUP": "0", "PYTHONIOENCODING": "utf-8"})
sys.path.insert(0, str(BACKEND))
for _s in (sys.stdout, sys.stderr):      # консоль Windows: вывод по-русски без ошибок кодировки
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)


def step(name: str) -> float:
    print(f"\n== {name}", flush=True)
    return time.time()


def main() -> int:
    t = step("1/3 тесты (pytest)")
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "--basetemp", os.path.join(TMP, "pt"), "-p", "no:cacheprovider"],
                       cwd=BACKEND, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (r.stdout or "").strip().splitlines()[-1:] or ["нет вывода"]
    tests_ok = r.returncode == 0
    print(tail[0], f"({time.time() - t:.0f} с)")

    t = step("2/3 метрики против базовых подходов")
    from app.learn import global_model
    from app.learn.api import forecast_payload
    from app.stress import DATA_FAULTS
    from app.stress_api import data_fault
    from app.twin_calib import synthetic_check
    reg = global_model.registry()
    cur = next(v for v in reg["versions"] if v["version"] == reg["current"])
    ms = forecast_payload()["multi_seed"]
    # реальная фабрика (UCI 597): пересчитываем из сырых данных при каждой проверке
    vdir = ROOT / "validation" / "real-factory"
    subprocess.run([sys.executable, str(vdir / "validate_garment.py")], cwd=vdir, capture_output=True, text=True, encoding="utf-8", errors="replace")
    rf = json.loads((vdir / "results.json").read_text(encoding="utf-8"))
    real = json.loads((ROOT / "data" / "validation_real.json").read_text(encoding="utf-8"))
    faults = [data_fault(k) for k, _, _ in DATA_FAULTS]
    from app.trust import factory_check
    fc = factory_check("2999-01-01")
    fit = synthetic_check()
    rows = [
        {"metric": "Ошибка прогноза выпуска на 2 ч, машин (MAE)", "ours": round(cur["holdout_mae"], 2), "baseline": round(cur["holdout_mae_naive"], 2),
         "baseline_name": "как за прошлые 2 ч", "better": "меньше", "data": "10 отложенных потоков эмулятора (не в обучении)", "source": "forecast"},
        {"metric": "Покрытие коридора 90% (доля фактов внутри)", "ours": round(ms["interval"]["coverage"], 3), "baseline": 0.90,
         "baseline_name": "обещанное покрытие", "better": "≈ цели", "data": "10 потоков, прогноз до факта", "source": "forecast"},
        {"metric": "Риск провала выпуска: AUC", "ours": round(ms["dip"]["auc"], 3), "baseline": 0.5,
         "baseline_name": "угадывание", "better": "больше", "data": "10 потоков; порог по цене ошибок", "source": "forecast"},
        {"metric": "Риск провала: поймано провалов (recall)", "ours": round(ms["dip"]["recall"], 3), "baseline": round(ms["dip"]["warn_rate"], 3),
         "baseline_name": "случайная тревога с той же частотой", "better": "больше", "data": f"порог {ms['dip'].get('threshold')}; тревог {ms['dip']['warn_rate']:.0%} окон", "source": "forecast"},
        {"metric": "Риск провала: тревога верна (precision)", "ours": round(ms["dip"]["precision"], 3), "baseline": round(ms["dip"]["base_rate"], 3),
         "baseline_name": "случайная тревога (= доля провалов)", "better": "больше", "data": "10 потоков эмулятора", "source": "forecast"},
        {"metric": "РЕАЛЬНАЯ фабрика: ошибка прогноза выработки, п.п. (MAE)", "ours": round(100 * rf["mae"]["lgbm"], 2), "baseline": round(100 * rf["mae"]["plan"], 2),
         "baseline_name": "план бригады", "better": "меньше",
         "data": f"UCI 597, {rf['test_rows']} прогнозов за {rf['test_days']} дн. проверки; 95% ДИ разницы {100 * rf['paired_bootstrap_95']['lgbm_vs_plan'][1]:.2f}…{100 * rf['paired_bootstrap_95']['lgbm_vs_plan'][2]:.2f} п.п.", "source": "fact"},
        {"metric": "РЕАЛЬНАЯ фабрика: ошибка против «как вчера», п.п.", "ours": round(100 * rf["mae"]["lgbm"], 2), "baseline": round(100 * rf["mae"]["naive"], 2),
         "baseline_name": "как вчера", "better": "меньше",
         "data": f"95% ДИ разницы {100 * rf['paired_bootstrap_95']['lgbm_vs_naive'][1]:.2f}…{100 * rf['paired_bootstrap_95']['lgbm_vs_naive'][2]:.2f} п.п.", "source": "fact"},
        {"metric": "РЕАЛЬНАЯ фабрика: покрытие коридора 90%", "ours": round(rf["interval"]["coverage"], 3), "baseline": rf["interval"]["target"],
         "baseline_name": "обещанное покрытие", "better": "≈ цели", "data": f"{rf['interval']['n']} проверок", "source": "fact"},
        {"metric": "РЕАЛЬНАЯ фабрика: провалы выработки (AUC)", "ours": round(rf["dip"]["auc_model"], 3), "baseline": round(rf["dip"]["auc_yesterday_dip"], 3),
         "baseline_name": "«вчера был провал»", "better": "больше", "data": f"доля провалов {rf['dip']['base_rate']:.0%}", "source": "fact"},
        {"metric": "Сбои данных пойманы", "ours": sum(f["detected"] for f in faults), "baseline": len(faults),
         "baseline_name": "всего сбоев", "better": "= всего", "data": "6 типов искажений потока", "source": "calc"},
        {"metric": "Ложные тревоги проверки данных на чистом потоке", "ours": len(faults[0]["false_alarm_on_clean_data"]), "baseline": 0,
         "baseline_name": "ноль", "better": "= 0", "data": "чистый поток эмулятора", "source": "calc"},
        {"metric": "Прогноз смены против данных Allur: в коридоре", "ours": f"{fc['hits']} из {fc['shifts']}", "baseline": "—",
         "baseline_name": "данных мало — вывод предварительный", "better": "больше", "data": f"факты заказчика из ТЗ, {fc['days']} дн.", "source": "fact"},
        {"metric": "Подгонка двойника: восстановленное время ремонта, мин", "ours": round(fit["recovered_mttr"], 1), "baseline": fit["hidden_mttr"],
         "baseline_name": "скрытое истинное значение", "better": "≈ истинному", "data": "синтетический «завод» со скрытыми параметрами", "source": "sim"},
    ]
    for x in rows:
        print(f"- {x['metric']}: {x['ours']} (база: {x['baseline']} — {x['baseline_name']})")
    print(f"({time.time() - t:.0f} с)")

    t = step("3/3 выгрузка результатов (JSON/CSV)")
    r2 = subprocess.run([sys.executable, str(BACKEND / "scripts" / "export_results.py")], cwd=BACKEND, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print((r2.stdout or r2.stderr).strip().splitlines()[-1] if (r2.stdout or r2.stderr) else "", f"({time.time() - t:.0f} с)")

    (OUT / "metrics.json").write_text(json.dumps({"tests": tail[0], "tests_ok": tests_ok, "metrics": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# Результаты проверки (пересобраны `verify.bat`)", "", f"Тесты: **{tail[0]}**", "",
          "| Метрика | Allur Flow | База | Что за база | Лучше | На чём проверено | Источник |", "|---|---|---|---|---|---|---|"]
    md += [f"| {x['metric']} | **{x['ours']}** | {x['baseline']} | {x['baseline_name']} | {x['better']} | {x['data']} | {x['source']} |" for x in rows]
    md += ["", "Источники: fact — реальные данные, forecast — прогноз до факта на отложенных данных, sim — симуляция, calc — расчёт.",
           "Ограничения: данных заказчика 2 дня; модели прогноза учатся на эмуляторе завода; на реальной фабрике проверены на открытом наборе UCI 597."]
    (OUT / "RESULTS.md").write_text("\n".join(md), encoding="utf-8")
    # та же таблица — в README между маркерами, чтобы цифры не расходились
    readme = ROOT / "README.md"
    txt = readme.read_text(encoding="utf-8")
    b, e = "<!-- RESULTS:BEGIN -->", "<!-- RESULTS:END -->"
    if b in txt and e in txt:
        table = ["| Метрика | Allur Flow | База | На чём проверено |", "|---|---|---|---|"]
        table += [f"| {x['metric']} | **{x['ours']}** | {x['baseline']} ({x['baseline_name']}) | {x['data']} |" for x in rows]
        table += ["", f"Тесты: **{tail[0]}**. Пересобрано командой `python verify.py`."]
        readme.write_text(txt[: txt.index(b) + len(b)] + "\n" + "\n".join(table) + "\n" + txt[txt.index(e):], encoding="utf-8")
    ok = tests_ok and r2.returncode == 0
    print("\nИТОГ:", "OK" if ok else "ЕСТЬ ОШИБКИ", "→ results/RESULTS.md")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

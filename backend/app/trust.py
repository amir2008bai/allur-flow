"""Панель доверия: почему прогнозам двойника можно верить — все проверки в одном месте.

Каждая строка — проверка, которую можно повторить: журнал «утренний прогноз против факта», коридор прогноза,
отложенные потоки для LightGBM, реальные данные фабрики, восстановление скрытых параметров, журнал обучения.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api")
VALIDATION = Path(__file__).resolve().parents[2] / "data" / "validation_real.json"


def factory_check(today: str) -> dict:
    """Сверка утреннего прогноза с ФАКТОМ завода: все прошедшие дни, по которым есть данные."""
    from .dataset import active_facts
    from .journal import record
    f = active_facts()
    days = sorted({r.date for r in f.lines} | {r.date for r in f.downtime} | {r.date for r in f.quality})
    shifts = [s for d in days if d.isoformat() < today for s in record(d)["shifts"] if s.get("source") == "fact"]
    return {"hits": sum(s["in_corridor"] for s in shifts), "shifts": len(shifts), "days": len(days), "source": "fact",
            "text": "утренний прогноз смены против выпуска из данных завода"}


@router.get("/trust")
def trust() -> dict:
    from .journal import month
    from .learn import global_model
    from .learn.api import forecast_payload, learning_stats
    from .sim.params import ASSUMPTIONS
    from .twin_calib import synthetic_check
    today = date.today().isoformat()
    m = month(today[:7], today)
    ms = forecast_payload()["multi_seed"]
    reg = global_model.registry()
    cur = next((v for v in reg["versions"] if v["version"] == reg["current"]), None)
    real = json.loads(VALIDATION.read_text(encoding="utf-8")) if VALIDATION.exists() else None
    return {
        "factory": factory_check(today),
        # самопроверка: журнал месяца построен тем же двойником — это проверка расчёта, а не точности
        "journal": {"hits": m["corridor_hits"], "shifts": m["shifts_total"], "month": m["month"], "source": "sim",
                    "text": "самопроверка двойника: утренний прогноз против симулированной смены"},
        "interval": {"coverage": ms["interval"]["coverage"], "target": ms["interval"]["target"], "source": "forecast",
                     "text": "коридор прогноза на 2 часа: доля фактов внутри (10 прогонов)"},
        "model": ({"version": cur["version"], "mae": cur["holdout_mae"], "mae_naive": cur["holdout_mae_naive"], "source": "forecast",
                   "text": "LightGBM на потоках, которых модель не видела, против простого прогноза"} if cur else None),
        "real_data": real,
        "twin_fit": {**synthetic_check(), "source": "sim", "text": "подгонка двойника восстановила скрытые параметры «завода»"},
        "learning": {**learning_stats(), "source": "feedback", "text": "ответы людей и камеры сохранены в журнале обучения"},
        "honesty": {"assumptions": len(ASSUMPTIONS), "text": "у каждого числа метка источника; ИИ не может выдать число, которого нет в расчёте"},
    }

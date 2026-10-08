"""Активный набор данных и автокалибровка двойника под него.

По умолчанию — тестовые данные ТЗ. Пользователь загружает реальный файл → предпросмотр → «Применить»:
файл сохраняется в data/uploads, становится активным, двойник перекалибровывается (брак и темп участков),
все кэши сбрасываются. Вернуться к тестовым данным — одна кнопка.
"""
from __future__ import annotations

import json
import time
from dataclasses import replace
from pathlib import Path

import numpy as np

from .ingest import load_any
from .schemas import Facts

ROOT = Path(__file__).resolve().parents[2] / "data"
TEST_FILE = ROOT / "raw" / "test_data.docx"
# ALLUR_STATE_DIR — куда класть загрузки и выбор активного набора (тесты — во временную папку)
_STATE_DIR = Path(__import__("os").environ.get("ALLUR_STATE_DIR") or ROOT)
UPLOADS = _STATE_DIR / "uploads"
STATE = _STATE_DIR / "active_dataset.json"

_cache: dict = {}


def _state() -> dict:
    if STATE.exists():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"path": str(TEST_FILE), "is_test": True, "activated_at": None}


def active_facts() -> Facts:
    st = _state()
    if _cache.get("path") != st["path"]:
        p = Path(st["path"])
        if not p.exists():
            p, st = TEST_FILE, {"path": str(TEST_FILE), "is_test": True}
        facts, warnings = load_any(p.name, p.read_bytes())
        _cache.update(path=st["path"], facts=facts, warnings=warnings)
    return _cache["facts"]


def status() -> dict:
    f, st = active_facts(), _state()
    dates = sorted({x.date for x in f.lines} | {x.date for x in f.quality})
    return {"file": Path(st["path"]).name, "is_test": st.get("is_test", False), "activated_at": st.get("activated_at"),
            "rows": {"lines": len(f.lines), "downtime": len(f.downtime), "model_plan": len(f.model_plan), "quality": len(f.quality)},
            "date_from": str(dates[0]) if dates else None, "date_to": str(dates[-1]) if dates else None,
            "warnings": _cache.get("warnings", []), "calibration": _cache.get("calibration")}


def preview(name: str, data: bytes) -> dict:
    facts, warnings = load_any(name, data)
    from .findings import all_findings
    dates = sorted({x.date for x in facts.lines} | {x.date for x in facts.quality})
    top = [{"title": x.title, "key": x.key, "severity": x.severity} for x in all_findings(facts) if x.severity in ("critical", "warn")][:5]
    return {"file": name, "rows": {"lines": len(facts.lines), "downtime": len(facts.downtime), "model_plan": len(facts.model_plan), "quality": len(facts.quality)},
            "date_from": str(dates[0]) if dates else None, "date_to": str(dates[-1]) if dates else None,
            "areas": sorted({x.area for x in facts.lines}), "warnings": warnings, "top_findings": top}


def activate(name: str, data: bytes) -> dict:
    load_any(name, data)  # проверка до сохранения
    UPLOADS.mkdir(parents=True, exist_ok=True)
    path = UPLOADS / f"{int(time.time())}_{Path(name).name}"
    path.write_bytes(data)
    STATE.write_text(json.dumps({"path": str(path), "is_test": False, "activated_at": time.time()}, ensure_ascii=False), encoding="utf-8")
    return _reload()


def reset_to_test() -> dict:
    if STATE.exists():
        STATE.unlink()
    return _reload()


# ── автокалибровка ──────────────────────────────────────────────────────────
_ORIG: dict = {}


def calibrate(facts: Facts) -> dict:
    """Подогнать двойник под данные: брак участков = брак из данных, темп = средний факт за строку (смену)."""
    from .sim.engine import simulate
    from .sim.params import BASE
    st = BASE.stations
    if not _ORIG:
        _ORIG.update({k: v for k, v in st.items()})
    for k, v in _ORIG.items():
        st[k] = v
    # брак по участкам
    defect = {}
    for a in ("welding", "paint", "assembly"):
        q = [x for x in facts.quality if x.area == a]
        if q:
            defect[a] = sum(x.defects for x in q) / max(1, sum(x.produced for x in q))
            st[a] = replace(st[a], defect_p=defect[a])
    # надёжность участков (MTBF/MTTR) — по журналу внеплановых простоев
    from .twin_calib import fit
    reliability = fit(facts, BASE, apply=True)
    # темп: средний факт строки на выходе (сборка, иначе любая линия), приведённый к 8 ч
    rows = [x for x in facts.lines if x.area == "assembly"] or facts.lines
    target = float(np.mean([x.fact * 8 / max(1e-6, x.runtime_h) * x.runtime_h / 8 for x in rows]))
    k = 1.0
    for _ in range(3):  # пропорциональная подгонка масштаба циклов
        for a in ("welding", "paint", "assembly"):
            st[a] = replace(st[a], cycle=_ORIG[a].cycle * k)
        good = float(np.mean([simulate(BASE, 300 + s).good_out / 2 for s in range(8)]))
        k *= good / max(1e-6, target)
    for a in ("welding", "paint", "assembly"):
        st[a] = replace(st[a], cycle=_ORIG[a].cycle * k)
    good = float(np.mean([simulate(BASE, 300 + s).good_out / 2 for s in range(8)]))
    return {"target_per_shift": round(target, 1), "model_per_shift": round(good, 1), "cycle_scale": round(k, 3),
            "defect_pct": {a: round(100 * v, 2) for a, v in defect.items()}, "reliability": reliability}


def _reload() -> dict:
    _cache.clear()
    facts = active_facts()
    _cache["calibration"] = calibrate(facts) if not _state().get("is_test", True) else None
    if _state().get("is_test", True) and _ORIG:
        from .sim.params import BASE
        for k, v in _ORIG.items():
            BASE.stations[k] = v
    _clear_caches()
    return status()


def _clear_caches() -> None:
    from . import main
    from .learn import api as learn_api, stream
    from .sim import api as sim_api
    from . import stress_api
    from . import journal, spc
    journal.clear_forecast_cache()
    spc.clear_cache()
    main.facts.cache_clear()
    sim_api.run_payload.cache_clear(); sim_api._whatif.cache_clear(); sim_api.futures_payload.cache_clear(); sim_api._eta_runs.cache_clear()
    learn_api.forecast_payload.cache_clear(); stream.emulate.cache_clear(); stress_api._run.cache_clear()
    from . import effect as effect_mod
    effect_mod._effect.cache_clear()
    learn_api._alerts = None; learn_api._calib = None

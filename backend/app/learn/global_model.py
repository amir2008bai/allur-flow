"""Глобальная модель прогноза (LightGBM), обучаемая на БОЛЬШОМ наборе смоделированных смен.

Зачем: онлайн-модель River учится только на свежем потоке (десятки фактов). Глобальная модель заранее видела
сотни разных дней завода — разные поломки, деградации, нехватки, — и узнаёт знакомые ситуации сразу.

Как устроено автодообучение (champion/challenger для версий):
  1) генерируем N дней эмулятора со СЛУЧАЙНЫМИ скрытыми условиями (domain randomization);
  2) обучаем LightGBM предсказывать поправку к простому прогнозу: y − «выпуск за прошлые 2 часа»;
  3) проверяем на ОТЛОЖЕННЫХ 10 потоках (seeds 11–20, те же, что у остальных моделей; в обучение не входят);
  4) новая версия становится основной, только если точнее текущей на отложенных потоках хотя бы на 3%.
На заводе шаг 1 дополняется реальной историей MES — механизм тот же.
"""
from __future__ import annotations

import json
import random
import threading
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..sim.engine import simulate
from ..sim.params import BASE, STATIONS, Degradation, ForcedDown
from .stream import FEATURES, HORIZON, emulate, interval_snapshots

DIR = Path(__file__).resolve().parents[3] / "data" / "models"
REGISTRY = DIR / "registry.json"
HOLDOUT = list(range(11, 21))
TRAIN_SEED0 = 5000          # обучающие потоки не пересекаются с отложенными
DAY = 960.0
PROMOTE_MARGIN = 0.03
PARAMS = {"objective": "l1", "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 40,
          "feature_fraction": 0.9, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0, "verbose": -1, "seed": 7}
ROUNDS = 400

_lock = threading.Lock()
_status = {"running": False, "progress": 0.0, "stage": "", "last_error": None}


def random_day(seed: int, days: int = 3):
    """Скрытые условия потока: случайные деградации, аварии, нехватки, надёжность станций."""
    rnd = random.Random(seed)
    horizon = days * DAY
    stations = dict(BASE.stations)
    for s in ("welding", "paint", "assembly"):
        sp = stations[s]
        stations[s] = sp.__class__(**{**sp.__dict__, "mtbf_work": sp.mtbf_work * rnd.uniform(0.5, 1.6), "mttr": sp.mttr * rnd.uniform(0.6, 1.5),
                                      "defect_p": sp.defect_p * rnd.uniform(0.6, 1.8)})
    degs, downs, shorts = [], [], []
    for _ in range(rnd.randint(0, 2)):
        st = rnd.choice(["paint", "paint", "welding", "assembly"])
        a = rnd.uniform(60, horizon - 300)
        degs.append(Degradation(st, a, a + rnd.uniform(120, 420), cycle_x=rnd.uniform(1.05, 1.3), defect_x=rnd.uniform(1.0, 3.0),
                                reset_at=(a + rnd.uniform(300, 900)) if rnd.random() < 0.5 else None))
    for _ in range(rnd.randint(0, 2)):
        downs.append(ForcedDown(rnd.choice(STATIONS[:3]), rnd.uniform(60, horizon - 120), rnd.uniform(15, 70), reason="случайная авария"))
    if rnd.random() < 0.3:
        shorts.append((rnd.uniform(60, horizon - 120), rnd.uniform(15, 50)))
    return BASE.with_(horizon=horizon, stations=stations, degradations=tuple(degs), forced_downs=tuple(downs), shortages=tuple(shorts))


def xy(snaps) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    X = np.array([[s.x[f] for f in FEATURES] for s in snaps], dtype=float)
    last_h = np.array([s.x["last_h"] for s in snaps], dtype=float)
    y = np.array([s.y for s in snaps], dtype=float)
    return X, y - last_h, last_h


def build_dataset(n_runs: int, seed0: int = TRAIN_SEED0, progress=None):
    Xs, ys = [], []
    for i in range(n_runs):
        run = simulate(random_day(seed0 + i), seed0 + i)
        X, r, _ = xy(interval_snapshots(run))
        Xs.append(X); ys.append(r)
        if progress:
            progress((i + 1) / n_runs)
    return np.vstack(Xs), np.concatenate(ys)


def holdout_mae(booster) -> dict:
    errs, naive = [], []
    for s in HOLDOUT:
        snaps = interval_snapshots(emulate(s))
        X, r, last_h = xy(snaps)
        pred = np.clip(last_h + booster.predict(X), 0, 60)
        y = r + last_h
        errs += list(np.abs(pred - y)); naive += list(np.abs(last_h - y))
    return {"mae": float(np.mean(errs)), "mae_naive": float(np.mean(naive))}


def registry() -> dict:
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text(encoding="utf-8"))
    return {"current": None, "versions": []}


def _save_registry(r: dict) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")


def train(n_runs: int = 200, progress=None) -> dict:
    """Обучить новую версию и решить, становится ли она основной."""
    import lightgbm as lgb
    t0 = time.time()
    ver = len(registry()["versions"]) + 1
    seed0 = TRAIN_SEED0 + 100_000 * ver      # каждая версия видит НОВЫЕ дни завода
    X, y = build_dataset(n_runs, seed0=seed0, progress=lambda p: progress and progress(0.85 * p, "генерирую смены"))
    if progress:
        progress(0.88, "обучаю LightGBM")
    booster = lgb.train(PARAMS, lgb.Dataset(X, y, feature_name=FEATURES), num_boost_round=ROUNDS)
    if progress:
        progress(0.95, "проверяю на отложенных потоках")
    score = holdout_mae(booster)
    reg = registry()
    path = DIR / f"lgbm_v{ver}.txt"
    DIR.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(path))
    cur = next((v for v in reg["versions"] if v["version"] == reg["current"]), None)
    promoted = cur is None or score["mae"] < (1 - PROMOTE_MARGIN) * cur["holdout_mae"]
    entry = {"version": ver, "file": path.name, "trained_at": time.time(), "runs": n_runs, "rows": int(len(y)),
             "days": round(n_runs * 3, 0), "seed0": seed0, "holdout_mae": score["mae"], "holdout_mae_naive": score["mae_naive"],
             "seconds": round(time.time() - t0, 1), "promoted": promoted,
             "verdict": ("стала основной" if cur is None else f"точнее v{cur['version']} → стала основной") if promoted
             else f"не точнее v{cur['version']} на 3% → осталась претендентом"}
    reg["versions"].append(entry)
    if promoted:
        reg["current"] = ver
    _save_registry(reg)
    current_booster.cache_clear()
    return entry


@lru_cache(maxsize=1)
def current_booster():
    reg = registry()
    if not reg["current"]:
        return None
    import lightgbm as lgb
    v = next(v for v in reg["versions"] if v["version"] == reg["current"])
    return lgb.Booster(model_file=str(DIR / v["file"]))


def predict(x: dict) -> float | None:
    b = current_booster()
    if b is None:
        return None
    return float(b.predict(np.array([[x[f] for f in FEATURES]], dtype=float))[0])


def status() -> dict:
    reg = registry()
    return {**_status, "current": reg["current"], "versions": reg["versions"][-8:]}


def train_async(n_runs: int, on_done=None) -> bool:
    """Дообучение в фоне: интерфейс показывает прогресс, сервис продолжает работать."""
    if not _lock.acquire(blocking=False):
        return False

    def job():
        try:
            _status.update(running=True, progress=0.0, stage="старт", last_error=None)
            entry = train(n_runs, progress=lambda p, st: _status.update(progress=p, stage=st))
            _status.update(stage=entry["verdict"])
            if on_done:
                on_done(entry)
        except Exception as e:  # noqa: BLE001 — ошибку показываем в интерфейсе
            _status["last_error"] = str(e)
        finally:
            _status.update(running=False, progress=1.0)
            _lock.release()

    threading.Thread(target=job, daemon=True).start()
    return True

"""Прогноз выпуска «до факта» и онлайн-обучение с отбором лучшей модели.

Протокол на каждом интервале:
  1) все модели выдают прогноз на следующий интервал по признакам, известным СЕЙЧАС (пишем в журнал);
  2) интервал проходит, приходит факт → считаем ошибку каждой модели;
  3) учатся только онлайн-модели (learn_one); «замороженная» копия не учится — это контроль;
  4) детектор дрейфа следит за ошибкой основной модели; при дрейфе запускается свежий претендент;
  5) каждые CHECK интервалов претендент сравнивается с основной на одинаковых последних интервалах.
"""
from __future__ import annotations

import copy
from collections import deque

import numpy as np
from river import drift, linear_model, preprocessing

from .stream import DRIFT_AT, HORIZON, INTERVAL, Snapshot, emulate, interval_snapshots

PLAN = 120 / 480 * HORIZON
DELAY = HORIZON // INTERVAL  # через сколько интервалов приходит факт
WARMUP = 16      # интервалов только обучения (первые 8 часов)
WINDOW = 16      # окно скользящей ошибки
CHECK = 4        # как часто сравнивать претендента
MARGIN = 0.05    # претендент должен быть лучше на 5%


def make_model(smoothing: float = 0.98):
    """Онлайн байесовская линейная регрессия с забыванием старых данных (устойчива, без расхождения).
    Учится ПОПРАВКЕ к наивному прогнозу: y − «выпуск за прошлые 2 часа»."""
    return preprocessing.StandardScaler() | linear_model.BayesianLinearRegression(alpha=1, beta=1, smoothing=smoothing)


def clip(v: float | None) -> float:
    return float(min(max(v or 0.0, 0.0), 2 * PLAN))


def run_learning(seed: int = 11) -> dict:
    snaps: list[Snapshot] = interval_snapshots(emulate(seed))
    champion, challenger = make_model(0.98), make_model(0.95)
    frozen = None
    version, champ_name = 1, "v1"
    detector = drift.PageHinkley(min_instances=8, delta=0.5, threshold=25.0, mode="up")
    errs = {k: deque(maxlen=WINDOW) for k in ("champion", "challenger", "frozen", "naive", "plan")}
    pair_c, pair_h = deque(maxlen=WINDOW), deque(maxlen=WINDOW)  # ошибки на одних и тех же интервалах
    timeline, events = [], []
    ledger = []
    pending: deque = deque()  # прогнозы, ждущие факта
    for i, s in enumerate(snaps):
        # 1) прогнозы ДО факта — пишутся в журнал сразу
        preds = {
            "champion": clip(s.x["last_h"] + (champion.predict_one(s.x) or 0.0)),
            "challenger": clip(s.x["last_h"] + (challenger.predict_one(s.x) or 0.0)),
            "frozen": clip(s.x["last_h"] + (frozen.predict_one(s.x) or 0.0)) if frozen else None,
            "naive": s.x["last_h"],
            "plan": PLAN,
        }
        ledger.append({"issued_at": s.t, "horizon_start": s.t, "horizon_end": s.t + HORIZON,
                       "y_hat": round(preds["champion"], 2), "model_version": champ_name})
        pending.append((i, s, preds))
        row = {"t": s.t, "target_t": s.t + HORIZON, **{k: (round(v, 2) if v is not None else None) for k, v in preds.items()}, "y": s.y}
        # 2) пришёл факт по прогнозу, выпущенному DELAY интервалов назад
        while pending and pending[0][1].t + HORIZON <= s.t:
            j, sj, pj = pending.popleft()
            y = sj.y
            if j >= WARMUP:
                for k, v in pj.items():
                    if v is not None:
                        errs[k].append(abs(v - y))
                pair_c.append(abs(pj["champion"] - y))
                pair_h.append(abs(pj["challenger"] - y))
                detector.update(abs(pj["champion"] - y))
                if detector.drift_detected:
                    events.append({"t": s.t, "type": "drift", "text": "Ошибка прогноза выросла — режим линии изменился"})
                    challenger = make_model(0.95)   # свежий претендент учится только на новом режиме
                    pair_c.clear(); pair_h.clear()
                    detector = drift.PageHinkley(min_instances=8, delta=0.5, threshold=25.0, mode="up")
                if len(pair_h) >= 8 and i % CHECK == 0 and np.mean(pair_h) < (1 - MARGIN) * np.mean(pair_c):
                    version += 1
                    old = champ_name
                    champion, challenger = challenger, champion
                    champ_name = f"v{version}"
                    events.append({"t": s.t, "type": "promotion",
                                   "text": f"Претендент точнее ({np.mean(pair_h):.1f} против {np.mean(pair_c):.1f} машин) → {champ_name} вместо {old}"})
                    pair_c, pair_h = pair_h, pair_c
            # 3) обучение только после факта
            champion.learn_one(sj.x, y - sj.x["last_h"])
            challenger.learn_one(sj.x, y - sj.x["last_h"])
            if j == WARMUP - 1 and frozen is None:
                frozen = copy.deepcopy(champion)
                events.append({"t": s.t, "type": "freeze", "text": "Сделана замороженная копия модели для сравнения"})
        row.update({f"mae_{k}": (round(float(np.mean(v)), 2) if len(v) else None) for k, v in errs.items()})
        row["version"] = champ_name
        timeline.append(row)

    def mae(key, after=None):
        vals = [abs(r[key] - r["y"]) for r in timeline[WARMUP:] if r[key] is not None and (after is None or r["t"] >= after)]
        return float(np.mean(vals)) if vals else None

    summary = {k: {"mae_all": mae(k), "mae_after_drift": mae(k, DRIFT_AT)} for k in ("champion", "frozen", "naive", "plan")}
    best_base = min(summary["naive"]["mae_after_drift"], summary["plan"]["mae_after_drift"])
    summary["skill_vs_baseline"] = 1 - summary["champion"]["mae_after_drift"] / best_base
    return {"source": "forecast", "interval_min": INTERVAL, "horizon_min": HORIZON, "plan": PLAN, "drift_at": DRIFT_AT, "warmup": WARMUP,
            "timeline": timeline, "events": events, "summary": summary, "version": champ_name,
            "ledger_size": len(ledger), "note": "Поток из эмулятора завода (симуляция). Деградация окраски скрыта от моделей."}

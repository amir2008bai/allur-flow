"""Прогноз выпуска «до факта» и онлайн-обучение с отбором лучшей модели.

Протокол на каждом интервале:
  1) все модели выдают прогноз на следующий интервал по признакам, известным СЕЙЧАС (пишем в журнал);
  2) интервал проходит, приходит факт → считаем ошибку каждой модели;
  3) учатся только онлайн-модели (learn_one); «замороженная» копия не учится — это контроль;
  4) детектор дрейфа следит за ошибкой основной модели; при дрейфе запускается свежий претендент;
  5) каждые CHECK интервалов претендент сравнивается с основной на одинаковых последних интервалах;
  6) ЗАЩИТА: пользователю показывается прогноз модели, только если на последних фактах она точнее
     простого прогноза «как в прошлые 2 ч». Пока модель учится или после смены режима — показываем простой.

Почему так (см. scripts/diag_learning.py, diag_variants.py):
  - старый SGD «взрывался»: на старте разброс признака почти нулевой → после нормировки z до −34 →
    огромный градиент → прогнозы до 468 машин вместо ~30. Починка: обрезка z до ±3, clip_gradient, малый шаг;
  - на 4–28 фактах любая модель хуже простого прогноза — отсюда защита п.6.
"""
from __future__ import annotations

import copy
from collections import deque

import numpy as np
from river import compose, drift, linear_model, optim, preprocessing

from .stream import DRIFT_AT, HORIZON, INTERVAL, Snapshot, emulate, interval_snapshots

PLAN = 120 / 480 * HORIZON
DELAY = HORIZON // INTERVAL  # через сколько интервалов приходит факт
WARMUP = 16      # интервалов только обучения (первые 8 часов)
WINDOW = 16      # окно скользящей ошибки
CHECK = 4        # как часто сравнивать претендента
MARGIN = 0.05    # претендент должен быть лучше на 5%


def _clip_z(x: dict) -> dict:
    return {k: max(-3.0, min(3.0, v)) for k, v in x.items()}


def make_blr(smoothing: float = 0.98):
    """Байесовская линейная регрессия с забыванием — лучшая на длинной дистанции.
    Учится ПОПРАВКЕ к простому прогнозу: y − «выпуск за прошлые 2 часа»."""
    return preprocessing.StandardScaler() | compose.FuncTransformer(_clip_z) |         linear_model.BayesianLinearRegression(alpha=1, beta=1, smoothing=smoothing)


def make_sgd():
    """Починенный онлайн-SGD: обрезка признаков и градиента, малый шаг — лучший на малых данных."""
    return preprocessing.StandardScaler() | compose.FuncTransformer(_clip_z) |         linear_model.LinearRegression(optimizer=optim.SGD(0.005), intercept_lr=0.005, clip_gradient=1.0, l2=0.001)


def clip(v: float | None) -> float:
    return float(min(max(v or 0.0, 0.0), 2 * PLAN))


TSFM_FILE = __import__("pathlib").Path(__file__).resolve().parents[3] / "data" / "tsfm_results.json"
TSFM_MODEL = "timesfm-3.0"


def _tsfm_predictions(seed: int) -> dict[int, float]:
    """Заранее посчитанные прогнозы TimesFM 3.0 (zero-shot, только прошлое) — как ещё один претендент."""
    import json
    if not TSFM_FILE.exists():
        return {}
    data = json.loads(TSFM_FILE.read_text(encoding="utf-8"))
    for m in data.get("models", []):
        if m.get("model") == TSFM_MODEL and "per_seed" in m:
            for ps in m["per_seed"]:
                if ps["seed"] == seed:
                    return {int(t): float(v) for t, v in ps["series"]}
    return {}


SERVE_NAMES = {"model": "наша модель", "naive": "простой прогноз", "tsfm": "TimesFM 3.0"}


def run_learning(seed: int = 11, n_max: int | None = None, use_tsfm: bool = True) -> dict:
    tsfm = _tsfm_predictions(seed) if use_tsfm else {}
    snaps: list[Snapshot] = interval_snapshots(emulate(seed))[:n_max]
    champion, challenger = make_blr(0.98), make_sgd()
    serving = "naive"
    frozen = None
    version, champ_name = 1, "v1"
    detector = drift.PageHinkley(min_instances=8, delta=0.5, threshold=25.0, mode="up")
    errs = {k: deque(maxlen=WINDOW) for k in ("champion", "challenger", "frozen", "naive", "plan", "served", "tsfm")}
    gate = {k: deque(maxlen=WINDOW) for k in ("model", "naive", "tsfm")}  # ошибки кандидатов на показ
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
        if s.t in tsfm:
            preds["tsfm"] = clip(tsfm[s.t])
        cand = {"model": preds["champion"], "naive": preds["naive"], **({"tsfm": preds["tsfm"]} if "tsfm" in preds else {})}
        preds["served"] = cand.get(serving, preds["naive"])
        ledger.append({"issued_at": s.t, "horizon_start": s.t, "horizon_end": s.t + HORIZON,
                       "y_hat": round(preds["served"], 2), "model_version": champ_name if serving == "model" else SERVE_NAMES.get(serving, serving)})
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
                gate["model"].append(abs(pj["champion"] - y))
                gate["naive"].append(abs(pj["naive"] - y))
                if "tsfm" in pj:
                    gate["tsfm"].append(abs(pj["tsfm"] - y))
                pair_c.append(abs(pj["champion"] - y))
                pair_h.append(abs(pj["challenger"] - y))
                detector.update(abs(pj["champion"] - y))
                if detector.drift_detected:
                    events.append({"t": s.t, "type": "drift", "text": "Ошибка прогноза выросла — режим линии изменился"})
                    challenger = make_blr(0.95)   # свежий претендент учится только на новом режиме
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
                    gate["model"] = deque(pair_c, maxlen=WINDOW)
                # 6) защита/выбор: показываем того кандидата, кто точнее на последних фактах (с запасом 3%)
                ready = {k: float(np.mean(v)) for k, v in gate.items() if len(v) >= 8}
                if ready:
                    best = min(ready, key=ready.get)
                    cur = ready.get(serving, float("inf"))
                    if best != serving and ready[best] < 0.97 * cur:
                        events.append({"t": s.t, "type": f"serve_{best}",
                                       "text": f"Показываем: {SERVE_NAMES[best]} — точнее на последних фактах ({ready[best]:.1f} против {cur:.1f})" if cur != float("inf") else f"Показываем: {SERVE_NAMES[best]}"})
                        serving = best
            # 3) обучение только после факта
            champion.learn_one(sj.x, y - sj.x["last_h"])
            challenger.learn_one(sj.x, y - sj.x["last_h"])
            if j == WARMUP - 1 and frozen is None:
                frozen = copy.deepcopy(champion)
                events.append({"t": s.t, "type": "freeze", "text": "Сделана замороженная копия модели для сравнения"})
        row.update({f"mae_{k}": (round(float(np.mean(v)), 2) if len(v) else None) for k, v in errs.items()})
        row["version"] = champ_name
        row["serving"] = serving
        timeline.append(row)

    def mae(key, after=None):
        vals = [abs(r[key] - r["y"]) for r in timeline[WARMUP:] if r.get(key) is not None and (after is None or r["t"] >= after)]
        if not vals and after is not None:
            return mae(key)
        return float(np.mean(vals)) if vals else None

    summary = {k: {"mae_all": mae(k), "mae_after_drift": mae(k, DRIFT_AT)} for k in ("champion", "served", "frozen", "naive", "plan", "tsfm") if any(r.get(k) is not None for r in timeline)}
    best_base = min(summary["naive"]["mae_after_drift"], summary["plan"]["mae_after_drift"])
    summary["skill_vs_baseline"] = 1 - summary["served"]["mae_after_drift"] / best_base
    return {"source": "forecast", "interval_min": INTERVAL, "horizon_min": HORIZON, "plan": PLAN, "drift_at": DRIFT_AT, "warmup": WARMUP,
            "timeline": timeline, "events": events, "summary": summary, "version": champ_name,
            "ledger_size": len(ledger), "note": "Поток из эмулятора завода (симуляция). Деградация окраски скрыта от моделей."}

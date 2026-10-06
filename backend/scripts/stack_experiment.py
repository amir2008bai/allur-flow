"""Эксперимент: стекинг — LightGBM получает прогнозы foundation-моделей (Chronos-2, TimesFM 3.0) как признаки.

Сравнение честное: одни и те же обучающие дни (случайные условия) и отложенные потоки 11–20.
Прогнозы foundation-моделей для отложенных потоков берутся из data/tsfm_results.json (тот же протокол).
Запуск: .venv/Scripts/python scripts/stack_experiment.py [runs] [models]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lightgbm as lgb  # noqa: E402

from app.learn import global_model as g  # noqa: E402
from app.learn.forecast import _tsfm_predictions  # noqa: E402
from app.learn.stream import DRIFT_AT, FEATURES, INTERVAL, emulate, interval_snapshots  # noqa: E402
from app.sim.engine import simulate  # noqa: E402
from scripts.tsfm_challengers import STEPS, chronos_predictor, timesfm_predictor  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "data" / "stack_results.json"
RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 300
MODELS = (sys.argv[2] if len(sys.argv) > 2 else "chronos-2,timesfm-3.0").split(",")
NAME_TO_KEY = {"chronos-2": "chronos", "timesfm-3.0": "tsfm"}


def per_interval(run):
    good = np.array([f["good"] for f in run.frames] + [run.good_out], dtype=float)
    return np.diff(good[::INTERVAL])


def main():
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    preds = {}
    for m in MODELS:
        preds[m] = chronos_predictor("amazon/chronos-2", dev) if m == "chronos-2" else timesfm_predictor("3.0", dev)
    t0 = time.time()
    X, y, F = [], [], {m: [] for m in MODELS}
    for i in range(RUNS):
        seed = 777_000 + i
        run = simulate(g.random_day(seed), seed)
        snaps = interval_snapshots(run)
        per = per_interval(run)
        ctx = [per[: s.t // INTERVAL] for s in snaps]
        Xi, ri, last_h = g.xy(snaps)
        X.append(Xi); y.append(ri)
        for m in MODELS:
            fc = np.clip(preds[m](ctx)[:, :STEPS].sum(axis=1), 0, 60)
            F[m].append(fc - last_h)
        if i % 25 == 0:
            print(f"{i}/{RUNS} · {time.time() - t0:.0f} с", flush=True)
    X = np.vstack(X); y = np.concatenate(y); F = {m: np.concatenate(v) for m, v in F.items()}

    def holdout(cols):
        errs, errs_after = [], []
        for s in g.HOLDOUT:
            snaps = interval_snapshots(emulate(s))
            Xh, rh, lh = g.xy(snaps)
            extra = []
            for m in cols:
                ser = _tsfm_predictions(s, m)
                extra.append(np.array([ser[sn.t] for sn in snaps]) - lh)
            Xa = np.column_stack([Xh, *extra]) if extra else Xh
            p = np.clip(lh + boosters[tuple(cols)].predict(Xa), 0, 60)
            e = np.abs(p - (rh + lh))
            t = np.array([sn.t for sn in snaps])
            errs.append(e[16:].mean()); errs_after.append(e[(t >= DRIFT_AT)].mean())
        return float(np.mean(errs)), float(np.mean(errs_after))

    boosters, res = {}, {}
    for cols in ([], ["chronos-2"], ["timesfm-3.0"], MODELS):
        cols = [c for c in cols if c in MODELS]
        if tuple(cols) in boosters:
            continue
        Xa = np.column_stack([X, *[F[c] for c in cols]]) if cols else X
        boosters[tuple(cols)] = lgb.train(g.PARAMS, lgb.Dataset(Xa, y, feature_name=FEATURES + [f"fc_{c}" for c in cols]), num_boost_round=g.ROUNDS)
        mae, after = holdout(cols)
        res["+".join(["lgbm", *cols])] = {"mae_all": mae, "mae_after_drift": after}
        print(f"{'+'.join(['lgbm', *cols]):32s} всё {mae:.3f} · после дрейфа {after:.3f}", flush=True)
    OUT.write_text(json.dumps({"runs": RUNS, "device": dev, "results": res, "seconds": round(time.time() - t0)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("сохранено", OUT)


if __name__ == "__main__":
    main()

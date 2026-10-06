"""Foundation-модели временных рядов как ПРЕТЕНДЕНТЫ: TimesFM (Google) и Chronos-2 (Amazon).

Честное сравнение с нашей моделью:
  - тот же поток эмулятора, те же 10 сидов, те же моменты прогноза (каждые 30 мин);
  - прогноз годных на 2 ч вперёд по истории, известной ДО момента прогноза (rolling origin);
  - веса моделей не меняются (zero-shot) — они «учатся» только через свежий контекст.
Результат → data/tsfm_results.json (приложение читает файл, PyTorch на защите не нужен).

Запуск: .venv/Scripts/python scripts/tsfm_challengers.py
"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.learn.forecast import run_learning  # noqa: E402
from app.learn.stream import DRIFT_AT, HORIZON, INTERVAL, emulate, interval_snapshots  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "data" / "tsfm_results.json"
SEEDS = list(range(11, 21))
STEPS = HORIZON // INTERVAL   # 4 шага по 30 мин
WARMUP = 16


def series(seed: int) -> tuple[np.ndarray, list[int]]:
    """Годные за каждые 30 мин и моменты прогноза (минуты), как в нашей модели."""
    run = emulate(seed)
    good = np.array([f["good"] for f in run.frames] + [run.good_out], dtype=float)
    per = np.diff(good[::INTERVAL])            # годных за интервал k: [k·30, (k+1)·30)
    origins = [s.t for s in interval_snapshots(run)]
    return per, origins


def contexts(per: np.ndarray, origins: list[int]) -> list[np.ndarray]:
    return [per[: t // INTERVAL] for t in origins]  # только прошлое


def evaluate(name: str, predict) -> dict:
    """predict(list[np.ndarray]) -> np.ndarray [n, STEPS] (медианный прогноз по шагам)."""
    per_seed, t0 = [], time.time()
    for seed in SEEDS:
        per, origins = series(seed)
        ctx = contexts(per, origins)
        fc = predict(ctx)
        snaps = interval_snapshots(emulate(seed))
        y = np.array([s.y for s in snaps])
        yhat = np.clip(fc[:, :STEPS].sum(axis=1), 0, 60)
        idx = [i for i, t in enumerate(origins) if i >= WARMUP]
        after = [i for i in idx if origins[i] >= DRIFT_AT]
        per_seed.append({"seed": seed, "mae_all": float(np.mean(np.abs(yhat[idx] - y[idx]))),
                         "mae_after_drift": float(np.mean(np.abs(yhat[after] - y[after]))),
                         "series": [[origins[i], round(float(yhat[i]), 2)] for i in range(len(origins))]})
    sec = time.time() - t0
    n = sum(len(series(s)[1]) for s in SEEDS)
    return {"model": name, "seconds_total": round(sec, 1), "ms_per_forecast": round(1000 * sec / n, 1),
            "mae_after_drift": float(np.mean([p["mae_after_drift"] for p in per_seed])),
            "mae_all": float(np.mean([p["mae_all"] for p in per_seed])), "per_seed": per_seed}


def timesfm_predictor(version: str, device: str):
    import timesfm
    if version == "3.0":
        f = timesfm.TimesFM3Forecaster.from_pretrained("google/timesfm-3.0-pytorch", device=device)

        def predict(ctx):
            return np.vstack([np.asarray(o.forecast, dtype=float).reshape(-1)[:STEPS] for o in f.predict_batch(list(ctx), horizon=STEPS)])
        return predict
    m = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch", torch_compile=False)
    m.compile(timesfm.ForecastConfig(max_context=512, max_horizon=128, normalize_inputs=True, per_core_batch_size=32,
                                     infer_is_positive=True, fix_quantile_crossing=True))

    def predict(ctx):
        point, _ = m.forecast(horizon=STEPS, inputs=list(ctx))
        return np.asarray(point, dtype=float)[:, :STEPS]
    return predict


def chronos_predictor(model_id: str, device: str):
    import torch
    from chronos import BaseChronosPipeline
    pipe = BaseChronosPipeline.from_pretrained(model_id, device_map=device, torch_dtype=torch.float32)

    def predict(ctx):
        out = []
        for i in range(0, len(ctx), 64):
            batch = [torch.tensor(c, dtype=torch.float32) for c in ctx[i:i + 64]]
            q, _ = pipe.predict_quantiles(batch, prediction_length=STEPS, quantile_levels=[0.5])
            for x in (q if isinstance(q, list) else list(q)):
                out.append(np.asarray(x.cpu() if hasattr(x, "cpu") else x, dtype=float).reshape(-1)[:STEPS])
        return np.vstack(out)
    return predict


if __name__ == "__main__":
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", dev)
    results = {"generated_at": time.time(), "device": dev, "horizon_min": HORIZON, "seeds": SEEDS, "models": []}
    ours = [run_learning(s)["summary"] for s in SEEDS]
    results["baselines"] = {k: float(np.mean([o[k]["mae_after_drift"] for o in ours])) for k in ("served", "frozen", "naive")}
    todo = [arg for arg in sys.argv[1:]] or ["chronos-2-small", "chronos-2", "timesfm-2.5", "timesfm-3.0"]
    for name in todo:
        try:
            if name.startswith("chronos"):
                mid = {"chronos-2-small": "autogluon/chronos-2-small", "chronos-2": "amazon/chronos-2"}[name]
                pred = chronos_predictor(mid, dev)
            else:
                pred = timesfm_predictor(name.split("-")[1], dev)
            r = evaluate(name, pred)
            results["models"].append(r)
            print(f"{name:16s} MAE после дрейфа {r['mae_after_drift']:.2f} | {r['ms_per_forecast']} мс/прогноз")
        except Exception as e:
            print(f"{name}: ОШИБКА {type(e).__name__}: {str(e)[:300]}")
            results["models"].append({"model": name, "error": f"{type(e).__name__}: {str(e)[:300]}"})
    print("наши:", {k: round(v, 2) for k, v in results["baselines"].items()})
    OUT.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
    print("сохранено", OUT)

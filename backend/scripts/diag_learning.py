"""Диагностика: почему онлайн-SGD «взрывался» и как ведёт себя байесовская модель на малых данных.

Запуск: .venv/Scripts/python scripts/diag_learning.py
"""
import math
import sys
from pathlib import Path

import numpy as np
from river import linear_model, optim, preprocessing

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.learn.stream import HORIZON, emulate, interval_snapshots  # noqa: E402

SEEDS = range(11, 21)


def stream(seed):
    return interval_snapshots(emulate(seed))


def run(make, seed, residual, n_max=None):
    """Протокол «прогноз до факта» с задержкой факта на HORIZON. Возвращает ошибки, прогнозы и макс. |z| признаков."""
    snaps = stream(seed)[: n_max] if n_max else stream(seed)
    m = make()
    pend, errs, preds, zmax = [], [], [], []
    for s in snaps:
        p = (m.predict_one(s.x) or 0.0) + (s.x["last_h"] if residual else 0.0)
        preds.append(p)
        pend.append((s, p))
        while pend and pend[0][0].t + HORIZON <= s.t:
            sj, pj = pend.pop(0)
            errs.append(abs(pj - sj.y))
            scaler = m["StandardScaler"] if "StandardScaler" in getattr(m, "steps", {}) else None
            if scaler is not None:
                z = scaler.transform_one(sj.x)
                zmax.append(max(abs(v) for v in z.values()))
            m.learn_one(sj.x, sj.y - (sj.x["last_h"] if residual else 0.0))
    return np.array(errs), np.array(preds), np.array(zmax) if zmax else np.array([0.0])


def sgd_old():          # было: сырые признаки → StandardScaler → SGD(0.02) на сырой цели (~30 машин)
    return preprocessing.StandardScaler() | linear_model.LinearRegression(optimizer=optim.SGD(0.02), intercept_lr=0.02)


def sgd_fixed():        # починка: цель-поправка + обрезка градиента + маленький шаг
    return preprocessing.StandardScaler() | linear_model.LinearRegression(optimizer=optim.SGD(0.005), intercept_lr=0.005, clip_gradient=1.0, l2=0.001)


def blr():              # сейчас: байесовская линейная регрессия с забыванием
    return preprocessing.StandardScaler() | linear_model.BayesianLinearRegression(alpha=1, beta=1, smoothing=0.98)


print("=" * 78)
print("1. ВОСПРОИЗВЕДЕНИЕ «ВЗРЫВА» (SGD на сырой цели)")
for seed in (12, 13):
    e, p, z = run(sgd_old, seed, residual=False)
    first_bad = next((i for i, v in enumerate(p) if abs(v) > 200), None)
    print(f"  seed {seed}: макс. прогноз {np.abs(p).max():,.0f} машин за 2 ч (реально ~30), "
          f"MAE {e.mean():,.1f}; первый прогноз >200 на шаге {first_bad}")
    print(f"     макс. |z| признака после StandardScaler за первые 10 обучений: {z[:10].max():,.1f}, за всё время: {z.max():,.1f}")

print("\n   Почему: смотрим, какой признак даёт огромный z в начале потока")
snaps = stream(13)
sc = preprocessing.StandardScaler()
for i, s in enumerate(snaps[:40]):
    z = sc.transform_one(s.x)
    big = {k: round(v, 1) for k, v in z.items() if abs(v) > 5}
    if big:
        print(f"     шаг {i}: {big}  (сырые значения: { {k: s.x[k] for k in big} })")
    sc.learn_one(s.x)

print("\n" + "=" * 78)
print("2. ПОПЫТКА ПОЧИНИТЬ SGD: поправка к наивному + clip_gradient=1 + шаг 0.005")
res = {"sgd_old": [], "sgd_fixed": [], "blr": [], "naive": []}
maxp = {"sgd_old": 0, "sgd_fixed": 0, "blr": 0}
for seed in SEEDS:
    for name, mk, resid in (("sgd_old", sgd_old, False), ("sgd_fixed", sgd_fixed, True), ("blr", blr, True)):
        e, p, _ = run(mk, seed, resid)
        res[name].append(e[16:].mean())
        maxp[name] = max(maxp[name], np.abs(p).max())
    s = stream(seed)
    res["naive"].append(np.mean([abs(x.x["last_h"] - x.y) for x in s[16 + HORIZON // 30:]]))
for k, v in res.items():
    extra = f", макс. прогноз {maxp[k]:,.0f}" if k in maxp else ""
    print(f"  {k:10s} MAE {np.mean(v):7.2f} (по 10 сидам; худший сид {np.max(v):7.2f}){extra}")

print("\n" + "=" * 78)
print("3. МАЛО ДАННЫХ: модель видит только первые N интервалов (по 30 мин), 10 сидов")
print(f"  {'N':>4} {'фактов':>7} {'BLR MAE':>8} {'наивный':>8} {'SGD-fix':>8} {'BLR макс.прогноз':>17} {'BLR хуже наивного >2×':>22}")
for n in (8, 12, 16, 24, 32, 48):
    b, nv, sf, mp, bad = [], [], [], 0, 0
    for seed in SEEDS:
        e, p, _ = run(blr, seed, True, n_max=n)
        e2, _, _ = run(sgd_fixed, seed, True, n_max=n)
        s = stream(seed)[:n]
        naive = np.array([abs(x.x["last_h"] - x.y) for x in s[HORIZON // 30:]])
        b.append(e.mean()); sf.append(e2.mean()); nv.append(naive.mean()); mp = max(mp, np.abs(p).max())
        bad += e.mean() > 2 * naive.mean()
    print(f"  {n:>4} {n - HORIZON // 30:>7} {np.mean(b):>8.2f} {np.mean(nv):>8.2f} {np.mean(sf):>8.2f} {mp:>17.1f} {bad:>18}/10")

"""Сравнение починенных вариантов на малых и полных данных (10 сидов)."""
import sys
from pathlib import Path
import numpy as np
from river import compose, linear_model, optim, preprocessing
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.diag_learning import run, stream, SEEDS, HORIZON  # noqa: E402

clip3 = compose.FuncTransformer(lambda x: {k: max(-3.0, min(3.0, v)) for k, v in x.items()})
V = {
    "BLR a=1 (было)": lambda: preprocessing.StandardScaler() | linear_model.BayesianLinearRegression(alpha=1, beta=1, smoothing=0.98),
    "BLR a=1 +clip": lambda: preprocessing.StandardScaler() | clip3 | linear_model.BayesianLinearRegression(alpha=1, beta=1, smoothing=0.98),
    "BLR a=20 +clip": lambda: preprocessing.StandardScaler() | clip3 | linear_model.BayesianLinearRegression(alpha=20, beta=1, smoothing=0.98),
    "BLR a=50 +clip": lambda: preprocessing.StandardScaler() | clip3 | linear_model.BayesianLinearRegression(alpha=50, beta=1, smoothing=0.98),
    "SGD-fix +clip": lambda: preprocessing.StandardScaler() | clip3 | linear_model.LinearRegression(optimizer=optim.SGD(0.005), intercept_lr=0.005, clip_gradient=1.0, l2=0.001),
}
print(f"{'вариант':16s}" + "".join(f"{'N='+str(n):>9}" for n in (8, 16, 32, 'all')) + f"{'макс.прогноз':>14}")
for name, mk in V.items():
    row, mp = [], 0
    for n in (8, 16, 32, None):
        e_all = []
        for seed in SEEDS:
            e, p, _ = run(mk, seed, True, n_max=n)
            e_all.append(e.mean() if n else e[16:].mean()); mp = max(mp, np.abs(p).max())
        row.append(np.mean(e_all))
    print(f"{name:16s}" + "".join(f"{v:9.2f}" for v in row) + f"{mp:14.1f}")
nv = []
for n in (8, 16, 32, None):
    vals = []
    for seed in SEEDS:
        s = stream(seed)[:n] if n else stream(seed)
        start = HORIZON // 30 if n else 16 + HORIZON // 30
        vals.append(np.mean([abs(x.x['last_h'] - x.y) for x in s[start:]]))
    nv.append(np.mean(vals))
print(f"{'наивный':16s}" + "".join(f"{v:9.2f}" for v in nv))

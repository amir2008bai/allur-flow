"""Проверка моделей Allur Flow на НАСТОЯЩИХ данных производства.

Данные: UCI «Productivity Prediction of Garment Employees» — швейная фабрика (Бангладеш), 59 рабочих дней 2015 г.,
12 бригад в двух цехах; на каждый день и бригаду: план выработки (targeted_productivity), факт (actual_productivity),
простои, сверхурочные и др. Лицензия CC BY 4.0. https://archive.ics.uci.edu/dataset/597

Задача та же, что у Allur Flow: ДО начала смены предсказать факт выработки бригады и риск провала
(факт < 80% плана). Правила честности те же:
  • признаки только известные ДО смены (план, бригада, цех, день недели, число рабочих, плановая смена модели,
    трудоёмкость SMV и история бригады за прошлые дни). Данные самой смены (простои, сверхурочные, WIP, премия) — НЕ используем;
  • скользящая проверка: на каждый день проверки модели учатся только на прошлых днях (rolling origin);
  • первые 60% дней — только обучение, оценка на последних 40% дней;
  • сравнение с простыми прогнозами: «как вчера у этой бригады» и «план»;
  • доверительные интервалы разницы ошибок — парный бутстрэп по дням.
Запуск: allur-flow/backend/.venv/Scripts/python validation-real/validate_garment.py
"""
from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from river import compose, linear_model, preprocessing

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / "garments_worker_productivity.csv"
TRAIN_SHARE = 0.6
DIP = 0.8                 # провал: факт < 80% плана (как в Allur Flow: < 80% нормы)
COVER = 0.9
ACI_GAMMA = 0.02
GATE_WINDOW = 40          # записей (≈ 2 дня по 20 бригадо-сменам)
GATE_MARGIN = 0.2
REG = {"objective": "l1", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": 20, "feature_fraction": 0.9,
       "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0, "verbose": -1, "seed": 7}
CLS = {**REG, "objective": "binary"}
FEATS = ["dept", "team", "dow", "target", "smv", "workers", "style_change", "lag1", "lag1_gap", "lag_mean3",
         "lag_idle1", "lag_dips5", "team_mean", "days_since"]


def load() -> pd.DataFrame:
    d = pd.read_csv(DATA)
    d["date"] = pd.to_datetime(d["date"], format="%m/%d/%Y")
    d["dept"] = (d["department"].str.strip().str.lower() == "finishing").astype(int)
    d["unit"] = d["dept"].astype(str) + "-" + d["team"].astype(str)
    d = d.sort_values(["date", "unit"]).reset_index(drop=True)
    d["dow"] = d["date"].dt.dayofweek
    d = d.rename(columns={"targeted_productivity": "target", "no_of_workers": "workers", "no_of_style_change": "style_change",
                          "actual_productivity": "y"})
    # история бригады — только ПРОШЛЫЕ дни
    g = d.groupby("unit", sort=False)
    d["lag1"] = g["y"].shift(1)
    d["lag1_gap"] = d["lag1"] - g["target"].shift(1)
    d["lag_mean3"] = g["y"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    d["lag_idle1"] = g["idle_time"].shift(1)
    dip = (d["y"] < DIP * d["target"]).astype(float)
    d["dip"] = dip.astype(int)
    d["lag_dips5"] = dip.groupby(d["unit"]).transform(lambda s: s.shift(1).rolling(5, min_periods=1).sum())
    d["team_mean"] = g["y"].transform(lambda s: s.shift(1).expanding().mean())
    d["days_since"] = g["date"].diff().dt.days
    return d


def auc(p, y) -> float:
    p, y = np.asarray(p, float), np.asarray(y, int)
    pos, neg = p[y == 1], p[y == 0]
    if not len(pos) or not len(neg):
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order)); ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def boot_diff(e_a, e_b, days, n=2000, seed=0):
    """Парный бутстрэп по дням: средняя разница ошибок a − b и 95% интервал."""
    rng = np.random.default_rng(seed)
    uniq = np.unique(days)
    idx = {u: np.where(days == u)[0] for u in uniq}
    diffs = []
    for _ in range(n):
        pick = np.concatenate([idx[u] for u in rng.choice(uniq, len(uniq))])
        diffs.append(np.mean(e_a[pick] - e_b[pick]))
    return float(np.mean(e_a - e_b)), float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))


def main() -> dict:
    d = load()
    dates = sorted(d["date"].unique())
    first_test = dates[int(len(dates) * TRAIN_SHARE)]
    river = preprocessing.StandardScaler() | linear_model.BayesianLinearRegression(alpha=1, beta=1, smoothing=0.98)
    river_feats = ["target", "smv", "workers", "style_change", "lag1", "lag1_gap", "lag_mean3", "dow", "dept"]
    rows = []
    alpha, resid = 1 - COVER, deque(maxlen=200)
    errs = {k: deque(maxlen=GATE_WINDOW) for k in ("lgbm", "river", "naive", "ens")}
    serving = "lgbm"
    # онлайн-модель River учится на всём прошлом по порядку дней
    for day in dates:
        today = d[d["date"] == day]
        past = d[d["date"] < day]
        if day >= first_test:
            Xp = past[FEATS].astype(float); Xt = today[FEATS].astype(float)
            reg = lgb.train(REG, lgb.Dataset(Xp, past["y"] - past["target"]), num_boost_round=300)   # поправка к плану
            cls = lgb.train(CLS, lgb.Dataset(Xp, past["dip"]), num_boost_round=200)
            p_lgbm = np.clip(today["target"].values + reg.predict(Xt), 0, 1.2)
            p_dip = cls.predict(Xt)
            for k, (_, r) in enumerate(today.iterrows()):
                xr = {f: (0.0 if pd.isna(r[f]) else float(r[f])) for f in river_feats}
                naive = r["lag1"] if not pd.isna(r["lag1"]) else r["target"]
                p_r = float(np.clip(r["target"] + (river.predict_one(xr) or 0.0), 0, 1.2))
                preds = {"lgbm": float(p_lgbm[k]), "river": p_r, "naive": float(naive), "plan": float(r["target"]),
                         "ens": float((p_lgbm[k] + p_r) / 2)}
                served = preds[serving]
                if len(resid) >= 30:
                    a = min(0.5, max(0.0, alpha)); res = np.array(resid)
                    lo, hi = served + np.quantile(res, a / 2), served + np.quantile(res, 1 - a / 2)
                else:
                    lo = hi = None
                rows.append({"date": str(day)[:10], "unit": r["unit"], "y": float(r["y"]), "target": float(r["target"]), "dip": int(r["dip"]),
                             "served": served, "serving": serving, "lo": lo, "hi": hi, "p_dip": float(p_dip[k]),
                             "lag_dip": float(r["lag1"] < DIP * r["target"]) if not pd.isna(r["lag1"]) else 0.0, **{f"p_{m}": v for m, v in preds.items()}})
            # факт дня пришёл: ошибки, коридор, выбор показа
            for row in rows[-len(today):]:
                if row["lo"] is not None:
                    miss = not (row["lo"] <= row["y"] <= row["hi"])
                    alpha = min(0.5, max(0.0, alpha + ACI_GAMMA * ((1 - COVER) - miss)))
                    row["covered"] = not miss
                resid.append(row["y"] - row["served"])
                for m in errs:
                    errs[m].append(abs(row[f"p_{m}"] - row["y"]))
            ready = {m: float(np.mean(v)) for m, v in errs.items() if len(v) >= 20}
            if ready:
                best = min(ready, key=ready.get)
                if best != serving and ready[best] < (1 - GATE_MARGIN) * ready.get(serving, np.inf):
                    serving = best
        for _, r in today.iterrows():   # River учится после факта
            xr = {f: (0.0 if pd.isna(r[f]) else float(r[f])) for f in river_feats}
            river.learn_one(xr, float(r["y"] - r["target"]))

    t = pd.DataFrame(rows)
    y = t["y"].values; days = t["date"].values
    mae = {m: float(np.mean(np.abs(t[f"p_{m}"] - y))) for m in ("lgbm", "river", "ens", "naive", "plan")}
    mae["served"] = float(np.mean(np.abs(t["served"] - y)))
    e = {m: np.abs(t[f"p_{m}"].values - y) for m in ("lgbm", "naive", "plan", "ens", "river")}
    e["served"] = np.abs(t["served"].values - y)
    comp = {f"{a}_vs_{b}": boot_diff(e[a], e[b], days) for a, b in (("served", "naive"), ("served", "plan"), ("lgbm", "naive"), ("lgbm", "plan"), ("ens", "lgbm"))}
    cov = t["covered"].dropna()
    w = (t["hi"] - t["lo"]).dropna()
    yd = t["dip"].values
    dip = {"base_rate": float(yd.mean()), "auc_model": auc(t["p_dip"], yd), "auc_yesterday_dip": auc(t["lag_dip"], yd)}
    for thr in (0.3, 0.5):
        warn = t["p_dip"].values >= thr
        dip[f"precision@{thr}"] = float(yd[warn].mean()) if warn.any() else None
        dip[f"recall@{thr}"] = float(warn[yd == 1].mean())
    res = {
        "dataset": "UCI 597 · Productivity Prediction of Garment Employees (реальная фабрика, 2015)",
        "rows_total": int(len(d)), "days_total": len(dates), "test_days": int(t["date"].nunique()), "test_rows": int(len(t)),
        "first_test_day": str(first_test)[:10], "metric": "MAE выработки (доля 0–1; 0,01 = 1 п.п.)",
        "mae": mae, "relative_to_naive": {m: 1 - v / mae["naive"] for m, v in mae.items()},
        "relative_to_plan": {m: 1 - v / mae["plan"] for m, v in mae.items()},
        "paired_bootstrap_95": comp,
        "interval": {"target": COVER, "coverage": float(cov.mean()), "n": int(len(cov)), "mean_width": float(w.mean())},
        "serving_share": t["serving"].value_counts(normalize=True).to_dict(),
        "dip": dip,
    }
    (HERE / "results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    t.to_csv(HERE / "predictions.csv", index=False)
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(main(), ensure_ascii=False, indent=1))

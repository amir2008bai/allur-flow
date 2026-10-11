"""Предварительная регистрация прогноза смены: прогноз пишется в базу ДО начала смены, потом сверяется с фактом.

Правило честности №8: «прогноз записывается до факта». Таблица `forecasts` (db.py) сама проверяет порядок времени:
CHECK (feature_cutoff <= issued_at <= horizon_start) — смену, которая уже началась, зарегистрировать нельзя.

Когда пишем: при каждом открытии брифинга или журнала — на все ещё не начавшиеся смены сегодня и на следующий рабочий день.
Что пишем: утренний прогноз двойника (30 прогонов обычного дня, без событий этого дня), коридор p10–p90.
Сверка: запись дня в журнале берёт зарегистрированный прогноз, если он есть, и помечает «записан до факта».
Время — Казахстан (UTC+5).
"""
from __future__ import annotations

import time
from datetime import date as Date
from datetime import datetime, timedelta, timezone

KZ = timezone(timedelta(hours=5))
SHIFT_START_H = (8, 16)          # смены 08–16 и 16–24
TARGET = "shift_output"
MODEL = "twin-morning"


def shift_start_ts(d: Date, shift: int) -> float:
    return datetime(d.year, d.month, d.day, SHIFT_START_H[shift - 1], tzinfo=KZ).timestamp()


def _key(d: Date, shift: int) -> str:
    return f"{d.isoformat()}#{shift}"


def _con():
    from .journal import con
    return con()


def register(d: Date, now: float | None = None) -> int:
    """Записать утренний прогноз на ещё не начавшиеся смены дня d. Возвращает число новых записей."""
    import numpy as np
    from .sim.api import _eta_runs, twin_context
    now = time.time() if now is None else now
    ver = twin_context()["version"]
    c = _eta_runs("base", ver)
    end = c.shape[1] - 1
    n = 0
    for shift, (s0, s1) in ((1, (0, 480)), (2, (480, min(960, end)))):
        start = shift_start_ts(d, shift)
        if now > start:
            continue                                    # смена уже идёт — записать «до факта» нельзя
        if _con().execute("SELECT 1 FROM forecasts WHERE target=? AND asset_id=?", (TARGET, _key(d, shift))).fetchone():
            continue
        v = c[:, s1] - c[:, s0]
        _con().execute("INSERT INTO forecasts (target, asset_id, issued_at, feature_cutoff, horizon_start, horizon_end, model_name, model_version, role, y_hat, y_lo, y_hi) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                       (TARGET, _key(d, shift), now, now, start, start + 8 * 3600, MODEL, ver, "champion",
                        float(v.mean()), float(np.percentile(v, 10)), float(np.percentile(v, 90))))
        n += 1
    _con().commit()
    return n


def register_upcoming(today: Date, now: float | None = None) -> int:
    """Сегодняшние ещё не начавшиеся смены и следующий рабочий день (выходные пропускаем)."""
    from .journal import day_kind
    n = register(today, now)
    d = today + timedelta(days=1)
    for _ in range(7):
        if day_kind(d) != "off":
            n += register(d, now)
            break
        d += timedelta(days=1)
    return n


def get(d: Date, shift: int) -> dict | None:
    r = _con().execute("SELECT issued_at, y_hat, y_lo, y_hi, model_version FROM forecasts WHERE target=? AND asset_id=?", (TARGET, _key(d, shift))).fetchone()
    if not r:
        return None
    return {"issued_at": r[0], "mean": r[1], "lo": r[2], "hi": r[3], "model_version": r[4],
            "issued_at_local": datetime.fromtimestamp(r[0], KZ).strftime("%d.%m %H:%M")}


def settle(d: Date, shift: int, fact: float) -> None:
    """Записать факт к зарегистрированному прогнозу (ошибка считается по факту)."""
    f = get(d, shift)
    if f is None:
        return
    _con().execute("UPDATE forecasts SET y_true=?, abs_err=? WHERE target=? AND asset_id=? AND y_true IS NULL",
                   (fact, abs(fact - f["mean"]), TARGET, _key(d, shift)))
    _con().commit()


def stats() -> dict:
    """Сколько прогнозов записано заранее, сколько уже сверено с фактом, сколько попало в коридор."""
    rows = _con().execute("SELECT y_true, y_lo, y_hi FROM forecasts WHERE target=?", (TARGET,)).fetchall()
    settled = [r for r in rows if r[0] is not None]
    return {"registered": len(rows), "settled": len(settled),
            "in_corridor": sum(1 for y, lo, hi in settled if lo <= y <= hi), "source": "forecast"}

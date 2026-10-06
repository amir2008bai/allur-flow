"""Проверка качества входящих данных с линии (кадры состояния раз в минуту).

На реальном заводе данные приходят с PLC/MES и бывают «грязными»: пропуски связи, дубли, залипшие датчики,
невозможные значения, сбой часов, выбросы. Двойник не должен на них учиться и не должен падать.
`check_frames` находит проблемы, `clean_frames` убирает то, что можно безопасно убрать.
"""
from __future__ import annotations

from collections import defaultdict

STATES = {"working", "starved", "blocked", "down"}
BUF_RU = {"b_weld_paint": "сварка → окраска", "b_paint_asm": "окраска → сборка", "b_asm_qc": "сборка → ОТК"}
NEIGHBORS = {"b_weld_paint": ("welding", "paint"), "b_paint_asm": ("paint", "assembly"), "b_asm_qc": ("assembly", "qc")}


def check_frames(frames: list[dict], buffer_cap: dict[str, int], step: float = 1.0) -> list[dict]:
    issues: list[dict] = []
    seen_t: set[float] = set()
    prev = None
    same_buf = defaultdict(int)
    for i, f in enumerate(frames):
        t = f.get("t")
        if t is None:
            issues.append({"type": "no_time", "i": i, "text": "кадр без времени"}); continue
        if prev is not None and t < prev["t"] and not (frames[i - 1].get("t") == t):
            # время меньше предыдущего: сбой часов (одиночный кадр) или повтор уже переданного блока (дубли)
            nxt = frames[i + 1].get("t") if i + 1 < len(frames) else None
            if nxt is None or nxt > prev["t"]:
                issues.append({"type": "time_backwards", "t": t, "text": f"время пошло назад на {prev['t'] - t:.0f} мин (сбой часов)"}); continue
        if t in seen_t:
            issues.append({"type": "duplicate", "t": t, "text": "повтор кадра (дубль)"}); continue
        seen_t.add(t)
        if prev is not None:
            dt = t - prev["t"]
            if dt < 0:
                issues.append({"type": "time_backwards", "t": t, "text": f"время пошло назад на {abs(dt):.0f} мин (сбой часов)"})
            elif dt > 3 * step:
                issues.append({"type": "gap", "t": prev["t"], "minutes": dt, "text": f"нет данных {dt:.0f} мин (пропала связь)"})
            if f.get("good", 0) < prev.get("good", 0) and dt >= 0:
                issues.append({"type": "counter_reset", "t": t, "text": "счётчик выпуска уменьшился"})
            if dt > 0 and (f.get("good", 0) - prev.get("good", 0)) / dt > 3:  # линия физически не даёт >3 машин в минуту
                issues.append({"type": "outlier", "t": t, "text": f"скачок выпуска +{f['good'] - prev['good']} за {dt:.0f} мин — невозможно"})
        for b, v in (f.get("buffers") or {}).items():
            if v is None or v < 0 or v > buffer_cap.get(b, 10 ** 6):
                issues.append({"type": "out_of_range", "t": t, "text": f"буфер «{BUF_RU.get(b, b)}» = {v}, а мест 0…{buffer_cap.get(b)}"})
            up, dn = NEIGHBORS.get(b, (None, None))
            sts = f.get("states", {})
            both_work = sts.get(up) == "working" and sts.get(dn) == "working"
            if prev is not None and prev.get("buffers", {}).get(b) == v and both_work:
                same_buf[b] += 1
                if same_buf[b] == 120:
                    issues.append({"type": "stuck", "t": t, "text": f"датчик буфера «{BUF_RU.get(b, b)}» не меняется 2 ч, хотя соседние участки работают (залип?)"})
            else:
                same_buf[b] = 0
        for st_name, st in (f.get("states") or {}).items():
            if st not in STATES:
                issues.append({"type": "bad_state", "t": t, "text": f"{st_name}: неизвестное состояние «{st}»"})
        if not issues or issues[-1].get("t") != t or issues[-1]["type"] not in ("time_backwards",):
            prev = f
    return issues


def clean_frames(frames: list[dict], buffer_cap: dict[str, int]) -> tuple[list[dict], dict]:
    """Убрать дубли и кадры с прыжком времени назад, обрезать невозможные значения буферов, отбросить выбросы выпуска."""
    out, removed = [], defaultdict(int)
    last_t, last_good = -1.0, 0
    for f in frames:
        t = f.get("t")
        if t is None or t <= last_t:
            removed["duplicate_or_backwards"] += 1
            continue
        g = f.get("good", last_good)
        if g < last_good or (t - last_t > 0 and last_t >= 0 and (g - last_good) / (t - last_t) > 3):
            removed["bad_counter"] += 1
            continue
        f = {**f, "buffers": {b: min(max(int(v or 0), 0), buffer_cap.get(b, 10 ** 6)) for b, v in (f.get("buffers") or {}).items()}}
        out.append(f)
        last_t, last_good = t, g
    return out, dict(removed)

"""Дискретно-событийная модель линии на SimPy.

Станции работают по одному кузову, между ними конечные буферы. Станция может быть:
working (работает), starved (ждёт кузов), blocked (некуда отдать), down (отказ/остановка).
Отказы зависят от наработки (часы работы), а не от календаря. Случайные потоки разделены по
(станция, назначение) — это общие случайные числа (CRN) для честного сравнения сценариев.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import simpy

from .params import BUFFERS, STATIONS, LineParams

PURPOSES = ["cycle", "defect", "ttf", "ttr", "route", "repair"]


@dataclass
class Body:
    id: int
    paint_passes: int = 0
    defects: list[str] = field(default_factory=list)


@dataclass
class RunResult:
    params: LineParams
    seed: int
    horizon: float
    states: dict[str, list[tuple[float, float, str]]]     # станция → [(start, end, state)]
    events: list[dict]                                     # дефекты, ремонты, выпуск, остановки
    frames: list[dict]                                     # снимок раз в минуту
    produced: dict[str, int]                               # обработано станцией (как «Выпущено» в DOCX)
    defects: dict[str, int]
    good_out: int                                          # годные на выходе ОТК
    scrapped: int


def _rng(seed: int, station: str, purpose: str) -> np.random.Generator:
    return np.random.default_rng(np.random.SeedSequence([seed, STATIONS.index(station) if station in STATIONS else 9,
                                                         PURPOSES.index(purpose)]))


def _lognormal(rng: np.random.Generator, mean: float, cv: float) -> float:
    if mean <= 0:
        return 0.0
    s2 = math.log(1 + cv * cv)
    return float(rng.lognormal(math.log(mean) - s2 / 2, math.sqrt(s2)))


def simulate(params: LineParams, seed: int = 0, horizon: float | None = None, frame_every: float = 1.0) -> RunResult:
    horizon = horizon or params.horizon
    env = simpy.Environment()
    rng = {(s, p): _rng(seed, s, p) for s in STATIONS + ["repair"] for p in PURPOSES}

    buffers = {b: simpy.Store(env, capacity=params.buffer_cap[b]) for b in BUFFERS}
    repair_q = simpy.Store(env)
    next_id = [0]

    def new_body() -> Body:
        next_id[0] += 1
        return Body(next_id[0])

    for b in BUFFERS:
        for _ in range(params.buffer_init[b]):
            buffers[b].items.append(new_body())

    states: dict[str, list] = {s: [] for s in STATIONS}
    cur: dict[str, tuple[float, str]] = {s: (0.0, "starved") for s in STATIONS}
    events: list[dict] = []
    produced = {s: 0 for s in STATIONS}
    defects = {s: 0 for s in STATIONS}
    good = [0]
    scrapped = [0]

    def set_state(s: str, state: str):
        t0, st = cur[s]
        if st == state:
            return
        if env.now > t0:
            states[s].append((t0, env.now, st))
        cur[s] = (env.now, state)

    def factor(s: str, kind: str) -> float:
        x = 1.0
        for d in params.degradations:
            if d.station != s or env.now < d.start:
                continue
            if d.reset_at is not None and env.now >= d.reset_at:
                continue
            frac = min(1.0, (env.now - d.start) / max(1e-9, d.end - d.start))
            target = d.cycle_x if kind == "cycle" else d.defect_x
            x *= 1 + (target - 1) * frac
        return x

    forced = {s: sorted([f for f in params.forced_downs if f.station == s], key=lambda f: f.start) for s in STATIONS}
    ttf = {s: (rng[(s, "ttf")].exponential(params.stations[s].mtbf_work) if params.stations[s].mtbf_work else math.inf)
           for s in STATIONS}

    def go_down(s: str, minutes: float, reason: str, planned: bool):
        set_state(s, "down")
        events.append({"t": round(env.now, 2), "type": "stop_start", "station": s, "minutes": round(minutes, 1),
                       "planned": planned, "reason": reason})
        yield env.timeout(minutes)
        events.append({"t": round(env.now, 2), "type": "stop_end", "station": s})
        set_state(s, "working")

    def work(s: str, minutes: float):
        """Работать `minutes` чистого времени, прерываясь на отказы и принудительные остановки."""
        sp = params.stations[s]
        remaining = minutes
        while remaining > 1e-9:
            # принудительная остановка, которая уже началась
            fd = next((f for f in forced[s] if f.start <= env.now < f.start + f.minutes), None)
            if fd:
                forced[s].remove(fd)
                yield from go_down(s, fd.start + fd.minutes - env.now, fd.reason, fd.planned)
                continue
            nxt_forced = next((f.start for f in forced[s] if f.start > env.now), math.inf)
            step = min(remaining, ttf[s], nxt_forced - env.now)
            yield env.timeout(step)
            remaining -= step
            ttf[s] -= step
            if ttf[s] <= 1e-9:
                yield from go_down(s, _lognormal(rng[(s, "ttr")], sp.mttr, sp.mttr_cv), "Отказ оборудования", False)
                ttf[s] = rng[(s, "ttf")].exponential(sp.mtbf_work)

    def station(i: int, s: str):
        sp = params.stations[s]
        up = buffers[BUFFERS[i - 1]] if i > 0 else None
        down = buffers[BUFFERS[i]] if i < len(BUFFERS) else None
        while True:
            set_state(s, "starved")
            body = (yield up.get()) if up else new_body()
            set_state(s, "working")
            while True:
                yield from work(s, _lognormal(rng[(s, "cycle")], sp.cycle * factor(s, "cycle"), sp.cycle_cv))
                produced[s] += 1
                is_defect = rng[(s, "defect")].random() < min(0.95, sp.defect_p * factor(s, "defect"))
                if not is_defect:
                    break
                defects[s] += 1
                body.defects.append(s)
                events.append({"t": round(env.now, 2), "type": "defect", "station": s, "body": body.id})
                if s != "paint":
                    yield from work(s, sp.rework_min)      # исправление на месте
                    events.append({"t": round(env.now, 2), "type": "rework", "station": s, "body": body.id})
                    break
                body.paint_passes += 1
                if body.paint_passes >= params.max_paint_passes:
                    scrapped[0] += 1
                    events.append({"t": round(env.now, 2), "type": "scrap", "station": s, "body": body.id})
                    body = None
                    break
                if rng[("paint", "route")].random() < params.spot_repair_p:
                    yield repair_q.put(body)            # точечный ремонт вне линии
                    events.append({"t": round(env.now, 2), "type": "to_spot_repair", "station": s, "body": body.id})
                    body = None
                    break
                events.append({"t": round(env.now, 2), "type": "repaint", "station": s, "body": body.id})
                # перекраска: ещё один цикл окраски этого же кузова
            if body is None:
                continue
            if down is None:
                good[0] += 1
                events.append({"t": round(env.now, 2), "type": "good_out", "station": s, "body": body.id})
                continue
            set_state(s, "blocked")
            yield down.put(body)

    def repair_worker(k: int):
        r = rng[("repair", "repair")]
        while True:
            body = yield repair_q.get()
            yield env.timeout(_lognormal(r, params.repair_mean, 0.4))
            events.append({"t": round(env.now, 2), "type": "spot_repaired", "station": "paint", "body": body.id})
            yield buffers["b_paint_asm"].put(body)

    frames: list[dict] = []

    def monitor():
        while True:
            frames.append({
                "t": round(env.now, 2),
                "states": {s: cur[s][1] for s in STATIONS},
                "buffers": {b: len(buffers[b].items) for b in BUFFERS},
                "repair_queue": len(repair_q.items),
                "good": good[0],
            })
            yield env.timeout(frame_every)

    for i, s in enumerate(STATIONS):
        env.process(station(i, s))
    for k in range(params.repair_servers):
        env.process(repair_worker(k))
    env.process(monitor())
    env.run(until=horizon)
    for s in STATIONS:
        t0, st = cur[s]
        if horizon > t0:
            states[s].append((t0, horizon, st))

    return RunResult(params=params, seed=seed, horizon=horizon, states=states, events=events, frames=frames,
                     produced=produced, defects=defects, good_out=good[0], scrapped=scrapped[0])

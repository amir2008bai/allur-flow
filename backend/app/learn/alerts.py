"""Тревоги, которые учатся на ответах людей «да / нет».

1) Простые правила находят подозрительные ситуации в потоке эмулятора (их специально много — правила чувствительные).
2) Для каждой тревоги эмулятор знает правду: случилась ли через 30 мин реальная проблема
   (линия теряет машины: сборка без кузовов ≥5 мин или выпуск < 80% плана). Людям правда НЕ показывается.
3) Люди отвечают «да/нет» → байесовская таблица (Beta-Binomial) по «типу × силе» тревоги обновляется после
   каждого ответа. Модель прозрачна: «тревоги этого вида подтверждают в N% случаев».
   (Логистическая регрессия River на десятках ответов оказалась слишком шумной — проверено.)
4) Активное обучение: спрашиваем про тот вид тревог, о котором модель знает меньше всего.
5) Честная оценка: точность считается на ОТДЕЛЬНОМ наборе тревог, который людям не показывался.
"""
from __future__ import annotations

import random
import time
from dataclasses import dataclass

import numpy as np
from scipy.stats import beta as beta_dist

from .stream import EMULATOR, emulate, _state_minutes

TYPES = {
    "paint_slow": "Окраска не успевает",
    "buffer_low": "Буфер перед сборкой почти пуст",
    "stop_long": "Затянувшаяся остановка",
    "defect_burst": "Всплеск брака окраски",
    "shortage": "Склад не выдаёт комплектующие",
    "micro_stops": "Частые короткие остановки",
}
STATION_RU = {"welding": "сварка", "paint": "окраска", "assembly": "сборка", "qc": "ОТК"}


@dataclass
class Alert:
    id: str
    t: int
    type: str
    title: str
    text: str
    x: dict
    truth: bool  # знает только эмулятор


def _detect(seed: int) -> list[Alert]:
    return detect_run(emulate(seed), seed)


def detect_run(run, tag: int | str = 0) -> list[Alert]:
    """Правила тревог на любом прогоне (эмулятор, сценарий сбоя, реальные данные)."""
    seed = tag
    fr = run.frames
    good = np.array([f["good"] for f in fr] + [run.good_out])
    d_t = np.array([e["t"] for e in run.events if e["type"] == "defect" and e["station"] == "paint"])
    stops = [e for e in run.events if e["type"] == "stop_start"]
    last = {k: -999 for k in TYPES}
    out: list[Alert] = []
    H = int(run.horizon)
    for c in range(60, H - 31, 5):
        b_now, b_prev = fr[c]["buffers"]["b_paint_asm"], fr[c - 30]["buffers"]["b_paint_asm"]
        pw = _state_minutes(run, "paint", c - 30, c, "working") / 30
        defects30 = int(((d_t > c - 30) & (d_t <= c)).sum())
        down_now = [s for s in stops if s["t"] <= c - 8 and s["t"] + s["minutes"] > c]
        stop_station = None
        cand = []
        if pw >= 0.9 and b_prev - b_now >= 2:
            cand.append(("paint_slow", f"Окраска работает без пауз, буфер перед сборкой упал с {b_prev} до {b_now} за 30 мин"))
        if b_now <= 3:
            cand.append(("buffer_low", f"Перед сборкой осталось {b_now} кузова"))
        if down_now:
            s = down_now[0]
            cand.append(("stop_long", f"{STATION_RU[s['station']].capitalize()} стоит уже {int(c - s['t'])} мин"))
            stop_station = s["station"]
        if _state_minutes(run, "welding", c - 10, c, "starved") >= 9:
            cand.append(("shortage", "Сварка 10 мин ждёт кузов со склада — нет комплектующих?"))
        short_stops: dict = {}
        for st_ in stops:
            if c - 60 < st_["t"] <= c and st_["minutes"] < 8:
                short_stops[st_["station"]] = short_stops.get(st_["station"], 0) + 1
        for st_name, n in short_stops.items():
            if n >= 3:
                cand.append(("micro_stops", f"{STATION_RU[st_name].capitalize()}: {n} коротких остановок за час"))
                break
        if defects30 >= 2:
            cand.append(("defect_burst", f"{defects30} дефекта окраски за 30 мин"))
        for typ, text in cand:
            if c - last[typ] < 45:
                continue
            last[typ] = c
            starved_next = _state_minutes(run, "assembly", c, c + 30, "starved")
            out_next = good[c + 30] - good[c]
            truth = bool(starved_next >= 5 or out_next < 0.8 * 7.5)  # реальная проблема: линия теряет машины
            x = {f"type_{k}": float(k == typ) for k in TYPES}
            x.update({"stop_station": stop_station if typ == "stop_long" else None, "buf_pa": b_now, "buf_drop": b_prev - b_now, "paint_work": pw, "defects30": defects30,
                      "down_min": float(c - down_now[0]["t"]) if down_now else 0.0,
                      "shift_pos": (c % 480) / 480})
            hh = (c // 60 + 8) % 24
            out.append(Alert(id=f"{seed}-{c}-{typ}", t=c, type=typ, title=TYPES[typ], text=text, x=x, truth=truth))
    return out


SHOW_AT = 0.30   # вид тревог полезен, если его подтверждают хотя бы в 30% случаев
MUTE_CONF = 0.6  # глушим, если уверены на 60%, что вид ниже порога
MIN_VOTES = 3    # и только после 3+ ответов по этому виду


def bucket(a: "Alert") -> str:
    x = a.x
    if a.type == "buffer_low":
        return "buffer_empty" if x["buf_pa"] == 0 else "buffer_low"
    if a.type == "stop_long":
        return {"paint": "stop_paint", "assembly": "stop_asm"}.get(a.x["stop_station"], "stop_other")
    if a.type in ("paint_slow", "shortage", "micro_stops"):
        return a.type
    return "defect_burst"


BUCKET_RU = {"buffer_empty": "Буфер перед сборкой пуст", "buffer_low": "В буфере 1–3 кузова", "stop_paint": "Окраска стоит > 8 мин",
             "stop_asm": "Сборка стоит > 8 мин", "stop_other": "Сварка стоит > 8 мин",
             "paint_slow": "Окраска не успевает", "defect_burst": "Всплеск брака окраски",
             "shortage": "Склад не выдаёт комплектующие", "micro_stops": "Частые короткие остановки"}


class AlertLearner:
    def __init__(self, seeds=(11, 12, 13, 14), eval_share: float = 0.4) -> None:
        pool = [a for s in seeds for a in _detect(s)]
        rnd = random.Random(7)
        rnd.shuffle(pool)
        k = int(len(pool) * eval_share)
        self.eval_pool, self.vote_pool = pool[:k], pool[k:]
        self.by_id = {a.id: a for a in pool}
        self.order = {a.id: i for i, a in enumerate(self.vote_pool)}  # случайный порядок внутри вида — без смещения к началу смены
        self.reset()

    def reset(self) -> None:
        self.table = {b: [0, 0] for b in BUCKET_RU}  # подтвердили, отклонили
        self.version = 0
        self.votes: list[dict] = []
        self.answered: set[str] = set()
        self.curve = [self._evaluate()]

    def muted(self, b: str) -> bool:
        """Глушим вид тревог, только если по нему есть ответы и мы уверены, что его подтверждают редко."""
        c, r = self.table[b]
        return (c + r) >= MIN_VOTES and bool(beta_dist.cdf(SHOW_AT, 1 + c, 1 + r) > MUTE_CONF)

    def shown(self, a: Alert) -> bool:
        return not self.muted(bucket(a))

    def prob(self, a: Alert) -> float:
        c, r = self.table[bucket(a)]
        return (1 + c) / (2 + c + r)  # среднее Beta(1+c, 1+r)

    def _evaluate(self) -> dict:
        """Какие тревоги система показала бы (вероятность ≥ 0,5) и насколько они точны — по правде эмулятора."""
        shown = [a for a in self.eval_pool if self.shown(a)]
        real = [a for a in self.eval_pool if a.truth]
        tp = sum(a.truth for a in shown)
        voted = [(self.by_id[v["alert_id"]], v["verdict"] == "confirm") for v in self.votes]
        agree = sum(self.shown(a) == y for a, y in voted) / len(voted) if voted else None
        return {"votes": len(self.votes), "version": self.version, "agreement": agree,
                "precision": tp / len(shown) if shown else None,
                "recall": tp / len(real) if real else None,
                "shown": len(shown), "total": len(self.eval_pool),
                "false_suppressed": sum(1 for a in self.eval_pool if not a.truth and not self.shown(a))}

    def next_card(self, exclude: set[str] | None = None) -> dict | None:
        exclude = exclude or set()
        left = [a for a in self.vote_pool if a.id not in self.answered and a.id not in exclude]
        if not left:
            return None
        def uncertainty(b: str) -> float:  # дисперсия Beta — чем меньше ответов, тем больше
            c, r = self.table[b]
            al, be = 1 + c, 1 + r
            return al * be / ((al + be) ** 2 * (al + be + 1))
        a = max(left, key=lambda a: (uncertainty(bucket(a)), -self.order[a.id]))  # активное обучение: вид, о котором знаем меньше всего
        hh, mm = divmod(int(a.t % 960) + 8 * 60, 60)
        return {"id": a.id, "type": a.type, "title": a.title, "text": a.text, "time": f"день {int(a.t // 960) + 1}, {hh % 24:02d}:{mm:02d}",
                "model_confidence": round(self.prob(a), 2), "left": len(left)}

    def vote(self, alert_id: str, verdict: str, voter: str = "", simulated: bool = False) -> dict:
        a = self.by_id.get(alert_id)
        if a is None or a in self.eval_pool:
            raise KeyError(alert_id)
        if verdict not in ("confirm", "reject"):
            raise ValueError(verdict)
        y = verdict == "confirm"
        self.table[bucket(a)][0 if y else 1] += 1
        self.version += 1
        self.answered.add(a.id)
        self.votes.append({"alert_id": a.id, "verdict": verdict, "voter": voter, "simulated": simulated,
                           "agrees_with_truth": y == a.truth, "at": time.time()})
        self.curve.append(self._evaluate())
        return self.state()

    def simulate_votes(self, n: int = 10, accuracy: float = 0.9, seed: int = 0) -> dict:
        rnd = random.Random(seed + len(self.votes))
        for _ in range(n):
            card = self.next_card()
            if not card:
                break
            a = self.by_id[card["id"]]
            right = rnd.random() < accuracy
            self.vote(a.id, "confirm" if (a.truth if right else not a.truth) else "reject", voter="симулированный мастер", simulated=True)
        return self.state()

    def state(self) -> dict:
        types = []
        for k, (c, r) in self.table.items():
            mean = (1 + c) / (2 + c + r)  # Beta(1,1): доля подтверждений
            types.append({"type": k, "title": BUCKET_RU[k], "confirmed": c, "rejected": r, "confirm_rate": round(mean, 2),
                          "muted": self.muted(k)})
        human = [v for v in self.votes if not v["simulated"]]
        return {"source": "feedback", "version": f"v{self.version}", "votes": len(self.votes), "human_votes": len(human),
                "simulated_votes": len(self.votes) - len(human), "start": self.curve[0], "now": self.curve[-1],
                "curve": self.curve, "types": types, "left": len([a for a in self.vote_pool if a.id not in self.answered]),
                "note": "Точность считается на отдельном наборе тревог по правде эмулятора (симуляция)."}

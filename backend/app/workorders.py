"""Наряды на ремонт: тревога → причина → наряд (идея победителя ARIA, хакатон Anthropic 2026; реализация своя).

Из событий смены (остановки участков и тревоги) двойник собирает наряд: что случилось, почему (по данным события),
что это стоит (цена минуты простоя участка из двойника), кому и что сделать, в какой срок, приоритет.
Приоритет: «высокий», если участок — ограничитель линии или простой долгий; иначе «обычный».
Статус наряда (открыт → в работе → закрыт) хранится в SQLite и переживает перезапуск.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .db import connect

router = APIRouter(prefix="/api/workorders")
SCHEMA = """CREATE TABLE IF NOT EXISTS workorders (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('open','progress','done')),
  updated_at REAL NOT NULL, note TEXT NOT NULL DEFAULT '');"""
LONG_STOP = 30            # мин: долгий простой — высокий приоритет
_con = None

ROLE = {"welding": "наладчик роботов сварки", "paint": "технолог окраски", "assembly": "слесарь конвейера", "qc": "контролёр ОТК"}
# что проверить: по ключевому слову причины, иначе — общий порядок для участка
PLAYBOOK = [
    ("датчик", "Проверить датчик и кабель, сбросить аварию, прогнать тестовый цикл"),
    ("фильтр", "Заменить фильтры камеры, проверить перепад давления воздуха, осмотреть 3 последних кузова"),
    ("засор", "Заменить фильтры камеры, проверить перепад давления воздуха, осмотреть 3 последних кузова"),
    ("цеп", "Заменить звено цепи, проверить натяжение и смазку конвейера"),
    ("брак", "Осмотреть кузова после окраски, проверить вязкость краски и режим камеры"),
    ("то", "Плановое обслуживание по регламенту, отметить выполненные пункты"),
]
DEFAULT = {"welding": "Диагностика робота ABB: привод, программа, сварочные клещи; сброс аварии и тестовый цикл",
           "paint": "Диагностика окрасочной камеры: распылители, вентиляция, подача краски",
           "assembly": "Диагностика конвейера и постов сборки: привод, цепь, инструмент",
           "qc": "Проверка стенда контроля качества"}


def con():
    global _con
    if _con is None:
        _con = connect()
        _con.executescript(SCHEMA)
    return _con


def _clock(t: float) -> str:
    m = int(t) + 8 * 60
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def _todo(station: str, reason: str) -> str:
    r = reason.lower()
    for key, text in PLAYBOOK:
        if key in r:
            return text
    return DEFAULT.get(station, "Диагностика участка")


def build(scenario: str, seed: int, t: float) -> list[dict]:
    """Наряды по событиям смены до минуты t (новые — сверху)."""
    from .sim.api import STATION_RU, run_payload, station_value
    from .sim.params import STATION_ASSETS
    run = run_payload(scenario, seed)
    value = {r["station"]: r for r in station_value(12)["stations"]}
    out = []
    for e in run["stops"]:
        if e["t"] > t or e.get("planned"):
            continue
        st = e["station"]
        reason = e.get("reason") or "отказ оборудования"
        v = value.get(st)
        loss_cars = (v["loss_per_min"] * e["minutes"]) if v else 0.0
        limit = bool(v and v["limits_output"])
        high = limit or e["minutes"] >= LONG_STOP
        oid = f"{scenario}:{seed}:{st}:{int(e['t'])}"
        out.append({
            "id": oid, "t": e["t"], "time": _clock(e["t"]), "station": st, "station_name": STATION_RU.get(st, st),
            "assets": STATION_ASSETS.get(st, []),
            "alarm": f"{STATION_RU.get(st, st)} остановилась в {_clock(e['t'])}",
            "cause": reason[0].upper() + reason[1:],
            "impact": {"minutes": e["minutes"], "cars": loss_cars, "limits_output": limit, "source": "sim"},
            "todo": _todo(st, reason), "role": ROLE.get(st, "наладчик"),
            "deadline_min": 15 if high else 45, "priority": "high" if high else "normal",
        })
    for a in run.get("alerts", []):
        if a["t"] > t or "брак" not in (a["title"] + a["text"]).lower():
            continue
        oid = f"{scenario}:{seed}:paint-defect:{int(a['t'])}"
        out.append({"id": oid, "t": a["t"], "time": _clock(a["t"]), "station": "paint", "station_name": STATION_RU.get("paint", "Окраска"),
                    "assets": STATION_ASSETS.get("paint", []), "alarm": a["title"], "cause": a["text"],
                    "impact": {"minutes": 0, "cars": 0.0, "limits_output": False, "source": "sim"},
                    "todo": _todo("paint", "брак"), "role": ROLE["paint"], "deadline_min": 30, "priority": "normal"})
    status = {r[0]: (r[1], r[2]) for r in con().execute("SELECT id, status, note FROM workorders").fetchall()}
    for o in out:
        o["status"], o["note"] = status.get(o["id"], ("open", ""))
    order = {"high": 0, "normal": 1}
    return sorted(out, key=lambda o: (o["status"] == "done", order[o["priority"]], -o["t"]))


@router.get("")
def list_orders(scenario: str = "base", seed: int = 7, t: float = Query(960, ge=0, le=960)) -> dict:
    items = build(scenario, seed, t)
    return {"source": "sim", "items": items, "open": sum(o["status"] != "done" for o in items),
            "high": sum(o["priority"] == "high" and o["status"] != "done" for o in items)}


class Status(BaseModel):
    status: str = Field(pattern=r"^(open|progress|done)$")
    note: str = Field("", max_length=200)


@router.post("/{order_id:path}/status")
def set_status(order_id: str, body: Status) -> dict:
    if len(order_id) > 200:
        raise HTTPException(422, "слишком длинный id")
    con().execute("INSERT OR REPLACE INTO workorders VALUES (?,?,?,?)", (order_id, body.status, time.time(), body.note.strip()))
    con().commit()
    return {"ok": True, "id": order_id, "status": body.status}

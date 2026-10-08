"""Разбор брака по шагам (8D, сокращённо до 5 шагов) и проверка эффекта действия.

8D — метод разбора проблем качества, принятый в автопроме (GM, Ford и их поставщики). Здесь он связан с данными:
  1) Проблема — из контрольной карты брака окраски (уровень, норма, особые причины);
  2) Сдерживание — что сделать сразу, чтобы брак не ушёл дальше;
  3) Причины — гипотезы по 6M (оборудование, материал, метод, люди, измерение, среда) и чем каждую проверить;
     то, что данные не доказывают, остаётся гипотезой (пример: замена фильтра 01.10 — совпадение по времени);
  4) Действие — человек записывает, что сделали и с какого дня;
  5) Проверка эффекта — двойник сам сравнивает брак до и после (двухвыборочный тест долей, одностороний):
     «подтверждён» только если брак после ниже и разница не объясняется случайностью (p < 0,01 — строже, т.к. проверяем каждый день),
     и не раньше, чем пройдёт MIN_DAYS рабочих дней. Иначе — «ждём данных» или «не подтверждён».
Действия хранятся в SQLite (таблица capa) и переживают перезапуск.
"""
from __future__ import annotations

import math
import time
from datetime import date as Date
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from scipy.stats import norm

from .db import connect

router = APIRouter(prefix="/api/capa")
MIN_DAYS = 5            # рабочих дней после действия до вывода (на заводе 8D требует 90 дней или 3 партии — здесь демо-масштаб)
BASELINE_DAYS = 20
ALPHA = 0.01           # проверка пересчитывается каждый день — при многократных «подглядываниях» порог строже, иначе случайность подтвердится
SCHEMA = """CREATE TABLE IF NOT EXISTS capa (id INTEGER PRIMARY KEY AUTOINCREMENT, created REAL NOT NULL, start_day TEXT NOT NULL,
  action TEXT NOT NULL, cause TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '');"""
PRESETS = [
    {"id": "filters", "cause": "Оборудование", "text": "Замена фильтров камеры окраски по графику, а не по засору"},
    {"id": "paint_batch", "cause": "Материал", "text": "Входной контроль партии краски (вязкость, срок)"},
    {"id": "booth_mode", "cause": "Метод", "text": "Проверка и фиксация режима камеры (температура, влажность, расход воздуха)"},
    {"id": "prep", "cause": "Люди", "text": "Стандарт подготовки кузова перед окраской (обезжиривание, обдув)"},
    {"id": "service", "cause": "Оборудование", "text": "Обслуживание окрасочной камеры (как действие «Обслужить камеру» в двойнике)"},
]
_con = None


def con():
    global _con
    if _con is None:
        _con = connect()
        _con.executescript(SCHEMA)
    return _con


def _working_points(d0: Date, d1: Date) -> list[dict]:
    """Точки брака окраски по рабочим дням d0..d1 включительно (факт завода или двойник)."""
    from .spc import _day_point
    out, d = [], d0
    while d <= d1:
        p = _day_point(d)
        if p:
            out.append(p)
        d += timedelta(days=1)
    return out


def _baseline(start: Date) -> list[dict]:
    from .spc import _day_point
    pts, k = [], 1
    while len(pts) < BASELINE_DAYS and k <= 60:
        p = _day_point(start - timedelta(days=k))
        if p:
            pts.append(p)
        k += 1
    pts = list(reversed(pts))
    # дни с особой причиной (за границей контрольной карты) в базу «до» не входят: иначе любое действие после
    # аномального дня «подтвердится» само — брак просто вернётся к обычному уровню (возврат к среднему)
    n, d = sum(p["n"] for p in pts), sum(p["defects"] for p in pts)
    pbar = d / n if n else 0.0
    usual = [p for p in pts if not p["n"] or abs(p["defects"] / p["n"] - pbar) <= 3 * math.sqrt(pbar * (1 - pbar) / p["n"])]
    for p in pts:
        p["excluded"] = p not in usual
    return pts


def evaluate(start: Date, today: Date) -> dict:
    """Брак до и после действия и вывод: подтверждён / не подтверждён / ждём данных."""
    base = _baseline(start)
    before = [p for p in base if not p["excluded"]]
    after = _working_points(start, today - timedelta(days=1)) if start < today else []
    nb, db = sum(p["n"] for p in before), sum(p["defects"] for p in before)
    na, da = sum(p["n"] for p in after), sum(p["defects"] for p in after)
    pb = db / nb if nb else 0.0
    pa = da / na if na else None
    res = {"before": {"days": len(before), "n": nb, "defects": db, "p": pb, "excluded_days": [p["day"] for p in base if p["excluded"]]},
           "after": {"days": len(after), "n": na, "defects": da, "p": pa, "fact_days": sum(p["source"] == "fact" for p in after)},
           "min_days": MIN_DAYS}
    if len(after) < MIN_DAYS:
        res.update(verdict="wait", title=f"Ждём данных: {len(after)} из {MIN_DAYS} рабочих дней после действия",
                   text="Вывод об эффекте — только когда наберётся достаточно дней: по одному-двум дням легко принять случайность за успех.")
        return res
    pool = (db + da) / (nb + na)
    se = math.sqrt(pool * (1 - pool) * (1 / nb + 1 / na)) if 0 < pool < 1 else 0.0
    z = (pb - pa) / se if se else 0.0
    pval = float(norm.sf(z))
    res.update(z=z, p_value=pval)
    if pa < pb and pval < ALPHA:
        goal = pa <= 0.02
        res.update(verdict="confirmed", title=f"Эффект подтверждён: брак {100 * pb:.1f}% → {100 * pa:.1f}%".replace(".", ","),
                   text=("Снижение не объясняется случайным разбросом. " + ("Брак в норме — действие можно закрепить в стандарте."
                         if goal else "Но до нормы 2% ещё не дошли — нужна следующая мера.")))
    else:
        res.update(verdict="not_confirmed", title=f"Эффект не подтверждён: брак {100 * pb:.1f}% → {100 * pa:.1f}%".replace(".", ","),
                   text="Разница укладывается в обычный разброс или брак не снизился. Причина, скорее всего, другая — вернитесь к шагу «Причины».")
    if after and res["after"]["fact_days"] < len(after):
        res["demo"] = True
        res["note"] = (f"{len(after) - res['after']['fact_days']} из {len(after)} дней после действия — симуляция двойника: она не знает о вашем действии, "
                       "поэтому вывод здесь — демонстрация метода. На данных завода проверка станет настоящей.")
    return res


def draft(today: Date) -> dict:
    """Черновик разбора из данных: проблема из контрольной карты, сдерживание, гипотезы причин с проверкой."""
    from .spc import paint
    c = paint(today.isoformat())
    special = [p for p in c["points"] if p["signals"]]
    pbar = f"{100 * c['pbar']:.1f}".replace(".", ",")
    problem = (f"Брак окраски в среднем {pbar}% при норме {100 * c['norm']:g}% за последние {len(c['points'])} рабочих дней. "
               + ("Процесс стабилен — это уровень самого процесса, а не отдельные плохие дни." if c["verdict"]["kind"] == "chronic"
                  else c["verdict"]["title"] + "."))
    causes = [
        {"m": "Оборудование", "hypothesis": "Фильтры и режим окрасочной камеры", "check": "Брак до и после замены фильтра; график замен",
         "status": "гипотеза: замена фильтра 01.10 совпала по времени с браком 3,5% — это совпадение, не доказанная причина"},
        {"m": "Материал", "hypothesis": "Партия краски (вязкость, срок)", "check": "Брак по партиям краски", "status": "данных о партиях нет"},
        {"m": "Метод", "hypothesis": "Подготовка кузова перед окраской", "check": "Классы дефектов: пыль, кратеры, подтёки", "status": "классов дефектов в данных нет"},
        {"m": "Люди", "hypothesis": "Разница между сменами", "check": "Брак смены 1 против смены 2", "status": "брак по сменам в данных нет"},
        {"m": "Измерение", "hypothesis": "Контроль находит не все дефекты или считает лишние", "check": "Сверка ОТК и камеры контроля ЛКП", "status": "камера ЛКП подключается во вкладке «Обучение»"},
        {"m": "Среда", "hypothesis": "Температура и влажность в цехе", "check": "Брак против погоды и времени года", "status": "данных нет"},
    ]
    return {"problem": problem, "pbar": c["pbar"], "norm": c["norm"], "spc_kind": c["verdict"]["kind"],
            "special_days": [{"day": p["day"], "p": p["p"], "signals": p["signals"], "source": p["source"]} for p in special],
            "containment": "Усилить контроль кузовов после окраски (100% осмотр) и сразу отправлять дефектные на пост ремонта — пока причина не найдена, брак не должен уйти на сборку.",
            "causes": causes, "presets": PRESETS, "min_days": MIN_DAYS, "source": "calc"}


class NewAction(BaseModel):
    start_day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    action: str = Field(min_length=3, max_length=300)
    cause: str = Field("", max_length=60)
    owner: str = Field("", max_length=80)
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


@router.get("")
def list_actions(today: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict:
    td = Date.fromisoformat(today)
    rows = con().execute("SELECT id, created, start_day, action, cause, owner FROM capa ORDER BY id DESC").fetchall()
    items = [{"id": r[0], "created": r[1], "start_day": r[2], "action": r[3], "cause": r[4], "owner": r[5],
              "check": evaluate(Date.fromisoformat(r[2]), td)} for r in rows]
    return {"draft": draft(td), "actions": items}


@router.post("")
def add_action(body: NewAction) -> dict:
    d, td = Date.fromisoformat(body.start_day), Date.fromisoformat(body.today)
    if d > td + timedelta(days=60):
        raise HTTPException(422, "Дата действия слишком далеко в будущем")
    cur = con().execute("INSERT INTO capa (created, start_day, action, cause, owner) VALUES (?,?,?,?,?)",
                        (time.time(), body.start_day, body.action.strip(), body.cause.strip(), body.owner.strip()))
    con().commit()
    return {"ok": True, "id": cur.lastrowid}


@router.delete("/{item_id}")
def delete_action(item_id: int) -> dict:
    con().execute("DELETE FROM capa WHERE id=?", (item_id,))
    con().commit()
    return {"ok": True}

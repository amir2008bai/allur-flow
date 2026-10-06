"""Копилот: LLM через OpenRouter с вызовом функций, проверкой чисел и офлайн-режимом.

Правила: отвечает коротко, по-русски, ТОЛЬКО числами из результатов функций. Каждое число ответа проверяется
по результатам функций этого хода; непроверенные числа помечаются. Если сеть/ключ/модели недоступны —
работает детерминированный роутер по ключевым словам (офлайн-режим).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import httpx

from .tools import CURRENT_SCENARIO, REGISTRY, SCHEMAS

ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM = """Ты — помощник начальника смены на автозаводе Allur (Костанай), встроенный в цифровой двойник.
Правила:
- Отвечай по-русски, коротко: 2–4 предложения, без markdown-таблиц.
- Любое число бери ТОЛЬКО из результатов функций. Не выдумывай и не пересчитывай числа.
- Перед ответом вызови нужные функции. Если говоришь о конкретном участке — вызови focus_3d.
- Отличай факт (ТЗ), симуляцию и прогноз; если данных нет — так и скажи.
- Замену фильтра не называй причиной брака: это совпадение по времени.
- Давай практический совет: что сделать сейчас.
- Не выводи новые числа (разности, суммы) — только те, что есть в результатах."""


def _env() -> dict:
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    env.update({k: v for k, v in os.environ.items() if k.startswith("OPENROUTER")})
    return env


def _models(env: dict) -> list[str]:
    main = env.get("OPENROUTER_MODEL", "qwen/qwen3.8-27b:free")
    fb = [m.strip() for m in env.get("OPENROUTER_FALLBACK_MODELS", "").split(",") if m.strip()]
    return [main, *fb]


NUM_RE = re.compile(r"(?<![\w.])[-−+]?\d+(?:[.,]\d+)?")


def _numbers(text: str) -> set[float]:
    out = set()
    for m in NUM_RE.findall(text):
        try:
            out.add(round(abs(float(m.replace("−", "-").replace(",", "."))), 1))
        except ValueError:
            pass
    return out


def verify_numbers(answer: str, tool_results: list[dict]) -> list[str]:
    """Числа ответа, которых нет в результатах функций (с точностью до 0,1). Мелкие порядковые числа (≤10) не проверяем."""
    allowed = _numbers(json.dumps(tool_results, ensure_ascii=False))
    allowed |= {round(x, 0) for x in allowed}
    bad = []
    for m in NUM_RE.findall(answer):
        v = round(abs(float(m.replace("−", "-").replace(",", "."))), 1)
        if v <= 10 and float(v).is_integer():
            continue
        if v not in allowed and round(v, 0) not in allowed:
            bad.append(m)
    return bad


def _call_tool(name: str, args: dict) -> dict:
    fn = REGISTRY.get(name)
    if fn is None:
        return {"error": f"нет функции {name}"}
    try:
        return fn(**(args or {}))
    except TypeError:
        return fn()


def _chat(model: str, messages: list[dict], key: str) -> dict:
    r = httpx.post(URL, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                 "X-Title": "Allur Flow"},
                   json={"model": model, "messages": messages, "tools": SCHEMAS, "tool_choice": "auto",
                         "max_tokens": 900, "temperature": 0.2}, timeout=25)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["choices"][0]["message"]


def ask_llm(question: str, history: list[dict] | None = None) -> dict:
    env = _env()
    key = env.get("OPENROUTER_API_KEY", "")
    if not key.startswith("sk-or-"):
        raise RuntimeError("нет ключа OpenRouter")
    errors = []
    for model in _models(env):
        messages = [{"role": "system", "content": SYSTEM}, *(history or [])[-6:], {"role": "user", "content": question}]
        tool_log, actions = [], []
        try:
            for _ in range(4):
                msg = _chat(model, messages, key)
                calls = msg.get("tool_calls") or []
                if not calls:
                    answer = (msg.get("content") or "").strip()
                    if not answer:
                        raise RuntimeError("пустой ответ")
                    return {"answer": answer, "model": model, "mode": "llm", "tools": tool_log, "actions": actions,
                            "unverified": verify_numbers(answer, [t["result"] for t in tool_log])}
                messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
                for c in calls:
                    name = c["function"]["name"]
                    try:
                        args = json.loads(c["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    res = _call_tool(name, args)
                    if isinstance(res, dict) and res.get("action"):
                        actions.append(res["action"])
                    tool_log.append({"name": name, "args": args, "result": res})
                    messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(res, ensure_ascii=False)})
            raise RuntimeError("слишком много вызовов функций")
        except Exception as e:  # пробуем следующую модель
            errors.append(f"{model}: {str(e)[:120]}")
    raise RuntimeError("; ".join(errors))


# ── Офлайн-режим: без сети и LLM ────────────────────────────────────────────
def _ru(x) -> str:
    """Число по-русски: десятичная запятая."""
    return str(x).replace(".", ",")


def ask_offline(question: str) -> dict:
    q = question.lower()
    tools, actions = [], []

    def use(name, **args):
        res = _call_tool(name, args)
        tools.append({"name": name, "args": args, "result": res})
        if isinstance(res, dict) and res.get("action"):
            actions.append(res["action"])
        return res

    if any(w in q for w in ("брак", "окраск", "переделк", "фильтр")):
        p = use("get_paint_quality"); use("focus_3d", zone="paint")
        ans = (f"Брак окраски — {_ru(p['брак_окраски_оценка_pct'])}% при норме 2% (вилка {_ru(p['интервал_90_pct'][0])}–{_ru(p['интервал_90_pct'][1])}%). "
               f"Это {_ru(p['переделок_за_смену'])} переделки за смену вместо {_ru(p['переделок_при_норме'])}. "
               f"Замена фильтра 01.10 — совпадение по времени, причина не доказана: стоит проверить классы дефектов.")
    elif any(w in q for w in ("сделать", "действ", "больше", "вмешат", "совет")):
        c = use("compare_actions"); best = c["действия"][0]; use("focus_3d", zone="paint")
        ans = (f"Лучшее действие — «{_ru(best['действие'])}»: +{_ru(best['прирост_машин_за_смену'])} машин за смену "
               f"(интервал {_ru(best['интервал_95'][0])}…{_ru(best['интервал_95'][1])}, симуляция). Остальные варианты дают меньше.")
    elif any(w in q for w in ("oee", "оее", "данн", "тз", "план")):
        d = use("get_data_findings")
        top = [x for x in d["выводы"] if x["важность"] in ("critical", "warn")][:3]
        ans = " ".join(f"{x['заголовок']}: {x['суть']}" for x in top)
    elif any(w in q for w in ("учит", "обуч", "тревог")):
        s = use("get_learning_status")
        ans = (f"Точность тревог: было {_ru(s['точность_тревог_было_pct'])}%, сейчас {_ru(s['точность_тревог_сейчас_pct'])}%. "
               f"Прогноз с обучением ошибается на {_ru(s['прогноз_ошибка_меньше_чем_без_обучения_pct'])}% меньше, чем без обучения.")
    else:
        s = use("get_line_status")
        zone = {"Сварка": "welding", "Окраска": "paint", "Сборка": "assembly", "Контроль качества": "qc"}.get(s["узкое_место"], "paint")
        use("focus_3d", zone=zone)
        ans = (f"Сейчас линия даёт {_ru(s['годных_за_смену'])} годных за смену при плане {_ru(s['план_за_смену'])}. "
               f"Узкое место — {_ru(s['узкое_место'])} ({_ru(s['узкое_место_доля_времени_pct'])}% времени). Брак окраски {_ru(s['брак_окраски_pct'])}%.")
    return {"answer": ans, "model": "офлайн-шаблон", "mode": "offline", "tools": tools, "actions": actions,
            "unverified": verify_numbers(ans, [t["result"] for t in tools])}


def ask(question: str, history: list[dict] | None = None, offline: bool = False, scenario: str = "paint_degradation") -> dict:
    CURRENT_SCENARIO.set(scenario)
    if not offline:
        try:
            return ask_llm(question, history)
        except Exception as e:
            res = ask_offline(question)
            res["fallback_reason"] = str(e)[:300]
            return res
    return ask_offline(question)

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

from .tools import CURRENT_SCENARIO, CURRENT_SEED, CURRENT_VIEW, REGISTRY, SCHEMAS

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


NUM_RE = re.compile(r"(?<![\w.:])([-−+]?)(\d+(?:[.,]\d+)?)(?![\d:])")
UNIT_WORDS = [("pct", ("%", "процент", "percent", "п.п")), ("money", ("₸", "тг", "тенге", "млн", "млрд", "тыс")),
              ("cars", ("маш", "авто", "кузов", "car")), ("min", ("мин", "min"))]
SCALE = {"млрд": 1e9, "млн": 1e6, "тыс": 1e3}


def _unit_after(text: str, end: int) -> tuple[str | None, float]:
    tail = text[end:end + 14].lower().lstrip()
    for unit, words in UNIT_WORDS:
        for w in words:
            if tail.startswith(w):
                return unit, SCALE.get(w, 1.0)
    return None, 1.0


def _key_unit(key: str) -> str | None:
    k = key.lower()
    if "pct" in k or "%" in k or "доля" in k:
        return "pct"
    if "тг" in k or "₸" in k or "маржа" in k:
        return "money"
    if "мин" in k:
        return "min"
    if any(w in k for w in ("машин", "годных", "прирост", "план", "не_хватает", "delta", "good", "интервал", "выпуск")):
        return "cars"
    return None


def _allowed(obj, key: str = "", out: list | None = None) -> list[tuple[float, str | None]]:
    """Все числа из результатов функций со знаком и единицей (по имени поля)."""
    out = [] if out is None else out
    if isinstance(obj, dict):
        for k, v in obj.items():
            _allowed(v, f"{key}.{k}", out)
    elif isinstance(obj, list):
        for v in obj:
            _allowed(v, key, out)
    elif isinstance(obj, bool):
        pass
    elif isinstance(obj, (int, float)):
        out.append((float(obj), _key_unit(key)))
    elif isinstance(obj, str):
        for m in NUM_RE.finditer(obj):
            v = float(m.group(2).replace(",", ".")) * (-1 if m.group(1) in ("-", "−") else 1)
            out.append((v, _unit_after(obj, m.end())[0] or _key_unit(key)))
    return out


def _matches(v: float, decimals: bool, a: float, money: bool) -> bool:
    if money:
        return abs(abs(a) - v) <= 0.015 * max(abs(a), 1)
    if decimals:
        return abs(abs(a) - v) < 0.051
    return round(abs(a)) == v or abs(abs(a) - v) < 0.051


def verify_numbers(answer: str, tool_results: list[dict]) -> list[str]:
    """Числа ответа, которых нет в результатах функций с ТЕМ ЖЕ смыслом: значение, единица (машины/%/₸/мин) и знак.
    Пропускаем только мелкие целые без единицы и знака (порядковые: «2 действия», «3 участка»)."""
    allowed = _allowed(tool_results)
    bad = []
    for m in NUM_RE.finditer(answer):
        sign, raw = m.group(1), m.group(2)
        v = float(raw.replace(",", "."))
        unit, scale = _unit_after(answer, m.end())
        decimals = "," in raw or "." in raw
        if not decimals and v <= 10 and unit is None and not sign:
            continue
        v *= scale
        ok = False
        for a, au in allowed:
            if unit and au and unit != au:
                continue
            if sign == "+" and a < 0 or sign in ("-", "−") and a > 0:
                continue
            if _matches(v, decimals and scale == 1, a, unit == "money"):
                ok = True
                break
        if not ok:
            bad.append(m.group(0).strip())
    return bad


def verified_facts(tool_log: list[dict]) -> list[dict]:
    """Карточка цифр, которую формирует СЕРВЕР из результата расчёта (не из текста ИИ): знак, интервал, статус."""
    out = []
    for t in tool_log:
        r = t.get("result") or {}
        if t["name"] == "compare_actions":
            acts = r.get("действия") or []
            if r.get("лучшая_пара"):
                lp = r["лучшая_пара"]
                out.append({"label": " + ".join(lp["действия"]), "value": f"+{_ru(lp['прирост'])} машин/смену", "note": "лучшая пара" + (" · план выполнен" if lp.get("план_выполнен") else "")})
            for o in acts[:3]:
                lo, hi = o["интервал_95"]
                status = "эффект подтверждён" if lo > 0 else "вредит" if hi < 0 else "не подтверждён — интервал проходит через 0"
                out.append({"label": o["действие"], "value": f"{'+' if o['прирост_машин_за_смену'] >= 0 else '−'}{_ru(abs(o['прирост_машин_за_смену']))} машин/смену",
                            "note": f"{_ru(lo)}…{_ru(hi)} · {status}"})
            if not acts:
                out.append({"label": "Ничего не менять", "value": "0", "note": "ни одно действие не даёт подтверждённого прироста"})
        elif t["name"] == "get_line_status":
            out.append({"label": "Годных за смену", "value": f"{_ru(r['годных_за_смену'])} из {r['план_за_смену']}", "note": f"узкое место — {r['узкое_место']}"})
    return out[:5]


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
    cache: dict[str, dict] = {}   # расчёт отделён от объяснения: сбой модели не повторяет и не теряет расчёт
    for model in _models(env):
        v = CURRENT_VIEW.get() or {}
        ctx = "; ".join(f"{k}: {v[k]}" for k in ("tab", "date", "time", "scenario_name", "selected_zone", "incident", "stress") if v.get(k))
        sys = SYSTEM + ((chr(10) + f"Сейчас на экране пользователя — {ctx}. Если вопрос про «сейчас/это/здесь» — это про экран; вызови get_current_view.") if ctx else "")
        messages = [{"role": "system", "content": sys}, *(history or [])[-6:], {"role": "user", "content": question}]
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
                            "unverified": verify_numbers(answer, [t["result"] for t in tool_log]), "verified": verified_facts(tool_log),
                            "tool_calls_computed": len(cache)}
                messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
                for c in calls:
                    name = c["function"]["name"]
                    try:
                        args = json.loads(c["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    ck = name + json.dumps(args, sort_keys=True, ensure_ascii=False)
                    if ck not in cache:
                        cache[ck] = _call_tool(name, args)
                    res = cache[ck]
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

    if any(w in q for w in ("сейчас", "происходит", "на экране", "здесь", "испытан")) and CURRENT_VIEW.get():
        v = use("get_current_view")
        st = v.get("состояния_сейчас", {})
        bad = [f"{k} — {s}" for k, s in st.items() if s in ("стоит", "некуда отдать")]
        parts = [f"{v.get('date', '')} {v.get('time', '')}".strip()]
        if v.get("incident"): parts.append(f"Идёт эпизод: {v['incident']}")
        elif bad: parts.append("; ".join(bad))
        else: parts.append("Линия работает без потерь")
        if v.get("stress"): parts.append(f"Открыто испытание: {v['stress']}")
        ans = ". ".join(p for p in parts if p) + "."
        zone = v.get("selected_zone_id")
        if zone: use("focus_3d", zone=zone)
    elif any(w in q for w in ("брак", "окраск", "переделк", "фильтр")):
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
            "unverified": verify_numbers(ans, [t["result"] for t in tools]), "verified": verified_facts(tools)}


def ask(question: str, history: list[dict] | None = None, offline: bool = False, scenario: str = "paint_degradation",
        seed: int = 7, view: dict | None = None) -> dict:
    CURRENT_SCENARIO.set(scenario)
    CURRENT_SEED.set(seed)
    CURRENT_VIEW.set(view or {})
    if not offline:
        try:
            return ask_llm(question, history)
        except Exception as e:
            res = ask_offline(question)
            res["fallback_reason"] = str(e)[:300]
            return res
    return ask_offline(question)

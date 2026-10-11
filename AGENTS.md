# AGENTS.md — правила проекта Allur Flow

Читай этот файл, затем `docs/dev/PLAN.md` и `docs/dev/PROGRESS.md` перед любой работой. Продолжай со следующего невыполненного шага в `docs/dev/PLAN.md`. После каждого завершённого шага: обнови `docs/dev/PLAN.md` (галочка), допиши `docs/dev/PROGRESS.md`, сделай git-коммит.

## Что это
Цифровой двойник автозавода Allur (Костанай) для кейса №2 Qostanai Industry Hackathon.
Это помощник начальника смены: где проблема → как пойдёт по линии → какое действие даст больше машин → сотрудник подтверждает «да/нет» → система учится. Главный сценарий — брак окраски.

Источники:
- ТЗ: `data/raw/case_brief.pdf`
- тестовые данные: `data/raw/test_data.docx`
- исследование: `../reports/Стек цифрового двойника Allur.md`, `../handoff/AI_AGENT_CONTEXT.md`
- документ решения: `../Allur Flow — проект.docx`

Пользователь не программист и общается на русском. Весь интерфейс на русском.

## Стек (зафиксирован, без согласования не менять)
- Backend: Python **3.12** (`py -3.12`), venv в `backend/.venv`, версии в `backend/requirements.txt` (точные пины).
  FastAPI, Pydantic 2, SimPy 4.1.2, numpy, scipy, River 0.26.1. Позже: TimescaleDB, EMQX, Node-RED (Docker), TimesFM 3.0, Chronos-2, TSPulse, LightGBM, MLflow, Prefect, Evidently.
- Frontend: Vite + React **19.3.0 (точно, без ^)** + TypeScript, three **0.186.1**, @react-three/fiber **9.8.1**, drei 10.7.x, @react-three/postprocessing 3.1.x, @xyflow/react 12, ECharts 6, Zustand 5, Motion. PWA.
  R3F 9.8.1 требует react <19.4, postprocessing требует three <0.187. Используй `npm install --save-exact`. Не запускай `npm update`.
- LLM-копилот: OpenRouter, ключ в `.env` (ключ НИКОГДА не печатать и не коммитить). Модель `nvidia/nemotron-3.5-lightning:free` (быстрая), запасные — Qwen3.8 и Nemotron Super (см. `.env`). Читай `.env` в UTF-8; в Git Bash кириллицу в curl не отправлять — использовать Python.

## Правила честности данных (обязательно)
1. У каждого числа есть метка источника: `fact` (из DOCX) / `calc` (расчёт по фактам) / `assumption` (допущение) / `sim` (симуляция) / `forecast` (прогноз) / `feedback` (ответ человека).
2. OEE по DOCX не вычисляется (нет идеального цикла). В симуляции — одно число на линию с меткой допущения.
3. Выпуск считаем один раз — на выходе контроля качества. Выпуск и брак участков не суммировать как «машины».
4. План 4800 против 5500 — «несогласованность плана», а не недовыпуск.
5. Замена фильтра и брак окраски — совпадение по времени, не причина.
6. Конвейер-03 (55 мин) — в симуляции это смоделированный инцидент, не реконструкция.
7. Копилот не придумывает числа: только из результатов функций, с чипом источника.
8. TimesFM сам не учится; учатся калибровка, онлайн-модели (River) и дообучение (LoRA). Прогноз записывается ДО факта.

## Структура
- `backend/app/` — код сервера; `backend/tests/` — pytest
- `frontend/` — веб-интерфейс
- `data/raw/` — исходные файлы кейса (не изменять)

## Команды
- Тесты: `cd backend && .venv/Scripts/python -m pytest -q`
- Сервер: `cd backend && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000`
- Фронтенд: `cd frontend && npm run dev` (порт 5173, прокси /api → 8000)

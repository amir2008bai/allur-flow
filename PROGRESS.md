# PROGRESS.md — журнал работы

## 2026-10-05 · Сессия 1 · Этап 1 (каркас и факты) — ГОТОВ
Сделано:
- Структура проекта, git, Python 3.12 venv (`backend/.venv`), точные пины в `backend/requirements.txt`.
- `backend/app/ingest_docx.py`: импорт 4 таблиц DOCX по заголовкам + дополнительные вводные (нормы) с валидацией.
- `backend/app/findings.py`: 15 выводов с метками источника — брак по участкам (байес, Jeffreys: окраска P(>2%)=0,99, сварка 0,61, сборка 0,21), план 4800/5500, OEE не вычисляется (Performance 100,4–102,8% при плановом темпе), загрузка = часы/8, сверка простоев с недоработкой линий, баланс потока (+19 кузовов), RTY, «строка = смена», фильтр — гипотеза.
- `backend/app/main.py`: `/api/health`, `/api/facts`, `/api/findings`. 7 тестов pytest зелёные.
- Фронтенд: Vite 8.3.2 + React 19.3.0 + TS 6.0.3 + Tailwind 4.3.3 + Zustand 5.0.15 (`.npmrc` save-exact). Страница «Факты из ТЗ»: KPI, маршрут с фильтром по участку, карточки выводов с бейджами источника, исходные таблицы. Проверено в браузере.
- Запуск для превью: `../.claude/launch.json` (backend через venv python, frontend через `node node_modules/vite/bin/vite.js <dir>` — `npm --prefix` на Windows не стартовал).
- OpenRouter-ключ в `.env` проверен: qwen3.8-27b:free, nemotron-3.5-lightning:free, nemotron-3-super:free отвечают по-русски (Qwen иногда даёт 429 — нужен fallback). Лимит аккаунта: 50 запросов/день.

Следующий шаг: Этап 2.1 — схема событий в SQLite, затем 2.2 SimPy-линия.

Заметки:
- Железо: RTX 3050 Laptop 4 ГБ (TimesFM-инференс ок, дообучение — Colab). Docker установлен, демон не запущен.
- three/R3F ещё не установлены — ставить на этапе 3 с точными версиями из AGENTS.md.

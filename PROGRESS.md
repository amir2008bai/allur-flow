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

## 2026-10-05 · Сессия 1 · Правка UX + Этап 2 (симуляция и KPI) — ГОТОВ
- Факты из ТЗ упрощены по просьбе пользователя: короткий заголовок + одно число + одна строка простым языком (`backend/app/plain.py`), детали под «Подробнее», заметки — компактным списком, исходные таблицы свёрнуты. Пользователь просит: КРАТКО, без умных слов.
- `backend/app/sim/params.py`: станции, буферы, допущения A1–A7, сценарии (base, paint_degradation, conveyor_break), вмешательства (paint_service, second_repair_post, pbs_buffer).
- `backend/app/sim/engine.py`: SimPy-линия — конечные буферы, состояния working/starved/blocked/down, отказы по наработке, принудительные остановки, деградация, петля окраски (точечный ремонт вне линии / перекраска / списание после 2 проходов), CRN-потоки по (станция, назначение). ~16 мс на прогон 2 смен.
- Калибровка: base ≈ 118,6 годных/смену (DOCX 115–121), брак участков ≈ DOCX.
- `kpi.py`: KPI по событиям + метод активных периодов (sole/shifting, timeline 10 мин). OEE — допущение A7: идеальный цикл 3,4 мин (план 120 = OEE 85%) → base ≈ 84%, деградация ≈ 82%.
- `whatif.py`: CRN, 20 реплик, парный t-CI. На paint_degradation: «Обслужить камеру» +7,9 [6,6; 9,3] машин/смену; буфер +6 мест — не значимо; второй пост ремонта — 0.
- `db.py`: SQLite WAL — runs, events (source/provenance обязательны), forecasts (CHECK прогноз до факта), feedback, twin_params, model_versions. Прогоны API пишутся в журнал.
- `sim/api.py`: /api/sim/meta, /run, /whatif, /stream (SSE). Replay-бандлы: `backend/scripts/export_bundles.py` → `frontend/public/bundles/` (перевыгружать после изменения модели!).
- Фронтенд: вкладка «Двойник» (`TwinPage.tsx`, `source.ts` — live с откатом на replay): сценарии, 4 плитки, полосы состояний участков, карточки «Что будет, если…», допущения под спойлером.
- 14 тестов pytest зелёные.

Следующий шаг: Этап 3.1 — layout.json + Zustand, затем 2D (React Flow) и 3D (R3F). Установить three 0.186.1, @react-three/fiber 9.8.1, drei 10.7.x, postprocessing 3.1.x, @xyflow/react 12, echarts 6 точными версиями.
Заметка: uvicorn --reload в превью не всегда подхватывает правки — перезапускать backend.

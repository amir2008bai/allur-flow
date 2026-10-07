# Allur Flow — цифровой двойник автозавода Allur

Прототип для кейса №2 Qostanai Industry Hackathon. Правила и стек — `AGENTS.md`, план — `PLAN.md`, журнал — `PROGRESS.md`.

## Запуск (Windows)
1. Сервер:
   ```
   cd backend
   .venv\Scripts\python -m uvicorn app.main:app --port 8000
   ```
2. Интерфейс (в другом окне):
   ```
   cd frontend
   npm run dev
   ```
3. Открыть http://localhost:5173

Первая установка: `py -3.12 -m venv backend\.venv`, `backend\.venv\Scripts\pip install -r backend\requirements.txt`, `cd frontend && npm ci`.
Ключ OpenRouter — в файле `.env` (не коммитится): скопируйте `.env.example` в `.env` и впишите свой ключ. Без ключа копилот работает офлайн.

## Приложение на телефоне и ПК (PWA)
Allur Flow устанавливается как приложение и открывается без интернета (Двойник и Испытания — на записанных прогонах).

1. Собрать интерфейс и запустить сервер — он отдаёт и API, и интерфейс с одного адреса:
   ```
   cd frontend && npm run build
   cd ..\backend
   .venv\Scripts\python -m uvicorn app.main:app --port 8000
   ```
2. Открыть http://localhost:8000 в Chrome/Edge → значок «Установить приложение» в адресной строке (на телефоне: меню ⋮ → «Добавить на главный экран»; iPhone/Safari: «Поделиться» → «На экран „Домой“»).
3. Без сервера приложение откроется из кеша и покажет плашку «Офлайн-режим». Копилоту, загрузке данных, дообучению и голосованию нужен сервер — там будет «Нужно подключение к серверу».
4. Новая версия не перезагружает страницу сама: появится плашка «Доступна новая версия — Обновить».

Важно: service worker работает только по **HTTPS** или на `localhost`. С телефона по адресу `http://192.168.x.x:8000` приложение откроется, но не установится и не будет работать офлайн — нужен HTTPS (см. Docker ниже).

`npm run dev` (порт 5173) — для разработки, там service worker выключен.

Записанные прогоны (replay) лежат в `frontend/public/bundles/`. После изменения модели их нужно перевыгрузить: `backend\.venv\Scripts\python backend\scripts\export_bundles.py` (только «Испытания»: `--only-stress`).

## Docker (одной командой, с HTTPS)
Нужен Docker Desktop (Compose 2.24+).
```
copy .env.example .env      # вписать ключ OpenRouter (необязательно) и при желании ALLUR_DOMAIN
docker compose up -d --build
```
- Откроется https://localhost (сертификат локальный — браузер попросит подтвердить один раз).
- `app` — Python 3.12 + собранный интерфейс; тяжёлый `requirements-ai.txt` (PyTorch) не ставится: результаты TimesFM уже в `data/tsfm_results.json`.
- `caddy` — HTTPS и сжатие перед `app`.
- Голоса, калибровка, новые версии моделей и загруженные данные хранятся в томе `allur-data` и переживают перезапуск. Секреты — только в `.env`, в образ он не попадает (`.dockerignore`).
- Остановить: `docker compose down` (данные останутся; `down -v` — удалит и их).

## Деплой на сайт (только после согласования с владельцем проекта)
1. Сервер Linux с Docker, открыты порты 80 и 443.
2. DNS: A-запись домена (например, `allur.example.kz`) → IP сервера.
3. На сервере: скопировать проект, создать `.env`, вписать `ALLUR_DOMAIN=allur.example.kz` (и ключ OpenRouter, если нужен).
4. `docker compose up -d --build` — Caddy сам получит сертификат Let's Encrypt.
5. Проверить: `https://<домен>/api/health` → `{"status":"ok"}`, затем установка приложения и QR на `/vote` (он берёт адрес сайта сам).
6. Реальные данные завода на публичный сервер не загружать без решения владельца.

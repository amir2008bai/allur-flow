#!/usr/bin/env bash
# Allur Flow: установка и запуск на Linux / macOS (нужны Python 3.12 и Node 20+). Открыть: http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3.12}; command -v "$PY" >/dev/null || PY=python3
[ -d backend/.venv ] || "$PY" -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements.txt
(cd frontend && npm ci --silent && npm run build)
[ -f .env ] || cp .env.example .env     # ключ OpenRouter можно вписать позже; без него ИИ отвечает быстрыми ответами
exec backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

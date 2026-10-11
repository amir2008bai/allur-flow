# Allur Flow: один контейнер — FastAPI отдаёт и API, и собранный интерфейс.
# Тяжёлые requirements-ai.txt (PyTorch, TimesFM) НЕ ставим: их результаты уже лежат в data/tsfm_results.json.

# --- 1. Сборка интерфейса ---
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. Сервер ---
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    ALLUR_FRONTEND_DIST=/app/frontend/dist
# libgomp1 нужен LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY backend/app backend/app
COPY backend/scripts backend/scripts
# только данные из git: исходники кейса, модели, результаты TimesFM. Данные завода (uploads) в образ не попадают.
COPY data/raw data/raw
COPY data/models data/models
COPY data/line.json data/tsfm_results.json data/stack_results.json data/validation_real.json data/
COPY --from=frontend /src/frontend/dist frontend/dist
RUN useradd --create-home allur && chown -R allur /app/data
USER allur
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

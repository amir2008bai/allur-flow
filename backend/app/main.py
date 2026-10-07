from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from .findings import all_findings
from .dataset import active_facts
from .schemas import Facts, Finding
from .copilot.api import router as copilot_router
from .learn.api import router as learn_router
from .sim.api import router as sim_router
from .stress_api import router as stress_router
from .data_api import router as data_router

DATA = Path(__file__).resolve().parents[2] / "data" / "raw" / "test_data.docx"

app = FastAPI(title="Allur Flow API")
app.add_middleware(GZipMiddleware, minimum_size=1024)   # JSON и JS сжимаются; поток SSE Starlette не сжимает
app.include_router(sim_router)
app.include_router(learn_router)
app.include_router(copilot_router)
app.include_router(stress_router)
app.include_router(data_router)


@lru_cache
def facts() -> Facts:
    return active_facts()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/facts", response_model=Facts)
def get_facts() -> Facts:
    return facts()


@app.get("/api/findings", response_model=list[Finding])
def get_findings() -> list[Finding]:
    return all_findings(facts())


# --- Собранный интерфейс (frontend/dist) с того же адреса, что и API: нужно для PWA и деплоя. ---
# Объявлено последним: все /api/* маршруты выше имеют приоритет.
DIST_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "dist"
NO_CACHE = {"Cache-Control": "no-cache"}
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


def _dist() -> Path:
    return Path(os.environ.get("ALLUR_FRONTEND_DIST") or DIST_DEFAULT).resolve()


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "Нет такого адреса API")
    dist = _dist()
    if not (dist / "index.html").is_file():
        raise HTTPException(404, "Интерфейс не собран: cd frontend && npm run build")
    f = (dist / path).resolve()
    if path and f.is_file() and f.is_relative_to(dist):
        # файлы с хешем в имени не меняются; sw.js, манифест и записи replay — всегда проверять свежесть
        return FileResponse(f, headers=IMMUTABLE if path.startswith("assets/") else NO_CACHE)
    if "." in path.rsplit("/", 1)[-1]:
        raise HTTPException(404, "Файл не найден")   # нет файла — не подсовываем index.html вместо JSON/картинки
    return FileResponse(dist / "index.html", headers=NO_CACHE)   # /, /vote и др. — маршрутизация на клиенте

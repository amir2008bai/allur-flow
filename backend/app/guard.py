"""Защита для публичного демо: PIN администратора на изменения и лимит вопросов к ИИ.

- ALLUR_ADMIN_PIN (переменная окружения или .env): если задан, любые POST/PUT/PATCH/DELETE в /api требуют заголовок
  X-Admin-PIN. Открыты без PIN только безопасные для жюри действия: вопрос ИИ-помощнику, ответ «да / нет» на тревогу,
  предпросмотр файла. Без ALLUR_ADMIN_PIN (локальный запуск) — всё как раньше.
- Лимит вопросов к ИИ: ALLUR_COPILOT_LIMIT вопросов за 10 минут с одного адреса (по умолчанию 30) — защита ключа и квоты.
"""
from __future__ import annotations

import hmac
import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

OPEN_PATHS = ("/api/copilot", "/api/learn/alerts/vote", "/api/data/preview")
WINDOW_S = 600
ENV = Path(__file__).resolve().parents[2] / ".env"


def _env(name: str, default: str = "") -> str:
    if os.environ.get(name):
        return os.environ[name]
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name:
                return v.strip()
    return default


class Guard(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    async def dispatch(self, request: Request, call_next):
        path, method = request.url.path, request.method
        if path.startswith("/api/") and method in ("POST", "PUT", "PATCH", "DELETE"):
            pin = _env("ALLUR_ADMIN_PIN")
            if pin and not path.startswith(OPEN_PATHS):
                given = request.headers.get("x-admin-pin", "")
                if not hmac.compare_digest(given.encode(), pin.encode()):
                    return JSONResponse({"detail": "pin_required", "message": "Нужен PIN администратора"}, status_code=403)
            if path.startswith("/api/copilot"):
                limit = int(_env("ALLUR_COPILOT_LIMIT", "30") or 30)
                ip = request.client.host if request.client else "?"
                now = time.time()
                with self._lock:
                    q = self._hits[ip]
                    while q and now - q[0] > WINDOW_S:
                        q.popleft()
                    if len(q) >= limit:
                        return JSONResponse({"detail": "rate_limited", "message": "Слишком много вопросов — подождите несколько минут"}, status_code=429)
                    q.append(now)
        return await call_next(request)

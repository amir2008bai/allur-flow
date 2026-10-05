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
Ключ OpenRouter — в файле `.env` (не коммитится).

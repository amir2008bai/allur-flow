@echo off
rem Allur Flow: установка и запуск в один клик (Windows). Нужны Python 3.12 и Node.js 20+.
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>&1
if errorlevel 1 (
  echo Нужен Python 3.12: https://www.python.org/downloads/  ^(при установке отметьте "Add to PATH"^)
  pause & exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo Нужен Node.js 20 или новее: https://nodejs.org/
  pause & exit /b 1
)

if exist backend\.venv\Scripts\python.exe goto deps_ok
echo [1/4] Ставлю Python-зависимости (один раз, 2-5 минут)...
py -3.12 -m venv backend\.venv
if errorlevel 1 (
  echo Нужен именно Python 3.12: py -3.12 не найден.
  pause & exit /b 1
)
backend\.venv\Scripts\python -m pip install -q --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 goto fail
:deps_ok

if exist frontend\node_modules goto node_ok
echo [2/4] Ставлю зависимости сайта (один раз)...
pushd frontend
call npm ci --no-audit --no-fund
popd
:node_ok

if exist frontend\dist\index.html goto build_ok
echo [3/4] Собираю сайт...
pushd frontend
call npm run build
popd
if not exist frontend\dist\index.html goto fail
:build_ok

if exist .env goto env_ok
copy .env.example .env >nul
echo.
echo Ключ OpenRouter включает свободные ответы ИИ-помощника (https://openrouter.ai/keys).
echo Без ключа всё остальное работает, а помощник отвечает быстрыми ответами по расчётам двойника.
set "KEY="
set /p "KEY=Вставьте ключ и нажмите Enter (или просто Enter, чтобы пропустить): "
if not defined KEY goto env_ok
powershell -NoProfile -Command "$k=$env:KEY; $t=(Get-Content -Raw -Encoding UTF8 .env) -replace '(?m)^OPENROUTER_API_KEY=.*$', ('OPENROUTER_API_KEY=' + $k); [IO.File]::WriteAllText((Resolve-Path .env), $t)"
:env_ok

echo [4/4] Запускаю Allur Flow: http://localhost:8000  (закрыть — Ctrl+C или закрыть это окно)
start "" cmd /c "timeout /t 6 >nul & start http://localhost:8000"
backend\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
goto :eof

:fail
echo.
echo Не получилось установить. Пришлите текст ошибки выше разработчикам.
pause
exit /b 1

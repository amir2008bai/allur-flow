@echo off
rem Одна команда проверки: тесты, метрики против базовых подходов, результаты JSON/CSV -> results\RESULTS.md
chcp 65001 >nul
cd /d "%~dp0"
if not exist backend\.venv\Scripts\python.exe (
  echo Сначала установка: start.bat
  exit /b 1
)
set PYTHONIOENCODING=utf-8
backend\.venv\Scripts\python backend\scripts\verify.py

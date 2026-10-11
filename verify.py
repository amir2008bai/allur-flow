"""Одна команда проверки Allur Flow: тесты -> метрики против базовых подходов -> results/RESULTS.md (+ JSON/CSV).

Запуск:  python verify.py   (или verify.bat на Windows). Нужна установка: start.bat или backend/.venv с requirements.txt.
"""
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
venv = root / "backend" / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
python = str(venv) if venv.exists() else sys.executable
sys.exit(subprocess.call([python, str(root / "backend" / "scripts" / "verify.py")]))

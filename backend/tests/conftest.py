"""Тесты не трогают рабочие данные: своя временная база (журнал, прогоны) и своя папка загрузок/активного набора.
Переменные ставятся до импорта приложения — conftest загружается первым."""
import os
import shutil
import tempfile

_TMP = tempfile.mkdtemp(prefix="allur_tests_")
os.environ["ALLUR_DB"] = os.path.join(_TMP, "test.sqlite")
os.environ["ALLUR_STATE_DIR"] = _TMP


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP, ignore_errors=True)

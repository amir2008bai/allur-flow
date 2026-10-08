from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import time

from app import journal, dataset


def test_parallel_requests_share_forecast_and_import_invalidates_it(monkeypatch):
    calls = []
    monkeypatch.setattr(journal, "PARAM_SETS", 1)
    monkeypatch.setattr(journal, "DAYS_PER_SET", 1)
    monkeypatch.setattr(journal, "MAINT_PER_SET", 1)

    def simulate(params, seed):
        calls.append(seed)
        time.sleep(0.01)
        return SimpleNamespace(good_out=123)

    monkeypatch.setattr("app.sim.engine.simulate", simulate)
    journal.clear_forecast_cache()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(journal._day_dist, ["refresh-test"] * 2))
        assert len(calls) == 2  # one typical day + one maintenance day
        assert results[0] is results[1]
        dataset._clear_caches()
        journal._day_dist("refresh-test")
        assert len(calls) == 4
    finally:
        journal.clear_forecast_cache()

"""Выгрузка записанных прогонов (replay-бандлов) для показа без сервера: frontend/public/bundles/."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.sim.api import _whatif, meta, run_payload  # noqa: E402
from app.sim.params import SCENARIOS  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "bundles"
OUT.mkdir(parents=True, exist_ok=True)
SEED = 7
(OUT / "meta.json").write_text(json.dumps(meta(), ensure_ascii=False), encoding="utf-8")
for sc in SCENARIOS:
    (OUT / f"run_{sc}.json").write_text(json.dumps(run_payload(sc, SEED), ensure_ascii=False), encoding="utf-8")
    (OUT / f"whatif_{sc}.json").write_text(json.dumps(_whatif(sc, 20), ensure_ascii=False), encoding="utf-8")
print("ok", sorted(p.name for p in OUT.iterdir()))

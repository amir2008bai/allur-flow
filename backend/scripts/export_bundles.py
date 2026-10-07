"""Выгрузка записанных прогонов (replay-бандлов) для показа без сервера: frontend/public/bundles/."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.sim.api import _whatif, meta, run_payload  # noqa: E402
from app.sim.params import SCENARIOS  # noqa: E402
from app.stress import DATA_FAULTS  # noqa: E402
from app.stress import SCENARIOS as STRESS  # noqa: E402
from app.stress_api import _chaos, data_fault, scenarios as stress_scenarios  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "bundles"
OUT.mkdir(parents=True, exist_ok=True)
SEED = 7
STRESS_SEED = 101  # как первый запуск во вкладке «Испытания»


def dump(name: str, payload: dict) -> None:
    (OUT / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def export_stress() -> None:
    """«Испытания» без сервера: каждый сбой отдельно и все вместе; сбои данных."""
    dump("stress_scenarios.json", stress_scenarios())
    ids = sorted(s["id"] for s in STRESS)
    for key in [[i] for i in ids] + [ids]:
        name = "all" if len(key) == len(ids) else key[0]
        dump(f"stress_chaos_{name}.json", _chaos(",".join(key), STRESS_SEED))
    for k, _, _ in DATA_FAULTS:
        dump(f"stress_data_{k}.json", data_fault(k, STRESS_SEED))


if "--only-stress" in sys.argv:
    export_stress()
    print("ok", sorted(p.name for p in OUT.glob("stress_*")))
    sys.exit(0)

(OUT / "meta.json").write_text(json.dumps(meta(), ensure_ascii=False), encoding="utf-8")
for sc in SCENARIOS:
    (OUT / f"run_{sc}.json").write_text(json.dumps(run_payload(sc, SEED), ensure_ascii=False), encoding="utf-8")
    (OUT / f"whatif_{sc}.json").write_text(json.dumps(_whatif(sc, 20), ensure_ascii=False), encoding="utf-8")
export_stress()
print("ok", sorted(p.name for p in OUT.iterdir()))

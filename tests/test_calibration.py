"""Regression against independent reference runs recorded in benchmarks/astruttie/*.json."""
import json, math, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stm.engine import run_case

CASES = sorted((ROOT / "benchmarks" / "astruttie").glob("*-AST-*.json"))
CASES = [c for c in CASES if not c.name.endswith(".open.json")]


def _load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def test_member_forces():
    for p in CASES:
        case = _load(p)
        res, _, _ = run_case(case)
        for k, v in case["reference"]["forces"].items():
            tol = max(1.5, 0.005 * abs(v))   # reference shows 0.1-1 kN rounding
            assert abs(res.forces[k] - v) <= tol, (p.name, k, res.forces[k], v)


def test_required_steel():
    for p in CASES:
        case = _load(p)
        ref = case["reference"].get("As_req")
        if not ref:
            continue
        _, checks, _ = run_case(case)
        asr = {c.item: float(re.search(r"As,req = (\d+)", c.detail).group(1))
               for c in checks if c.kind == "tie"}
        for k, v in ref.items():
            assert abs(asr[k] - v) <= max(2, 0.005 * v), (p.name, k, asr[k], v)


def test_deep_beam_widths_and_anchorage():
    case = _load(ROOT / "benchmarks" / "astruttie" / "DB-AST-1.json")
    _, checks, _ = run_case(case)
    d1 = next(c for c in checks if c.item == "D1" and c.kind == "strut")
    # reference: prov. width 369.85 mm -> safety factor 3.09
    assert abs(1 / d1.ratio - 3.09) < 0.01
    anc = next(c for c in checks if c.kind == "anchorage" and c.item == "BC1@B1")
    assert abs(anc.demand - 1220) < 1 and abs(anc.capacity - 424) < 1

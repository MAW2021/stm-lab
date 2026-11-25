"""AStrutTie worked examples (4 US verification examples and 8 Technical Book examples),
rebuilt in STM-Lab in SI units.  Each case file holds the model and the reference run's
member forces, required steel, strut widths and the safety factors of every strut, tie,
node face and bearing face.  Items STM-Lab does not reproduce are listed in
reference["skip"] with the reason in reference["known_gaps"]."""
import json, pathlib, re, sys
import pytest
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stm.engine import run_case
from stm.checks import strut_width_2d

NAMES = ["FH1", "FH4", "HH", "CB-AST-2", "CP1", "CP2", "PF1", "PF2", "SF1", "SF2", "AB1", "AB2"]
CASES = [p for p in sorted((ROOT / "benchmarks" / "astruttie").glob("*.json"))
         if any(p.stem.startswith(n) for n in NAMES)]


def _sf(checks):
    out = {}
    for c in checks:
        if c.capacity is None:
            continue
        if c.kind in ("strut", "tie"):
            out[("member", c.item)] = c.capacity / c.demand
        elif c.kind == "node":
            face = re.search(r"face of (\w+)", c.detail).group(1)
            out[("node", f"{c.item}/{face}")] = c.capacity / c.demand
        elif c.kind == "bearing":
            out[("node", f"{c.item}/bearing")] = c.capacity / c.demand
    return out


@pytest.mark.parametrize("path", CASES, ids=[p.stem for p in CASES])
def test_worked_example(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    ref = case["reference"]
    skip = set(ref.get("skip", []))
    res, checks, _ = run_case(case)
    assert res.stable
    for k, v in ref["forces"].items():
        assert abs(res.forces[k] - v) <= max(1.0, 0.005 * abs(v)), ("force", k, res.forces[k], v)
    asr = {c.item: float(re.search(r"As,req = (\d+)", c.detail).group(1)) for c in checks if c.kind == "tie"}
    for k, v in ref["As_req"].items():
        assert abs(asr[k] - v) <= max(2, 0.005 * v), ("As_req", k, asr[k], v)
    sf = _sf(checks)
    if case["custom"]["dim"] == 2:
        for k, v in ref["strut_wmax"].items():
            if k in skip:
                continue
            w = strut_width_2d(res.model, next(m for m in res.model.members if m.name == k))
            assert abs(w - v) <= max(0.6, 0.003 * v), ("width", k, w, v)
    for grp, kind in (("strut_sf", "member"), ("tie_sf", "member"), ("node_sf", "node")):
        for k, v in ref.get(grp, {}).items():
            if k in skip:
                continue
            mine = sf.get((kind, k))
            assert mine is not None and abs(mine - v) <= 0.006 * v + 0.01, (grp, k, mine, v)

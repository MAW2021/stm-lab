"""Every template input pushed through +, −, 0, tiny, huge, blank and text values in both
engines.  Each run must either give finite, stable results or stop with a clear input
message; the browser and Python engines must agree on which."""
import json
import math
import pathlib
import subprocess

from stm.codes import CODES
from stm.engine import run_case
from stm.validate import InputError

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _js_runs():
    p = subprocess.run(["node", str(ROOT / "tests/fuzz.js"), str(ROOT / "web/stm-engine.js")],
                       capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(p.stdout)


def test_fuzz_inputs_both_engines():
    runs = _js_runs()
    assert len(runs) > 2000
    js_bugs = [r for r in runs if r["status"] == "bug"]
    assert not js_bugs, js_bugs[:5]
    py_bugs, mismatch = [], []
    for r in runs:
        try:
            res, checks, _ = run_case(dict(template=r["t"], code=r["code"], params={r["k"]: r["v"]}))
            vals = list(res.forces.values()) + [x for c in checks for x in (c.demand, c.capacity, c.ratio)
                                               if isinstance(x, (int, float))]
            st = "ok" if all(math.isfinite(v) for v in vals) and res.stable else "bug"
        except InputError:
            st = "input"
        except Exception as e:  # noqa: BLE001
            st = "bug"
            py_bugs.append((r, repr(e)))
            continue
        if st == "bug":
            py_bugs.append((r, "non-finite or unstable"))
        elif st != r["status"]:
            mismatch.append((r["t"], r["code"], r["k"], r["v"], r["status"], st))
    assert not py_bugs, py_bugs[:5]
    assert not mismatch, mismatch[:10]


def test_negative_loads_are_valid():
    # reversed loads (uplift, tension, opposite moments) are legitimate and must solve
    cases = [("deep_beam", {"P": -1000}), ("corbel", {"Vu": -300}), ("pier_cap", {"P1": -500, "P2": 2000}),
             ("frame_corner", {"M": -300, "V": -150, "N": 80}), ("footing", {"V1": -2000, "M1": -30000}),
             ("dapped_end", {"Vu": -200}), ("pile_cap_2", {"P": -800})]
    for t, p in cases:
        res, checks, _ = run_case(dict(template=t, code="ACI318-19", params=p))
        assert res.stable, t
        assert all(math.isfinite(v) for v in res.forces.values()), t


def test_codes_listed():
    assert set(CODES) == {"ACI318-19", "AASHTO-LRFD"}

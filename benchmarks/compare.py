"""Compare STM-Lab with reference results recorded in benchmarks/cases/*.json.

Case file: the normal STM-Lab case plus
  "reference": {"source": "...", "forces": {"AC": -869.0, ...},
                "capacities": {"AC/strut": 1080.6, "A/node": 2511.9, ...},
                "As_req": {"AB": 1996}}
"""
import json, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stm.engine import run_case

TOL = {"forces": 0.005, "capacities": 0.02, "As_req": 0.005}

def pct(a, b):
    return 100 * (a - b) / b if b else float("nan")

def main():
    rows, worst = [], 0.0
    for f in sorted((ROOT / "benchmarks" / "cases").glob("*.json")):
        case = json.loads(f.read_text(encoding="utf-8"))
        ref = case.get("reference")
        if not ref:
            rows.append(f"| {f.stem} | – | – | – | – | no reference yet |")
            continue
        res, checks, _ = run_case(case)
        cap = {}
        for c in checks:
            if c.capacity is not None:
                cap.setdefault(f"{c.item}/{c.kind}", c.capacity)
        asr = {c.item: float(re.search(r"As,req = (\d+)", c.detail).group(1))
               for c in checks if c.kind == "tie" and "As,req" in c.detail}
        mine = {"forces": res.forces, "capacities": cap, "As_req": asr}
        for grp, vals in ref.items():
            if grp not in TOL:
                continue
            for k, rv in vals.items():
                mv = mine[grp].get(k)
                if mv is None:
                    rows.append(f"| {f.stem} | {grp} | {k} | – | {rv} | missing in STM-Lab |")
                    continue
                d = pct(mv, rv)
                ok = abs(d) <= 100 * TOL[grp]
                worst = max(worst, abs(d))
                rows.append(f"| {f.stem} | {grp} | {k} | {mv:.1f} | {rv} | {d:+.2f}% {'OK' if ok else 'CHECK'} |")
    out = ["# Benchmark results", "", "| Case | Group | Item | STM-Lab | Reference | Diff |",
           "|---|---|---|---|---|---|"] + rows + ["", f"Largest difference: {worst:.2f}%"]
    (ROOT / "benchmarks" / "results.md").write_text("\n".join(out), encoding="utf-8")
    print("\n".join(out))

if __name__ == "__main__":
    main()

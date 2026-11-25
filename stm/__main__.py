"""Command line: python -m stm case.json [-o report.html]

case.json example:
{"template": "deep_beam", "code": "ACI318-19", "project": "Tower A",
 "params": {"L": 3000, "h": 1500, "b": 400, "P": 1200, "fc": 35, "fy": 420}}

or a custom model:
{"code": "ACI318-19", "custom": {"title": "...", "dim": 2, "b": 400, "fc": 35, "fy": 420,
  "nodes": [{"name": "A", "xyz": [0, 100], "fix": [true, true], "lb": 300, "wt": 200}, ...],
  "members": [{"name": "AC", "i": "A", "j": "C", "strut_class": "interior_reinf"}, ...]}}
"""
import argparse
import json
import sys
from pathlib import Path

from .engine import run_case


def main(argv=None):
    ap = argparse.ArgumentParser(prog="stm", description="Strut-and-tie design (offline)")
    ap.add_argument("case", help="JSON case file")
    ap.add_argument("-o", "--out", help="HTML report path (default: next to the case)")
    a = ap.parse_args(argv)
    case = json.loads(Path(a.case).read_text(encoding="utf-8"))
    res, checks, html = run_case(case)
    out = Path(a.out) if a.out else Path(a.case).with_suffix(".html")
    out.write_text(html, encoding="utf-8")
    ng = [c for c in checks if c.status == "NG"]
    print(f"{res.model.title}: {'PASS' if not ng else f'{len(ng)} check(s) FAIL'} -> {out}")
    return 0 if not ng else 1


if __name__ == "__main__":
    sys.exit(main())

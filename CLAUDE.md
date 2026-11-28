# STM-Lab: notes for Claude

Offline strut-and-tie design tool. Python reference engine in `stm/`, browser engine and single-file app in `web/`.

## Rules (never break)
- ACI 318 + AASHTO LRFD only, never ECP. SI units (mm, kN, MPa), tension positive.
- Only verified, codified methods, each with its clause. No invented heuristics.
- Code factors live only in `stm/codes.py` and the JS `codes` section, and must match.
- Single self-contained offline HTML app. Never edit `web/stm-lab.html` or `stm/params.json` by hand: run
  `python web/build.py`.
- Strut width without a bearing plate: "projection" (conservative) by default, "secant" as an option.

## Commands
- Build: `python web/build.py` (needs node).
- Tests: `pytest -q tests` (hand calcs, worked examples, calibration, JS parity, 2,540-run fuzz). Must pass.
- CLI report: `python -m stm examples/deep_beam.json -o out.html`.

## Agents
Work is split among nine specialist agents in `.claude/agents/`, grouped as engineering method, implementation,
QA / verification and release. See [AGENTS.md](AGENTS.md) for who owns which files and which agent leads each task.

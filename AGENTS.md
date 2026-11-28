# STM-Lab agent team

Nine specialist agents live in [`.claude/agents/`](.claude/agents/). Claude Code picks them up automatically;
you can also ask for one by name ("use stm-checks-engineer to add headed-bar anchorage").
Each agent owns a fragment of the code, so every task has one clear owner and one reviewer.

## Standing rules (all agents)
- American codes only: ACI 318-19/318-25 and AASHTO LRFD 5.8.2. Never ECP.
- SI units (mm, kN, MPa), tension positive, factored loads.
- Only verified, codified methodology, with clause citations in code, UI and report. No invented heuristics.
- The app is one self-contained HTML file that works offline (`web/stm-lab.html`, built by `python web/build.py`).
- Strut width at nodes without a bearing plate: conservative "projection" rule by default; "secant" is an option.
- The Python engine (`stm/`) and the browser engine (`web/stm-engine.js`) must agree; `pytest -q tests`
  (including the 2,540-run fuzz test and the parity test) must pass before any PR.

## Agents by task nature

| Group | Agent | Owns (code fragment) | Typical tasks |
|---|---|---|---|
| Engineering method | [`stm-code-provisions`](.claude/agents/stm-code-provisions.md) | `stm/codes.py`, JS `codes` section, clause refs, code-based input ranges | Look up a clause, change a β/φ factor, add an edition, code-compliance review of any engineering PR |
| Engineering method | [`stm-template-engineer`](.claude/agents/stm-template-engineer.md) | `stm/templates.py`, JS `templates` section (`stm/params.json` is generated) | New or changed D-region template, node placement, corbel / pier coping nodes, 3D caps |
| Engineering method | [`stm-checks-engineer`](.claude/agents/stm-checks-engineer.md) | `stm/checks.py`, JS `checks` and `design assistant` sections | Strut/tie/node/bearing checks, development and hooked/headed anchorage, design-assistant fixes and auto-design |
| Implementation | [`stm-python-engine-dev`](.claude/agents/stm-python-engine-dev.md) | `stm/model.py`, `engine.py`, `validate.py`, `report.py`, `ui.py`, `__main__.py` | Solver, custom JSON, validation plumbing, report, CLI/local UI, load combinations, DXF |
| Implementation | [`stm-web-app-dev`](.claude/agents/stm-web-app-dev.md) | `web/app.html`, `web/build.py`, JS `model`/`runCase`/`API` plumbing | Gallery, tabs, canvas editing, dashboard, print/save, iframe behaviour, build |
| QA / verification | [`stm-test-engineer`](.claude/agents/stm-test-engineer.md) | `tests/`, `.github/workflows/` | Hand-calc tests, fuzz/stress tests, JS–Python parity, CI |
| QA / verification | [`stm-benchmark-analyst`](.claude/agents/stm-benchmark-analyst.md) | `benchmarks/`, `tools/ast_convert.py`, `docs/benchmark-plan.md`, `docs/calibration-*.md` | AStrutTie and published-example comparisons, explaining differences, calibration notes |
| QA / verification | [`stm-verification-writer`](.claude/agents/stm-verification-writer.md) | `docs/verification/`, `README.md`, `CONTRIBUTING.md` | Hand-calc verification document per model, user docs |
| Release | [`stm-release-publisher`](.claude/agents/stm-release-publisher.md) | release steps (no code) | After merge: rebuild, test, publish to artifact, project files and PC folder |

## Which agent for which task

| Task | Lead | Then |
|---|---|---|
| New template (e.g. wall opening) | template-engineer | checks-engineer (if new checks) → test-engineer → code-provisions review |
| New or changed check / anchorage | checks-engineer | test-engineer → code-provisions review |
| Change a code factor or edition | code-provisions | test-engineer |
| Solver, report, load combinations, DXF | python-engine-dev | web-app-dev (mirror in JS) → test-engineer |
| UI feature or UI bug | web-app-dev | test-engineer |
| Benchmark against AStrutTie / a textbook | benchmark-analyst | owner of any discrepancy → test-engineer |
| Hand-calc verification document | verification-writer | test-engineer (closed-form test) |
| Test failure or CI red | test-engineer | owner of the failing fragment |
| Merged PR → publish | release-publisher | – |

## Change procedure
1. Branch from `main`; the lead agent implements with clause citations, Python and JS together.
2. `python web/build.py`, then `pytest -q tests`.
3. `stm-code-provisions` reviews any change to a check, factor or template.
4. Open a PR (template in `.github/pull_request_template.md`), assign MAW2021. Never merge without Mahmoud's approval.
5. After merge, `stm-release-publisher` updates every home of the built app.

# STM-Lab

Offline strut-and-tie model (STM) design for reinforced-concrete D-regions.
It covers parametric templates, 2D/3D truss analysis, strut/tie/node checks with
clause references, and a printable calculation report. It runs on Windows, macOS or Linux
with Python and numpy. Nothing leaves your computer.

> **Status: v0.2 (pre-release).** The ACI 318-19 checks are implemented from Chapter 23.
> The **ECP 203 factors are provisional** and are flagged in every report until they have been
> verified against ECP 203 §6-11. Calibration against an independent commercial tool is
> in progress (see [docs/benchmark-plan.md](docs/benchmark-plan.md)). Always review the results
> as an engineer before you use them.

## What it does

| Step | STM-Lab |
|---|---|
| Template | Deep beam / transfer girder (1 or 2 loads), corbel, two-pile cap, four-pile cap (3D), hammerhead pier cap, or any custom truss written in JSON |
| Geometry, load, material | Dimensions, bearing plates, tie depth, f'c / fcu, fy, provided steel |
| STM model | Nodes are placed automatically. The compression chord / node depth is sized so that the CCC node is at capacity |
| Analysis | Pin-jointed truss solved by direct stiffness (2D and 3D), with equilibrium and stability checks |
| Checks | Struts (β_s), ties (As,req and bar options), nodal faces and bearing (β_n, β_c), 25° strut–tie angle limit, distributed reinforcement (23.5), size-effect limit (23.4.4), corbel limits (16.5) |
| Deliverable | A self-contained HTML calculation report with the drawn model, force tables, check tables and clause references. Print it to PDF from the browser |

## Install and run

```bash
pip install numpy
python -m stm.ui                      # local browser UI at http://127.0.0.1:8765
python -m stm examples/deep_beam.json # command line: writes examples/deep_beam.html
python tests/test_hand.py             # verification tests (or: pytest)
```

On Windows, install Python 3.10+ from python.org, then run the same commands in a terminal
opened in this folder.

## Units and sign convention
mm, kN, MPa. Loads are factored. Member force + = tension (tie), − = compression (strut).

## Custom models
See the docstring in `stm/__main__.py`, or pick **Custom model (JSON)** in the UI. Nodes carry
`fix`, `load`, `lb` (bearing length), `wt` (tie/chord zone height). For 3D models they carry
`bearing_area` instead. Members carry `strut_class`, `As`, and optional `width`/`area` overrides.

## Code
- `stm/model.py`: model and truss solver
- `stm/codes.py`: code factors (one place to edit)
- `stm/checks.py`: strut / tie / node checks
- `stm/templates.py`: parametric D-region templates and template-specific checks
- `stm/report.py`: HTML report
- `stm/ui.py`: local web UI
- `benchmarks/`: calibration cases and comparison results

## Calibration status
Round 1 (Nov 2026) compared STM-Lab with a commercial STM program on a deep beam, a corbel and a pier
coping. Forces, required steel, node and bearing checks, and development length match exactly or
within display rounding. See [docs/calibration-2026-11.md](docs/calibration-2026-11.md). Regression tests in
`tests/test_calibration.py` keep it that way.

## Contributing
Feedback and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md).
Use the issue templates to report a bug or a **calibration discrepancy** (a case where STM-Lab
disagrees with a hand calculation, a textbook example or another program).

## Disclaimer
This software is provided as-is under the MIT license. It is a design aid, not a substitute for
engineering judgement. The responsible engineer must verify every result.

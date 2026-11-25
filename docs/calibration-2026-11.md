# Calibration round 1: 25 Nov 2026

Reference: a commercial browser STM program (AStrutTie, free plan, ACI 318-25 mode; its Chapter 23
strength factors are identical to 318-19). Each template was run with its default inputs. The node
coordinates, member forces and check values were read from the program's own result tables and
entered into STM-Lab as custom models (`benchmarks/astruttie/*.json`). Only numbers that we produced
ourselves are recorded. No code, text or graphics were copied.

## Results

| Case | What was compared | Result |
|---|---|---|
| DB-AST-1 deep beam, H = 1600 (determinate fan truss) | 11 member forces, As,req, tie safety factors, φ·f_ce for every strut and node type, bearing plates, tie-face node checks, strut–tie angles, straight-bar ld and available ℓanc | **Exact** (to 0.1 kN / 1 mm) |
| DB-AST-2 deep beam, H = 1200 | forces, strut widths, safety factors | **Exact** |
| CB-AST-1 corbel (column + bracket, 6 nodes) | all 9 member forces, As,req | **Exact**. Supports: lower rear node pinned, lower front node roller |
| PR-AST-1 pier coping, 5 bearings, H loads (14 nodes, 25 members) | all 25 member forces | **Within 1.4 kN** (the reference shows forces rounded to 1 kN) |
| PF-AST-1 pile footing with pile springs + moment | member forces | **Not yet matched.** The model is indeterminate; we still need the reference's column-load transfer and member EA convention |
| Four-pile cap 3D | – | Not run: 3D templates need the reference's Pro plan |

## Differences found and how they were handled

1. **Strut width at nodes without a bearing plate** (interior chord or tie nodes).
   - STM-Lab default: `wt·cosθ`, the projection of the chord zone. This is conservative.
   - Reference: `wt / cosθ` for deep-beam chord nodes, which gives widths 2–3.4× larger.
   - **Fix:** a model option `interior_width_rule = "secant"` reproduces the reference exactly
     for the deep beam. The default stays `"projection"`; switch it per project.
   - For corbel interior nodes the reference uses a further rule that its report does not state.
     For now, enter those widths explicitly per member (`width`).
2. **Tie-face checks at nodes:** these were missing in v0.1 and have now been added (tie force on b·wt with the node's β_n).
3. **Development length:** this was missing in v0.1. A straight-bar check (ACI 25.4.2.4,
   ψ = 1) with ℓanc per 23.8.2 has now been added, and it matches the reference exactly (ld = 1220 mm, ℓanc = 424 mm).
   Hooked and headed bars are still to do.
4. **Plate nodes and bearing checks:** these already matched exactly (`lb·sinθ + wt·cosθ`).

## Still to do
- Spring supports have been added to the solver. Matching PF-AST-1 still needs the stiffness convention.
- Hooked/headed anchorage (25.4.3 / 25.4.4).
- 3D pile cap: compare against a published worked example, because the reference's 3D is paid.

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
| DE-AST-1 dapped end (7 nodes, 10 members), f'c 24, fy 400, V 400 / H 80 kN | 10 member forces, As,req of 6 ties, strut and tie safety factors, node face factors at A, C0, B, D, G, H, ℓanc and ld of the nib tie at A | **Exact** with the secant rule and the S2 width at D entered (173.7 mm) |
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
- Dapped end: reproduce the reference strut widths at hanger nodes C and D (it measures S2 at D from the vertical hanger: 150/cos30.3° = 173.7 mm), its bearing check on the vertical reaction only, and the available ℓanc at C and D.
- Spring supports have been added to the solver. Matching PF-AST-1 still needs the stiffness convention.
- Hooked/headed anchorage (25.4.3 / 25.4.4).
- 3D pile cap: compare against a published worked example, because the reference's 3D is paid.

# Calibration round 2: worked examples (25 Nov 2026)

Reference: the solved examples that ship with the same program. These are 4 US verification examples
(FHWA-NHI-17-071, ACI SP-208, ACI SP-273) and 8 examples from its technical book. Each model was read
from the program's own model file and result tables, converted to SI (mm, kN, MPa) with
`tools/ast_convert.py`, and stored in `benchmarks/astruttie/` with the reference numbers. Only numbers
are kept. No code, text or graphics were copied. `tests/test_worked_examples.py` re-checks all 12 on every run.

| Case | Source | Code | Forces and As,req | Widths and strut/tie SFs | Node face SFs |
|---|---|---|---|---|---|
| FH1-AST-1 simply supported deep beam | FHWA DE1 | AASHTO | Exact | Exact | 18/18 |
| FH4-AST-1 drilled-shaft footing, 4 shafts (3D) | FHWA DE4 | AASHTO | Exact | Strut SFs 13/13 | Not compared (3D) |
| CB-AST-2 column corbel | ACI SP-208 Ex. 3.1 | ACI | Exact | 2 of 4 widths | 14/17 |
| HH-AST-1 hammerhead bent cap | ACI SP-273 Ex. 1 | ACI | Exact | Exact | All |
| CP1-AST-1 pier coping, one column | Book 1.1 | ACI | Exact | Exact | All |
| CP2-AST-1 pier coping, two columns | Book 1.2 | ACI | Exact | Exact | 56/58 |
| PF1-AST-1 pile footing, one column | Book 2.1 | ACI | Exact | Exact (user β_s) | All |
| PF2-AST-1 pile footing, two columns | Book 2.2 | ACI | Exact | Exact (user β_s) | All |
| SF1-AST-1 spread footing, one column | Book 2.3 | ACI | Exact | Exact | All |
| SF2-AST-1 spread footing, two columns | Book 2.4 | ACI | Exact | Exact | All |
| AB1-AST-1 abutment footing on piles | Book 3.1 | ACI | Exact | Exact | All |
| AB2-AST-1 abutment spread footing | Book 3.2 | ACI | Exact | Exact | All |

"Exact" means within the reference's display rounding.

## What changed in the tool (v0.6)

1. **AASHTO LRFD 5.8.2 code set** (`AASHTO-LRFD`). φ is 0.70 for struts and nodes and 0.90 for ties.
   Node ν is 0.85 (CCC) or 0.70 (CCT) at bearing and back faces. CTT faces and all strut–node interfaces use
   0.85 − f'c/137.9 MPa, limited to 0.45–0.65. Without crack-control reinforcement ν = 0.45.
2. **Section stiffness** for indeterminate trusses (`stiffness: "section"`). EA = Es·As for ties with steel,
   and Ec·w·b for struts (Ec = 4700√f'c, w = governing strut width), or Ec·A in 3D. This reproduces every
   indeterminate force in the examples. The old uniform EA stays available.
3. **Strut width at interior nodes (secant rule)**: the least of wt/cosθ measured from the chord band
   (`band_dir` for sloped chords), wt_v/sinθ for a vertical tie band (`wt_v`), and the nearest chord panel × sinθ.
   A member's "provided width" is used only when the node has no geometry.
4. **Bearing check** on the force component normal to the plate. **Node kind** ignores ties with negligible force,
   and the 25° angle check skips collinear members.
5. **Footing template** (`footing`): pile, spread or abutment footing with one or two columns (V, H, M each),
   heel soil load, and the rigid-footing pile/soil reactions applied as loads. Parity cases FT-1, FT-2 and FT-3.
6. **Load combinations** in custom models (`load_cases`: factor × loads per node), and a per-member user β_s.

## Open items
- Corbel (SP-208): 3 node faces and 2 strut widths use a nodal-zone geometry we have not reproduced yet.
- Pier coping, two columns: 2 node faces with an inclined tie at the bottom node; STM-Lab is conservative there.
- Book 2.1 and 2.2 use ν = 0.51 (β_s = 0.6) on some struts without stating why. The benchmark enters it as a user β_s.
- Hooked and headed-bar development (ACI 25.4.3 / 25.4.4) is not implemented yet.
- 3D node faces are not compared yet.
- Spread-footing springs are linear, so uplift is not excluded.
- The Book 3.1 loads were back-calculated from the book's model, so FT-3 is a parity case, not a reference match.

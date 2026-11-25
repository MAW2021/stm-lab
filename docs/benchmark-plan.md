# Calibration and benchmark plan

## Goal
Show that STM-Lab gives the same member forces, and capacities within a known tolerance, as an
independent tool on identical inputs. Explain every difference that remains.

## Three levels of reference
1. **Hand calculations** (closed-form statics + code factors): `tests/test_hand.py`. Expected match: exact.
2. **Published worked examples**, for example ACI SP-208 / SP-273 and textbook deep beam, corbel and pile cap
   examples. Expected match: within rounding once the same node geometry is used.
3. **Commercial STM software** run by the user on the same inputs (for example AStrutTie in its ACI 318 mode).
   Only numbers we produce ourselves are recorded. Nothing is copied from the program.

## Case matrix (level 3)
| ID | Template | Key variation |
|---|---|---|
| DB-1 | Deep beam, central load | ρ ≥ 0.0025 (β_s = 0.75) |
| DB-2 | Deep beam, two loads | no web steel (β_s = 0.4) |
| DB-3 | Deep beam, two loads | bearing-governed (small plates) |
| CB-1 | Corbel | a_v/d ≈ 0.45 |
| CB-2 | Corbel | a_v/d ≈ 0.9, Nuc = 0.2 Vu |
| PC2-1 | Two-pile cap | standard |
| PC4-1 | Four-pile cap (3D) | standard |
| PC4-2 | Four-pile cap (3D) | thick cap, steep struts |
| PR-1 | Pier cap | equal bearing loads |
| PR-2 | Pier cap | unequal loads |

## What is compared, and the tolerance
| Quantity | Tolerance | Usual cause of a difference |
|---|---|---|
| Member forces | 0.5 % | node coordinates (chord depth, top node level) |
| Strut / node capacity | 2 % | strut-end width formula, node classification, β_c |
| Tie As,req | 0.5 % | φ, fy |
| Governing check and ratio | same element, ±3 % | combination of the above |

## Procedure for each case
1. Enter the inputs in both tools. Match the node coordinates first by entering the other tool's
   node coordinates in a STM-Lab custom JSON model.
2. Record the other tool's results in `benchmarks/cases/<ID>.json` under `"reference"`.
3. Run `python benchmarks/compare.py`. It writes `benchmarks/results.md`.
4. If a difference exceeds the tolerance, find the cause. Then either fix STM-Lab (with a test) or
   document it as a deliberate modelling difference.

The same sequence will be repeated for AASHTO LRFD 5.8.2 when it is added.

# Contributing to STM-Lab

Thank you for helping. This is an engineering tool, so every change has to be verifiable.

## Ways to help
1. **Report a calibration discrepancy.** Open a *Calibration discrepancy* issue with the full
   inputs, STM-Lab's numbers, and the reference numbers and their source (hand calc, textbook
   example, or other software). Attach the STM-Lab JSON case.
2. **Report a bug.** Use the *Bug report* template.
3. **Propose a template or code.** Examples are a dapped end, a wall opening, a continuous deep
   beam, SBC 304 or EC2. Open an issue first so that the approach can be agreed.
4. **Send a pull request.**

## Pull request rules
- One topic per PR. Explain the engineering basis and cite the code clause.
- Every new check or template needs a test in `tests/` with a closed-form hand calculation or a
  published worked example (cite the source and page).
- Code factors live only in `stm/codes.py`. Do not hard-code them elsewhere.
- `python tests/test_hand.py` (or `pytest`) must pass. CI runs it on every PR.
- Do not commit copyrighted code text, screenshots or files from commercial programs. Numerical
  results that you produced yourself for comparison are fine in `benchmarks/`.
- Keep the units as mm, kN and MPa, with tension positive.

## Review
At least one engineer reviews each PR that changes a check, a code factor or a template before
it is merged.

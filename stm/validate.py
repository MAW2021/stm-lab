"""Input and model validation shared by the CLI, the Python UI and the tests.

Ranges follow the code: f'c >= 17 MPa (ACI 318-19 19.2.1.1); fy of ties <= 550 MPa
(ACI 318-19 Table 20.2.2.4(a)) or <= 690 MPa (AASHTO LRFD 5.4.3.1); beta_c 1.0-2.0
(ACI 318-19 23.4.3).  Mirrors validateParams / validateModel in web/stm-engine.js."""
from __future__ import annotations

import json
import math
import pathlib

PARAMS = json.loads((pathlib.Path(__file__).parent / "params.json").read_text(encoding="utf-8"))
ZERO_OK = {"rb", "heel_len", "w_heel1", "w_heel2", "db", "c_end", "e_h", "anchor_ext", "n_spread"}


class InputError(ValueError):
    """Bad input, with a message the user can act on."""


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def validate_params(template, params, code):
    if template not in PARAMS:
        raise InputError(f'unknown template "{template}"')
    errs = []
    for k, lab, dv, unit in PARAMS[template]["params"]:
        raw = params.get(k, dv)
        if unit in ("class", "text"):
            continue
        if raw in (None, ""):
            if dv in ("", None):
                continue
            errs.append(f"{lab}: a value is required")
            continue
        v = _num(raw)
        if v is None:
            errs.append(f'{lab}: "{raw}" is not a number')
            continue
        if unit == "mm":
            if v < 0 or (v == 0 and k not in ZERO_OK):
                errs.append(f"{lab}: must be {'zero or more' if k in ZERO_OK else 'greater than zero'} (got {v:g} mm)")
            elif 0 < v < 1:
                errs.append(f"{lab}: {v:g} mm is below 1 mm")
            elif v > 1e5:
                errs.append(f"{lab}: {v:g} mm is above 100 000 mm (outside the range of a D-region)")
        elif unit == "mm²":
            if v < 0:
                errs.append(f"{lab}: cannot be negative (got {v:g})")
            elif 0 < v < 1:
                errs.append(f"{lab}: {v:g} mm² is below 1 mm²")
        elif unit == "":
            if v < 0:
                errs.append(f"{lab}: cannot be negative (got {v:g})")
        elif unit == "MPa":
            if k == "fc" and not 17 <= v <= 120:
                errs.append(f"{lab}: f'c must be 17–120 MPa (ACI 318-19 19.2.1.1 sets 17 MPa minimum; got {v:g})")
            fymax = 690 if getattr(code, "family", "ACI") == "AASHTO" else 550
            if k == "fy" and not 280 <= v <= fymax:
                ref = "ACI 318-19 Table 20.2.2.4(a), ties" if fymax == 550 else "AASHTO LRFD 5.4.3.1"
                errs.append(f"{lab}: fy must be 280–{fymax} MPa ({ref}; got {v:g})")
        elif unit in ("kN", "kN·m", "kN/m"):
            if abs(v) > 1e7:
                errs.append(f"{lab}: {v:g} {unit} is above the supported magnitude (10⁷)")
    if errs:
        raise InputError("Input problem: " + "; ".join(errs))


def _in_poly(p, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def _on_edge(p, poly, tol):
    j = len(poly) - 1
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[j], poly[i]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1.0
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
        if math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy) <= tol:
            return True
        j = i
    return False


def validate_model(m, strict=True):
    errs, warn = [], []
    if not 17 <= m.fc <= 120:
        errs.append(f"f'c = {m.fc:g} MPa is outside 17–120 MPa (ACI 318-19 19.2.1.1)")
    if not 280 <= m.fy <= 690:
        errs.append(f"fy = {m.fy:g} MPa is outside 280–690 MPa")
    if m.dim == 2 and not m.b > 0:
        errs.append(f"thickness b must be greater than zero (got {m.b:g})")
    for n, N in m.nodes.items():
        if not all(math.isfinite(v) for v in N.xyz):
            errs.append(f"node {n} has an invalid coordinate")
        if not all(math.isfinite(float(v)) for v in N.load):
            errs.append(f"node {n} has an invalid load")
        for k in ("lb", "wt", "wt_v", "bearing_area"):
            if getattr(N, k) < 0:
                errs.append(f"node {n}: {k} cannot be negative")
        if not 1 <= N.confine <= 2:
            errs.append(f"node {n}: β_c must be 1.0–2.0 (ACI 318-19 23.4.3)")
    for e in m.members:
        if e.i not in m.nodes or e.j not in m.nodes:
            errs.append(f"member {e.name} refers to a missing node")
            continue
        if e.i == e.j:
            errs.append(f"member {e.name} joins node {e.i} to itself")
            continue
        a, b = m.nodes[e.i].xyz, m.nodes[e.j].xyz
        L = math.dist(a, b)
        if not L >= 1:
            errs.append(f"member {e.name} is {'of zero length' if L < 1e-9 else 'shorter than 1 mm'}: "
                        f"nodes {e.i} and {e.j} coincide (check the dimensions)")
        for k in ("As", "width", "area", "EA", "db", "width_max", "beta_s"):
            if getattr(e, k, 0) < 0:
                errs.append(f"member {e.name}: {k} cannot be negative")
        if 0 < e.As < 1:
            errs.append(f"member {e.name}: As = {e.As:g} mm² is below 1 mm²")
    ol = (m.meta or {}).get("outline") or []
    if m.dim == 3:
        pts = [q for poly in ol for q in poly if len(q) == 3]
        if pts:
            lo = [min(q[a] for q in pts) - 1 for a in range(3)]
            hi = [max(q[a] for q in pts) + 1 for a in range(3)]
            out = [n for n, N in m.nodes.items() if any(v < lo[a] or v > hi[a] for a, v in enumerate(N.xyz))]
            if out:
                errs.append(f"node{'s' if len(out) > 1 else ''} {', '.join(out)} outside the concrete "
                            "(check the dimensions and tie positions)")
    elif ol and all(len(p) >= 3 and all(len(q) == 2 for q in p) for p in ol):
        out = [n for n, N in m.nodes.items()
               if not any(_in_poly(N.xyz, poly) or _on_edge(N.xyz, poly, 1.0) for poly in ol)]
        if out:
            (errs if strict else warn).append(
                f"node{'s' if len(out) > 1 else ''} {', '.join(out)} {'lie' if len(out) > 1 else 'lies'} "
                "outside the concrete outline (check the dimensions, covers and tie positions)")
    if errs:
        raise InputError("Model problem: " + "; ".join(errs))
    return warn

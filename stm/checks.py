"""Strut, tie and node checks for a solved strut-and-tie model."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from .codes import CodeSet
from .model import Result

BARS = [12, 16, 20, 25, 28, 32]


@dataclass
class Check:
    item: str          # member / node name
    kind: str          # strut | tie | node | bearing | angle | detail
    demand: float      # kN (or ratio for detailing)
    capacity: Optional[float]
    ratio: Optional[float]
    status: str        # OK | NG | INFO
    clause: str
    detail: str = ""


def _bar_suggestion(As_req):
    out = []
    for d in BARS:
        a = math.pi * d * d / 4
        n = max(2, math.ceil(As_req / a))
        out.append((n, d, n * a))
    # pick the first 2 options with modest bar counts
    good = [o for o in out if o[0] <= 12][:2] or out[-1:]
    return " or ".join(f"{n}T{d} ({A:.0f} mm²)" for n, d, A in good)


def _strut_end_width_2d(res: Result, m, node_name):
    """Strut width at a node from the node's rectangular face (lb x wt)."""
    if m.width > 0:
        return m.width, "given"
    node = res.model.nodes[node_name]
    if node.lb <= 0 and node.wt <= 0:
        return None, "no node geometry"
    _, u = res.model.geometry(m)
    if node.lb <= 0 and res.model.interior_width_rule == "secant" and abs(u[0]) > 0.17:
        ws = node.wt / abs(u[0])
        return ws, f"wt/cosθ = {node.wt:.0f}/{abs(u[0]):.3f} (interior node, secant rule)"
    ws = node.lb * abs(u[1]) + node.wt * abs(u[0])
    return ws, f"lb·sinθ + wt·cosθ = {node.lb:.0f}·{abs(u[1]):.3f} + {node.wt:.0f}·{abs(u[0]):.3f}"


def _strut_end_area_3d(res: Result, m, node_name):
    if m.area > 0:
        return m.area, "given"
    node = res.model.nodes[node_name]
    if node.bearing_area <= 0:
        return None, "no node geometry"
    _, u = res.model.geometry(m)
    ax = node.bearing_axis if node.bearing_axis >= 0 else res.model.dim - 1
    c = abs(u[ax])
    return node.bearing_area * c, f"A_bearing·|cos| = {node.bearing_area:.0f}·{c:.3f}"


def node_kind(res: Result, name):
    node = res.model.nodes[name]
    if node.kind_override:
        return node.kind_override
    ties = sum(1 for m in res.model.members
               if name in (m.i, m.j) and res.forces[m.name] > 1e-6)
    return "CCC" if ties == 0 else ("CCT" if ties == 1 else "CTT")


def run_checks(res: Result, code: CodeSet) -> List[Check]:
    mdl = res.model
    fc, b = mdl.fc, mdl.b
    out: List[Check] = []
    kinds = {n: node_kind(res, n) for n in mdl.nodes}

    for m in mdl.members:
        F = res.forces[m.name]
        if abs(F) < 1e-6:
            out.append(Check(m.name, "zero", 0.0, None, None, "INFO", "",
                             "zero-force member"))
            continue
        if F > 0:   # ---------------- tie
            fy = (m.fy or mdl.fy) * code.steel_factor
            As_req = F * 1e3 / (code.phi_tie * fy)
            if m.As > 0:
                cap = code.phi_tie * m.As * fy / 1e3
                r = F / cap
                out.append(Check(m.name, "tie", F, cap, r, "OK" if r <= 1.0 else "NG",
                                 code.refs["tie"],
                                 f"As = {m.As:.0f} mm², As,req = {As_req:.0f} mm²"))
            else:
                out.append(Check(m.name, "tie", F, None, None, "INFO", code.refs["tie"],
                                 f"As,req = {As_req:.0f} mm² → {_bar_suggestion(As_req)}"))
            if m.role == "strut":
                out.append(Check(m.name, "detail", F, None, None, "NG", "",
                                 "member defined as strut but carries tension"))
        else:       # ---------------- strut
            C = -F
            fce = code.fce_strut(fc, m.strut_class)
            ends = []
            for nn in (m.i, m.j):
                if mdl.dim == 2:
                    w, how = _strut_end_width_2d(res, m, nn)
                    A = w * b if w else None
                else:
                    A, how = _strut_end_area_3d(res, m, nn)
                ends.append((nn, A, how))
            known = [e for e in ends if e[1]]
            if m.role == "tie":
                out.append(Check(m.name, "detail", F, None, None, "NG", "",
                                 "member defined as tie but carries compression"))
            if not known:
                A_req = C * 1e3 / (code.phi_strut * fce)
                txt = (f"w,req = {A_req / b:.0f} mm" if mdl.dim == 2 else f"A,req = {A_req:.0f} mm²")
                out.append(Check(m.name, "strut", C, None, None, "INFO", code.refs["strut"],
                                 f"{m.strut_class}, f_ce = {fce:.2f} MPa, {txt} (no width given)"))
                continue
            nn, A, how = min(known, key=lambda e: e[1])
            cap = code.phi_strut * fce * A / 1e3
            r = C / cap
            wtxt = f"w = {A / b:.0f} mm at {nn}" if mdl.dim == 2 else f"A = {A:.0f} mm² at {nn}"
            out.append(Check(m.name, "strut", C, cap, r, "OK" if r <= 1 else "NG",
                             code.refs["strut"],
                             f"β_s = {code.beta_s[m.strut_class]} ({m.strut_class}), "
                             f"f_ce = {fce:.2f} MPa, {wtxt} ({how})"))

    # ---------------- nodes: strut-end faces and bearing faces
    for nn, node in mdl.nodes.items():
        k = kinds[nn]
        fce = code.fce_node(fc, k, node.confine)
        cap_stress = code.phi_node * fce
        for m in mdl.members:
            if nn not in (m.i, m.j) or res.forces[m.name] >= -1e-6:
                continue
            C = -res.forces[m.name]
            if mdl.dim == 2:
                w, how = _strut_end_width_2d(res, m, nn)
                A = w * b if w else None
            else:
                A, how = _strut_end_area_3d(res, m, nn)
            if not A:
                continue
            cap = cap_stress * A / 1e3
            r = C / cap
            out.append(Check(nn, "node", C, cap, r, "OK" if r <= 1 else "NG",
                             code.refs["node"],
                             f"{k} node, β_n = {code.beta_n[k]}, β_c = {node.confine}, "
                             f"face of {m.name}, f_ce = {fce:.2f} MPa"))
        # tie faces (tie force acting as bearing on the back face of the node)
        if mdl.dim == 2:
            for m in mdl.members:
                if nn not in (m.i, m.j) or res.forces[m.name] <= 1e-6:
                    continue
                w, how = _strut_end_width_2d(res, m, nn)
                if not w or m.width > 0:
                    continue
                T = res.forces[m.name]
                cap = cap_stress * w * b / 1e3
                r = T / cap
                out.append(Check(nn, "node", T, cap, r, "OK" if r <= 1 else "NG",
                                 code.refs["node"],
                                 f"{k} node, β_n = {code.beta_n[k]}, tie face of {m.name}, "
                                 f"w = {w:.0f} mm, f_ce = {fce:.2f} MPa"))
        # bearing face (load or reaction)
        P = np.array(node.load, dtype=float)
        if nn in res.reactions:
            P = P + np.array(res.reactions[nn])
        Pn = float(np.linalg.norm(P))
        if Pn > 1e-6:
            if mdl.dim == 2 and node.lb > 0:
                A = node.lb * b
            elif mdl.dim == 3 and node.bearing_area > 0:
                A = node.bearing_area
            else:
                A = None
            if A:
                cap = cap_stress * A / 1e3
                r = Pn / cap
                out.append(Check(nn, "bearing", Pn, cap, r, "OK" if r <= 1 else "NG",
                                 code.refs["node"],
                                 f"{k} node bearing face, A = {A:.0f} mm²"))

    # ---------------- strut/tie angle limit
    for nn in mdl.nodes:
        here = [m for m in mdl.members if nn in (m.i, m.j) and abs(res.forces[m.name]) > 1e-6]
        for s in here:
            if res.forces[s.name] >= 0:
                continue
            for t in here:
                if res.forces[t.name] <= 0:
                    continue
                _, us = mdl.geometry(s)
                _, ut = mdl.geometry(t)
                ang = math.degrees(math.acos(min(1.0, abs(float(np.dot(us, ut))))))
                ok = ang >= code.min_angle_deg - 1e-9
                out.append(Check(nn, "angle", ang, code.min_angle_deg, None,
                                 "OK" if ok else "NG", code.refs["angle"],
                                 f"angle {s.name}–{t.name} = {ang:.1f}° (min {code.min_angle_deg:.0f}°)"))
    out += _development(res, code)
    return out


def _development(res, code):
    """Straight-bar development of ties at anchorage nodes (ACI 25.4.2.4, psi = 1, normal-weight).
    Available length per 23.8.2: from where the tie centroid leaves the extended nodal zone
    to the bar end = anchor_ext + lb/2 + (wt/2)/tan(theta)."""
    mdl = res.model
    out = []
    if mdl.dim != 2:
        return out
    for nn, node in mdl.nodes.items():
        if node.anchor_ext < 0:
            continue
        for t in mdl.members:
            if nn not in (t.i, t.j) or res.forces[t.name] <= 1e-6 or t.db <= 0:
                continue
            _, ut = mdl.geometry(t)
            struts = [s for s in mdl.members if nn in (s.i, s.j) and res.forces[s.name] < -1e-6]
            angs = []
            for s in struts:
                _, us = mdl.geometry(s)
                c = min(1.0, abs(float(np.dot(us, ut))))
                if c < 0.999:
                    angs.append(math.acos(c))
            if not angs:
                continue
            th = max(angs)
            avail = node.anchor_ext + node.lb / 2 + (node.wt / 2) / math.tan(th)
            fy = t.fy or mdl.fy
            fc = mdl.fc if code.key.startswith("ACI") else 0.8 * mdl.fc
            k = 2.1 if t.db <= 20 else 1.7
            ld = max(300.0, fy / (k * math.sqrt(fc)) * t.db)
            r = ld / avail
            out.append(Check(f"{t.name}@{nn}", "anchorage", ld, avail, r,
                             "OK" if r <= 1 else "NG", "ACI 318-19 23.8.2, 25.4.2.4",
                             f"straight bar db = {t.db:.0f}: ld = fy/({k}·√f'c)·db = {ld:.0f} mm; "
                             f"available ℓanc = {node.anchor_ext:.0f} + {node.lb:.0f}/2 + "
                             f"({node.wt:.0f}/2)/tan{math.degrees(th):.1f}° = {avail:.0f} mm "
                             "(hooks/heads not yet modelled)"))
    return out


def summary(checks: List[Check]):
    rated = [c for c in checks if c.ratio is not None and c.status in ("OK", "NG")
             and c.kind != "detail" or (c.kind == "detail" and c.status == "NG")]
    worst = max(rated, key=lambda c: c.ratio) if rated else None
    ng = [c for c in checks if c.status == "NG"]
    return {"worst": worst, "n_ng": len(ng), "ok": not ng}

"""Parametric strut-and-tie templates for common D-regions.

Every template returns an STModel.  Geometry in mm, loads in kN (factored).
Template-specific code checks (detailing limits) live in `extra_checks`.
"""
from __future__ import annotations

import math

from .checks import Check
from .codes import CodeSet
from .model import STModel

XY = (True, True)
Y = (False, True)


def _size_chord(force_kN, b, code: CodeSet, fc, kind="CCC", round_to=10.0):
    """Depth of a horizontal compression chord / node so that the node face is
    exactly at capacity, rounded up."""
    f = code.phi_node * code.fce_node(fc, kind)
    w = force_kN * 1e3 / (f * b)
    return math.ceil(w / round_to) * round_to


# ---------------------------------------------------------------------------
def deep_beam(code: CodeSet, L, h, b, P, fc, fy, a=None, lb_load=300, lb_sup=300,
              d_tie=100, wc=None, rho_h=0.0, rho_v=0.0, As_tie=0.0, title=None):
    """Simply supported deep beam. a=None -> one central load P;
    a given -> two symmetric loads P at distance a from each support."""
    wt = 2 * d_tie
    two = a is not None
    # horizontal lever / chord depth by iteration
    R = P if two else P / 2
    x = a if two else L / 2 - lb_load / 4
    wc_i = wc or 0.2 * h
    for _ in range(30):
        jd = h - wt / 2 - wc_i / 2
        T = R * x / jd
        if wc:
            break
        new = max(_size_chord(T, b, code, fc, "CCC"), 50.0)
        if abs(new - wc_i) < 1:
            wc_i = new
            break
        wc_i = new
    wc_i = wc or wc_i
    reinf = rho_h >= 0.0025 and rho_v >= 0.0025
    diag_cls = "interior_reinf" if reinf else "interior_no_reinf"
    m = STModel(title or ("Deep beam, two point loads" if two else "Deep beam, central point load"),
                dim=2, b=b, fc=fc, fy=fy)
    yb, yt = wt / 2, h - wc_i / 2
    m.add_node("A", (0, yb), fix=XY, lb=lb_sup, wt=wt)
    m.add_node("B", (L, yb), fix=Y, lb=lb_sup, wt=wt)
    if two:
        m.add_node("C", (a, yt), load=(0, -P), lb=lb_load, wt=wc_i)
        m.add_node("D", (L - a, yt), load=(0, -P), lb=lb_load, wt=wc_i)
    else:
        m.add_node("C", (L / 2 - lb_load / 4, yt), load=(0, -P / 2), lb=lb_load / 2, wt=wc_i)
        m.add_node("D", (L / 2 + lb_load / 4, yt), load=(0, -P / 2), lb=lb_load / 2, wt=wc_i)
    m.add_member("AC", "A", "C", strut_class=diag_cls)
    m.add_member("DB", "D", "B", strut_class=diag_cls)
    m.add_member("CD", "C", "D", strut_class="boundary")
    m.add_member("AB", "A", "B", As=As_tie)
    m.meta = dict(template="deep_beam", L=L, h=h, b=b, P=P, a=a, lb_load=lb_load,
                  lb_sup=lb_sup, d_tie=d_tie, wc=wc_i, rho_h=rho_h, rho_v=rho_v,
                  d=h - d_tie,
                  outline=[[(-lb_sup / 2, 0), (L + lb_sup / 2, 0), (L + lb_sup / 2, h), (-lb_sup / 2, h)]],
                  notes=[f"Top chord/node depth wc = {wc_i:.0f} mm "
                         + ("(given)" if wc else "(sized so the CCC node face is at capacity)"),
                         f"Bottom tie zone height wt = 2·{d_tie:.0f} = {wt:.0f} mm",
                         "Diagonal strut class: " + diag_cls])
    return m


# ---------------------------------------------------------------------------
def corbel(code: CodeSet, hc, b, h, d, av, Vu, fc, fy, Nuc=None, lb=150, c_col=60,
           As_tie=0.0, title=None):
    """Single corbel projecting from a column face (x = 0, corbel on +x side).
    hc = column depth in the plane of the corbel."""
    Nuc = 0.2 * Vu if Nuc is None else Nuc
    m = STModel(title or "Corbel", dim=2, b=b, fc=fc, fy=fy)
    yA = d
    # Node C: strut lands in the column compression zone near the corbel soffit
    xC, yC = -c_col, c_col
    m.add_node("A", (av, yA), load=(Nuc, -Vu), lb=lb, wt=2 * (h - d))
    m.add_node("B", (-(hc - c_col), yA), fix=XY, wt=2 * (h - d))   # tie anchored at far column bars
    m.add_node("C", (xC, yC), fix=XY, lb=0.25 * hc, wt=2 * c_col)
    m.add_member("AB", "A", "B", As=As_tie)
    m.add_member("AC", "A", "C", strut_class="interior_no_reinf")
    m.meta = dict(template="corbel", hc=hc, b=b, h=h, d=d, av=av, Vu=Vu, Nuc=Nuc, lb=lb,
                  c_col=c_col,
                  outline=[[(-hc, -0.8 * h), (0, -0.8 * h), (0, 0), (av + lb / 2 + 75, 0),
                            (av + lb / 2 + 75, h), (0, h), (0, 1.8 * h), (-hc, 1.8 * h)]],
                  notes=[f"Horizontal force Nuc = {Nuc:.1f} kN applied with Vu",
                         "Tie anchored at the far-face column bars; node C in the column "
                         "compression zone at the corbel soffit (assumed face 0.25·hc × 2·c_col)",
                         "Reactions at B and C are the forces delivered to the column"])
    return m


# ---------------------------------------------------------------------------
def pile_cap_2(code: CodeSet, s, c, h, b, D, P, fc, fy, d_tie=150, wc=None,
               As_tie=0.0, strut_class="interior_no_reinf", title=None):
    """Two-pile cap (2D section). s = pile spacing, c = column width, D = pile dia."""
    wt = 2 * d_tie
    x = s / 2 - c / 4
    wc_i = wc or 0.15 * h
    for _ in range(30):
        jd = h - wt / 2 - wc_i / 2
        T = (P / 2) * x / jd
        if wc:
            break
        new = max(_size_chord(T, b, code, fc, "CCC"), 50.0)
        if abs(new - wc_i) < 1:
            wc_i = new
            break
        wc_i = new
    m = STModel(title or "Two-pile cap", dim=2, b=b, fc=fc, fy=fy)
    yt = h - wc_i / 2
    m.add_node("P1", (-s / 2, wt / 2), fix=XY, lb=D, wt=wt)
    m.add_node("P2", (s / 2, wt / 2), fix=Y, lb=D, wt=wt)
    m.add_node("T1", (-c / 4, yt), load=(0, -P / 2), lb=c / 2, wt=wc_i)
    m.add_node("T2", (c / 4, yt), load=(0, -P / 2), lb=c / 2, wt=wc_i)
    m.add_member("S1", "T1", "P1", strut_class=strut_class)
    m.add_member("S2", "T2", "P2", strut_class=strut_class)
    m.add_member("S12", "T1", "T2", strut_class="boundary")
    m.add_member("T", "P1", "P2", As=As_tie)
    m.meta = dict(template="pile_cap_2", s=s, c=c, h=h, b=b, D=D, P=P, d=h - d_tie,
                  d_tie=d_tie, wc=wc_i,
                  outline=[[(-s / 2 - D / 2 - 150, 0), (s / 2 + D / 2 + 150, 0), (s / 2 + D / 2 + 150, h),
                            (c / 2, h), (c / 2, h + 300), (-c / 2, h + 300), (-c / 2, h),
                            (-s / 2 - D / 2 - 150, h)]],
                  notes=[f"Top node depth wc = {wc_i:.0f} mm", "Pile treated as a "
                         f"{D:.0f} mm bearing width in the 2D section",
                         f"Diagonal strut class: {strut_class}"])
    return m


# ---------------------------------------------------------------------------
def pile_cap_4(code: CodeSet, s, a, h, D, P, fc, fy, d_tie=150, d_top=None,
               As_tie=0.0, strut_class="interior_no_reinf", title=None):
    """Four-pile cap, 3D space truss. Piles on a square s x s, square column a x a.
    Four top nodes at the column quarter points, ties along the pile lines."""
    d_top = d_tie if d_top is None else d_top
    zb, zt = d_tie, h - d_top
    m = STModel(title or "Four-pile cap (3D)", dim=3, fc=fc, fy=fy, b=1.0)
    Apile = math.pi * D * D / 4
    sgn = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for k, (sx, sy) in enumerate(sgn, 1):
        fix = (k in (1,), k in (1, 2), True)
        m.add_node(f"P{k}", (sx * s / 2, sy * s / 2, zb), fix=fix, bearing_area=Apile)
        m.add_node(f"T{k}", (sx * a / 4, sy * a / 4, zt), load=(0, 0, -P / 4),
                   bearing_area=a * a / 4)
    ring_area = 2 * d_top * a / 2    # top compression ring: depth 2·d_top x half column
    for k in range(1, 5):
        n = k % 4 + 1
        m.add_member(f"S{k}", f"T{k}", f"P{k}", strut_class=strut_class)
        m.add_member(f"T{k}{n}", f"P{k}", f"P{n}", As=As_tie)
        m.add_member(f"C{k}{n}", f"T{k}", f"T{n}", strut_class="boundary", area=ring_area)
    m.meta = dict(template="pile_cap_4", s=s, a=a, h=h, D=D, P=P, d_tie=d_tie,
                  d_top=d_top, d=h - d_tie,
                  outline=[[(-e, -e, z), (e, -e, z), (e, e, z), (-e, e, z)] for e in [s / 2 + D / 2 + 150]
                           for z in (0, h)],
                  notes=[f"Top nodes at column quarter points, {d_top:.0f} mm below top",
                         f"Pile bearing area π·{D:.0f}²/4 = {Apile:.0f} mm²",
                         "Ties bunched over the piles along the four cap edges",
                         f"Top ring strut area assumed {ring_area:.0f} mm²"])
    return m


# ---------------------------------------------------------------------------
def pier_cap(code: CodeSet, xb, cw, h, b, P1, P2, fc, fy, d_tie=100, wc=None, lb=400,
             As_tie=0.0, title=None):
    """Hammerhead pier cap: bearings at x = -xb and +xb, column width cw centred at 0.
    Tie along the top; struts from bearings into the column."""
    wt = 2 * d_tie
    yt = h - d_tie
    Pmax = max(P1, P2)
    wc_i = wc or 0.15 * h
    for _ in range(30):
        jd = yt - wc_i / 2
        T = Pmax * (xb - cw / 4) / jd
        if wc:
            break
        new = max(_size_chord(T, b, code, fc, "CCC"), 50.0)
        if abs(new - wc_i) < 1:
            wc_i = new
            break
        wc_i = new
    m = STModel(title or "Hammerhead pier cap", dim=2, b=b, fc=fc, fy=fy)
    m.add_node("L1", (-xb, yt), load=(0, -P1), lb=lb, wt=wt)
    m.add_node("L2", (xb, yt), load=(0, -P2), lb=lb, wt=wt)
    m.add_node("M1", (-cw / 4, yt), wt=wt)
    m.add_node("M2", (cw / 4, yt), wt=wt)
    m.add_node("C1", (-cw / 4, wc_i / 2), fix=XY, lb=cw / 2, wt=wc_i)
    m.add_node("C2", (cw / 4, wc_i / 2), fix=XY, lb=cw / 2, wt=wc_i)
    m.add_member("T1", "L1", "M1", As=As_tie)
    m.add_member("T0", "M1", "M2", As=As_tie)
    m.add_member("T2", "M2", "L2", As=As_tie)
    m.add_member("S1", "L1", "C1", strut_class="interior_no_reinf")
    m.add_member("S2", "L2", "C2", strut_class="interior_no_reinf")
    m.add_member("V1", "M1", "C1", strut_class="interior_no_reinf")
    m.add_member("V2", "M2", "C2", strut_class="interior_no_reinf")
    if abs(P1 - P2) > 1e-9:
        # diagonal carrying the unbalanced shear; orientation chosen so it is a strut
        for (i, j) in (("M1", "C2"), ("M2", "C1")):
            m.add_member("D", i, j, strut_class="interior_no_reinf")
            r = m.solve()
            if r.forces["D"] <= 0:
                break
            m.members.pop()
    m.meta = dict(template="pier_cap", xb=xb, cw=cw, h=h, b=b, P1=P1, P2=P2, lb=lb,
                  d=h - d_tie, wc=wc_i,
                  outline=[[(-cw / 2, -0.6 * h), (cw / 2, -0.6 * h), (cw / 2, 0), (xb + lb / 2 + 200, 0),
                            (xb + lb / 2 + 200, h), (-xb - lb / 2 - 200, h), (-xb - lb / 2 - 200, 0),
                            (-cw / 2, 0)]],
                  notes=[f"Column-top nodes at ±cw/4, node depth {wc_i:.0f} mm",
                         f"Top tie zone height wt = {wt:.0f} mm"])
    return m


# ---------------------------------------------------------------------------
def dapped_end(code: CodeSet, H, hn, ln, xb, b, Vu, fc, fy, Nuc=None, e_h=75, a_c=350,
               lb=150, c_top=75, c_bot=75, c_nib=75, c_end=40, As_nib=0.0, As_hanger=0.0,
               As_bot=0.0, As_vert=0.0, db=25, strut_class="interior_reinf", title=None):
    """Dapped end of a beam (x = 0 at the end of the nib, y = 0 at the beam soffit).
    The bearing reaction Vu (up) and the restraint force Nuc (outward) act on the nib.
    The truss is cut at node C/G/H, one hanger-to-anchorage distance a_c inside the
    hanger; the forces at G and H are what the rest of the beam must carry."""
    Nuc = 0.2 * Vu if Nuc is None else Nuc
    m = STModel(title or "Dapped end", dim=2, b=b, fc=fc, fy=fy)
    yA, yT, yB = H - hn + c_nib, H - c_top, c_bot
    xh = ln + e_h
    xc = xh + a_c
    m.add_node("A", (xb, yA), load=(-Nuc, Vu), lb=lb, wt=2 * c_nib, anchor_ext=xb - c_end)
    m.add_node("C0", (xh, yA), wt=2 * c_nib)
    m.add_node("B", (xh, yT), wt=2 * c_top)
    m.add_node("D", (xh, yB), wt=2 * c_bot)
    m.add_node("C", (xc, yA), wt=2 * c_nib)
    m.add_node("G", (xc, yT), fix=XY, wt=2 * c_top)
    m.add_node("H", (xc, yB), fix=XY, wt=2 * c_bot)
    m.add_member("S1", "A", "B", strut_class=strut_class)
    m.add_member("TN1", "A", "C0", As=As_nib, db=db)
    m.add_member("TN2", "C0", "C", As=As_nib, db=db)
    m.add_member("HG1", "C0", "B", As=As_hanger)
    m.add_member("HG2", "D", "C0", As=As_hanger)
    m.add_member("TC1", "B", "G", strut_class="boundary")
    m.add_member("BC1", "D", "H", As=As_bot, db=db)
    m.add_member("S2", "D", "C", strut_class=strut_class)
    m.add_member("S3", "B", "C", strut_class=strut_class)
    m.add_member("V1", "C", "H", As=As_vert)
    m.meta = dict(template="dapped_end", H=H, hn=hn, ln=ln, xb=xb, Vu=Vu, Nuc=Nuc, d=H - c_bot,
                  outline=[[(0, H - hn), (ln, H - hn), (ln, 0), (xc + hn, 0), (xc + hn, H), (0, H)]],
                  notes=[f"Bearing reaction Vu = {Vu:.1f} kN (up) and restraint Nuc = {Nuc:.1f} kN (outward) act on the nib at A",
                         f"Hanger at {e_h:.0f} mm from the re-entrant corner; truss cut {a_c:.0f} mm beyond the hanger (nodes C, G, H)",
                         "G and H carry the section forces into the rest of the beam",
                         "Nib tie TN1/TN2 and hanger HG1/HG2 need full anchorage at both ends (check hooks at A)"])
    return m


TEMPLATES = {
    "deep_beam": deep_beam,
    "corbel": corbel,
    "pile_cap_2": pile_cap_2,
    "pile_cap_4": pile_cap_4,
    "pier_cap": pier_cap,
    "dapped_end": dapped_end,
}


# ---------------------------------------------------------------------------
def extra_checks(model: STModel, res, code: CodeSet):
    """Template-specific code checks that are not strut/tie/node strength."""
    t = model.meta.get("template")
    out = []
    fc, fy = model.fc, model.fy
    if t == "deep_beam":
        rh, rv = model.meta["rho_h"], model.meta["rho_v"]
        for lab, r in (("ρ_h", rh), ("ρ_v", rv)):
            out.append(Check("web", "detail", r, 0.0025, r and 0.0025 / r,
                             "OK" if r >= 0.0025 else "INFO", code.refs["distributed"],
                             f"{lab} = {r:.4f} (≥ 0.0025 needed to use β_s = 0.75)"))
    uses_se = any(m.strut_class == "interior_sizeeffect" for m in model.members)
    if t in ("deep_beam", "pile_cap_2", "pier_cap", "pile_cap_4") and code.key.startswith("ACI"):
        d = model.meta["d"]
        bw = model.b
        if t == "pile_cap_4":
            bw = model.meta["s"] + model.meta["D"] + 300
            Vu = model.meta["P"] / 2
        elif t == "pier_cap":
            Vu = max(model.meta["P1"], model.meta["P2"])
        else:
            Vu = max(abs(r[1]) for r in res.reactions.values())
        lam_s = min(1.0, math.sqrt(2 / (1 + 0.004 * d)))
        Vlim = code.phi_strut * 0.42 * lam_s * math.sqrt(fc) * bw * d / 1e3
        out.append(Check("section", "detail", Vu, Vlim, Vu / Vlim,
                         "OK" if Vu <= Vlim else ("NG" if uses_se else "INFO"), code.refs["sizeeffect"],
                         f"Vu ≤ φ·0.42·λs·√f'c·bw·d, λs = {lam_s:.3f}, bw = {bw:.0f}, d = {d:.0f}; required when "
                         "β_s = 0.75 is used without distributed reinforcement"))
    if t == "corbel":
        d, av, b = model.meta["d"], model.meta["av"], model.b
        Vu, Nuc = model.meta["Vu"], model.meta["Nuc"]
        out.append(Check("geometry", "detail", av / d, 1.0, av / d,
                         "OK" if av / d <= 1.0 else "NG", code.refs["corbel"],
                         f"a_v/d = {av:.0f}/{d:.0f} = {av / d:.2f} ≤ 1.0"))
        out.append(Check("load", "detail", Nuc, Vu, Nuc / Vu if Vu else None,
                         "OK" if 0.2 * Vu - 1e-9 <= Nuc <= Vu else "NG", code.refs["corbel"],
                         f"0.2·Vu ≤ Nuc ≤ Vu ({Nuc:.1f} kN)"))
        if code.key.startswith("ACI"):
            Vn = min(0.2 * fc, 3.3 + 0.08 * fc, 11.0) * b * d / 1e3
            out.append(Check("section", "detail", Vu, 0.75 * Vn, Vu / (0.75 * Vn),
                             "OK" if Vu <= 0.75 * Vn else "NG", code.refs["corbel"],
                             "Vu ≤ φ·min(0.2f'c, 3.3+0.08f'c, 11)·bw·d (16.5.2.4)"))
            Asmin = 0.04 * fc / fy * b * d
            tie = next((m for m in model.members if m.name == "AB"), None)
            if tie is not None:
                out.append(Check("AB", "detail", tie.As, Asmin, (Asmin / tie.As) if tie.As else None,
                                 ("OK" if tie.As >= Asmin else "NG") if tie.As else "INFO",
                                 code.refs["corbel"],
                                 f"As,min = 0.04·(f'c/fy)·b·d = {Asmin:.0f} mm² (16.5.5.5)"))
    return out

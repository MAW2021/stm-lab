"""Printable HTML calculation report with an SVG drawing of the model."""
from __future__ import annotations

import datetime as _dt
import html
import math

import numpy as np

from . import __version__
from .checks import summary

E = html.escape


def _project(model, pts):
    """Return 2D drawing coordinates (x right, y up) for node coordinates."""
    if model.dim == 2:
        return {k: (v[0], v[1]) for k, v in pts.items()}
    # isometric-ish projection for 3D
    out = {}
    ca, sa = math.cos(math.radians(30)), math.sin(math.radians(30))
    for k, (x, y, z) in pts.items():
        out[k] = ((x - y) * ca, (x + y) * sa * 0.55 + z)
    return out


def svg_model(res, W=760, H=430, pad=60):
    mdl = res.model
    pts = {k: n.xyz for k, n in mdl.nodes.items()}
    outline = mdl.meta.get("outline", [])
    allp = dict(pts)
    for pi, poly in enumerate(outline):
        for vi, p in enumerate(poly):
            allp[f"_o{pi}_{vi}"] = p
    P = _project(mdl, allp)
    xs = [p[0] for p in P.values()]
    ys = [p[1] for p in P.values()]
    sx = (W - 2 * pad) / max(1e-9, max(xs) - min(xs))
    sy = (H - 2 * pad) / max(1e-9, max(ys) - min(ys))
    s = min(sx, sy)
    ox = (W - s * (max(xs) - min(xs))) / 2 - s * min(xs)
    oy = (H + s * (max(ys) - min(ys))) / 2 + s * min(ys)

    def T(p):
        return ox + s * p[0], oy - s * p[1]

    g = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" class="stm">',
         '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
         'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" '
         'fill="#222"/></marker></defs>']
    for pi, poly in enumerate(outline):
        d = " ".join(f"{T(P[f'_o{pi}_{vi}'])[0]:.1f},{T(P[f'_o{pi}_{vi}'])[1]:.1f}"
                     for vi in range(len(poly)))
        g.append(f'<polygon points="{d}" fill="#eef1f5" stroke="#9aa5b1" stroke-width="1"/>')
    fmax = max([abs(f) for f in res.forces.values()] + [1e-9])
    for m in mdl.members:
        f = res.forces[m.name]
        (x1, y1), (x2, y2) = T(P[m.i]), T(P[m.j])
        wpx = 1.5 + 5 * abs(f) / fmax
        if abs(f) < 1e-6:
            sty = 'stroke="#aaa" stroke-width="1" stroke-dasharray="2,3"'
        elif f > 0:
            sty = f'stroke="#c62828" stroke-width="{wpx:.1f}"'
        else:
            sty = f'stroke="#1565c0" stroke-width="{wpx:.1f}" stroke-dasharray="9,5"'
        g.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" {sty}/>')
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        g.append(f'<text x="{mx:.1f}" y="{my - 6:.1f}" class="lbl" text-anchor="middle">'
                 f'{E(m.name)} {f:+.0f}</text>')
    for k, n in mdl.nodes.items():
        x, y = T(P[k])
        g.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#222"/>')
        g.append(f'<text x="{x + 7:.1f}" y="{y + 14:.1f}" class="nd">{E(k)}</text>')
        if any(n.fix):
            g.append(f'<path d="M{x:.1f},{y + 5:.1f} l-9,14 h18 z" fill="none" stroke="#2e7d32" '
                     'stroke-width="1.5"/>')
        L = np.array(n.load, dtype=float)
        if np.linalg.norm(L) > 0:
            v = L / np.linalg.norm(L)
            dv = _project(mdl, {"a": tuple(np.zeros(mdl.dim)), "b": tuple(v)})
            dx, dy = dv["b"][0] - dv["a"][0], dv["b"][1] - dv["a"][1]
            nn = math.hypot(dx, dy) or 1
            dx, dy = dx / nn, dy / nn
            x0, y0 = x - 45 * dx, y + 45 * dy
            g.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x - 6 * dx:.1f}" y2="{y + 6 * dy:.1f}" '
                     'stroke="#222" stroke-width="1.6" marker-end="url(#arr)"/>')
            g.append(f'<text x="{x0 + 4:.1f}" y="{y0 - 4:.1f}" class="ld">{np.linalg.norm(L):.0f} kN</text>')
    g.append('</svg>')
    return "\n".join(g)


def _fmt(v, nd=1):
    if v is None:
        return "–"
    if isinstance(v, float):
        return f"{v:,.{nd}f}"
    return E(str(v))


CSS = """
:root{--ink:#1d232b;--mut:#5b6673;--ok:#1b7f3b;--ng:#b3261e;--info:#8a6d00;--line:#d5dbe2;--bg:#fff}
*{box-sizing:border-box}
body{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:24px;max-width:1000px;margin:auto}
h1{font-size:20px;margin:0 0 2px} h2{font-size:15px;border-bottom:2px solid var(--ink);padding-bottom:3px;margin:22px 0 8px}
.sub{color:var(--mut)} table{border-collapse:collapse;width:100%;margin:6px 0}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f3f5f8;font-weight:600} td.n{text-align:right;font-variant-numeric:tabular-nums}
.OK{color:var(--ok);font-weight:600}.NG{color:var(--ng);font-weight:700}.INFO{color:var(--info);font-weight:600}
.banner{border:2px solid var(--ng);color:var(--ng);padding:8px 10px;margin:10px 0;font-weight:600}
.verdict{font-size:15px;padding:8px 10px;border:2px solid;display:inline-block;margin:6px 0}
.verdict.OK{border-color:var(--ok)}.verdict.NG{border-color:var(--ng)}
svg.stm{width:100%;height:auto;border:1px solid var(--line);background:#fff}
svg .lbl{font:11px Arial;fill:#333} svg .nd{font:bold 12px Arial;fill:#111} svg .ld{font:11px Arial;fill:#111}
.legend span{margin-right:16px} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:700px){.grid2{grid-template-columns:1fr} body{padding:12px}}
@media print{body{padding:0;font-size:11px} h2{break-after:avoid} table,svg{break-inside:avoid}}
"""


def html_report(res, checks, code, project="", engineer="", element=""):
    mdl = res.model
    sm = summary(checks)
    ok = sm["ok"]
    now = _dt.date.today().isoformat()
    meta = {k: v for k, v in mdl.meta.items() if k not in ("notes", "outline", "template")}
    h = [f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' "
         f"content='width=device-width,initial-scale=1'><title>STM calc – {E(mdl.title)}</title>"
         f"<style>{CSS}</style></head><body>"]
    h.append(f"<h1>Strut-and-tie calculation: {E(element or mdl.title)}</h1>")
    h.append(f"<div class='sub'>Project: {E(project or '—')} · Engineer: {E(engineer or '—')} · "
             f"Date: {now} · Code: {E(code.name)} · STM-Lab v{__version__}</div>")
    if code.provisional:
        h.append("<div class='banner'>PROVISIONAL CODE FACTORS – the ECP 203 strength factors in "
                 "this tool have not yet been confirmed against the code text. Do not use for "
                 "design until they are verified.</div>")
    if not res.stable:
        h.append("<div class='banner'>The truss is unstable or not in equilibrium under these "
                 f"loads (residual {res.residual:.3g} kN). Results are not valid.</div>")
    w = sm["worst"]
    verdict = "ALL CHECKS PASS" if ok else f"{sm['n_ng']} CHECK(S) FAIL"
    h.append(f"<div class='verdict {'OK' if ok else 'NG'}'>{verdict}"
             + (f" · governing: {E(w.kind)} {E(w.item)} at {w.ratio:.2f}" if w else "")
             + "</div>")

    h.append("<h2>1. Input data</h2><table><tr><th>Parameter</th><th>Value</th></tr>")
    for k, v in meta.items():
        h.append(f"<tr><td>{E(k)}</td><td>{_fmt(v, 4 if isinstance(v, float) and abs(v) < 0.1 else 1)}</td></tr>")
    h.append(f"<tr><td>{code.fc_symbol}</td><td>{mdl.fc} MPa</td></tr><tr><td>fy</td><td>{mdl.fy} MPa</td></tr>")
    if mdl.dim == 2:
        h.append(f"<tr><td>b (thickness)</td><td>{mdl.b:.0f} mm</td></tr>")
    h.append("</table><div class='sub'>Units: mm, kN, MPa. Loads are factored.</div>")

    h.append("<h2>2. Code parameters</h2><table><tr><th>Item</th><th>Value</th><th>Reference</th></tr>")
    h.append(f"<tr><td>Effective strength</td><td>{E(code.refs['fce'])}</td><td></td></tr>")
    h.append("<tr><td>β_s</td><td>" + ", ".join(f"{E(k)} {v}" for k, v in code.beta_s.items())
             + f"</td><td>{E(code.refs['strut'])}</td></tr>")
    h.append("<tr><td>β_n</td><td>" + ", ".join(f"{k} {v}" for k, v in code.beta_n.items())
             + f"</td><td>{E(code.refs['node'])}</td></tr>")
    h.append(f"<tr><td>φ strut / node / tie</td><td>{code.phi_strut} / {code.phi_node} / "
             f"{code.phi_tie}</td><td></td></tr>")
    h.append(f"<tr><td>Min. strut–tie angle</td><td>{code.min_angle_deg:.0f}°</td>"
             f"<td>{E(code.refs['angle'])}</td></tr></table>")

    h.append("<h2>3. Strut-and-tie model</h2>")
    h.append(svg_model(res))
    h.append("<div class='legend sub'><span style='color:#1565c0'>– – strut (compression)</span>"
             "<span style='color:#c62828'>—— tie (tension)</span><span>line weight ∝ force</span></div>")
    h.append("<table><tr><th>Node</th><th>Coordinates (mm)</th><th>Load (kN)</th>"
             "<th>Support</th><th>Reaction (kN)</th></tr>")
    for k, n in mdl.nodes.items():
        r = res.reactions.get(k)
        h.append(f"<tr><td>{E(k)}</td><td>{', '.join(f'{c:.0f}' for c in n.xyz)}</td>"
                 f"<td>{', '.join(f'{c:.1f}' for c in n.load) if any(n.load) else ''}</td>"
                 f"<td>{''.join('XYZ'[i] for i, f in enumerate(n.fix) if f)}</td>"
                 f"<td>{', '.join(f'{c:.1f}' for c in r) if r else ''}</td></tr>")
    h.append("</table>")

    h.append("<h2>4. Member forces</h2><table><tr><th>Member</th><th>Nodes</th><th>Length (mm)</th>"
             "<th>Angle to horizontal</th><th>Force (kN)</th><th>Type</th></tr>")
    for m in mdl.members:
        L, u = mdl.geometry(m)
        ang = math.degrees(math.asin(min(1.0, abs(u[-1]))))
        f = res.forces[m.name]
        h.append(f"<tr><td>{E(m.name)}</td><td>{E(m.i)}–{E(m.j)}</td><td class='n'>{L:,.0f}</td>"
                 f"<td class='n'>{ang:.1f}°</td><td class='n'>{f:+,.1f}</td><td>{res.role(m)}</td></tr>")
    h.append("</table>")

    groups = [("5. Strut checks", ("strut",)), ("6. Tie checks", ("tie",)),
              ("7. Nodal zone checks", ("node", "bearing")), ("8. Geometry, anchorage and detailing", ("angle", "anchorage", "detail"))]
    for title, kinds in groups:
        rows = [c for c in checks if c.kind in kinds]
        if not rows:
            continue
        h.append(f"<h2>{title}</h2><table><tr><th>Item</th><th>Check</th><th>Demand</th>"
                 "<th>Capacity</th><th>Ratio</th><th>Status</th><th>Details</th><th>Clause</th></tr>")
        for c in rows:
            nd = 3 if c.kind == "detail" and c.capacity is not None and c.capacity < 1 else 1
            h.append(f"<tr><td>{E(c.item)}</td><td>{E(c.kind)}</td><td class='n'>{_fmt(float(c.demand), nd)}</td>"
                     f"<td class='n'>{_fmt(None if c.capacity is None else float(c.capacity), nd)}</td>"
                     f"<td class='n'>{'' if c.ratio is None else f'{c.ratio:.2f}'}</td>"
                     f"<td class='{c.status}'>{c.status}</td><td>{E(c.detail)}</td><td>{E(c.clause)}</td></tr>")
        h.append("</table>")

    h.append("<h2>9. Assumptions and notes</h2><ul>")
    for n in mdl.meta.get("notes", []):
        h.append(f"<li>{E(n)}</li>")
    h.append("<li>Truss solved as a pin-jointed frame by the direct stiffness method; equilibrium "
             f"error {res.equilibrium_error:.2e} kN.</li>")
    h.append("<li>Strut width at a node = lb·sinθ + wt·cosθ (projection of the nodal face); strut "
             "capacity taken at the weaker end.</li>")
    h.append("<li>Not yet checked by this tool: hooked/headed anchorage, crack-control "
             "reinforcement detailing, and serviceability.</li></ul>")
    h.append("</body></html>")
    return "".join(h)

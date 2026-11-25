"""Local browser UI (offline).  Run:  python -m stm.ui   then open http://127.0.0.1:8765

Uses only the Python standard library plus numpy.  Nothing leaves the computer.
"""
from __future__ import annotations

import html
import inspect
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

from .codes import CODES, STRUT_CLASSES
from .engine import run_case
from .templates import TEMPLATES

PORT = 8765

LABELS = {
    "L": "Span between supports L (mm)", "h": "Overall depth h (mm)", "b": "Thickness b (mm)",
    "P": "Factored load P (kN)", "fc": "Concrete strength f'c (MPa)",
    "fy": "Steel yield fy (MPa)", "a": "Shear span a for two loads (mm, blank = one central load)",
    "lb_load": "Load plate length (mm)", "lb_sup": "Support plate length (mm)",
    "d_tie": "Tie centroid from face (mm)", "wc": "Top node / chord depth (mm, blank = auto)",
    "rho_h": "Horizontal web reinf. ratio", "rho_v": "Vertical web reinf. ratio",
    "As_tie": "Provided tie steel As (mm², 0 = design)", "hc": "Column depth hc (mm)",
    "d": "Effective depth d (mm)", "av": "Load distance from column face a_v (mm)",
    "Vu": "Factored vertical load Vu (kN)", "Nuc": "Horizontal force Nuc (kN, blank = 0.2Vu)",
    "lb": "Bearing plate length (mm)", "c_col": "Column cover to bar centroid (mm)",
    "s": "Pile spacing s (mm)", "c": "Column width c (mm)", "D": "Pile diameter D (mm)",
    "a_col": "Column size (mm)", "d_top": "Top node depth (mm, blank = d_tie)",
    "strut_class": "Diagonal strut class", "xb": "Bearing distance from column axis (mm)",
    "cw": "Column width (mm)", "P1": "Left bearing load P1 (kN)", "P2": "Right bearing load P2 (kN)",
    "title": "Element title",
    "pile_cap_4.a": "Square column size a (mm)", "pile_cap_2.b": "Cap width b (mm)",
    "corbel.h": "Corbel depth at column face h (mm)",
}
DEFAULTS = {
    "deep_beam": dict(L=3000, h=1500, b=400, P=1200, fc=35, fy=420),
    "corbel": dict(hc=400, b=400, h=500, d=450, av=200, Vu=400, fc=35, fy=420),
    "pile_cap_2": dict(s=1800, c=500, h=1000, b=800, D=600, P=2500, fc=30, fy=420),
    "pile_cap_4": dict(s=1800, a=800, h=1200, D=600, P=4000, fc=30, fy=420),
    "pier_cap": dict(xb=2500, cw=1500, h=1800, b=1500, P1=3000, P2=3000, fc=35, fy=420),
    "dapped_end": dict(H=1200, hn=600, ln=500, xb=250, b=500, Vu=400, fc=30, fy=420),
}
NAMES = {"deep_beam": "Deep beam / transfer girder", "corbel": "Corbel",
         "pile_cap_2": "Two-pile cap", "pile_cap_4": "Four-pile cap (3D)",
         "pier_cap": "Hammerhead pier cap", "dapped_end": "Dapped end", "custom": "Custom model (JSON)"}

CUSTOM_EXAMPLE = json.dumps({
    "title": "Custom deep beam", "dim": 2, "b": 400, "fc": 35, "fy": 420,
    "nodes": [
        {"name": "A", "xyz": [0, 100], "fix": [True, True], "lb": 300, "wt": 200},
        {"name": "B", "xyz": [3000, 100], "fix": [False, True], "lb": 300, "wt": 200},
        {"name": "C", "xyz": [1500, 1400], "load": [0, -1000], "lb": 400, "wt": 200}],
    "members": [
        {"name": "AC", "i": "A", "j": "C", "strut_class": "interior_reinf"},
        {"name": "CB", "i": "C", "j": "B", "strut_class": "interior_reinf"},
        {"name": "AB", "i": "A", "j": "B", "As": 2000}]}, indent=1)


def _fields(tpl):
    sig = inspect.signature(TEMPLATES[tpl])
    out = []
    for name, p in list(sig.parameters.items())[1:]:
        dv = DEFAULTS[tpl].get(name, None if p.default is inspect._empty else p.default)
        out.append((name, dv))
    return out


def page(tpl="deep_beam", values=None, code="ACI318-19", report="", error="", project="", element=""):
    E = html.escape
    values = values or {}
    opts = "".join(f"<option value='{k}' {'selected' if k == tpl else ''}>{v}</option>" for k, v in NAMES.items())
    copts = "".join(f"<option value='{k}' {'selected' if k == code else ''}>{E(c.name)}</option>"
                    for k, c in CODES.items())
    rows = []
    if tpl == "custom":
        rows.append(f"<label>Model JSON<textarea name='custom' rows='22'>"
                    f"{E(values.get('custom', CUSTOM_EXAMPLE))}</textarea></label>")
    else:
        for name, dv in _fields(tpl):
            v = values.get(name, "" if dv is None else dv)
            lab = LABELS.get(f"{tpl}.{name}", LABELS.get(name, name))
            if name == "strut_class":
                so = "".join(f"<option value='{k}' {'selected' if k == v else ''}>{E(d)}</option>"
                             for k, d in STRUT_CLASSES.items())
                rows.append(f"<label>{E(lab)}<select name='{name}'>{so}</select></label>")
            else:
                rows.append(f"<label>{E(lab)}<input name='{name}' value='{E(str(v))}'></label>")
    rep = (f"<iframe id='rep' srcdoc=\"{E(report)}\"></iframe>"
           "<button type='button' onclick=\"var w=window.open('');w.document.write("
           "document.getElementById('rep').srcdoc);w.document.close();\">Open report for print / save</button>"
           if report else "<p class='hint'>Fill in the inputs and press Run.</p>")
    return f"""<!doctype html><html><head><meta charset='utf-8'><title>STM-Lab</title>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<style>
body{{font:14px 'Segoe UI',Arial,sans-serif;margin:0;color:#1d232b;background:#f4f6f9}}
header{{background:#1d232b;color:#fff;padding:10px 18px;font-weight:600}}
main{{display:grid;grid-template-columns:360px 1fr;gap:16px;padding:16px}}
form{{background:#fff;padding:14px;border:1px solid #d5dbe2}}
label{{display:block;margin:6px 0;font-size:12px;color:#444}}
input,select,textarea{{width:100%;box-sizing:border-box;padding:5px;font:13px Consolas,monospace;border:1px solid #c3cbd5}}
button{{margin-top:10px;padding:8px 14px;background:#1565c0;color:#fff;border:0;cursor:pointer}}
iframe{{width:100%;height:80vh;border:1px solid #d5dbe2;background:#fff}}
.err{{color:#b3261e;white-space:pre-wrap}} .hint{{color:#666}}
@media(max-width:800px){{main{{grid-template-columns:1fr}}}}
</style></head><body><header>STM-Lab · offline strut-and-tie design</header><main>
<form method='post'>
<label>Element type<select name='template' onchange="location='/?t='+this.value">{opts}</select></label>
<label>Design code<select name='code'>{copts}</select></label>
<label>Project<input name='project' value='{E(project)}'></label>
<label>Element name<input name='element' value='{E(element)}'></label>
<label>Strut width at nodes without a plate<select name='interior_width_rule'>
<option value='projection'>Projection wt·cosθ (conservative, default)</option>
<option value='secant' {'selected' if values.get('interior_width_rule')=='secant' else ''}>Secant wt/cosθ (as AStrutTie)</option></select></label>
<hr>{''.join(rows)}
<button>Run analysis and checks</button>
</form><section><div class='err'>{E(error)}</div>{rep}</section></main></body></html>"""


def _num(v):
    v = v.strip()
    if v == "":
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in v else f
    except ValueError:
        return v


class H(BaseHTTPRequestHandler):
    def _send(self, body):
        b = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        t = parse_qs(self.path.partition("?")[2]).get("t", ["deep_beam"])[0]
        self._send(page(t if t in NAMES else "deep_beam"))

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        q = {k: v[0] for k, v in parse_qs(self.rfile.read(n).decode("utf-8"), keep_blank_values=True).items()}
        tpl, code = q.pop("template"), q.pop("code")
        project, element = q.pop("project", ""), q.pop("element", "")
        rule = q.pop("interior_width_rule", "projection")
        case = {"code": code, "project": project, "element": element, "interior_width_rule": rule}
        try:
            if tpl == "custom":
                case["custom"] = json.loads(q["custom"])
                case["custom"].setdefault("interior_width_rule", rule)
            else:
                params = {k: _num(v) for k, v in q.items()}
                case["template"] = tpl
                case["params"] = {k: v for k, v in params.items() if v is not None}
            _, _, rep = run_case(case)
            self._send(page(tpl, q, code, rep, "", project, element))
        except Exception as e:  # show the problem in the page
            self._send(page(tpl, q, code, "", f"Error: {e}", project, element))

    def log_message(self, *a):
        pass


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = f"http://127.0.0.1:{PORT}"
    print(f"STM-Lab running at {url}  (Ctrl+C to stop)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    srv.serve_forever()


if __name__ == "__main__":
    main()

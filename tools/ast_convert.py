"""Convert an AStrutTie worked example (model JSON + result tables captured from the
app) into an STM-Lab benchmark case in SI units (mm, kN, MPa).

Input: <slug>.json (model, SI internally) and <slug>.txt (comparison dialog + result
tables, pipe separated, in the example's display units).  Only the published inputs
and AStrutTie's numerical results are used; nothing of the program itself.

Usage: python tools/ast_convert.py SRC_DIR OUT_DIR
"""
import json, math, pathlib, re, sys

KIP, INCH = 4.4482216152605, 25.4


def _num(s):
    s = s.replace(",", "").replace("−", "-").strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse_tables(txt, us):
    """Return forces, As_req, strut (width, SF, nu), tie SF, node face SF, anchorage."""
    fk = KIP if us else 1.0
    lk = INCH if us else 1.0
    ak = INCH ** 2 if us else 1.0
    tabs = txt.split("@@TABLES\n", 1)[1].split("\n##\n")
    ref = {"forces": {}, "As_req": {}, "strut_sf": {}, "strut_wmax": {}, "strut_nu": {},
           "tie_sf": {}, "node_sf": {}, "node_kind": {}, "anchorage": {}}
    for t in tabs:
        rows = [r.split("|") for r in t.strip().split("\n") if r.strip()]
        if not rows:
            continue
        h = rows[0]
        if h[0] == "Item" and len(h) > 2 and h[1] in ("Type", "Crack ctrl reinf."):  # struts
            for r in rows[1:]:
                ref["forces"][r[0]] = -_num(r[6]) * fk
                ref["strut_nu"][r[0]] = _num(r[2])
                if h[1].startswith("Crack"):
                    ref.setdefault("crack_control", {})[r[0]] = not r[1].startswith("Not")
                ref["strut_wmax"][r[0]] = _num(r[8]) * (lk if "width" in h[8] else ak)
                ref["strut_sf"][r[0]] = _num(r[9])
        elif h[0] == "Item" and len(h) > 2 and h[1] == "Role":        # ties
            for r in rows[1:]:
                ref["forces"][r[0]] = _num(r[5]) * fk
                ref["As_req"][r[0]] = _num(r[6]) * ak
                if _num(r[7]):
                    ref["tie_sf"][r[0]] = _num(r[8])
        elif h[0] == "Node" and len(h) > 3 and h[1] == "Type" and "width" in h[9]:  # nodes (2D)
            cur = None
            for r in rows[1:]:
                if len(r) >= 12:
                    cur = r[0]
                    ref["node_kind"][cur] = r[1]
                    el, sf = r[3], _num(r[10])
                else:
                    el, sf = r[0], _num(r[4])
                key = "bearing" if el in ("Load plate", "Support plate") else el
                ref["node_sf"][f"{cur}/{key}"] = sf
        elif h[0] == "Item" and len(h) > 2 and h[1] == "Termination":  # anchorage
            for r in rows[1:]:
                if _num(r[3]) is None:
                    continue
                m = re.match(r"(\S+) · end [ij] \((\S+)\)", r[0])
                ref["anchorage"][f"{m.group(1)}@{m.group(2)}"] = {
                    "termination": r[1].replace(" ▾", ""), "db": _num(r[2]) * lk,
                    "ld": _num(r[3]) * lk, "lanc": _num(r[4]) * lk, "sf": _num(r[5])}
    return ref


def _band(outline, x, y):
    """Distance from a node to the nearest horizontal / vertical outline edge, and to
    the nearest sloped edge (distance, direction in degrees)."""
    dv, dh, ds = 1e9, 1e9, (1e9, 0.0)
    pts = [(p["x"], p["y"]) for p in outline]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if abs(y1 - y2) < 1e-6:
            if min(x1, x2) - 1e-6 <= x <= max(x1, x2) + 1e-6:
                dv = min(dv, abs(y - y1))
        elif abs(x1 - x2) < 1e-6:
            if min(y1, y2) - 1e-6 <= y <= max(y1, y2) + 1e-6:
                dh = min(dh, abs(x - x1))
        elif min(x1, x2) - 1e-6 <= x <= max(x1, x2) + 1e-6:
            L = math.hypot(x2 - x1, y2 - y1)
            d = abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / L
            if d < ds[0]:
                ds = (d, math.degrees(math.atan2(y2 - y1, x2 - x1)))
    return dv, dh, ds


def _xy(model, m):
    P = {n["name"]: n["xyz"] for n in model["nodes"]}
    a, b = P[m["i"]], P[m["j"]]
    return b[0] - a[0], b[1] - a[1]


def convert(model, txt):
    us = model.get("units") == "US"
    inp = model["input"]
    outline = model.get("outline") or []
    dim = len(model["nodes"][0]["xyz"])
    nodes = []
    for n in model["nodes"]:
        d = {"name": n["name"], "xyz": n["xyz"]}
        if n.get("fix"):
            d["fix"] = n["fix"]
        if n.get("load"):
            d["load"] = n["load"]
        if dim == 2:
            d["lb"] = n.get("lb", 0)
            dv, dh, ds = _band(outline, *n["xyz"]) if outline else (1e9, 1e9, (1e9, 0))
            d["wt"] = round(2 * dv, 2) if dv < 1e8 else 0
            if ds[0] < dv and ds[0] < 1e8:
                ang = ds[1] % 180.0
                d["wt"], d["band_dir"] = round(2 * ds[0], 2), round(ang if ang <= 90 else ang - 180, 3)
            vt = [m for m in model["members"] if n["name"] in (m["i"], m["j"]) and m.get("As")
                  and abs(_xy(model, m)[0]) < 1e-6]
            if vt and dh < 1e8:
                d["wt_v"] = round(2 * dh, 2)
        if n.get("smeared"):
            d["smeared"] = True
        nodes.append(d)
    members = []
    for m in model["members"]:
        d = {"name": m["name"], "i": m["i"], "j": m["j"]}
        if m.get("As"):
            d["As"] = m["As"]
        if m.get("wprov"):
            d["width_max"] = m["wprov"]
        st = m.get("st") or ""
        if m.get("boundary") and not st.startswith("bottle"):
            d["strut_class"] = "boundary"
        elif st == "bottle-reinforced" or st == "prismatic":
            d["strut_class"] = "interior_reinf"
        else:
            d["strut_class"] = "interior_reinf" if st != "bottle-plain" else "interior_no_reinf"
        nu = None
        members.append(d)
    ref = parse_tables(txt, us)
    for d in members:
        nu = ref["strut_nu"].get(d["name"])
        table = {"boundary": 1.0, "interior_reinf": 0.75, "interior_no_reinf": 0.4}[d["strut_class"]]
        if model["input"].get("code", "").startswith("AASHTO"):
            cc = ref.get("crack_control", {}).get(d["name"])
            if cc is not None and d.get("strut_class") != "boundary":
                d["strut_class"] = "interior_reinf" if cc else "interior_no_reinf"
            continue
        if nu and abs(nu / 0.85 - table) > 0.01:
            d["beta_s"] = round(nu / 0.85, 3)   # the example's own strut factor
    if dim == 3:   # 3D: strut areas as computed by the reference run (inputs to this check)
        for d in members:
            if d["name"] in ref["strut_wmax"]:
                d["area"] = round(ref["strut_wmax"].pop(d["name"]), 1)
                d.pop("width_max", None)
    code = {"ACI318-19": "ACI318-19", "ACI318-25": "ACI318-19"}.get(inp.get("code"), "AASHTO-LRFD")
    for d in members:
        if code == "AASHTO-LRFD":
            d.pop("beta_s", None)
    case = {
        "code": code,
        "interior_width_rule": "secant",
        "element": model["title"],
        "custom": {"title": model["title"] + " (AStrutTie worked example)", "dim": dim,
                   "b": inp["thickness"], "fc": round(inp["fck"], 3), "fy": round(inp["fy"], 3),
                   "interior_width_rule": "secant", "stiffness": "section", "nodes": nodes, "members": members,
                   "outline": [[[p["x"], p["y"]] for p in outline]] if outline and dim == 2 else [],
                   "meta": {"template": "custom", "source": model.get("note", "")}},
        "reference": {"source": "AStrutTie worked example '%s' (%s), run 25 Nov 2026"
                      % (model["title"], model.get("note", "")),
                      **ref},
    }
    return case


def main(src, out):
    src, out = pathlib.Path(src), pathlib.Path(out)
    for j in sorted(src.glob("*.json")):
        t = j.with_suffix(".txt")
        model = json.loads(j.read_text())
        case = convert(model, t.read_text())
        (out / (j.stem + ".json")).write_text(json.dumps(case, indent=1, ensure_ascii=False))
        print(j.stem, len(case["reference"]["forces"]))


if __name__ == "__main__":
    main(*sys.argv[1:3])

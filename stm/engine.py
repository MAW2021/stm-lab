"""Single entry point used by the CLI, the local UI and the tests."""
from .checks import run_checks
from .codes import CODES
from .model import STModel
from .report import html_report
from .templates import TEMPLATES, extra_checks


def build_custom(d):
    m = STModel(d.get("title", "Custom STM"), dim=d.get("dim", 2), b=d.get("b", 300),
                fc=d["fc"], fy=d["fy"],
                interior_width_rule=d.get("interior_width_rule", "projection"),
                stiffness=d.get("stiffness", "uniform"))
    for n in d["nodes"]:
        n = dict(n)
        name, xyz = n.pop("name"), n.pop("xyz")
        for k in ("fix", "load"):
            if k in n:
                n[k] = tuple(n[k])
        m.add_node(name, xyz, **n)
    for lc in d.get("load_cases", []):   # factored load cases: Σ factor·loads
        f = float(lc.get("factor", 1.0))
        for name, ld in lc.get("loads", {}).items():
            n = m.nodes[name]
            n.load = tuple(a + f * float(v) for a, v in zip(n.load, ld))
    for e in d["members"]:
        e = dict(e)
        m.add_member(e.pop("name"), e.pop("i"), e.pop("j"), **e)
    m.meta = dict(d.get("meta", {}))
    m.meta.setdefault("template", "custom")
    m.meta.update(notes=d.get("notes", []), outline=d.get("outline", []))
    return m


def run_case(case):
    code = CODES[case.get("code", "ACI318-19")]
    if "custom" in case:
        model = build_custom(case["custom"])
    else:
        model = TEMPLATES[case["template"]](code, **case["params"])
        if case.get("interior_width_rule"):
            model.interior_width_rule = case["interior_width_rule"]
    res = model.solve()
    checks = run_checks(res, code) + extra_checks(model, res, code)
    html = html_report(res, checks, code, project=case.get("project", ""),
                       engineer=case.get("engineer", ""), element=case.get("element", ""))
    return res, checks, html

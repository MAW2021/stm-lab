"""The browser app (web/stm-engine.js) must give the same answers as the Python engine."""
import glob, json, pathlib, shutil, subprocess, sys
import pytest
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stm.engine import run_case

JS = """const S=require(process.argv[1]);const cs=JSON.parse(require("fs").readFileSync(0,"utf8"));
console.log(JSON.stringify(cs.map(c=>{const r=S.runCase(c);return {f:r.res.forces,ch:r.checks.map(x=>[x.item,x.kind,x.demand,x.capacity,x.status])}})))"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_js_matches_python():
    files = sorted(glob.glob(str(ROOT / "benchmarks/cases/*.json"))) + \
        sorted(glob.glob(str(ROOT / "benchmarks/astruttie/*-AST-?.json")))
    cases = []
    for f in files:
        c = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
        c.pop("reference", None)
        for code in ("ACI318-19", "ECP203"):
            cases.append(dict(c, code=code))
    p = subprocess.run(["node", "-e", JS, str(ROOT / "web/stm-engine.js")], input=json.dumps(cases),
                       capture_output=True, text=True, check=True)
    for c, o in zip(cases, json.loads(p.stdout)):
        r, ch, _ = run_case(c)
        for k, v in r.forces.items():
            assert abs(v - o["f"][k]) < 1e-6
        py = [(x.item, x.kind, round(x.demand, 3), None if x.capacity is None else round(x.capacity, 3), x.status) for x in ch]
        js = [(a, b, round(d, 3), None if e is None else round(e, 3), s) for a, b, d, e, s in o["ch"]]
        assert py == js, c.get("element") or c.get("template")

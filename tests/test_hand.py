"""Hand-calculation verification cases (closed-form statics + ACI 318-19 factors)."""
import math, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from stm.codes import ACI318_19 as C
from stm import templates as T
from stm.checks import run_checks

def close(a, b, tol=1e-3):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)

def test_deep_beam_central():
    m = T.deep_beam(C, L=3000, h=1500, b=400, P=1200, fc=35, fy=420, wc=80, rho_h=.003, rho_v=.003)
    r = m.solve()
    x, jd = 1500 - 75, (1500 - 40) - 100
    th = math.atan2(jd, x)
    close(r.forces["AC"], -600 / math.sin(th))
    close(r.forces["AB"], 600 * x / jd)
    ch = {(c.item, c.kind): c for c in run_checks(r, C)}
    # strut AC at node C: w = 150 sin + 80 cos ; capacity 0.75*0.85*0.75*35*w*400
    w = 150 * math.sin(th) + 80 * math.cos(th)
    close(ch[("AC", "strut")].capacity, 0.75 * 0.85 * 0.75 * 35 * w * 400 / 1e3)
    # tie As,req = T / (0.75 fy)
    assert f"{600 * x / jd * 1e3 / (0.75 * 420):.0f}" in ch[("AB", "tie")].detail

def test_two_loads():
    m = T.deep_beam(C, L=4000, h=1800, b=400, P=900, a=1200, fc=35, fy=420, wc=100)
    r = m.solve()
    jd = (1800 - 50) - 100
    close(r.forces["AB"], 900 * 1200 / jd)
    close(r.forces["CD"], -900 * 1200 / jd)

def test_pile_cap_4_3d():
    m = T.pile_cap_4(C, s=1800, a=800, h=1200, D=600, P=4000, fc=30, fy=420, d_tie=150)
    r = m.solve()
    assert r.stable
    hz = math.hypot(700, 700); dz = 900
    close(r.forces["S1"], -1000 * math.hypot(hz, dz) / dz)
    close(r.forces["T12"], 1000 * hz / dz / math.sqrt(2))
    for k in "1234":
        close(r.reactions["P" + k][2], 1000)

def test_corbel():
    m = T.corbel(C, hc=400, b=400, h=500, d=450, av=200, Vu=400, fc=35, fy=420)
    r = m.solve()
    # strut A->C carries the vertical load: C*sin = Vu
    _, u = m.geometry(next(x for x in m.members if x.name == "AC"))
    close(-r.forces["AC"] * abs(u[1]), 400)
    close(r.forces["AB"], 80 + 400 * abs(u[0]) / abs(u[1]))

if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); print("PASS", k)

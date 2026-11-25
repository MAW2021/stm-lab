"""Strut-and-tie model data structures and pin-jointed truss solver.

Units used throughout: mm, kN, MPa (N/mm2).  Sign convention: member force
positive = tension (tie), negative = compression (strut).
Works for 2D (x, y) and 3D (x, y, z) models.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


@dataclass
class Node:
    name: str
    xyz: Tuple[float, ...]
    # Restraints: tuple of booleans per DOF (True = fixed)
    fix: Tuple[bool, ...] = ()
    # Applied load per DOF in kN
    load: Tuple[float, ...] = ()
    # Nodal geometry used for strut-end width / node face checks
    lb: float = 0.0         # bearing plate length in plane (mm)
    wt: float = 0.0         # height of tie / chord zone through the node (mm)
    wt_v: float = 0.0       # width of a vertical tie band through the node (mm), secant rule only
    band_dir: float = 0.0   # direction of the chord band of width wt (degrees from x; 0 = horizontal)
    bearing_area: float = 0.0  # 3D: bearing area (mm2) of plate/pile/column part
    bearing_axis: int = -1  # 3D: axis normal to bearing face (default vertical)
    confine: float = 1.0    # beta_c confinement factor (ACI 23.4.3), 1.0..2.0
    kind_override: str = ""  # force CCC / CCT / CTT if given
    spring: Tuple[float, ...] = ()  # elastic support stiffness per DOF (kN/mm); 0 = none
    anchor_ext: float = -1.0  # tie anchorage: distance node centre -> bar end (mm); <0 = not an anchorage
    smeared: bool = False   # smeared (continuous) node: no nodal-zone face checks
    curved: bool = False    # curved-bar node (ACI 23.10): checked by bend radius, no face checks
    cut: bool = False       # section-cut node: members continue beyond it, no face checks


@dataclass
class Member:
    name: str
    i: str
    j: str
    role: str = "auto"       # auto | strut | tie
    # Strut data
    strut_class: str = "interior_no_reinf"  # see codes.STRUT_CLASSES
    beta_s: float = 0.0      # user strut efficiency factor; 0 = from strut_class and the code table
    width: float = 0.0       # override strut width (2D, mm); 0 = derive from nodes
    width_max: float = 0.0   # provided strut/tie band width, used at nodes without own geometry; 0 = none
    area: float = 0.0        # override strut area (3D, mm2); 0 = derive
    # Tie data
    As: float = 0.0          # provided tie steel area (mm2)
    fy: float = 0.0          # 0 = use model default
    db: float = 0.0          # tie bar diameter (mm) for development length; 0 = skip
    EA: float = 0.0          # axial stiffness override (kN); 0 = uniform


@dataclass
class STModel:
    title: str
    dim: int = 2
    b: float = 300.0          # out-of-plane thickness (2D) in mm
    fc: float = 30.0          # f'c cylinder strength (MPa)
    fy: float = 420.0
    nodes: Dict[str, Node] = field(default_factory=dict)
    members: List[Member] = field(default_factory=list)
    meta: dict = field(default_factory=dict)   # template inputs, notes
    # Strut width at a node with no bearing plate (lb = 0):
    #   "projection": wt*cos(theta)  (face of the chord zone; conservative, default)
    #   "secant":     wt/cos(theta)  (strut spread over the chord band; matches AStrutTie)
    interior_width_rule: str = "projection"
    # Member stiffness for statically indeterminate models:
    #   "uniform": the same EA for every member (default)
    #   "section": Es*As for members with provided steel, Ec*w*b (2D) or Ec*A (3D)
    #              otherwise, w = governing strut width; Ec = 4700*sqrt(f'c) (ACI 19.2.2.1)
    stiffness: str = "uniform"
    Es: float = 200000.0

    # ------------------------------------------------------------------
    def add_node(self, name, xyz, **kw):
        xyz = tuple(float(v) for v in xyz)
        assert len(xyz) == self.dim, f"node {name}: expected {self.dim} coordinates"
        kw.setdefault("fix", (False,) * self.dim)
        kw.setdefault("load", (0.0,) * self.dim)
        n = Node(name, xyz, **kw)
        self.nodes[name] = n
        return n

    def add_member(self, name, i, j, **kw):
        m = Member(name, i, j, **kw)
        self.members.append(m)
        return m

    # ------------------------------------------------------------------
    def geometry(self, m: Member):
        a = np.array(self.nodes[m.i].xyz)
        b = np.array(self.nodes[m.j].xyz)
        d = b - a
        L = float(np.linalg.norm(d))
        if L <= 0:
            raise ValueError(f"member {m.name} has zero length")
        return L, d / L

    def section_EA(self, m: "Member") -> float:
        """Axial stiffness (kN) for the "section" stiffness option."""
        if m.As > 0:
            return self.Es * m.As / 1e3
        Ec = 4700.0 * self.fc ** 0.5
        if self.dim == 2:
            from .checks import strut_width_2d
            w = strut_width_2d(self, m) or 0.25 * self.b
            return Ec * w * self.b / 1e3
        A = m.area or max((self.nodes[n].bearing_area for n in (m.i, m.j)), default=0) or 1e5
        return Ec * A / 1e3

    def solve(self) -> "Result":
        dim = self.dim
        names = list(self.nodes)
        idx = {n: k for k, n in enumerate(names)}
        ndof = dim * len(names)
        K = np.zeros((ndof, ndof))
        F = np.zeros(ndof)
        for n in names:
            node = self.nodes[n]
            F[idx[n] * dim: idx[n] * dim + dim] = node.load
        units = []
        for m in self.members:
            L, u = self.geometry(m)
            if m.EA > 0:
                EA = m.EA
            elif self.stiffness == "section":
                EA = self.section_EA(m)
            else:
                EA = 1.0e6
            k = EA / L * np.outer(u, u)
            di = slice(idx[m.i] * dim, idx[m.i] * dim + dim)
            dj = slice(idx[m.j] * dim, idx[m.j] * dim + dim)
            K[di, di] += k
            K[dj, dj] += k
            K[di, dj] -= k
            K[dj, di] -= k
            units.append((L, u, EA))
        Kspring = np.zeros(ndof)
        for n in names:
            sp = self.nodes[n].spring
            if sp:
                Kspring[idx[n] * dim: idx[n] * dim + dim] = sp
        K = K + np.diag(Kspring)
        fixed = np.zeros(ndof, dtype=bool)
        for n in names:
            fixed[idx[n] * dim: idx[n] * dim + dim] = self.nodes[n].fix
        free = ~fixed
        Kff = K[np.ix_(free, free)]
        # Tiny stabilising spring: keeps load-orthogonal mechanisms (e.g. the
        # in-plane sway of a square tie ring under symmetric load) from making
        # the matrix singular.  A mechanism that the loads actually excite is
        # caught by the equilibrium/displacement check below.
        eps = 1e-9 * (np.max(np.abs(np.diag(Kff))) if Kff.size else 1.0)
        U = np.zeros(ndof)
        Kr = Kff + eps * np.eye(Kff.shape[0])
        Uf = np.linalg.solve(Kr, F[free])
        for _ in range(3):   # iterative refinement removes the error of the stabilising spring
            Uf = Uf + np.linalg.solve(Kr, F[free] - Kff @ Uf)
        U[free] = Uf
        R = K @ U - F  # reactions at fixed DOFs (residual elsewhere)
        forces = {}
        for m, (L, u, EA) in zip(self.members, units):
            ui = U[idx[m.i] * dim: idx[m.i] * dim + dim]
            uj = U[idx[m.j] * dim: idx[m.j] * dim + dim]
            forces[m.name] = float(EA / L * np.dot(u, uj - ui))
        resid = float(np.max(np.abs(R[free]))) if free.any() else 0.0
        fscale = max(1.0, float(np.max(np.abs(F))))
        stable = resid < 1e-6 * fscale
        reactions = {}
        for n in names:
            sl = slice(idx[n] * dim, idx[n] * dim + dim)
            if self.nodes[n].spring and not any(self.nodes[n].fix):
                reactions[n] = tuple(float(-k * u) for k, u in zip(Kspring[sl], U[sl]))
                continue
            if any(self.nodes[n].fix):
                reactions[n] = tuple(float(r) if f else 0.0 for r, f in
                                     zip(R[sl], self.nodes[n].fix))
        # Global equilibrium check
        sumF = F.reshape(-1, dim).sum(0) + sum(np.array(r) for r in reactions.values())
        eq_err = float(np.max(np.abs(sumF)))
        fscale = max([fscale] + [abs(v) for r in reactions.values() for v in r])
        stable = resid < 1e-6 * fscale
        return Result(self, forces, reactions, stable and eq_err < 1e-6 * fscale,
                      resid, eq_err)


@dataclass
class Result:
    model: STModel
    forces: Dict[str, float]
    reactions: Dict[str, Tuple[float, ...]]
    stable: bool
    residual: float
    equilibrium_error: float

    def role(self, m: Member, tol=1e-6) -> str:
        f = self.forces[m.name]
        if abs(f) < tol:
            return "zero"
        return "tie" if f > 0 else "strut"

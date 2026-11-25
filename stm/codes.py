"""Design-code parameters for strut-and-tie checks.

ACI 318-19 / 318-25 Chapter 23 values are implemented as written in the code.
Only American codes are supported: ACI 318-19 Chapter 23 and AASHTO LRFD
(9th/10th ed.) Article 5.8.2.
Each factor is a plain number in this file so it can be corrected in one place.
"""
from dataclasses import dataclass, field
from typing import Dict

STRUT_CLASSES = {
    # key: (description, ACI 318-19 Table 23.4.3 row)
    "boundary": "Boundary strut (prismatic, e.g. compression chord)",
    "interior_reinf": "Interior strut, distributed reinforcement per 23.5",
    "interior_joint": "Interior strut in beam-column joint",
    "interior_sizeeffect": "Interior strut in region satisfying 23.4.4 (size-effect shear limit)",
    "interior_no_reinf": "Interior strut, all other cases",
    "tension_zone": "Strut in tension member / tension zone",
}


@dataclass
class CodeSet:
    key: str
    name: str
    # Strut and node efficiency factors
    beta_s: Dict[str, float]
    beta_n: Dict[str, float]
    # Effective strength f_ce = k_c * beta * f_c_ref
    k_c: float               # 0.85 (ACI)
    phi_strut: float
    phi_node: float
    phi_tie: float
    steel_factor: float      # multiplies fy (1.0 for ACI)
    min_angle_deg: float
    fc_symbol: str
    refs: Dict[str, str] = field(default_factory=dict)
    provisional: bool = False

    family: str = "ACI"      # ACI | AASHTO

    # ---- efficiency factors nu = f_ce / f'c --------------------------------
    def nu_strut(self, fc, cls, beta_s=0.0):
        """Strut efficiency (f_ce / f'c).  beta_s > 0 is a user value."""
        if self.family == "AASHTO":
            if beta_s > 0:
                return beta_s
            return 0.45 if cls in ("interior_no_reinf", "tension_zone") else aashto_nu_interface(fc)
        return self.k_c * (beta_s if beta_s > 0 else self.beta_s[cls])

    def nu_node(self, fc, kind, face="strut", strut_cls=None):
        """Node-face efficiency.  face: strut | back (tie) | bearing."""
        if self.family == "AASHTO":
            # AASHTO LRFD Table 5.8.2.5.3a-1; nu = 0.45 at strut faces without
            # crack-control reinforcement (5.8.2.5.3a)
            if face == "strut":
                return 0.45 if strut_cls in ("interior_no_reinf", "tension_zone") else aashto_nu_interface(fc)
            if kind == "CTT":
                return aashto_nu_interface(fc)
            return 0.85 if kind == "CCC" else 0.70
        return self.k_c * self.beta_n[kind]

    def fce_strut(self, fc, cls, beta_c=1.0, beta_s=0.0):
        return beta_c * self.nu_strut(fc, cls, beta_s) * fc

    def fce_node(self, fc, kind, beta_c=1.0, face="strut", strut_cls=None):
        return beta_c * self.nu_node(fc, kind, face, strut_cls) * fc


def aashto_nu_interface(fc):
    """AASHTO LRFD 5.8.2.5.3a: 0.85 - f'c/20 ksi, between 0.45 and 0.65."""
    return min(0.65, max(0.45, 0.85 - fc / 137.9))


ACI318_19 = CodeSet(
    key="ACI318-19",
    name="ACI 318-19 Chapter 23",
    beta_s={"boundary": 1.0, "interior_reinf": 0.75, "interior_joint": 0.75,
            "interior_sizeeffect": 0.75, "interior_no_reinf": 0.4, "tension_zone": 0.4},
    beta_n={"CCC": 1.0, "CCT": 0.8, "CTT": 0.6},
    k_c=0.85, phi_strut=0.75, phi_node=0.75, phi_tie=0.75, steel_factor=1.0,
    min_angle_deg=25.0, fc_symbol="f'c",
    refs={
        "strut": "ACI 318-19 23.4.1, 23.4.3 (Table 23.4.3), 21.2.1",
        "node": "ACI 318-19 23.9.1, 23.9.2 (Table 23.9.2)",
        "tie": "ACI 318-19 23.7.2",
        "angle": "ACI 318-19 23.2.7",
        "distributed": "ACI 318-19 23.5.1 (Table 23.5.1)",
        "sizeeffect": "ACI 318-19 23.4.4",
        "corbel": "ACI 318-19 16.5.1.1, 16.5.2.4, 16.5.3, 16.5.5.5",
        "fce": "f_ce = 0.85 beta_c beta_s f'c (23.4.3) ; 0.85 beta_c beta_n f'c (23.9.2)",
    },
)

AASHTO_LRFD = CodeSet(
    key="AASHTO-LRFD",
    name="AASHTO LRFD Bridge Design Specifications, Article 5.8.2",
    beta_s={"boundary": 1.0, "interior_reinf": 1.0, "interior_joint": 1.0,
            "interior_sizeeffect": 1.0, "interior_no_reinf": 1.0, "tension_zone": 1.0},
    beta_n={"CCC": 1.0, "CCT": 1.0, "CTT": 1.0},
    k_c=1.0, phi_strut=0.70, phi_node=0.70, phi_tie=0.90, steel_factor=1.0,
    min_angle_deg=25.0, fc_symbol="f'c", family="AASHTO",
    refs={
        "strut": "AASHTO LRFD 5.8.2.5.1, 5.8.2.5.3a; φ = 0.70 (5.5.4.2)",
        "node": "AASHTO LRFD 5.8.2.5.3a, Table 5.8.2.5.3a-1",
        "tie": "AASHTO LRFD 5.8.2.4.1; φ = 0.90 (5.5.4.2)",
        "angle": "STM-Lab practice limit (25°)",
        "distributed": "AASHTO LRFD 5.8.2.6 (crack-control reinforcement, 0.003 each way)",
        "sizeeffect": "-",
        "corbel": "AASHTO LRFD 5.8.4.2",
        "fce": "f_cu = m ν f'c; ν = 0.85 (CCC), 0.70 (CCT) at bearing/back faces, "
               "0.85 − f'c/20 ksi (0.45…0.65) at strut faces and CTT nodes; 0.45 without crack control",
    },
)

CODES = {c.key: c for c in (ACI318_19, AASHTO_LRFD)}

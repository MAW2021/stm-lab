/* STM-Lab engine (JavaScript port of the Python package `stm`).
   Units: mm, kN, MPa. Member force + = tension (tie), − = compression (strut).
   Works in the browser (global STM) and in Node (module.exports). */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ codes
  const STRUT_CLASSES = {
    boundary: "Boundary strut (prismatic, e.g. compression chord)",
    interior_reinf: "Interior strut, distributed reinforcement per 23.5",
    interior_joint: "Interior strut in beam-column joint",
    interior_sizeeffect: "Interior strut in region satisfying 23.4.4",
    interior_no_reinf: "Interior strut, all other cases",
    tension_zone: "Strut in tension member / tension zone",
  };
  const CODES = {
    "ACI318-19": {
      key: "ACI318-19", name: "ACI 318-19 Chapter 23",
      beta_s: { boundary: 1.0, interior_reinf: 0.75, interior_joint: 0.75, interior_sizeeffect: 0.75, interior_no_reinf: 0.4, tension_zone: 0.4 },
      beta_n: { CCC: 1.0, CCT: 0.8, CTT: 0.6 },
      k_c: 0.85, phi_strut: 0.75, phi_node: 0.75, phi_tie: 0.75, steel_factor: 1.0,
      min_angle_deg: 25, fc_symbol: "f'c", provisional: false,
      family: "ACI",
      refs: {
        strut: "ACI 318-19 23.4.1, 23.4.3, 21.2.1", node: "ACI 318-19 23.9.1, 23.9.2",
        tie: "ACI 318-19 23.7.2", angle: "ACI 318-19 23.2.7", distributed: "ACI 318-19 23.5.1",
        sizeeffect: "ACI 318-19 23.4.4", corbel: "ACI 318-19 16.5", anchorage: "ACI 318-19 23.8.2, 25.4.2.4",
        fce: "f_ce = 0.85·β_c·β_s·f'c (23.4.3) ; 0.85·β_c·β_n·f'c (23.9.2)",
      },
    },
    "AASHTO-LRFD": {
      key: "AASHTO-LRFD", name: "AASHTO LRFD Bridge Design Specifications, Article 5.8.2",
      beta_s: { boundary: 1, interior_reinf: 1, interior_joint: 1, interior_sizeeffect: 1, interior_no_reinf: 1, tension_zone: 1 },
      beta_n: { CCC: 1, CCT: 1, CTT: 1 },
      k_c: 1.0, phi_strut: 0.70, phi_node: 0.70, phi_tie: 0.90, steel_factor: 1.0,
      min_angle_deg: 25, fc_symbol: "f'c", provisional: false, family: "AASHTO",
      refs: {
        strut: "AASHTO LRFD 5.8.2.5.1, 5.8.2.5.3a; φ = 0.70 (5.5.4.2)", node: "AASHTO LRFD 5.8.2.5.3a, Table 5.8.2.5.3a-1",
        tie: "AASHTO LRFD 5.8.2.4.1; φ = 0.90 (5.5.4.2)", angle: "STM-Lab practice limit (25°)",
        distributed: "AASHTO LRFD 5.8.2.6 (crack-control reinforcement, 0.003 each way)", sizeeffect: "-",
        corbel: "AASHTO LRFD 5.8.4.2", anchorage: "ACI 318-19 25.4.2.4 (straight bar, used as an estimate)",
        fce: "f_cu = m·ν·f'c; ν = 0.85 (CCC), 0.70 (CCT) at bearing/back faces, 0.85 − f'c/20 ksi (0.45…0.65) at strut faces and CTT nodes; 0.45 without crack control",
      },
    },
  };
  const NO_CRACK = ["interior_no_reinf", "tension_zone"];
  const aashtoNu = fc => Math.min(0.65, Math.max(0.45, 0.85 - fc / 137.9));
  function nuStrut(c, fc, cls, bs = 0) {
    if (c.family === "AASHTO") return bs > 0 ? bs : NO_CRACK.includes(cls) ? 0.45 : aashtoNu(fc);
    return c.k_c * (bs > 0 ? bs : c.beta_s[cls]);
  }
  function nuNode(c, fc, kind, face = "strut", cls = null) {
    if (c.family === "AASHTO") {
      if (face === "strut") return NO_CRACK.includes(cls) ? 0.45 : aashtoNu(fc);
      if (kind === "CTT") return aashtoNu(fc);
      return kind === "CCC" ? 0.85 : 0.70;
    }
    return c.k_c * c.beta_n[kind];
  }
  const fceStrut = (c, fc, cls, bc = 1, bs = 0) => bc * nuStrut(c, fc, cls, bs) * fc;
  const fceNode = (c, fc, kind, bc = 1, face = "strut", cls = null) => bc * nuNode(c, fc, kind, face, cls) * fc;

  // ------------------------------------------------------------------ model
  function Model(title, dim = 2, b = 300, fc = 30, fy = 420) {
    return { title, dim, b, fc, fy, nodes: {}, order: [], members: [], meta: {}, interior_width_rule: "projection", stiffness: "uniform", Es: 200000 };
  }
  function addNode(m, name, xyz, o = {}) {
    const d = m.dim;
    m.nodes[name] = Object.assign({ name, xyz: xyz.map(Number), fix: Array(d).fill(false), load: Array(d).fill(0),
      spring: null, lb: 0, wt: 0, wt_v: 0, band_dir: 0, bearing_area: 0, bearing_axis: -1, confine: 1, kind_override: "", anchor_ext: -1, smeared: false, curved: false, cut: false }, o);
    if (!m.order.includes(name)) m.order.push(name);
    return m.nodes[name];
  }
  function addMember(m, name, i, j, o = {}) {
    const e = Object.assign({ name, i, j, role: "auto", strut_class: "interior_no_reinf", beta_s: 0, width: 0, width_max: 0, area: 0, As: 0, fy: 0, db: 0, EA: 0 }, o);
    m.members.push(e);
    return e;
  }
  function geometry(m, e) {
    const a = m.nodes[e.i].xyz, b = m.nodes[e.j].xyz;
    const d = b.map((v, k) => v - a[k]);
    const L = Math.hypot(...d);
    if (!(L > 0)) throw new Error(`member ${e.name} has zero length`);
    return { L, u: d.map(v => v / L) };
  }

  function gaussSolve(A, bvec) {
    const n = bvec.length, M = A.map((r, i) => r.concat([bvec[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) throw new Error("singular stiffness matrix");
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  // axial stiffness for the "section" option: Es·As where steel is given, else Ec·w·b (2D) / Ec·A (3D)
  function sectionEA(m, e) {
    if (e.As > 0) return m.Es * e.As / 1e3;
    const Ec = 4700 * Math.sqrt(m.fc);
    if (m.dim === 2) { const w = strutWidthModel(m, e) || 0.25 * m.b; return Ec * w * m.b / 1e3; }
    let A = e.area || Math.max(0, ...[e.i, e.j].map(n => m.nodes[n].bearing_area || 0)) || 1e5;
    return Ec * A / 1e3;
  }

  function solve(m) {
    const d = m.dim, names = m.order, idx = {}, nd = d * names.length;
    names.forEach((n, k) => (idx[n] = k));
    const K = Array.from({ length: nd }, () => Array(nd).fill(0));
    const F = Array(nd).fill(0), Ks = Array(nd).fill(0);
    names.forEach(n => { const N = m.nodes[n]; for (let a = 0; a < d; a++) { F[idx[n] * d + a] = +N.load[a] || 0; if (N.spring) Ks[idx[n] * d + a] = +N.spring[a] || 0; } });
    const units = m.members.map(e => {
      const { L, u } = geometry(m, e), EA = e.EA > 0 ? e.EA : m.stiffness === "section" ? sectionEA(m, e) : 1e6, i0 = idx[e.i] * d, j0 = idx[e.j] * d;
      for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) {
        const k = EA / L * u[a] * u[b];
        K[i0 + a][i0 + b] += k; K[j0 + a][j0 + b] += k; K[i0 + a][j0 + b] -= k; K[j0 + a][i0 + b] -= k;
      }
      return { L, u, EA };
    });
    for (let q = 0; q < nd; q++) K[q][q] += Ks[q];
    const fixed = Array(nd).fill(false);
    names.forEach(n => m.nodes[n].fix.forEach((f, a) => (fixed[idx[n] * d + a] = !!f)));
    const free = []; for (let q = 0; q < nd; q++) if (!fixed[q]) free.push(q);
    let dmax = 1; free.forEach(q => (dmax = Math.max(dmax, Math.abs(K[q][q]))));
    const eps = 1e-9 * dmax;
    const Kff = free.map(r => free.map(c => K[r][c] + (r === c ? eps : 0)));
    const Uf = gaussSolve(Kff, free.map(q => F[q]));
    const U = Array(nd).fill(0); free.forEach((q, k) => (U[q] = Uf[k]));
    const R = K.map((row, r) => row.reduce((s, v, c) => s + v * U[c], 0) - F[r]);
    const forces = {};
    m.members.forEach((e, k) => {
      const { L, u, EA } = units[k]; let s = 0;
      for (let a = 0; a < d; a++) s += u[a] * (U[idx[e.j] * d + a] - U[idx[e.i] * d + a]);
      forces[e.name] = EA / L * s;
    });
    let resid = 0; free.forEach(q => (resid = Math.max(resid, Math.abs(R[q]))));
    let fscale = Math.max(1, ...F.map(Math.abs));
    const reactions = {};
    names.forEach(n => {
      const N = m.nodes[n], o = idx[n] * d;
      if (N.spring && !N.fix.some(Boolean)) { reactions[n] = N.spring.map((k, a) => -k * U[o + a]); return; }
      if (N.fix.some(Boolean)) reactions[n] = N.fix.map((f, a) => (f ? R[o + a] : 0));
    });
    const sum = Array(d).fill(0);
    names.forEach(n => m.nodes[n].load.forEach((v, a) => (sum[a] += +v || 0)));
    Object.values(reactions).forEach(r => r.forEach((v, a) => (sum[a] += v)));
    const eq = Math.max(...sum.map(Math.abs));
    Object.values(reactions).forEach(r => r.forEach(v => (fscale = Math.max(fscale, Math.abs(v)))));
    return { model: m, forces, reactions, stable: resid < 1e-6 * fscale && eq < 1e-6 * fscale, residual: resid, equilibrium_error: eq };
  }

  // ------------------------------------------------------------------ checks
  const BARS = [12, 16, 20, 25, 28, 32];
  function barSuggestion(As) {
    const opts = BARS.map(dd => { const a = Math.PI * dd * dd / 4, n = Math.max(2, Math.ceil(As / a)); return [n, dd, n * a]; });
    const good = opts.filter(o => o[0] <= 12).slice(0, 2);
    return (good.length ? good : opts.slice(-1)).map(([n, dd, A]) => `${n}T${dd} (${A.toFixed(0)} mm²)`).join(" or ");
  }
  // strut width at a node from the node's face; width_max is used where the node has no geometry
  function strutEndWidth(m, e, nn) {
    if (e.width > 0) return [e.width, "given"];
    const N = m.nodes[nn]; let w = null, how = "no node geometry";
    if (N.curved) return [null, "curved-bar node (checked by 23.10)"];
    if (N.cut) return [null, "section cut (member continues)"];
    if (N.lb > 0 || N.wt > 0) {
      const { u } = geometry(m, e), a = (N.band_dir || 0) * Math.PI / 180;
      const ca = Math.abs(u[0] * Math.cos(a) + u[1] * Math.sin(a)), sa = Math.abs(-u[0] * Math.sin(a) + u[1] * Math.cos(a));
      if (N.lb <= 0 && m.interior_width_rule === "secant") {
        const cands = [];
        if (N.wt > 0 && ca > 0.17) cands.push([N.wt / ca, `wt/cosθ = ${N.wt.toFixed(0)}/${ca.toFixed(3)} (interior node, secant rule)`]);
        if (N.wt_v > 0 && sa > 0.17) cands.push([N.wt_v / sa, `wt,v/sinθ = ${N.wt_v.toFixed(0)}/${sa.toFixed(3)} (vertical tie band)`]);
        const spans = [];
        m.members.forEach(o => { if (o === e || (o.i !== nn && o.j !== nn)) return;
          const g = geometry(m, o); if (Math.abs(g.u[0] * Math.cos(a) + g.u[1] * Math.sin(a)) > 0.996) spans.push(g.L); });
        if (spans.length && sa > 0.17) { const s0 = Math.min(...spans); cands.push([s0 * sa, `s·sinθ = ${s0.toFixed(0)}·${sa.toFixed(3)} (nearest chord node)`]); }
        if (cands.length) [w, how] = cands.reduce((p, c) => (c[0] < p[0] ? c : p));
      } else {
        w = N.lb * sa + N.wt * ca;
        how = `lb·sinθ + wt·cosθ = ${N.lb.toFixed(0)}·${sa.toFixed(3)} + ${N.wt.toFixed(0)}·${ca.toFixed(3)}`;
      }
    }
    if (e.width_max > 0 && !w) return [e.width_max, `provided width ${e.width_max.toFixed(0)} mm`];
    return [w, how];
  }
  const strutWidth2d = (res, e, nn) => strutEndWidth(res.model, e, nn);
  function strutWidthModel(m, e) {
    const ws = [e.i, e.j].map(n => strutEndWidth(m, e, n)[0]).filter(Boolean);
    return ws.length ? Math.min(...ws) : null;
  }
  function strutArea3d(res, e, nn) {
    if (e.area > 0) return [e.area, "given"];
    const N = res.model.nodes[nn];
    if (N.bearing_area <= 0) return [null, "no node geometry"];
    const { u } = geometry(res.model, e), ax = N.bearing_axis >= 0 ? N.bearing_axis : res.model.dim - 1, c = Math.abs(u[ax]);
    return [N.bearing_area * c, `A_bearing·|cos| = ${N.bearing_area.toFixed(0)}·${c.toFixed(3)}`];
  }
  const endArea = (res, e, nn) => {
    if (res.model.dim === 2) { const [w, how] = strutWidth2d(res, e, nn); return [w ? w * res.model.b : null, how]; }
    return strutArea3d(res, e, nn);
  };
  function nodeKind(res, nn) {
    const N = res.model.nodes[nn];
    if (N.kind_override) return N.kind_override;
    const tol = 1e-6 * Math.max(1, ...Object.values(res.forces).map(Math.abs));
    const t = res.model.members.filter(e => (e.i === nn || e.j === nn) && res.forces[e.name] > tol).length;
    return t === 0 ? "CCC" : t === 1 ? "CCT" : "CTT";
  }
  const C = (item, kind, demand, capacity, ratio, status, clause, detail = "") => ({ item, kind, demand, capacity, ratio, status, clause, detail });

  function runChecks(res, code) {
    const m = res.model, fc = m.fc, b = m.b, out = [];
    const kinds = {}; m.order.forEach(n => (kinds[n] = nodeKind(res, n)));
    for (const e of m.members) {
      const F = res.forces[e.name];
      if (Math.abs(F) < 1e-6) { out.push(C(e.name, "zero", 0, null, null, "INFO", "", "zero-force member")); continue; }
      if (F > 0) {
        const fy = (e.fy || m.fy) * code.steel_factor, Asr = F * 1e3 / (code.phi_tie * fy);
        if (e.As > 0) {
          const cap = code.phi_tie * e.As * fy / 1e3, r = F / cap;
          out.push(C(e.name, "tie", F, cap, r, r <= 1 ? "OK" : "NG", code.refs.tie, `As = ${e.As.toFixed(0)} mm², As,req = ${Asr.toFixed(0)} mm²`));
        } else out.push(C(e.name, "tie", F, null, null, "INFO", code.refs.tie, `As,req = ${Asr.toFixed(0)} mm² → ${barSuggestion(Asr)}`));
        if (e.role === "strut") out.push(C(e.name, "detail", F, null, null, "NG", "", "member defined as strut but carries tension"));
      } else {
        const Cf = -F, nu = nuStrut(code, fc, e.strut_class, e.beta_s), fce = nu * fc;
        if (e.role === "tie") out.push(C(e.name, "detail", F, null, null, "NG", "", "member defined as tie but carries compression"));
        const ends = [e.i, e.j].map(nn => [nn, ...endArea(res, e, nn)]).filter(x => x[1]);
        if (!ends.length) {
          const Ar = Cf * 1e3 / (code.phi_strut * fce);
          out.push(C(e.name, "strut", Cf, null, null, "INFO", code.refs.strut,
            `${e.strut_class}, f_ce = ${fce.toFixed(2)} MPa, ${m.dim === 2 ? `w,req = ${(Ar / b).toFixed(0)} mm` : `A,req = ${Ar.toFixed(0)} mm²`} (no width given)`));
          continue;
        }
        const [nn, A, how] = ends.reduce((a, x) => (x[1] < a[1] ? x : a));
        const cap = code.phi_strut * fce * A / 1e3, r = Cf / cap;
        out.push(C(e.name, "strut", Cf, cap, r, r <= 1 ? "OK" : "NG", code.refs.strut,
          `ν = ${nu.toFixed(3)} (${e.strut_class}${e.beta_s > 0 ? ", user β_s" : ""}), f_ce = ${fce.toFixed(2)} MPa, ${m.dim === 2 ? `w = ${(A / b).toFixed(0)} mm` : `A = ${A.toFixed(0)} mm²`} at ${nn} (${how})`));
      }
    }
    for (const nn of m.order) {
      const N = m.nodes[nn], k = kinds[nn];
      for (const e of m.members) {
        if ((e.i !== nn && e.j !== nn) || res.forces[e.name] >= -1e-6) continue;
        const Cf = -res.forces[e.name], [A] = endArea(res, e, nn);
        if (!A) continue;
        const fce = fceNode(code, fc, k, N.confine, "strut", e.strut_class), cap = code.phi_node * fce * A / 1e3, r = Cf / cap;
        out.push(C(nn, "node", Cf, cap, r, r <= 1 ? "OK" : "NG", code.refs.node, `${k} node, ν = ${(fce / fc / N.confine).toFixed(3)}, β_c = ${N.confine}, face of ${e.name}, f_ce = ${fce.toFixed(2)} MPa`));
      }
      if (m.dim === 2) for (const e of m.members) {
        if ((e.i !== nn && e.j !== nn) || res.forces[e.name] <= 1e-6 || e.width > 0) continue;
        const [w] = strutWidth2d(res, e, nn);
        if (!w) continue;
        const fce = fceNode(code, fc, k, N.confine, "back"), T = res.forces[e.name], cap = code.phi_node * fce * w * b / 1e3, r = T / cap;
        out.push(C(nn, "node", T, cap, r, r <= 1 ? "OK" : "NG", code.refs.node, `${k} node, ν = ${(fce / fc / N.confine).toFixed(3)}, tie face of ${e.name}, w = ${w.toFixed(0)} mm, f_ce = ${fce.toFixed(2)} MPa`));
      }
      const P = N.load.map(Number); const R = res.reactions[nn];
      if (R) R.forEach((v, a) => (P[a] += v));
      const Pn = Math.abs(P[N.bearing_axis >= 0 ? N.bearing_axis : m.dim - 1]);   // force normal to the bearing plate
      if (Pn > 1e-6 && !N.cut) {   // at a section cut the member continues: no bearing
        const A = m.dim === 2 && N.lb > 0 ? N.lb * b : m.dim === 3 && N.bearing_area > 0 ? N.bearing_area : null;
        if (A) { const fce = fceNode(code, fc, k, N.confine, "bearing"), cap = code.phi_node * fce * A / 1e3, r = Pn / cap; out.push(C(nn, "bearing", Pn, cap, r, r <= 1 ? "OK" : "NG", code.refs.node, `${k} node bearing face, normal force on A = ${A.toFixed(0)} mm²`)); }
      }
    }
    const ftol = 1e-6 * Math.max(1, ...Object.values(res.forces).map(Math.abs));
    for (const nn of m.order) {
      const here = m.members.filter(e => (e.i === nn || e.j === nn) && Math.abs(res.forces[e.name]) > ftol);
      for (const s of here) { if (res.forces[s.name] >= 0) continue;
        for (const t of here) { if (res.forces[t.name] <= 0) continue;
          const us = geometry(m, s).u, ut = geometry(m, t).u;
          const ang = Math.acos(Math.min(1, Math.abs(us.reduce((a, v, q) => a + v * ut[q], 0)))) * 180 / Math.PI;
          if (ang < 1) continue;   // collinear chord whose force changes sign at the node
          out.push(C(nn, "angle", ang, code.min_angle_deg, null, ang >= code.min_angle_deg - 1e-9 ? "OK" : "NG", code.refs.angle, `angle ${s.name}–${t.name} = ${ang.toFixed(1)}° (min ${code.min_angle_deg}°)`));
        } }
    }
    return out.concat(development(res, code));
  }

  function development(res, code) {
    const m = res.model, out = [];
    if (m.dim !== 2) return out;
    for (const nn of m.order) {
      const N = m.nodes[nn]; if (N.anchor_ext < 0) continue;
      for (const t of m.members) {
        if ((t.i !== nn && t.j !== nn) || res.forces[t.name] <= 1e-6 || t.db <= 0) continue;
        const ut = geometry(m, t).u, angs = [];
        m.members.filter(s => (s.i === nn || s.j === nn) && res.forces[s.name] < -1e-6).forEach(s => {
          const us = geometry(m, s).u, c = Math.min(1, Math.abs(us.reduce((a, v, q) => a + v * ut[q], 0)));
          if (c < 0.999) angs.push(Math.acos(c));
        });
        if (!angs.length) continue;
        const th = Math.max(...angs), avail = N.anchor_ext + N.lb / 2 + (N.wt / 2) / Math.tan(th);
        const fy = t.fy || m.fy, fcd = code.key.startsWith("ACI") ? m.fc : 0.8 * m.fc, kk = t.db <= 20 ? 2.1 : 1.7;
        const ld = Math.max(300, fy / (kk * Math.sqrt(fcd)) * t.db), r = ld / avail;
        out.push(C(`${t.name}@${nn}`, "anchorage", ld, avail, r, r <= 1 ? "OK" : "NG", code.refs.anchorage,
          `straight bar db = ${t.db.toFixed(0)}: ld = fy/(${kk}·√f'c)·db = ${ld.toFixed(0)} mm; ℓanc = ${N.anchor_ext.toFixed(0)} + ${N.lb.toFixed(0)}/2 + (${N.wt.toFixed(0)}/2)/tan${(th * 180 / Math.PI).toFixed(1)}° = ${avail.toFixed(0)} mm`));
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ templates
  const XY = [true, true], Y = [false, true];
  function sizeChord(F, b, code, fc, kind = "CCC") {
    const f = code.phi_node * fceNode(code, fc, kind);
    return Math.ceil(F * 1e3 / (f * b) / 10) * 10;
  }
  function iterate(wc, start, fnT, b, code, fc) {
    let w = wc || start;
    for (let i = 0; i < 30 && !wc; i++) {
      const nw = Math.max(sizeChord(fnT(w), b, code, fc), 50);
      if (Math.abs(nw - w) < 1) { w = nw; break; }
      w = nw;
    }
    return wc || w;
  }

  const TEMPLATES = {
    deep_beam: {
      name: "Deep beam / transfer girder",
      params: [["L", "Span between supports L", 3000, "mm"], ["h", "Overall depth h", 1500, "mm"], ["b", "Thickness b", 400, "mm"],
        ["P", "Factored load P (each point)", 1200, "kN"], ["a", "Shear span a (blank = one central load)", "", "mm"],
        ["fc", "Concrete strength", 35, "MPa"], ["fy", "Steel yield fy", 420, "MPa"], ["lb_load", "Load plate length", 300, "mm"],
        ["lb_sup", "Support plate length", 300, "mm"], ["d_tie", "Tie centroid from bottom", 100, "mm"],
        ["wc", "Top chord depth (blank = auto)", "", "mm"], ["rho_h", "Horizontal web steel ratio ρh", 0, ""],
        ["rho_v", "Vertical web steel ratio ρv", 0, ""], ["As_tie", "Provided tie As (0 = design)", 0, "mm²"],
        ["db", "Tie bar diameter (0 = skip anchorage)", 0, "mm"], ["end_cover", "Bar end cover beyond support plate edge", 40, "mm"]],
      build(code, p) {
        const { L, h, b, P, a, fc, fy, lb_load, lb_sup, d_tie, wc, rho_h, rho_v, As_tie, db, end_cover } = p;
        const wt = 2 * d_tie, two = a != null, R = two ? P : P / 2, x = two ? a : L / 2 - lb_load / 4;
        const wci = iterate(wc, 0.2 * h, w => R * x / (h - wt / 2 - w / 2), b, code, fc);
        const reinf = rho_h >= 0.0025 && rho_v >= 0.0025, cls = reinf ? "interior_reinf" : "interior_no_reinf";
        const m = Model(two ? "Deep beam, two point loads" : "Deep beam, central point load", 2, b, fc, fy);
        const yb = wt / 2, yt = h - wci / 2, ext = lb_sup / 2 - end_cover;
        addNode(m, "A", [0, yb], { fix: XY, lb: lb_sup, wt, anchor_ext: ext });
        addNode(m, "B", [L, yb], { fix: Y, lb: lb_sup, wt, anchor_ext: ext });
        if (two) { addNode(m, "C", [a, yt], { load: [0, -P], lb: lb_load, wt: wci }); addNode(m, "D", [L - a, yt], { load: [0, -P], lb: lb_load, wt: wci }); }
        else { addNode(m, "C", [L / 2 - lb_load / 4, yt], { load: [0, -P / 2], lb: lb_load / 2, wt: wci }); addNode(m, "D", [L / 2 + lb_load / 4, yt], { load: [0, -P / 2], lb: lb_load / 2, wt: wci }); }
        addMember(m, "AC", "A", "C", { strut_class: cls }); addMember(m, "DB", "D", "B", { strut_class: cls });
        addMember(m, "CD", "C", "D", { strut_class: "boundary" }); addMember(m, "AB", "A", "B", { As: As_tie, db });
        m.meta = { template: "deep_beam", d: h - d_tie, rho_h, rho_v,
          outline: [[[-lb_sup / 2, 0], [L + lb_sup / 2, 0], [L + lb_sup / 2, h], [-lb_sup / 2, h]]],
          notes: [`Top chord/node depth wc = ${wci.toFixed(0)} mm ${wc ? "(given)" : "(sized so the CCC node face is at capacity)"}`,
            `Bottom tie zone height wt = 2·${d_tie} = ${wt} mm`, `Diagonal strut class: ${cls}`] };
        return m;
      },
    },
    corbel: {
      name: "Corbel",
      params: [["hc", "Column depth hc", 400, "mm"], ["b", "Width b", 400, "mm"], ["h", "Corbel depth at column face h", 500, "mm"],
        ["d", "Effective depth d", 450, "mm"], ["av", "Load distance from face a_v", 200, "mm"], ["Vu", "Factored vertical load Vu", 400, "kN"],
        ["Nuc", "Horizontal force Nuc (blank = 0.2Vu)", "", "kN"], ["fc", "Concrete strength", 35, "MPa"], ["fy", "Steel yield fy", 420, "MPa"],
        ["lb", "Bearing plate length", 150, "mm"], ["c_col", "Column cover to bar centroid", 60, "mm"], ["As_tie", "Provided tie As (0 = design)", 0, "mm²"]],
      build(code, p) {
        const { hc, b, h, d, av, Vu, fc, fy, lb, c_col, As_tie } = p, Nuc = p.Nuc == null ? 0.2 * Vu : p.Nuc;
        const m = Model("Corbel", 2, b, fc, fy);
        addNode(m, "A", [av, d], { load: [Nuc, -Vu], lb, wt: 2 * (h - d) });
        addNode(m, "B", [-(hc - c_col), d], { fix: XY, wt: 2 * (h - d) });
        addNode(m, "C", [-c_col, c_col], { fix: XY, lb: 0.25 * hc, wt: 2 * c_col });
        addMember(m, "AB", "A", "B", { As: As_tie }); addMember(m, "AC", "A", "C");
        m.meta = { template: "corbel", d, av, Vu, Nuc,
          outline: [[[-hc, -0.8 * h], [0, -0.8 * h], [0, 0], [av + lb / 2 + 75, 0], [av + lb / 2 + 75, h], [0, h], [0, 1.8 * h], [-hc, 1.8 * h]]],
          notes: [`Horizontal force Nuc = ${Nuc.toFixed(1)} kN applied with Vu`, "Tie anchored at the far-face column bars; node C in the column compression zone at the soffit (face 0.25·hc × 2·c_col assumed)", "Reactions at B and C are the forces delivered to the column"] };
        return m;
      },
    },
    dapped_end: {
      name: "Dapped end",
      params: [["H", "Overall beam depth H", 1200, "mm"], ["hn", "Nib depth hn", 600, "mm"], ["ln", "Nib length (end to re-entrant corner)", 500, "mm"],
        ["xb", "Bearing centre from beam end", 250, "mm"], ["b", "Width b", 500, "mm"], ["Vu", "Factored bearing reaction Vu", 400, "kN"],
        ["Nuc", "Restraint force Nuc (blank = 0.2Vu)", "", "kN"], ["fc", "Concrete strength", 30, "MPa"], ["fy", "Steel yield fy", 420, "MPa"],
        ["e_h", "Re-entrant corner to hanger centreline", 75, "mm"], ["a_c", "Hanger to nib-tie anchorage node", 350, "mm"],
        ["lb", "Bearing pad width (along beam)", 150, "mm"], ["c_top", "Top chord centroid from top", 75, "mm"], ["c_bot", "Bottom chord centroid from soffit", 75, "mm"],
        ["c_nib", "Nib tie centroid above nib soffit", 75, "mm"], ["c_end", "Bar end cover at beam end", 40, "mm"],
        ["As_nib", "Nib tie As (0 = design)", 0, "mm²"], ["As_hanger", "Hanger As (0 = design)", 0, "mm²"], ["As_bot", "Bottom chord As (0 = design)", 0, "mm²"],
        ["As_vert", "Vertical tie V1 As (0 = design)", 0, "mm²"], ["db", "Nib tie / chord bar diameter (0 = skip anchorage)", 25, "mm"],
        ["strut_class", "Diagonal strut class", "interior_reinf", "class"]],
      build(code, p) {
        const { H, hn, ln, xb, b, Vu, fc, fy, e_h, a_c, lb, c_top, c_bot, c_nib, c_end, As_nib, As_hanger, As_bot, As_vert, db, strut_class } = p;
        const Nuc = p.Nuc == null ? 0.2 * Vu : p.Nuc, yA = H - hn + c_nib, yT = H - c_top, yB = c_bot, xh = ln + e_h, xc = xh + a_c;
        const m = Model("Dapped end", 2, b, fc, fy);
        addNode(m, "A", [xb, yA], { load: [-Nuc, Vu], lb, wt: 2 * c_nib, anchor_ext: xb - c_end });
        addNode(m, "C0", [xh, yA], { wt: 2 * c_nib }); addNode(m, "B", [xh, yT], { wt: 2 * c_top }); addNode(m, "D", [xh, yB], { wt: 2 * c_bot });
        addNode(m, "C", [xc, yA], { wt: 2 * c_nib }); addNode(m, "G", [xc, yT], { fix: XY, wt: 2 * c_top }); addNode(m, "H", [xc, yB], { fix: XY, wt: 2 * c_bot });
        addMember(m, "S1", "A", "B", { strut_class }); addMember(m, "TN1", "A", "C0", { As: As_nib, db }); addMember(m, "TN2", "C0", "C", { As: As_nib, db });
        addMember(m, "HG1", "C0", "B", { As: As_hanger }); addMember(m, "HG2", "D", "C0", { As: As_hanger }); addMember(m, "TC1", "B", "G", { strut_class: "boundary" });
        addMember(m, "BC1", "D", "H", { As: As_bot, db }); addMember(m, "S2", "D", "C", { strut_class }); addMember(m, "S3", "B", "C", { strut_class });
        addMember(m, "V1", "C", "H", { As: As_vert });
        m.meta = { template: "dapped_end", H, hn, ln, xb, Vu, Nuc, d: H - c_bot,
          outline: [[[0, H - hn], [ln, H - hn], [ln, 0], [xc + hn, 0], [xc + hn, H], [0, H]]],
          notes: [`Bearing reaction Vu = ${Vu.toFixed(1)} kN (up) and restraint Nuc = ${Nuc.toFixed(1)} kN (outward) act on the nib at A`,
            `Hanger at ${e_h.toFixed(0)} mm from the re-entrant corner; truss cut ${a_c.toFixed(0)} mm beyond the hanger (nodes C, G, H)`,
            "G and H carry the section forces into the rest of the beam",
            "Nib tie TN1/TN2 and hanger HG1/HG2 need full anchorage at both ends (check hooks at A)"] };
        return m;
      },
    },
    pile_cap_2: {
      name: "Two-pile cap",
      params: [["s", "Pile spacing s", 1800, "mm"], ["c", "Column width c", 500, "mm"], ["h", "Cap depth h", 1000, "mm"],
        ["b", "Cap width b", 800, "mm"], ["D", "Pile diameter D", 600, "mm"], ["P", "Factored column load P", 2500, "kN"],
        ["fc", "Concrete strength", 30, "MPa"], ["fy", "Steel yield fy", 420, "MPa"], ["d_tie", "Tie centroid from bottom", 150, "mm"],
        ["wc", "Top node depth (blank = auto)", "", "mm"], ["As_tie", "Provided tie As (0 = design)", 0, "mm²"], ["strut_class", "Diagonal strut class", "interior_no_reinf", "class"]],
      build(code, p) {
        const { s, c, h, b, D, P, fc, fy, d_tie, wc, As_tie, strut_class } = p, wt = 2 * d_tie, x = s / 2 - c / 4;
        const wci = iterate(wc, 0.15 * h, w => (P / 2) * x / (h - wt / 2 - w / 2), b, code, fc);
        const m = Model("Two-pile cap", 2, b, fc, fy), yt = h - wci / 2;
        addNode(m, "P1", [-s / 2, wt / 2], { fix: XY, lb: D, wt }); addNode(m, "P2", [s / 2, wt / 2], { fix: Y, lb: D, wt });
        addNode(m, "T1", [-c / 4, yt], { load: [0, -P / 2], lb: c / 2, wt: wci }); addNode(m, "T2", [c / 4, yt], { load: [0, -P / 2], lb: c / 2, wt: wci });
        addMember(m, "S1", "T1", "P1", { strut_class }); addMember(m, "S2", "T2", "P2", { strut_class });
        addMember(m, "S12", "T1", "T2", { strut_class: "boundary" }); addMember(m, "T", "P1", "P2", { As: As_tie });
        const e = s / 2 + D / 2 + 150;
        m.meta = { template: "pile_cap_2", d: h - d_tie, s, D, P,
          outline: [[[-e, 0], [e, 0], [e, h], [c / 2, h], [c / 2, h + 300], [-c / 2, h + 300], [-c / 2, h], [-e, h]]],
          notes: [`Top node depth wc = ${wci.toFixed(0)} mm`, `Pile treated as a ${D} mm bearing width in the 2D section`, `Diagonal strut class: ${strut_class}`] };
        return m;
      },
    },
    pile_cap_4: {
      name: "Four-pile cap (3D)",
      params: [["s", "Pile spacing s (square)", 1800, "mm"], ["a", "Square column size a", 800, "mm"], ["h", "Cap depth h", 1200, "mm"],
        ["D", "Pile diameter D", 600, "mm"], ["P", "Factored column load P", 4000, "kN"], ["fc", "Concrete strength", 30, "MPa"],
        ["fy", "Steel yield fy", 420, "MPa"], ["d_tie", "Tie centroid from bottom", 150, "mm"], ["d_top", "Top node depth (blank = d_tie)", "", "mm"],
        ["As_tie", "Provided tie As per edge (0 = design)", 0, "mm²"], ["strut_class", "Diagonal strut class", "interior_no_reinf", "class"]],
      build(code, p) {
        const { s, a, h, D, P, fc, fy, d_tie, As_tie, strut_class } = p, d_top = p.d_top == null ? d_tie : p.d_top;
        const zb = d_tie, zt = h - d_top, m = Model("Four-pile cap (3D)", 3, 1, fc, fy), Ap = Math.PI * D * D / 4;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], k) => {
          const K = k + 1;
          addNode(m, `P${K}`, [sx * s / 2, sy * s / 2, zb], { fix: [K === 1, K <= 2, true], bearing_area: Ap });
          addNode(m, `T${K}`, [sx * a / 4, sy * a / 4, zt], { load: [0, 0, -P / 4], bearing_area: a * a / 4 });
        });
        const ring = 2 * d_top * a / 2;
        for (let k = 1; k <= 4; k++) { const n = k % 4 + 1;
          addMember(m, `S${k}`, `T${k}`, `P${k}`, { strut_class }); addMember(m, `T${k}${n}`, `P${k}`, `P${n}`, { As: As_tie });
          addMember(m, `C${k}${n}`, `T${k}`, `T${n}`, { strut_class: "boundary", area: ring }); }
        const e = s / 2 + D / 2 + 150;
        m.meta = { template: "pile_cap_4", d: h - d_tie, s, D, P,
          outline: [0, h].map(z => [[-e, -e, z], [e, -e, z], [e, e, z], [-e, e, z]]),
          notes: [`Top nodes at column quarter points, ${d_top} mm below top`, `Pile bearing area π·${D}²/4 = ${Ap.toFixed(0)} mm²`,
            "Ties bunched over the piles along the four cap edges", `Top ring strut area assumed ${ring.toFixed(0)} mm²`] };
        return m;
      },
    },
    pier_cap: {
      name: "Hammerhead pier cap",
      params: [["xb", "Bearing distance from column axis", 2500, "mm"], ["cw", "Column width", 1500, "mm"], ["h", "Cap depth h", 1800, "mm"],
        ["b", "Cap width b", 1500, "mm"], ["P1", "Left bearing load P1", 3000, "kN"], ["P2", "Right bearing load P2", 3000, "kN"],
        ["fc", "Concrete strength", 35, "MPa"], ["fy", "Steel yield fy", 420, "MPa"], ["d_tie", "Tie centroid from top", 100, "mm"],
        ["wc", "Column-top node depth (blank = auto)", "", "mm"], ["lb", "Bearing pad length", 400, "mm"], ["As_tie", "Provided tie As (0 = design)", 0, "mm²"]],
      build(code, p) {
        const { xb, cw, h, b, P1, P2, fc, fy, d_tie, wc, lb, As_tie } = p, wt = 2 * d_tie, yt = h - d_tie, Pm = Math.max(P1, P2);
        const wci = iterate(wc, 0.15 * h, w => Pm * (xb - cw / 4) / (yt - w / 2), b, code, fc);
        const m = Model("Hammerhead pier cap", 2, b, fc, fy);
        addNode(m, "L1", [-xb, yt], { load: [0, -P1], lb, wt }); addNode(m, "L2", [xb, yt], { load: [0, -P2], lb, wt });
        addNode(m, "M1", [-cw / 4, yt], { wt }); addNode(m, "M2", [cw / 4, yt], { wt });
        addNode(m, "C1", [-cw / 4, wci / 2], { fix: XY, lb: cw / 2, wt: wci }); addNode(m, "C2", [cw / 4, wci / 2], { fix: XY, lb: cw / 2, wt: wci });
        addMember(m, "T1", "L1", "M1", { As: As_tie }); addMember(m, "T0", "M1", "M2", { As: As_tie }); addMember(m, "T2", "M2", "L2", { As: As_tie });
        addMember(m, "S1", "L1", "C1"); addMember(m, "S2", "L2", "C2"); addMember(m, "V1", "M1", "C1"); addMember(m, "V2", "M2", "C2");
        if (Math.abs(P1 - P2) > 1e-9) for (const [i, j] of [["M1", "C2"], ["M2", "C1"]]) {
          addMember(m, "D", i, j); if (solve(m).forces.D <= 0) break; m.members.pop(); }
        const e = xb + lb / 2 + 200;
        m.meta = { template: "pier_cap", d: h - d_tie, P1, P2,
          outline: [[[-cw / 2, -0.6 * h], [cw / 2, -0.6 * h], [cw / 2, 0], [e, 0], [e, h], [-e, h], [-e, 0], [-cw / 2, 0]]],
          notes: [`Column-top nodes at ±cw/4, node depth ${wci.toFixed(0)} mm`, `Top tie zone height wt = ${wt} mm`] };
        return m;
      },
    },
    frame_corner: {
      name: "Frame corner (knee joint)",
      params: [["moment", "Moment: closing or opening", "closing", "text"], ["hc", "Column depth hc", 600, "mm"], ["hb", "Beam depth hb", 700, "mm"],
        ["b", "Width b", 400, "mm"], ["lc", "Column length below beam soffit", 600, "mm"], ["lb", "Beam length beyond column face", 700, "mm"],
        ["M", "Beam moment at the cut M", 300, "kN·m"], ["V", "Beam shear at the cut V (+ down)", 150, "kN"], ["N", "Beam axial force N (+ tension)", 0, "kN"],
        ["fc", "Concrete strength", 30, "MPa"], ["fy", "Steel yield fy", 420, "MPa"], ["c", "Bar centroid from face", 60, "mm"],
        ["wc", "Compression zone depth (blank = auto)", "", "mm"], ["As_out", "Outer bars As, closing (0 = design)", 0, "mm²"],
        ["As_in", "Inner bars As, opening (0 = design)", 0, "mm²"], ["As_diag", "Diagonal corner bars As, opening (0 = design)", 0, "mm²"],
        ["As_v", "Beam stirrups at the cut As (0 = design)", 0, "mm²"], ["db", "Outer bar diameter", 25, "mm"],
        ["rb", "Inside bend radius of outer bars (0 = report required)", 0, "mm"], ["cc", "Side cover to outer bars", 50, "mm"],
        ["strut_class", "Diagonal strut class", "interior_reinf", "class"]],
      build(code, p) {
        const { hc, hb, b, lc, lb, fc, fy, c, As_out, As_in, As_diag, As_v, db, rb, cc, strut_class } = p;
        const M = p.M || 0, V = p.V || 0, N = p.N || 0, wc = p.wc;
        const opening = String(p.moment || "closing").trim().toLowerCase().startsWith("o");
        const Mabs = Math.abs(M), Ht = lc + hb, xc = hc + lb, auto = wc == null || Number.isNaN(wc);
        let a = auto ? 0.2 * hb : wc, ac = a, T, Cb, Cc;
        for (let it = 0; it < 30; it++) {
          const z = hb - c - a / 2; T = Mabs * 1e3 / z + N / 2; Cb = Mabs * 1e3 / z - N / 2;
          const zc = hc - c - ac / 2;
          if (!opening) { const yE = Ht - c, yF = Ht - hb + a / 2; Cc = (V * (xc - c) + T * yE - Cb * yF) / zc; }
          else { const yE = Ht - a / 2, yF = Ht - hb + c; Cc = (Cb * yE - T * yF - V * (xc - (hc - c))) / zc; }
          if (!auto) break;
          const kind = opening ? "CCT" : "CCC";
          const f = Math.min(code.phi_node * fceNode(code, fc, kind), code.phi_strut * fceStrut(code, fc, strut_class)) * b / 1e3;
          const na = Math.min(Math.max(Math.ceil(Math.max(Cb, 0) / f / 10) * 10, 50), 0.4 * hb);
          const nac = Math.min(Math.max(Math.ceil(Math.abs(Cc) / f / 10) * 10, 50), 0.4 * hc);
          if (Math.abs(na - a) < 0.5 && Math.abs(nac - ac) < 0.5) break;
          a = na; ac = nac;
        }
        const z = hb - c - a / 2; T = Mabs * 1e3 / z + N / 2; Cb = Mabs * 1e3 / z - N / 2;
        const m = Model("Frame corner", 2, b, fc, fy);
        if (!opening) {
          const xt = c, xcm = hc - ac / 2, yt = Ht - c, ycm = Ht - hb + a / 2;
          addNode(m, "A", [xt, 0], { fix: XY, wt: 2 * c, cut: true }); addNode(m, "B", [xcm, 0], { fix: XY, lb: ac, cut: true });
          addNode(m, "C", [xt, yt], { wt: 2 * c, curved: true }); addNode(m, "D", [xcm, ycm], { lb: ac, wt: a });
          addNode(m, "E", [xc, yt], { load: [T, -V], wt: 2 * c, cut: true }); addNode(m, "F", [xc, ycm], { load: [-Cb, 0], wt: a, cut: true });
          addMember(m, "TC", "A", "C", { As: As_out }); addMember(m, "TB", "C", "E", { As: As_out });
          addMember(m, "SC", "B", "D", { strut_class: "boundary" }); addMember(m, "SB", "D", "F", { strut_class: "boundary" });
          addMember(m, "CD", "C", "D", { strut_class });
        } else {
          const xcm = ac / 2, xt = hc - c, ycm = Ht - a / 2, yt = Ht - hb + c;
          addNode(m, "A", [xcm, 0], { fix: XY, lb: ac, cut: true }); addNode(m, "B", [xt, 0], { fix: XY, wt: 2 * c, cut: true });
          addNode(m, "C", [xcm, ycm], { lb: ac, wt: a }); addNode(m, "D", [xt, yt], { lb: 2 * c, wt: 2 * c });
          addNode(m, "E", [xc, ycm], { load: [-Cb, -V], wt: a, cut: true }); addNode(m, "F", [xc, yt], { load: [T, 0], wt: 2 * c, cut: true });
          addMember(m, "SC", "A", "C", { strut_class: "boundary" }); addMember(m, "SB", "C", "E", { strut_class: "boundary" });
          addMember(m, "TC", "B", "D", { As: As_in }); addMember(m, "TB", "D", "F", { As: As_in });
          addMember(m, "CD", "C", "D", { As: As_diag });
        }
        if (V >= 0) addMember(m, "DE", "E", "D", { strut_class }); else addMember(m, "CF", "C", "F", { strut_class });
        addMember(m, "EF", "F", "E", { As: As_v }); addMember(m, "AD", "A", "D", { strut_class });
        m.meta = { template: "frame_corner", d: hb - c, M, V, N, moment: opening ? "opening" : "closing", db, rb, cc, As_out,
          outline: [[[0, -0.25 * hc], [hc, -0.25 * hc], [hc, Ht - hb], [xc + 0.25 * hb, Ht - hb], [xc + 0.25 * hb, Ht], [0, Ht]]],
          notes: [`${opening ? "Opening" : "Closing"} moment M = ${Mabs.toFixed(1)} kN·m at the beam cut, ${lb.toFixed(0)} mm from the column face; lever arm z = ${z.toFixed(0)} mm`,
            `Beam cut forces: T = ${T.toFixed(1)} kN, C = ${Cb.toFixed(1)} kN, V = ${V.toFixed(1)} kN (+ down), N = ${N.toFixed(1)} kN (+ tension)`,
            `Compression zones: beam ${a.toFixed(0)} mm, column ${ac.toFixed(0)} mm ${auto ? "(sized for the corner node and diagonal strut)" : "(given)"}; column compression ${Cc.toFixed(1)} kN`,
            "Column cut nodes A and B are the supports; their reactions are the column section forces. Nodes at the cuts (A, B, E, F) are not nodal zones and get no face checks",
            opening ? "Tie CD across the re-entrant corner needs diagonal bars or closed loops; inner bars TC/TB anchored past D"
              : "Outer bars TC/TB run continuously round the corner: node C is a curved-bar node, checked by its bend radius (ACI 23.10)"] };
        return m;
      },
    },
    footing: {
      name: "Pile / spread / abutment footing",
      params: [["kind", "Foundation: pile or spread", "pile", "text"], ["B", "Footing length B", 7000, "mm"], ["H", "Footing depth H", 2000, "mm"],
        ["b", "Footing width b (out of plane)", 7000, "mm"], ["fc", "Concrete strength", 35, "MPa"], ["fy", "Steel yield fy", 400, "MPa"],
        ["x1", "Column 1 centre from left edge", 3500, "mm"], ["cw1", "Column 1 width", 2500, "mm"], ["V1", "Column 1 axial load V (down)", 9000, "kN"],
        ["H1", "Column 1 horizontal load H (+x)", 5000, "kN"], ["M1", "Column 1 moment M (+ loads the right side)", 50000, "kN·m"],
        ["x2", "Column 2 centre (blank = one column)", "", "mm"], ["cw2", "Column 2 width", 1500, "mm"], ["V2", "Column 2 axial load V", 0, "kN"],
        ["H2", "Column 2 horizontal load H", 0, "kN"], ["M2", "Column 2 moment M", 0, "kN·m"],
        ["piles", "Pile rows / soil spring stations x (comma list)", "650,2550,4450,6350", "text"], ["pile_d", "Pile diameter", 508, "mm"],
        ["n_spread", "Soil springs if no stations given (spread)", 4, ""], ["heel_len", "Heel surcharge length from left edge (abutment)", 0, "mm"],
        ["w_heel1", "Heel surcharge at left edge", 0, "kN/m"], ["w_heel2", "Heel surcharge at the wall face", 0, "kN/m"],
        ["c_top", "Top chord centroid from top", 100, "mm"], ["c_bot", "Bottom chord centroid from soffit", 100, "mm"], ["c_col", "Column bar centroid from column face", 100, "mm"],
        ["As_top", "Top chord As (0 = design)", 0, "mm²"], ["As_bot", "Bottom chord As (0 = design)", 0, "mm²"], ["As_vert", "Vertical ties As (0 = design)", 0, "mm²"],
        ["strut_class", "Diagonal strut class", "interior_reinf", "class"]],
      build(code, p) {
        const { B, H, b, fc, fy, pile_d, n_spread, c_top, c_bot, c_col, As_top, As_bot, As_vert, strut_class } = p;
        const kind = String(p.kind || "pile").trim().toLowerCase() === "spread" ? "spread" : "pile";
        const heel_len = p.heel_len || 0, w1 = p.w_heel1 || 0, w2 = p.w_heel2 || 0;
        const cols = [[p.x1, p.cw1, p.V1 || 0, p.H1 || 0, p.M1 || 0]];
        if (p.x2 != null && !Number.isNaN(p.x2)) cols.push([p.x2, p.cw2, p.V2 || 0, p.H2 || 0, p.M2 || 0]);
        const fl = foundationLoads(kind, B, H, cols.map(c => [c[0], c[2], c[3], c[4]]), p.piles, n_spread, heel_len, w1, w2);
        const xsr = fl.xs, sup = [];
        cols.forEach(([xc, cw]) => { const off = Math.max(cw / 2 - c_col, cw / 4); sup.push(xc - off, xc + off); });
        let st = Array.from(new Set(xsr.map(x => +x.toFixed(3))));
        sup.forEach(xs => {
          if (st.every(x => Math.abs(xs - x) > 0.3 * H)) st.push(+xs.toFixed(3));
          else { let j = 0; st.forEach((x, q) => { if (Math.abs(x - xs) < Math.abs(st[j] - xs)) j = q; }); st[j] = +xs.toFixed(3); }
        });
        st.sort((a, c) => a - c);
        const m = Model(kind === "pile" ? "Pile footing" : "Spread footing", 2, b, fc, fy);
        m.interior_width_rule = "secant"; m.stiffness = "section";
        const yt = H - c_top, yb = c_bot, ccx = cols.map(c => c[0]);
        let first = true;
        st.forEach((x, q) => {
          const k = q + 1, isSup = sup.some(s0 => Math.abs(x - s0) < 1e-6);
          const col = cols.reduce((a, c) => (Math.abs(c[0] - x) < Math.abs(a[0] - x) ? c : a));
          const o = { wt: 2 * c_top };
          if (isSup) { o.fix = first ? [true, true] : [false, true]; o.lb = col[1] / 2 - c_col; first = false; }
          addNode(m, `T${k}`, [x, yt], o);
          addNode(m, `B${k}`, [x, yb], { wt: 2 * c_bot, lb: kind === "pile" && xsr.some(xr => Math.abs(x - xr) <= 0.3 * H) ? pile_d : 0 });
        });
        xsr.forEach((xr, i) => {
          let j = 0; st.forEach((x, q) => { if (Math.abs(x - xr) < Math.abs(st[j] - xr)) j = q; });
          const N = m.nodes[`B${j + 1}`]; N.load = [N.load[0] + fl.Hr[i], N.load[1] + fl.R[i]];
        });
        if (heel_len > 0) {
          const mids = [0].concat(st.slice(1).map((x, q) => (st[q] + x) / 2), [B]);
          const wq = x => w1 + (w2 - w1) * x / heel_len;
          st.forEach((x, q) => { const a0 = mids[q], a1 = Math.min(mids[q + 1], heel_len); if (a1 <= a0) return;
            const P = 0.5 * (wq(a0) + wq(a1)) * (a1 - a0) / 1e3, N = m.nodes[`T${q + 1}`]; N.load = [N.load[0], N.load[1] - P]; });
        }
        const n = st.length;
        for (let k = 1; k < n; k++) {
          addMember(m, `TC${k}`, `T${k}`, `T${k + 1}`, { As: As_top, strut_class: "boundary" });
          addMember(m, `BC${k}`, `B${k}`, `B${k + 1}`, { As: As_bot, strut_class: "boundary" });
          const xm = 0.5 * (st[k - 1] + st[k]), xc = ccx.reduce((a, c) => (Math.abs(c - xm) < Math.abs(a - xm) ? c : a));
          if (xm < xc) addMember(m, `D${k}`, `T${k + 1}`, `B${k}`, { strut_class });
          else addMember(m, `D${k}`, `T${k}`, `B${k + 1}`, { strut_class });
        }
        for (let k = 1; k <= n; k++) addMember(m, `V${k}`, `B${k}`, `T${k}`, { As: As_vert, strut_class: "interior_reinf" });
        const tot = fl.R.reduce((a, c) => a + c, 0), ring = [];
        cols.slice().sort((a, c) => c[0] - a[0]).forEach(c => ring.push([c[0] + c[1] / 2, H], [c[0] + c[1] / 2, 1.4 * H], [c[0] - c[1] / 2, 1.4 * H], [c[0] - c[1] / 2, H]));
        m.meta = { template: "footing", d: H - c_bot, kind,
          outline: [[[0, 0], [B, 0], [B, H]].concat(ring, [[0, H]])],
          notes: [(kind === "pile" ? "Pile reactions from a rigid cap with equal pile stiffness" : `Soil reactions from ${xsr.length} springs, stiffness ∝ tributary length (linear, uplift not excluded)`)
            + `; ΣR = ${tot.toFixed(1)} kN, moments taken at the soffit (M + H·${H.toFixed(0)} mm)`,
            "Reactions are applied as loads at the bottom chord; the columns are the supports",
            heel_len ? `Heel surcharge ${w1}→${w2} kN/m over ${heel_len.toFixed(0)} mm = ${fl.W.toFixed(1)} kN` : "No heel surcharge",
            "Indeterminate truss: member stiffness Es·As (reinforced) or Ec·w·b (struts)"] };
        return m;
      },
    },
  };

  // rigid-footing reactions (pile: equal stiffness; spread: springs ∝ tributary length); returned as loads (up +)
  function numList(v) { return (typeof v === "string" ? v.replace(/;/g, ",").split(",") : (v || [])).map(t => String(t).trim()).filter(t => t !== "").map(Number); }
  function foundationLoads(kind, B, H, columns, piles, nSpread = 4, heelLen = 0, w1 = 0, w2 = 0) {
    let xs = numList(piles).sort((a, c) => a - c), k;
    if (kind === "pile") k = xs.map(() => 1);
    else {
      if (xs.length < 2) { const n = Math.max(2, Math.trunc(nSpread)); xs = Array.from({ length: n }, (_, i) => (i + 0.5) * B / n); }
      const mids = [0].concat(xs.slice(1).map((x, q) => (xs[q] + x) / 2), [B]);
      k = xs.map((_, i) => mids[i + 1] - mids[i]);
    }
    const V = columns.reduce((a, c) => a + c[1], 0), Hx = columns.reduce((a, c) => a + c[2], 0);
    const W = heelLen > 0 ? 0.5 * (w1 + w2) * heelLen / 1e3 : 0, xW = W ? heelLen * (w1 + 2 * w2) / (3 * (w1 + w2)) : 0;
    const K = k.reduce((a, c) => a + c, 0), xbar = k.reduce((a, c, i) => a + c * xs[i], 0) / K;
    const M = columns.reduce((a, c) => a + c[3] * 1e3 + c[1] * (c[0] - xbar) + c[2] * H, 0) + W * (xW - xbar);
    const I = k.reduce((a, c, i) => a + c * (xs[i] - xbar) ** 2, 0), aa = (V + W) / K, bb = I > 0 ? M / I : 0;
    return { xs, R: k.map((c, i) => c * (aa + bb * (xs[i] - xbar))), Hr: k.map(c => -Hx * c / K), W };
  }

  // ACI 318-19 23.10: bend radius of the outer bars round curved-bar node C (closing frame corner)
  function curvedBarChecks(m, res, code) {
    const mt = m.meta, db = +mt.db || 25, rb = +mt.rb || 0, cc = +mt.cc || 50, fc = m.fc, fy = m.fy, b = m.b;
    const T1 = Math.max(res.forces.TC || 0, 0), T2 = Math.max(res.forces.TB || 0, 0), Tl = Math.max(T1, T2), Ts = Math.min(T1, T2);
    if (Tl <= 0) return [];
    const As = +mt.As_out || 0, Ats = As > 0 ? As : Tl * 1e3 / (code.phi_tie * fy), src = As > 0 ? "provided" : "required";
    let r1 = 2 * Ats * fy / (b * fc);
    let how = `2·Ats·fy/(b·f'c) = 2·${Ats.toFixed(0)}·${fy.toFixed(0)}/(${b.toFixed(0)}·${fc.toFixed(0)}) = ${r1.toFixed(0)} mm (Ats ${src})`;
    if (cc < 2 * db) { r1 *= 2 * db / cc; how += `, × 2db/cc = ${(2 * db).toFixed(0)}/${cc.toFixed(0)} (23.10.3)`; }
    const half = (db <= 25 ? 3 : db <= 36 ? 4 : 5) * db;
    if (half > r1) how += `; half the minimum bend diameter of Table 25.3.1 = ${half.toFixed(0)} mm governs`;
    r1 = Math.max(r1, half);
    const k = db <= 20 ? 2.1 : 1.7, fcd = code.key.startsWith("ACI") ? fc : 0.8 * fc;
    const ld = Math.max(300, fy / (k * Math.sqrt(fcd)) * db), tanc = Ts / Tl;
    const r2 = Math.max(0, 2 * ld * (1 - tanc) / Math.PI - db / 2), out = [];
    [[r1, "ACI 318-19 23.10.1–23.10.3, Table 25.3.1", `curved-bar node: rb ≥ ${how}`],
     [r2, "ACI 318-19 23.10.6", `unequal ties (${Ts.toFixed(1)} / ${Tl.toFixed(1)} kN, tanθc = ${tanc.toFixed(3)}): ℓcb = π/2·(rb + db/2) ≥ ℓd(1 − tanθc), ℓd = ${ld.toFixed(0)} mm → rb ≥ ${r2.toFixed(0)} mm`]]
      .forEach(([req, clause, txt]) => {
        if (rb > 0) out.push(C("C", "detail", req, rb, req / rb, rb >= req - 1e-9 ? "OK" : "NG", clause, txt + `; provided rb = ${rb.toFixed(0)} mm`));
        else out.push(C("C", "detail", req, null, null, "INFO", clause, txt + "; enter the bend radius rb to check it"));
      });
    return out;
  }

  function extraChecks(m, res, code) {
    const t = m.meta.template, out = [], fc = m.fc, fy = m.fy;
    if (t === "deep_beam") [["ρ_h", m.meta.rho_h], ["ρ_v", m.meta.rho_v]].forEach(([lab, r]) =>
      out.push(C("web", "detail", r, 0.0025, r ? 0.0025 / r : null, r >= 0.0025 ? "OK" : "INFO", code.refs.distributed, `${lab} = ${(+r).toFixed(4)} (≥ 0.0025 needed to use β_s = 0.75)`)));
    const usesSE = m.members.some(e => e.strut_class === "interior_sizeeffect");
    if (["deep_beam", "pile_cap_2", "pier_cap", "pile_cap_4"].includes(t) && code.key.startsWith("ACI")) {
      const d = m.meta.d; let bw = m.b, Vu;
      if (t === "pile_cap_4") { bw = m.meta.s + m.meta.D + 300; Vu = m.meta.P / 2; }
      else if (t === "pier_cap") Vu = Math.max(m.meta.P1, m.meta.P2);
      else Vu = Math.max(...Object.values(res.reactions).map(r => Math.abs(r[1])));
      const ls = Math.min(1, Math.sqrt(2 / (1 + 0.004 * d))), Vl = code.phi_strut * 0.42 * ls * Math.sqrt(fc) * bw * d / 1e3;
      out.push(C("section", "detail", Vu, Vl, Vu / Vl, Vu <= Vl ? "OK" : usesSE ? "NG" : "INFO", code.refs.sizeeffect,
        `Vu ≤ φ·0.42·λs·√f'c·bw·d, λs = ${ls.toFixed(3)}, bw = ${bw.toFixed(0)}, d = ${d.toFixed(0)}; required when β_s = 0.75 is used without distributed reinforcement`));
    }
    if (t === "frame_corner" && m.meta.moment === "closing") out.push(...curvedBarChecks(m, res, code));
    if (t === "corbel") {
      const { d, av, Vu, Nuc } = m.meta, b = m.b;
      out.push(C("geometry", "detail", av / d, 1, av / d, av / d <= 1 ? "OK" : "NG", code.refs.corbel, `a_v/d = ${av}/${d} = ${(av / d).toFixed(2)} ≤ 1.0`));
      out.push(C("load", "detail", Nuc, Vu, Vu ? Nuc / Vu : null, 0.2 * Vu - 1e-9 <= Nuc && Nuc <= Vu ? "OK" : "NG", code.refs.corbel, `0.2·Vu ≤ Nuc ≤ Vu (${Nuc.toFixed(1)} kN)`));
      if (code.key.startsWith("ACI")) {
        const Vn = Math.min(0.2 * fc, 3.3 + 0.08 * fc, 11) * b * d / 1e3;
        out.push(C("section", "detail", Vu, 0.75 * Vn, Vu / (0.75 * Vn), Vu <= 0.75 * Vn ? "OK" : "NG", code.refs.corbel, "Vu ≤ φ·min(0.2f'c, 3.3+0.08f'c, 11)·bw·d (16.5.2.4)"));
        const Asmin = 0.04 * fc / fy * b * d, tie = m.members.find(e => e.name === "AB");
        if (tie) out.push(C("AB", "detail", tie.As, Asmin, tie.As ? Asmin / tie.As : null, tie.As ? (tie.As >= Asmin ? "OK" : "NG") : "INFO", code.refs.corbel, `As,min = 0.04·(f'c/fy)·b·d = ${Asmin.toFixed(0)} mm² (16.5.5.5)`));
      }
    }
    return out;
  }

  function buildCustom(d) {
    const m = Model(d.title || "Custom STM", d.dim || 2, d.b || 300, d.fc, d.fy);
    m.interior_width_rule = d.interior_width_rule || "projection";
    m.stiffness = d.stiffness || "uniform";
    d.nodes.forEach(n => { const o = Object.assign({}, n); delete o.name; delete o.xyz; addNode(m, n.name, n.xyz, o); });
    (d.load_cases || []).forEach(lc => { const f = lc.factor == null ? 1 : +lc.factor;
      Object.entries(lc.loads || {}).forEach(([n, ld]) => { const N = m.nodes[n]; N.load = N.load.map((a, q) => a + f * (+ld[q] || 0)); }); });
    d.members.forEach(e => { const o = Object.assign({}, e); delete o.name; delete o.i; delete o.j; addMember(m, e.name, e.i, e.j, o); });
    m.meta = Object.assign({}, d.meta || {}, { template: (d.meta && d.meta.template) || "custom", notes: d.notes || [], outline: d.outline || [] });
    return m;
  }

  // editable model description (same shape as a custom JSON case); keeps template meta so extra checks still run
  function toSpec(m) {
    const meta = JSON.parse(JSON.stringify(m.meta || {}));
    const outline = meta.outline || [], notes = meta.notes || [];
    delete meta.outline; delete meta.notes;
    return { title: m.title, dim: m.dim, b: m.b, fc: m.fc, fy: m.fy, interior_width_rule: m.interior_width_rule, stiffness: m.stiffness,
      nodes: m.order.map(n => JSON.parse(JSON.stringify(m.nodes[n]))),
      members: m.members.map(e => Object.assign({}, e)), outline, notes, meta };
  }

  function summary(checks) {
    const rated = checks.filter(c => c.ratio != null && (c.status === "NG" || (c.status === "OK" && c.kind !== "detail")));
    const worst = rated.reduce((a, c) => (!a || c.ratio > a.ratio ? c : a), null);
    const ng = checks.filter(c => c.status === "NG").length;
    return { worst, n_ng: ng, ok: ng === 0 };
  }

  function runCase(cs) {
    const code = CODES[cs.code || "ACI318-19"];
    let m;
    if (cs.custom) m = buildCustom(Object.assign({ interior_width_rule: cs.interior_width_rule }, cs.custom));
    else {
      const T = TEMPLATES[cs.template], prm = {};
      T.params.forEach(([k, , dv, unit]) => { const v = cs.params[k] !== undefined ? cs.params[k] : dv; prm[k] = (v === "" || v === null) ? null : (unit === "class" || unit === "text" ? v : Number(v)); });
      m = T.build(code, prm); if (cs.interior_width_rule) m.interior_width_rule = cs.interior_width_rule; }
    const res = solve(m);
    const checks = runChecks(res, code).concat(extraChecks(m, res, code));
    return { model: m, res, checks, code, summary: summary(checks) };
  }

  const API = { CODES, STRUT_CLASSES, TEMPLATES, Model, addNode, addMember, geometry, solve, runChecks, extraChecks, buildCustom, toSpec, strutWidth: strutWidth2d, strutWidthModel, foundationLoads, nodeKind, runCase, summary, version: "0.7.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.STM = API;
})(typeof window !== "undefined" ? window : globalThis);

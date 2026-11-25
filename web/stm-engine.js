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
      refs: {
        strut: "ACI 318-19 23.4.1, 23.4.3, 21.2.1", node: "ACI 318-19 23.9.1, 23.9.2",
        tie: "ACI 318-19 23.7.2", angle: "ACI 318-19 23.2.7", distributed: "ACI 318-19 23.5.1",
        sizeeffect: "ACI 318-19 23.4.4", corbel: "ACI 318-19 16.5", anchorage: "ACI 318-19 23.8.2, 25.4.2.4",
        fce: "f_ce = 0.85·β_c·β_s·f'c (23.4.3) ; 0.85·β_c·β_n·f'c (23.9.2)",
      },
    },
  };
  const fceStrut = (c, fc, cls, bc = 1) => c.k_c * bc * c.beta_s[cls] * fc;
  const fceNode = (c, fc, kind, bc = 1) => c.k_c * bc * c.beta_n[kind] * fc;

  // ------------------------------------------------------------------ model
  function Model(title, dim = 2, b = 300, fc = 30, fy = 420) {
    return { title, dim, b, fc, fy, nodes: {}, order: [], members: [], meta: {}, interior_width_rule: "projection" };
  }
  function addNode(m, name, xyz, o = {}) {
    const d = m.dim;
    m.nodes[name] = Object.assign({ name, xyz: xyz.map(Number), fix: Array(d).fill(false), load: Array(d).fill(0),
      spring: null, lb: 0, wt: 0, bearing_area: 0, bearing_axis: -1, confine: 1, kind_override: "", anchor_ext: -1 }, o);
    if (!m.order.includes(name)) m.order.push(name);
    return m.nodes[name];
  }
  function addMember(m, name, i, j, o = {}) {
    const e = Object.assign({ name, i, j, role: "auto", strut_class: "interior_no_reinf", width: 0, area: 0, As: 0, fy: 0, db: 0, EA: 0 }, o);
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

  function solve(m) {
    const d = m.dim, names = m.order, idx = {}, nd = d * names.length;
    names.forEach((n, k) => (idx[n] = k));
    const K = Array.from({ length: nd }, () => Array(nd).fill(0));
    const F = Array(nd).fill(0), Ks = Array(nd).fill(0);
    names.forEach(n => { const N = m.nodes[n]; for (let a = 0; a < d; a++) { F[idx[n] * d + a] = +N.load[a] || 0; if (N.spring) Ks[idx[n] * d + a] = +N.spring[a] || 0; } });
    const units = m.members.map(e => {
      const { L, u } = geometry(m, e), EA = e.EA > 0 ? e.EA : 1e6, i0 = idx[e.i] * d, j0 = idx[e.j] * d;
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
    const fscale = Math.max(1, ...F.map(Math.abs));
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
    return { model: m, forces, reactions, stable: resid < 1e-6 * fscale && eq < 1e-6 * fscale, residual: resid, equilibrium_error: eq };
  }

  // ------------------------------------------------------------------ checks
  const BARS = [12, 16, 20, 25, 28, 32];
  function barSuggestion(As) {
    const opts = BARS.map(dd => { const a = Math.PI * dd * dd / 4, n = Math.max(2, Math.ceil(As / a)); return [n, dd, n * a]; });
    const good = opts.filter(o => o[0] <= 12).slice(0, 2);
    return (good.length ? good : opts.slice(-1)).map(([n, dd, A]) => `${n}T${dd} (${A.toFixed(0)} mm²)`).join(" or ");
  }
  function strutWidth2d(res, e, nn) {
    if (e.width > 0) return [e.width, "given"];
    const N = res.model.nodes[nn];
    if (N.lb <= 0 && N.wt <= 0) return [null, "no node geometry"];
    const { u } = geometry(res.model, e);
    if (N.lb <= 0 && res.model.interior_width_rule === "secant" && Math.abs(u[0]) > 0.17)
      return [N.wt / Math.abs(u[0]), `wt/cosθ = ${N.wt.toFixed(0)}/${Math.abs(u[0]).toFixed(3)} (secant rule)`];
    return [N.lb * Math.abs(u[1]) + N.wt * Math.abs(u[0]),
      `lb·sinθ + wt·cosθ = ${N.lb.toFixed(0)}·${Math.abs(u[1]).toFixed(3)} + ${N.wt.toFixed(0)}·${Math.abs(u[0]).toFixed(3)}`];
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
    const t = res.model.members.filter(e => (e.i === nn || e.j === nn) && res.forces[e.name] > 1e-6).length;
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
        const Cf = -F, fce = fceStrut(code, fc, e.strut_class);
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
          `β_s = ${code.beta_s[e.strut_class]} (${e.strut_class}), f_ce = ${fce.toFixed(2)} MPa, ${m.dim === 2 ? `w = ${(A / b).toFixed(0)} mm` : `A = ${A.toFixed(0)} mm²`} at ${nn} (${how})`));
      }
    }
    for (const nn of m.order) {
      const N = m.nodes[nn], k = kinds[nn], fce = fceNode(code, fc, k, N.confine), cs = code.phi_node * fce;
      for (const e of m.members) {
        if ((e.i !== nn && e.j !== nn) || res.forces[e.name] >= -1e-6) continue;
        const Cf = -res.forces[e.name], [A] = endArea(res, e, nn);
        if (!A) continue;
        const cap = cs * A / 1e3, r = Cf / cap;
        out.push(C(nn, "node", Cf, cap, r, r <= 1 ? "OK" : "NG", code.refs.node, `${k} node, β_n = ${code.beta_n[k]}, β_c = ${N.confine}, face of ${e.name}, f_ce = ${fce.toFixed(2)} MPa`));
      }
      if (m.dim === 2) for (const e of m.members) {
        if ((e.i !== nn && e.j !== nn) || res.forces[e.name] <= 1e-6 || e.width > 0) continue;
        const [w] = strutWidth2d(res, e, nn);
        if (!w) continue;
        const T = res.forces[e.name], cap = cs * w * b / 1e3, r = T / cap;
        out.push(C(nn, "node", T, cap, r, r <= 1 ? "OK" : "NG", code.refs.node, `${k} node, β_n = ${code.beta_n[k]}, tie face of ${e.name}, w = ${w.toFixed(0)} mm, f_ce = ${fce.toFixed(2)} MPa`));
      }
      const P = N.load.map(Number); const R = res.reactions[nn];
      if (R) R.forEach((v, a) => (P[a] += v));
      const Pn = Math.hypot(...P);
      if (Pn > 1e-6) {
        const A = m.dim === 2 && N.lb > 0 ? N.lb * b : m.dim === 3 && N.bearing_area > 0 ? N.bearing_area : null;
        if (A) { const cap = cs * A / 1e3, r = Pn / cap; out.push(C(nn, "bearing", Pn, cap, r, r <= 1 ? "OK" : "NG", code.refs.node, `${k} node bearing face, A = ${A.toFixed(0)} mm²`)); }
      }
    }
    for (const nn of m.order) {
      const here = m.members.filter(e => (e.i === nn || e.j === nn) && Math.abs(res.forces[e.name]) > 1e-6);
      for (const s of here) { if (res.forces[s.name] >= 0) continue;
        for (const t of here) { if (res.forces[t.name] <= 0) continue;
          const us = geometry(m, s).u, ut = geometry(m, t).u;
          const ang = Math.acos(Math.min(1, Math.abs(us.reduce((a, v, q) => a + v * ut[q], 0)))) * 180 / Math.PI;
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
  };

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
    d.nodes.forEach(n => { const o = Object.assign({}, n); delete o.name; delete o.xyz; addNode(m, n.name, n.xyz, o); });
    d.members.forEach(e => { const o = Object.assign({}, e); delete o.name; delete o.i; delete o.j; addMember(m, e.name, e.i, e.j, o); });
    m.meta = Object.assign({}, d.meta || {}, { template: (d.meta && d.meta.template) || "custom", notes: d.notes || [], outline: d.outline || [] });
    return m;
  }

  // editable model description (same shape as a custom JSON case); keeps template meta so extra checks still run
  function toSpec(m) {
    const meta = JSON.parse(JSON.stringify(m.meta || {}));
    const outline = meta.outline || [], notes = meta.notes || [];
    delete meta.outline; delete meta.notes;
    return { title: m.title, dim: m.dim, b: m.b, fc: m.fc, fy: m.fy, interior_width_rule: m.interior_width_rule,
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
      T.params.forEach(([k, , dv, unit]) => { const v = cs.params[k] !== undefined ? cs.params[k] : dv; prm[k] = (v === "" || v === null) ? null : (unit === "class" ? v : Number(v)); });
      m = T.build(code, prm); m.interior_width_rule = cs.interior_width_rule || "projection"; }
    const res = solve(m);
    const checks = runChecks(res, code).concat(extraChecks(m, res, code));
    return { model: m, res, checks, code, summary: summary(checks) };
  }

  const API = { CODES, STRUT_CLASSES, TEMPLATES, Model, addNode, addMember, geometry, solve, runChecks, extraChecks, buildCustom, toSpec, strutWidth: strutWidth2d, nodeKind, runCase, summary, version: "0.4.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.STM = API;
})(typeof window !== "undefined" ? window : globalThis);

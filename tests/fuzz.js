// Stress test of every template input in the browser engine: each numeric input is set to
// +default, -default, 0, tiny, huge, -1, 1e-6, 1e7, blank and text, one at a time, for both codes.
// Prints JSON lines: {t, code, k, v, status: "ok" | "input" | "bug", msg}.
const S = require(process.argv[2]);
const out = [];
const finite = o => [...Object.values(o.res.forces), ...o.checks.flatMap(c => [c.demand, c.capacity, c.ratio]).filter(v => v != null)]
  .every(v => typeof v !== "number" || isFinite(v));
for (const [t, T] of Object.entries(S.TEMPLATES)) for (const code of Object.keys(S.CODES))
  for (const [k, , dv, unit] of T.params) {
    if (unit === "class" || unit === "text") continue;
    const base = (dv === "" || dv == null) ? 500 : +dv;
    for (const v of [base, -base, 0, base * 1e-3, base * 1e3, -1, 1e-6, 1e7, "", "abc"]) {
      let status = "ok", msg = "";
      try { const o = S.runCase({ template: t, code, params: { [k]: v } });
        if (!finite(o)) { status = "bug"; msg = "non-finite result"; } else if (!o.res.stable) { status = "bug"; msg = "unstable"; } }
      catch (e) { if (e instanceof S.InputError) { status = "input"; msg = e.message; } else { status = "bug"; msg = e.stack.split("\n").slice(0, 2).join(" "); } }
      out.push({ t, code, k, v, status, msg });
    }
  }
console.log(JSON.stringify(out));

"""Build the single-file HTML app: python web/build.py -> web/stm-lab.html (standalone, offline)."""
import pathlib
here = pathlib.Path(__file__).parent
engine = (here / "stm-engine.js").read_text(encoding="utf-8")
app = (here / "app.html").read_text(encoding="utf-8").replace("/*ENGINE*/", engine)
(here / "stm-lab.embed.html").write_text(app, encoding="utf-8")   # body-only variant
full = ("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
        + app.replace("<header", "</head><body>\n<header", 1) + "\n</body></html>\n")
(here / "stm-lab.html").write_text(full, encoding="utf-8")
print("built", here / "stm-lab.html", len(full), "bytes")

# template input table (labels, defaults, units) shared with the Python engine for input validation
import json, subprocess
js = "const S=require(process.argv[1]);const o={};for(const[k,T]of Object.entries(S.TEMPLATES))o[k]={name:T.name,params:T.params};console.log(JSON.stringify(o,null,1))"
out = subprocess.run(["node", "-e", js, str(here / "stm-engine.js")], capture_output=True, text=True, check=True).stdout
(here.parent / "stm" / "params.json").write_text(out, encoding="utf-8")
print("wrote stm/params.json")

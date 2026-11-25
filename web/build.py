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

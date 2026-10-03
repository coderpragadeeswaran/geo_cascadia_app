r"""Static TTF copies of the app's own typeface (Anek Tamil, SIL OFL 1.1) for the PDF report (D55).

fpdf2 needs TrueType files; the app ships variable WOFF2 subsets (@fontsource-variable/anek-tamil). This tool instances
them at width 100 and weights 400 / 600 and writes backend/app/report_fonts/AnekTamil-{latin,tamil}-{400,600}.ttf plus
the licence. Run once (needs `brotli` for WOFF2); the outputs are committed, so the API itself needs no font tooling.
    backend\.venv\Scripts\python tools\build_report_fonts.py
"""
import os
import shutil

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "node_modules", "@fontsource-variable", "anek-tamil")
OUT = os.path.join(ROOT, "backend", "app", "report_fonts")

os.makedirs(OUT, exist_ok=True)
for subset in ("latin", "tamil"):
    for w in (400, 600):
        f = TTFont(os.path.join(SRC, "files", f"anek-tamil-{subset}-standard-normal.woff2"))
        axes = {a.axisTag for a in f["fvar"].axes}
        inst = instantiateVariableFont(f, {k: v for k, v in (("wght", w), ("wdth", 100)) if k in axes})
        inst.flavor = None
        path = os.path.join(OUT, f"AnekTamil-{subset}-{w}.ttf")
        inst.save(path)
        print(path, os.path.getsize(path))
for n in ("LICENSE", "LICENSE.md", "OFL.txt"):
    if os.path.isfile(os.path.join(SRC, n)):
        shutil.copy(os.path.join(SRC, n), os.path.join(OUT, "OFL-AnekTamil.txt"))
        print("licence copied")

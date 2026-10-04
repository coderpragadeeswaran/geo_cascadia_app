r"""Render the area report (PDF) to PNG pages for checking by eye (extras 5).

    backend\.venv\Scripts\python tools\render_report.py ward29 [--street "Sathy Main Road"] [--out docs\screenshots\report_v2]
Writes <out>/<name>.pdf and <out>/<name>-pNN.png (150 dpi) and prints the page count and the build time."""
import argparse
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--street")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "screenshots", "report_v2"))
    ap.add_argument("--dpi", type=int, default=150)
    a = ap.parse_args()
    from fastapi.testclient import TestClient
    import pypdfium2
    from app import mapdata, report
    from app.main import create_app
    from app.settings import Settings
    app = create_app(Settings())
    with TestClient(app):
        mapdata.configure(app.state.data.pool)
        s = app.state.data.db
        t = time.time()
        c = report.content(s, s.bundle(a.slug), app.state.runfiles.get(a.slug), app.state.model_card.get(),
                           app.state.settings.areas_dir, street=a.street)
        pdf = report.pdf(c)
        took = time.time() - t
    os.makedirs(a.out, exist_ok=True)
    name = a.slug + ("_" + "".join(ch if ch.isalnum() else "_" for ch in a.street.lower()).strip("_") if a.street else "")
    with open(os.path.join(a.out, name + ".pdf"), "wb") as f:
        f.write(pdf)
    doc = pypdfium2.PdfDocument(pdf)
    for i in range(len(doc)):
        doc[i].render(scale=a.dpi / 72).to_pil().save(os.path.join(a.out, f"{name}-p{i + 1:02d}.png"))
    print(f"{name}: {len(doc)} pages, built in {took:.1f} s -> {a.out}")


if __name__ == "__main__":
    main()

r"""build_pkg_zip.py — zip the pipeline package for the Colab S0 cell.

    backend\.venv\Scripts\python tools\build_pkg_zip.py [--out geo_cascadia_pkg_<tag>.zip]

S0 extracts the newest zip in /MyDrive/alldataset (after deleting geo_cascadia_pkg/) and expects its entries under
geo_cascadia_pkg/geo_cascadia/<file>.py. This writes every .py file of pipeline/geo_cascadia with that prefix (no
__pycache__, nothing else), then re-opens the zip and checks every entry name. Upload the zip to /MyDrive/alldataset.
"""
import argparse
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "pipeline", "geo_cascadia")
PREFIX = "geo_cascadia_pkg/geo_cascadia/"


def build(out):
    files = sorted(f for f in os.listdir(SRC) if f.endswith(".py") and os.path.isfile(os.path.join(SRC, f)))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(os.path.join(SRC, f), PREFIX + f)
    names = zipfile.ZipFile(out).namelist()
    bad = [n for n in names if not (n.startswith(PREFIX) and n.endswith(".py") and "/" not in n[len(PREFIX):])]
    if bad or len(names) != len(files) or PREFIX + "__init__.py" not in names:
        raise SystemExit(f"{out}: unexpected entries {bad or names}")
    return names


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "geo_cascadia_pkg_p7b.zip"))
    a = ap.parse_args()
    names = build(a.out)
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{a.out}: {len(names)} files, all under {PREFIX}")
    for n in names:
        print("  " + n)

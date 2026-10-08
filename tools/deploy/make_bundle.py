"""Build the deploy bundle for the AWS server (D63). Called by tools/deploy/make_bundle.ps1; stdlib only.

Two files in the output folder (outside the repo, default C:\\projects\\geo-cascadia-deploy):
  gc-bundle.tar.gz  code + production web build + server scripts + the app data the API reads (+ warm caches as seeds)
  gc-assets.tar.gz  the production detector weights, the local use router and the two floor-count example photos
                    (rarely change: deploy.ps1 sends it only with -Assets)

Only files git tracks are taken from the repo (so no .env, no venv, no node_modules, no caches by accident), plus three
runtime caches as seeds (data/cache/streetview_meta.json, streetpick/, planest/: they spare free-but-slow look-ups).
Excluded on purpose: docs, tests, screenshots, .git, every Street View image or crop (checked: the bundle may contain no
image at all; the two floor-count examples are the only images, in the assets file, because the floors prompt needs them).
Reproducible: sorted entries, fixed owner, file times = the commit time, gzip without a timestamp; text files get LF.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff")
TEXT_EXT = (".py", ".sh", ".conf", ".service", ".timer", ".txt", ".sql", ".md", ".ini", ".cfg", ".toml", ".html",
            ".js", ".css", ".svg", "")
SERVER_TOOLS = ("build_run_report.py", "box_choice.py", "fetch_osm_tags.py", "check_photos.py", "detect_photos.py",
                "measure_routes.py")                       # D65: the routed vs all-cloud measurement
CACHE_SEEDS = ("streetview_meta.json", "streetpick", "planest")
ASSETS = {"training_runs/v8s_640_s2/weights/best.pt": "the YOLOv8s detector (tier-1 config: v8s_640_s2)",
          "models/use_router.joblib": "the local building-use router",
          "crops_building_v1/w1236978105.jpg": "floor-count example, 1 storey",
          "crops_building_v1/w1247744938.jpg": "floor-count example, 2 storeys"}


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def tracked():
    return [p for p in git("ls-files", "-z").split("\0") if p]


def pick(paths):
    """repo path -> bundle path, for the files the server needs"""
    out = {}
    for p in paths:
        if os.path.basename(p).startswith(".env"):
            continue
        if p.startswith("backend/") and not p.startswith("backend/tests/") and p != "backend/pytest.ini":
            out[p] = p
        elif p.startswith("pipeline/geo_cascadia/") and p.endswith(".py"):
            out[p] = p
        elif p in ("worker/colab_worker.py", "worker/server_worker.py"):
            out[p] = p
        elif p.startswith("tools/") and p.count("/") == 1 and os.path.basename(p) in SERVER_TOOLS:
            out[p] = p
        elif p.startswith("tools/deploy/server/"):
            out[p] = "deploy/" + p[len("tools/deploy/server/"):]
        elif p.startswith("data/areas/") or p in ("data/model_card.json", "data/billing.json") \
                or p.startswith("data/study_area/"):
            out[p] = "data_seed/" + p
    return out


def build_web(dest):
    """The production build with the API under /api on the same host (nginx). Same build as `npm run build` minus
    the typecheck, which the checks run separately."""
    env = dict(os.environ, VITE_API_URL="/api")
    r = subprocess.run(f'npx vite build --outDir "{dest}" --emptyOutDir --logLevel warn', cwd=os.path.join(ROOT, "web"),
                       env=env, shell=True, capture_output=True, text=True)
    if r.returncode:
        sys.exit("web build failed:\n" + (r.stdout + r.stderr)[-3000:])
    js = "".join(open(os.path.join(dp, f), encoding="utf-8", errors="replace").read()
                 for dp, _, fs in os.walk(dest) for f in fs if f.endswith(".js"))
    if not any(q + "/api" + q in js for q in "\"'`") or "Program Files" in js:
        sys.exit("web build check failed: the API base is not exactly '/api' in the built code")
    if "__gcMap" in js:
        sys.exit("web build check failed: a dev-only test hook (__gcMap) is in the production build (D49)")


def add(tar, arc, data, mtime, mode=0o644):
    ti = tarfile.TarInfo(arc)
    ti.size, ti.mtime, ti.mode, ti.uid, ti.gid, ti.uname, ti.gname = len(data), mtime, mode, 0, 0, "root", "root"
    tar.addfile(ti, io.BytesIO(data))


def lf(path, data):
    ext = os.path.splitext(path)[1].lower()
    if ext in TEXT_EXT and b"\0" not in data[:4096]:
        return data.replace(b"\r\n", b"\n")
    return data


def write_tar(path, entries, mtime):
    """entries: {arcname: (bytes, mode)}; deterministic gzip (no name, mtime 0)"""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for arc in sorted(entries):
            data, mode = entries[arc]
            add(tar, arc, data, mtime, mode)
    with open(path, "wb") as fh, gzip.GzipFile(filename="", mode="wb", fileobj=fh, mtime=0, compresslevel=9) as gz:
        gz.write(raw.getvalue())
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def mode_for(arc):
    return 0o755 if arc.endswith(".sh") or arc in ("deploy/gc-autostop",) else 0o644


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"C:\projects\geo-cascadia-deploy")
    ap.add_argument("--assets", default=r"C:\projects\geo-cascadia-assets",
                    help="folder laid out like the Drive 'alldataset' folder (models/, crops_building_v1/, training_runs/)")
    ap.add_argument("--detector", default=r"C:\projects\gc-detector\best.pt",
                    help="used when the assets folder has no training_runs/v8s_640_s2/weights/best.pt (README D61 copy)")
    ap.add_argument("--no-assets", action="store_true", help="code bundle only (the server keeps its assets)")
    ap.add_argument("--allow-dirty", action="store_true", help="build from uncommitted changes (testing only)")
    a = ap.parse_args()

    dirty = bool(git("status", "--porcelain", "--untracked-files=no").strip())
    if dirty and not a.allow_dirty:
        sys.exit("Uncommitted changes to tracked files: commit first (or --allow-dirty for a test bundle).")
    commit = git("rev-parse", "HEAD").strip()
    mtime = int(git("show", "-s", "--format=%ct", "HEAD").strip())
    os.makedirs(a.out, exist_ok=True)

    files = pick(tracked())
    entries = {}
    for src, arc in files.items():
        data = open(os.path.join(ROOT, src), "rb").read()
        entries[arc] = (data if arc.startswith("data_seed/") else lf(arc, data), mode_for(arc))
    cache = os.path.join(ROOT, "data", "cache")
    for name in CACHE_SEEDS:
        p = os.path.join(cache, name)
        walk = [(p, "")] if os.path.isfile(p) else [(os.path.join(dp, f), os.path.relpath(os.path.join(dp, f), p))
                                                    for dp, _, fs in os.walk(p) for f in fs]
        for full, rel in walk:
            arc = "data_seed/cache/" + (name if not rel else f"{name}/{rel}").replace("\\", "/")
            entries[arc] = (open(full, "rb").read(), 0o644)
    with tempfile.TemporaryDirectory() as tmp:
        web = os.path.join(tmp, "web")
        build_web(web)
        for dp, _, fs in os.walk(web):
            for f in fs:
                full = os.path.join(dp, f)
                arc = "web/" + os.path.relpath(full, web).replace("\\", "/")
                entries[arc] = (open(full, "rb").read(), 0o644)

    bad = [arc for arc in entries if arc.lower().endswith(IMAGE_EXT)]
    if bad:
        sys.exit(f"Refused: image files in the bundle (Street View terms): {bad[:5]}")
    big = [arc for arc, (d, _) in entries.items() if len(d) > 40 * 2 ** 20]
    if big:
        sys.exit(f"Refused: files over 40 MB: {big}")
    if not any(arc == "worker/server_worker.py" for arc in entries) or "deploy/setup.sh" not in entries:
        sys.exit("Refused: worker/server_worker.py or tools/deploy/server/setup.sh is not committed yet.")

    groups = {}
    for arc, (d, _) in entries.items():
        top = "/".join(arc.split("/")[:2]) if arc.startswith("data_seed/") else arc.split("/")[0]
        n, s = groups.get(top, (0, 0))
        groups[top] = (n + 1, s + len(d))
    info = {"commit": commit, "dirty": dirty, "commit_time": mtime, "files": len(entries),
            "groups": {k: {"files": n, "bytes": s} for k, (n, s) in sorted(groups.items())}}
    entries["BUNDLE_INFO.json"] = (json.dumps(info, indent=1).encode(), 0o644)
    bundle = os.path.join(a.out, "gc-bundle.tar.gz")
    sha = write_tar(bundle, entries, mtime)

    print(f"gc-bundle.tar.gz  {os.path.getsize(bundle) / 2 ** 20:.1f} MB  ({len(entries)} files, "
          f"{sum(len(d) for d, _ in entries.values()) / 2 ** 20:.1f} MB unpacked)  sha256 {sha[:16]}…")
    print(f"  commit {commit[:10]}{' + uncommitted changes (test bundle)' if dirty else ''}")
    for k, (n, s) in sorted(groups.items(), key=lambda kv: -kv[1][1]):
        print(f"  {k:28s} {n:5d} files  {s / 2 ** 20:7.2f} MB")
    largest = sorted(((len(d), arc) for arc, (d, _) in entries.items()), reverse=True)[:5]
    print("  largest: " + ", ".join(f"{arc} {n / 2 ** 20:.1f} MB" for n, arc in largest))

    if a.no_assets:
        print("assets: skipped (--no-assets)")
        return
    found, missing = {}, []
    for rel, what in ASSETS.items():
        p = os.path.join(a.assets, *rel.split("/"))
        if not os.path.isfile(p) and rel.endswith("best.pt") and os.path.isfile(a.detector):
            p = a.detector
        (found.__setitem__(rel, p) if os.path.isfile(p) else missing.append(f"{rel} ({what})"))
    if missing:
        sys.exit(f"Missing model files in {a.assets}:\n  " + "\n  ".join(missing) +
                 "\nCopy them from the Drive folder MyDrive/alldataset (same sub-folders), then run again "
                 "(or --no-assets for a code-only bundle).")
    a_entries = {rel: (open(p, "rb").read(), 0o644) for rel, p in found.items()}
    assets = os.path.join(a.out, "gc-assets.tar.gz")
    sha = write_tar(assets, a_entries, mtime)
    print(f"gc-assets.tar.gz  {os.path.getsize(assets) / 2 ** 20:.1f} MB  sha256 {sha[:16]}…")
    for rel, p in sorted(found.items()):
        print(f"  {rel:42s} {os.path.getsize(p) / 2 ** 20:7.2f} MB  from {p}")


if __name__ == "__main__":
    main()

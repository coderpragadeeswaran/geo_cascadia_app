"""
verify_setup.py - checks the GEO-CASCADIA setup before P1.
Prints PASS / WARN / FAIL for every check. NEVER prints secret values.

Run from the repo root:
    python tools/verify_setup.py
Optional (for the database check):
    pip install "psycopg[binary]"
"""
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AREAS = ["ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"]
counts = {"PASS": 0, "WARN": 0, "FAIL": 0}
SECRETS = []  # values to redact from any error text


def redact(text):
    text = str(text)
    for s in SECRETS:
        if s and len(s) > 4:
            text = text.replace(s, "***")
    return text


def report(status, name, detail=""):
    counts[status] += 1
    line = f"[{status}] {name}"
    if detail:
        line += f"  ->  {redact(detail)}"
    print(line)


def section(title):
    print(f"\n=== {title} ===")


def load_env(path):
    if not path.exists():
        return None
    env = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ---------------------------------------------------------------- 1. files
section("1. Folders and files")
required = [
    "CLAUDE.md",
    "docs/DECISIONS.md",
    "data/model_card.json",
    "data/study_area/Study_area.geojson",
    "pipeline/geo_cascadia/__init__.py",
    "pipeline/geo_cascadia/localuse.py",
    "pipeline/geo_cascadia/run_area.py",
    "tools/build_run_report.py",
    "backend/.env",
    "backend/.env.example",
    "backend/requirements.txt",
    "web/.env.local",
    "web/.env.example",
    "web/package.json",
    ".gitignore",
]
for rel in required:
    p = ROOT / rel
    report("PASS" if p.exists() else "FAIL", rel, "" if p.exists() else "missing")

loose = [f.name for f in (ROOT / "pipeline").glob("*.py")]
if loose:
    report("WARN", "pipeline/ has loose .py files", ", ".join(loose))

# ---------------------------------------------------------------- 2. data
section("2. Area data (JSON parses, key files present)")
for area in AREAS:
    d = ROOT / "data" / "areas" / area
    if not d.exists():
        report("FAIL", f"data/areas/{area}", "folder missing")
        continue
    for fname in ["export.json", "export.geojson", "run_report.json", "coverage.json"]:
        f = d / fname
        if not f.exists():
            report("FAIL", f"{area}/{fname}", "missing")
            continue
        try:
            json.loads(f.read_text(encoding="utf-8"))
            report("PASS", f"{area}/{fname}")
        except Exception as e:
            report("FAIL", f"{area}/{fname}", f"invalid JSON: {e}")
    subdirs = [x.name for x in d.iterdir() if x.is_dir()]
    if subdirs:
        report("WARN", f"{area} has subfolders (should be flat)", ", ".join(subdirs))

# ---------------------------------------------------------------- 3. pipeline syntax
section("3. Pipeline code (syntax check only, nothing is executed)")
pkg = ROOT / "pipeline" / "geo_cascadia"
bad = 0
for py in sorted(pkg.glob("*.py")):
    try:
        compile(py.read_text(encoding="utf-8"), str(py), "exec")
    except SyntaxError as e:
        bad += 1
        report("FAIL", f"geo_cascadia/{py.name}", f"syntax error line {e.lineno}: {e.msg}")
n = len(list(pkg.glob("*.py")))
if n and not bad:
    report("PASS", f"all {n} pipeline .py files compile")

# ---------------------------------------------------------------- 4. env values
section("4. backend/.env values (checked, not printed)")
env = load_env(ROOT / "backend" / ".env") or {}
SECRETS.extend(v for v in env.values() if v)
placeholder = re.compile(r"your|xxx|\[YOUR-PASSWORD\]|<|>|\.\.\.|changeme", re.I)

expected = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET",
            "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAP_ID", "WORKER_TOKEN", "CORS_ORIGINS"]
for k in expected:
    v = env.get(k, "")
    if not v:
        report("FAIL", k, "empty or missing")
    elif placeholder.search(v):
        report("FAIL", k, "still contains a placeholder")
    else:
        report("PASS", k, f"set ({len(v)} chars)")

db = env.get("DATABASE_URL", "")
if db:
    # redact the whole user:password part, even if the password contains '@'
    m = re.match(r"^[a-z]+://(.*)@[^@]*$", db)
    if m:
        SECRETS.append(m.group(1))
        SECRETS.extend(p for p in re.split(r"[:@]", m.group(1)) if len(p) > 4)
    if db.count("@") > 1:
        report("FAIL", "DATABASE_URL password", "contains '@' - reset the DB password to letters+numbers only")
    try:
        u = urllib.parse.urlsplit(db)
        if u.password:
            SECRETS.append(u.password)
        if not db.startswith(("postgresql://", "postgres://")):
            report("FAIL", "DATABASE_URL format", "must start with postgresql://")
        elif "pooler.supabase.com" not in (u.hostname or ""):
            report("FAIL", "DATABASE_URL host", "not the Session pooler (direct host is IPv6-only)")
        elif u.port == 6543:
            report("WARN", "DATABASE_URL port", "6543 = transaction pooler; spec wants session pooler (5432)")
        else:
            report("PASS", "DATABASE_URL is a session pooler URI")
    except ValueError:
        report("FAIL", "DATABASE_URL", "cannot parse - password may contain @ # / : (reset it to letters+numbers)")

su = env.get("SUPABASE_URL", "")
if su and not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co/?", su):
    report("FAIL", "SUPABASE_URL format", "should be https://<ref>.supabase.co with nothing after it")

bk = env.get("GOOGLE_MAPS_BROWSER_KEY", "")
if bk and not bk.startswith("AIza"):
    report("FAIL", "GOOGLE_MAPS_BROWSER_KEY", "Google API keys start with AIza")
mid = env.get("GOOGLE_MAP_ID", "")
if mid.startswith("AIza"):
    report("FAIL", "GOOGLE_MAP_ID", "this is an API key, not a Map ID")
if len(env.get("WORKER_TOKEN", "")) < 32:
    report("WARN", "WORKER_TOKEN", "shorter than 32 chars")
if "5173" not in env.get("CORS_ORIGINS", ""):
    report("WARN", "CORS_ORIGINS", "does not include the dev port 5173")

web = load_env(ROOT / "web" / ".env.local") or {}
api = web.get("VITE_API_URL", "")
report("PASS" if api.startswith("http") else "FAIL", "web/.env.local VITE_API_URL",
       api if api.startswith("http") else "empty or missing")

# ---------------------------------------------------------------- 5. git safety
section("5. Git safety (secrets must never be committed)")
def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)

if shutil.which("git") and (ROOT / ".git").exists():
    for f in ["backend/.env", "web/.env.local"]:
        ignored = git("check-ignore", "-q", f).returncode == 0
        tracked = bool(git("ls-files", f).stdout.strip())
        if tracked:
            report("FAIL", f, "IS COMMITTED - remove with: git rm --cached " + f)
        else:
            report("PASS" if ignored else "FAIL", f"{f} ignored by git", "" if ignored else "NOT ignored")
    for f in ["backend/.env.example", "web/.env.example"]:
        ignored = git("check-ignore", "-q", f).returncode == 0
        report("WARN" if ignored else "PASS", f"{f} tracked", "ignored by .gitignore (.env.* rule?)" if ignored else "")
    has_commit = git("rev-parse", "--verify", "HEAD").returncode == 0
    report("PASS" if has_commit else "WARN", "P0 committed", "" if has_commit else "no commits yet")
else:
    report("FAIL", "git repo", "git missing or not initialised")

# ---------------------------------------------------------------- 6. tools
section("6. Installed software")
v = sys.version_info
report("PASS" if (3, 10) <= (v.major, v.minor) <= (3, 12) else "WARN", f"python {v.major}.{v.minor}")
for tool in ["node", "npm", "git", "cloudflared", "claude"]:
    report("PASS" if shutil.which(tool) else "FAIL", tool, "" if shutil.which(tool) else "not on PATH")

# ---------------------------------------------------------------- 7. database
section("7. Supabase database + PostGIS")
if db:
    try:
        import psycopg
        try:
            with psycopg.connect(db, connect_timeout=10) as conn:
                try:
                    ver = conn.execute("select extensions.postgis_version()").fetchone()[0]
                except Exception:
                    conn.rollback()
                    ver = conn.execute("select postgis_version()").fetchone()[0]
                report("PASS", "connected + PostGIS", ver)
        except Exception as e:
            report("FAIL", "database connection", e)
    except ImportError:
        report("WARN", "database check skipped", 'run: pip install "psycopg[binary]"  then re-run')
else:
    report("FAIL", "database check", "no DATABASE_URL")

# ---------------------------------------------------------------- 8. storage bucket
section("8. Supabase storage bucket")
key, bucket = env.get("SUPABASE_SERVICE_ROLE_KEY", ""), env.get("SUPABASE_BUCKET", "")
if su and key and bucket:
    headers = {"apikey": key}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(f"{su.rstrip('/')}/storage/v1/bucket/{bucket}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            info = json.loads(r.read())
            pub = info.get("public")
            report("PASS", f"bucket '{bucket}' exists", "private" if pub is False else "WARNING: public")
    except urllib.error.HTTPError as e:
        msg = {400: "bucket not found or bad request", 401: "service key rejected",
               403: "service key rejected", 404: "bucket not found"}.get(e.code, f"HTTP {e.code}")
        report("FAIL", f"bucket '{bucket}'", msg)
    except Exception as e:
        report("FAIL", "storage check", e)
else:
    report("FAIL", "storage check", "SUPABASE_URL / key / bucket missing")

# ---------------------------------------------------------------- 9. google key
section("9. Google Maps browser key (free Street View metadata call)")
if bk:
    q = urllib.parse.urlencode({"location": "11.0168,76.9558", "key": bk})
    req = urllib.request.Request(
        f"https://maps.googleapis.com/maps/api/streetview/metadata?{q}",
        headers={"Referer": "http://localhost:5173/"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        st = data.get("status")
        if st in ("OK", "ZERO_RESULTS"):
            report("PASS", "key works from localhost:5173 (referrer + Street View API OK)")
        else:
            report("FAIL", f"key status {st}", data.get("error_message", ""))
    except Exception as e:
        report("FAIL", "google key check", e)
    report("WARN", "Map ID / Maps JavaScript API",
           "can only be confirmed in the browser - check the 3D tilt works in P3")

# ---------------------------------------------------------------- summary
print(f"\n=== SUMMARY: {counts['PASS']} pass, {counts['WARN']} warn, {counts['FAIL']} fail ===")
if counts["FAIL"]:
    print("Fix every FAIL before starting P1.")
else:
    print("Setup is good. You can start P1.")
sys.exit(1 if counts["FAIL"] else 0)

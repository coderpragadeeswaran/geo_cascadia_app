#!/bin/bash
# GEO-CASCADIA server setup (D63). Idempotent: safe to run again after any change. Run as root on the instance, after
# install_release.sh has put a release in /opt/geo-cascadia/current:
#   sudo bash /opt/geo-cascadia/current/deploy/setup.sh
# Steps: auto-stop timer, system packages, users, Python 3.12 (uv), three venvs (API / worker / OCR), env files for the
# worker, nginx, systemd services, GPU checks, health check. Prints no secret.
set -euo pipefail
BASE=/opt/geo-cascadia
CUR=$BASE/current
D=$CUR/deploy
ETC=/etc/geo-cascadia
log() { echo; echo "== $*"; }
[ -d "$CUR/backend" ] || { echo "No release in $CUR: run install_release.sh first."; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }

log "auto-stop timer (keeps the current stop time; arms 90 min if none)"
install -m 755 "$D/gc-autostop" /usr/local/sbin/gc-autostop
for u in gc-autostop-arm.service gc-autostop.service gc-autostop.timer; do install -m 644 "$D/$u" /etc/systemd/system/$u; done
systemctl daemon-reload
systemctl enable --now gc-autostop.timer >/dev/null
systemctl enable gc-autostop-arm.service >/dev/null
[ -s /var/lib/gc/stop_at ] || /usr/local/sbin/gc-autostop arm 90 >/dev/null
/usr/local/sbin/gc-autostop show

log "system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=600 update -q
apt-get -o DPkg::Lock::Timeout=600 install -y -q nginx fonts-dejavu-core libgl1 libglib2.0-0 curl ca-certificates

log "users and folders"
id gcapp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gc-app --create-home --shell /usr/sbin/nologin gcapp
id gcworker >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gc-worker --create-home --shell /usr/sbin/nologin gcworker
install -d -m 755 /etc/geo-cascadia "$BASE/assets"
install -d -m 750 -o gcworker -g gcworker /var/lib/gc-worker /var/lib/gc-worker/jobs

log "uv + Python 3.12"
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi
export UV_PYTHON_INSTALL_DIR=$BASE/python UV_CACHE_DIR=/var/cache/uv UV_LINK_MODE=copy
uv python install 3.12
chmod -R a+rX "$BASE/python"

# venv NAME SPEC_FILE [extra uv args…]: create once; reinstall only when the spec file changed
venv() {
  local name=$1 req=$2; shift 2
  local py=$BASE/$name/bin/python sha
  sha=$( (cat "$req"; echo "$*") | sha256sum | cut -c1-16)
  [ -x "$py" ] || uv venv -q --python 3.12 "$BASE/$name"
  if [ "$(cat "$BASE/$name/.spec" 2>/dev/null)" != "$sha" ]; then
    echo "-- $name: installing ($req)"
    "$@"
    uv pip install -q --python "$py" -r "$req"
    echo "$sha" > "$BASE/$name/.spec"
  else
    echo "-- $name: up to date"
  fi
  uv pip freeze --python "$py" > "$BASE/freeze-$name.txt"
}
log "venvs"
venv venv-api "$CUR/backend/requirements.txt" true
venv venv-worker "$D/requirements-worker.txt" true
venv venv-ocr "$D/requirements-ocr.txt" \
  uv pip install -q --python "$BASE/venv-ocr/bin/python" "paddlepaddle-gpu>=3.0,<4" \
     --index-url https://www.paddlepaddle.org.cn/packages/stable/cu126/ --extra-index-url https://pypi.org/simple \
     --index-strategy unsafe-best-match
# D39: TensorFlow must never sit next to transformers 4.x / Paddle
for v in venv-worker venv-ocr; do
  uv pip uninstall -q --python "$BASE/$v/bin/python" tensorflow tensorflow-cpu tf-keras tensorflow-hub 2>/dev/null || true
done
chmod -R a+rX "$BASE"/venv-*

log "env files (values never printed)"
if [ -f $ETC/app.env ]; then
  chown gcapp:gcapp $ETC/app.env; chmod 600 $ETC/app.env
  bash "$D/put_env.sh" --derive-worker
else
  echo "⚠ $ETC/app.env is missing: run tools\\deploy\\deploy.ps1 -Env from the laptop"
fi
if [ -f $ETC/aws_builder.env ]; then
  chown gcworker:gcworker $ETC/aws_builder.env; chmod 600 $ETC/aws_builder.env; echo "aws_builder.env present (worker only)"
else
  echo "⚠ $ETC/aws_builder.env is missing: run tools\\deploy\\refresh_keys.ps1 (the worker needs it for Amazon Nova)"
fi

log "nginx"
install -m 644 "$D/nginx-geo-cascadia.conf" /etc/nginx/sites-available/geo-cascadia
ln -sfn /etc/nginx/sites-available/geo-cascadia /etc/nginx/sites-enabled/geo-cascadia
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl enable nginx >/dev/null
systemctl reload-or-restart nginx

log "GPU and models"
cd /var/lib/gc-worker      # the checks run as gcworker: from a folder it can read (PaddleX looks at paths on import)
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader || echo "⚠ nvidia-smi failed"
sudo -u gcworker -H "$BASE/venv-worker/bin/python" - <<'PY' || echo "⚠ worker venv check failed"
import os, warnings, torch, transformers, sklearn, joblib
print("torch", torch.__version__, "CUDA", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
print("transformers", transformers.__version__, "| scikit-learn", sklearn.__version__)
r = "/opt/geo-cascadia/assets/models/use_router.joblib"
if os.path.isfile(r):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        joblib.load(r)
    print("use router loads", "with warnings: " + "; ".join(str(x.message)[:120] for x in w) if w else "cleanly")
PY
sudo -u gcworker -H "$BASE/venv-ocr/bin/python" -c "import paddle, paddleocr; print('paddle', paddle.__version__, 'CUDA build', paddle.device.is_compiled_with_cuda(), 'GPUs', paddle.device.cuda.device_count(), '| paddleocr', paddleocr.__version__)" \
  || echo "⚠ OCR venv check failed"
for f in training_runs/v8s_640_s2/weights/best.pt models/use_router.joblib crops_building_v1/w1236978105.jpg crops_building_v1/w1247744938.jpg; do
  [ -f "$BASE/assets/$f" ] && echo "ok  assets/$f" || echo "⚠ missing assets/$f"
done

log "services"
install -m 644 "$D/geo-cascadia-api.service" /etc/systemd/system/geo-cascadia-api.service
install -m 644 "$D/geo-cascadia-worker.service" /etc/systemd/system/geo-cascadia-worker.service
systemctl daemon-reload
systemctl enable geo-cascadia-api.service geo-cascadia-worker.service >/dev/null
systemctl restart geo-cascadia-api.service
systemctl restart geo-cascadia-worker.service

log "health"
for i in $(seq 1 60); do
  if out=$(curl -fsS -m 10 http://127.0.0.1/api/health 2>/dev/null); then
    echo "$out" | "$BASE/venv-api/bin/python" -c "import json,sys; h=json.load(sys.stdin); print('API ok', h['ok'], '| database', 'OFFLINE' if h['offline'] else 'online', '| worker online', h['worker_online'])"
    exit 0
  fi
  sleep 3
done
echo "✗ the API did not answer on http://127.0.0.1/api/health within 3 min"; journalctl -u geo-cascadia-api -n 30 --no-pager
exit 1

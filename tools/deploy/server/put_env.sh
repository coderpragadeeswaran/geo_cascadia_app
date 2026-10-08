#!/bin/bash
# Write one secret env file from stdin (D63); values are never printed. Run as root:
#   ... | put_env.sh app.env           settings for the API (600, gcapp); also re-derives worker.env, restarts the API
#   ... | put_env.sh aws_builder.env   the Builder role's AWS keys (600, gcworker; the worker only)
#   put_env.sh --derive-worker         worker.env (WORKER_TOKEN + the Google server key) from app.env (setup.sh)
set -euo pipefail
ETC=/etc/geo-cascadia
install -d -m 755 $ETC
id gcapp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gc-app --create-home --shell /usr/sbin/nologin gcapp
id gcworker >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gc-worker --create-home --shell /usr/sbin/nologin gcworker

derive_worker() {
  [ -f $ETC/app.env ] || { echo "no $ETC/app.env yet"; return 0; }
  get() { grep -E "^$1=" $ETC/app.env | tail -1 | cut -d= -f2- | tr -d "\"' \r"; }
  ( umask 077; printf 'WORKER_TOKEN=%s\nGOOGLE_MAPS_KEY=%s\n' "$(get WORKER_TOKEN)" "$(get GOOGLE_PLACES_SERVER_KEY)" > $ETC/worker.env.new )
  chown gcworker:gcworker $ETC/worker.env.new
  mv $ETC/worker.env.new $ETC/worker.env
  echo "worker.env: derived from app.env (values not shown)"
}

case "${1:-}" in
  app.env)         own=gcapp ;;
  aws_builder.env) own=gcworker ;;
  --derive-worker) derive_worker; exit 0 ;;
  *) echo "usage: put_env.sh app.env|aws_builder.env|--derive-worker"; exit 2 ;;
esac
( umask 077; tr -d '\r' > $ETC/$1.new )
[ -s $ETC/$1.new ] || { rm -f $ETC/$1.new; echo "empty input: $1 not changed"; exit 1; }
chown $own:$own $ETC/$1.new
mv $ETC/$1.new $ETC/$1
echo "$1: $(grep -cE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_]+=' $ETC/$1) settings written (values not shown)"
if [ "$1" = app.env ]; then
  derive_worker
  if systemctl cat geo-cascadia-api.service >/dev/null 2>&1; then
    systemctl restart geo-cascadia-api.service geo-cascadia-worker.service; echo "API and worker restarted"
  fi
fi

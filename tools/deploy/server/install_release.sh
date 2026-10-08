#!/bin/bash
# Install one bundle as a new release (D63). Run as root on the server:
#   install_release.sh /tmp/gc-bundle.tar.gz [/tmp/gc-assets.tar.gz]
# Code goes to /opt/geo-cascadia/releases/<time>, "current" switches to it, and the last 3 releases are kept (roll back:
# point "current" at an older one and restart). Data lives OUTSIDE the releases in /opt/geo-cascadia/data:
# the bundle's tracked data files (areas, model card, billing) overwrite the same files there and never delete anything,
# so areas analysed on the server survive every update; runtime caches are only seeded where missing.
set -euo pipefail
BUNDLE=${1:?usage: install_release.sh bundle.tar.gz [assets.tar.gz]}
ASSETS=${2:-}
BASE=/opt/geo-cascadia

id gcapp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gc-app --create-home --shell /usr/sbin/nologin gcapp
id gcworker >/dev/null 2>&1 || useradd --system --home-dir /var/lib/gc-worker --create-home --shell /usr/sbin/nologin gcworker
install -d -m 755 "$BASE" "$BASE/releases" "$BASE/assets" /etc/geo-cascadia
install -d -m 755 -o gcapp -g gcapp "$BASE/data" "$BASE/data/cache"
install -d -m 750 -o gcworker -g gcworker /var/lib/gc-worker /var/lib/gc-worker/jobs

stamp=$(date -u +%Y%m%d-%H%M%S)
R="$BASE/releases/$stamp"
mkdir -p "$R"
tar -xzf "$BUNDLE" -C "$R" --no-same-owner
# data: tracked files overwrite (no delete); caches only where missing
cp -rT "$R/data_seed/data" "$BASE/data"
[ -d "$R/data_seed/cache" ] && cp -rnT "$R/data_seed/cache" "$BASE/data/cache"
rm -rf "$R/data_seed"
chown -R gcapp:gcapp "$BASE/data"
ln -sfn "$BASE/data" "$R/data"                              # backend/app/loader.py reads <code root>/data/...
ln -sfn /etc/geo-cascadia/app.env "$R/backend/.env"         # the app's own .env loader; the file stays outside the code
chmod -R a+rX "$R"

if [ -n "$ASSETS" ]; then
  tar -xzf "$ASSETS" -C "$BASE/assets" --no-same-owner
  chmod -R a+rX "$BASE/assets"
fi

ln -sfn "$R" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
ls -1dt "$BASE"/releases/* | tail -n +4 | xargs -r rm -rf

if systemctl cat geo-cascadia-api.service >/dev/null 2>&1; then
  systemctl restart geo-cascadia-api.service
  systemctl restart geo-cascadia-worker.service || true
fi
echo "release $stamp installed ($(cat "$R/BUNDLE_INFO.json" | head -c 160 | tr -d '\n'))"

#!/usr/bin/env bash
# Runs ON THE DROPLET as root. The GitHub Actions workflow feeds it in with:
#   ssh root@droplet 'bash -s' < deploy/remote-deploy.sh
# It updates the checked-out repo, reinstalls prod deps, refreshes the
# systemd unit, restarts the service, and health-checks it.
#
# Assumes the one-time bootstrap in deploy/DIGITALOCEAN.md is already done
# (hopebeyondmeasure user + repo clone + Node + /etc/hopebeyondmeasure.env).
set -euo pipefail

APP_DIR=/home/hopebeyondmeasure/HopeBeyondMeasure

# Update code as the hopebeyondmeasure user, which owns the repo. data/ is
# gitignored, so git never touches the database, uploaded photos, or session
# secret.
su - hopebeyondmeasure -s /bin/bash -c "
  set -euo pipefail
  cd '$APP_DIR'
  git fetch --prune origin
  git reset --hard origin/main
  npm ci --omit=dev
"

# Refresh the systemd unit (in case it changed in the repo) and restart.
install -m 644 "$APP_DIR/deploy/hopebeyondmeasure.service" /etc/systemd/system/hopebeyondmeasure.service
systemctl daemon-reload
systemctl enable hopebeyondmeasure >/dev/null 2>&1 || true
systemctl restart hopebeyondmeasure

# Wait for the app to answer on its local port before calling the deploy good.
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3002/healthz >/dev/null 2>&1; then
    echo "Hope Beyond Measure is healthy after deploy."
    exit 0
  fi
  sleep 1
done

echo "Health check failed — service did not answer on :3002" >&2
systemctl status hopebeyondmeasure --no-pager -l | tail -30 >&2
exit 1

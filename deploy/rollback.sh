#!/usr/bin/env bash
# Откат на предыдущий релиз (или на указанный: deploy/rollback.sh 20260101-120000-abc123).
set -euo pipefail
. "$(dirname "$0")/config.sh"
$SSH "TARGET='${1:-}' PORT='$PORT' bash -s" <<'REMOTE'
set -euo pipefail
B=/opt/hackalem
CUR="$(readlink -f "$B/current")"
if [ -n "$TARGET" ]; then
  NEW="$B/releases/$TARGET"
else
  NEW="$(ls -1dt "$B"/releases/*/ | sed 's:/$::' | grep -vx "$CUR" | head -1)"
fi
[ -d "$NEW" ] || { echo "нет релиза для отката"; ls -1t "$B/releases"; exit 1; }
ln -sfn "$NEW" "$B/current.tmp" && mv -Tf "$B/current.tmp" "$B/current"
systemctl restart hackalem
for _ in $(seq 1 30); do sleep 1; curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null && { echo "ok: $(basename "$NEW")"; exit 0; }; done
echo "!! health-check не прошёл после отката"; journalctl -u hackalem -n 40 --no-pager -o cat; exit 1
REMOTE

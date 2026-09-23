#!/usr/bin/env bash
# Живые логи приложения на сервере (JSON-строки). deploy/logs.sh 200 — последние 200 строк без слежения.
set -euo pipefail
. "$(dirname "$0")/config.sh"
if [ -n "${1:-}" ]; then
  $SSH "journalctl -u hackalem -n $1 --no-pager -o cat"
else
  $SSH -t "journalctl -u hackalem -f -n 50 -o cat"
fi

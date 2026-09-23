#!/usr/bin/env bash
# Проверить ключ и модели на сервере (с его app.env): deploy/llm-check.sh [модель ...]
set -euo pipefail
. "$(dirname "$0")/config.sh"
$SSH "cd /opt/hackalem/current/backend && runuser -u hackalem -- bash -c 'set -a; . /etc/hackalem/app.env; set +a; PYTHONDONTWRITEBYTECODE=1 exec .venv/bin/python -m app.llm_check $*'"

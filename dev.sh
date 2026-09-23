#!/usr/bin/env bash
# Локальный запуск: бэкенд :8000 (autoreload) + фронт :5173 (прокси /api → бэкенд). Ctrl+C гасит оба.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
trap 'trap - EXIT; kill 0' INT TERM EXIT

(cd "$ROOT/backend" && uv sync -q && exec .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000) &
(cd "$ROOT/frontend" && pnpm install --silent && exec ./node_modules/.bin/vite --host 127.0.0.1) &
wait

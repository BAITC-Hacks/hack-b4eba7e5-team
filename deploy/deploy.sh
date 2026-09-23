#!/usr/bin/env bash
# Выкатка: тесты → сборка фронта → новый релиз на сервере → переключение симлинка → health-check.
# Если health-check не прошёл — автоматический откат на предыдущий релиз.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/deploy/config.sh"

REL="$(date +%Y%m%d-%H%M%S)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
[ -n "$SHA" ] && REL="$REL-$SHA"

echo "==> тесты бэкенда"
(cd "$ROOT/backend" && LLM_MOCK=true uv run pytest -q -p no:warnings)

echo "==> сборка фронта"
(cd "$ROOT/frontend" && pnpm install --frozen-lockfile --silent && pnpm build >/dev/null)

echo "==> упаковка релиза $REL"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/backend"
cp -R "$ROOT/backend/app" "$STAGE/backend/"
(cd "$ROOT/backend" && uv export --frozen --no-dev --no-emit-project -q -o "$STAGE/backend/requirements.txt")
cp -R "$ROOT/frontend/dist" "$STAGE/web"
find "$STAGE" -name __pycache__ -prune -exec rm -rf {} +
chmod 755 "$STAGE"  # mktemp создаёт каталог 700 — nginx не прочитал бы статику
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "$STAGE.tgz" -C "$STAGE" .

echo "==> отправка на сервер"
$SSH "cat > /opt/hackalem/releases/$REL.tgz" < "$STAGE.tgz"
rm -f "$STAGE.tgz"

echo "==> активация"
$SSH "REL='$REL' PORT='$PORT' bash -s" <<'REMOTE'
set -euo pipefail
B=/opt/hackalem
R="$B/releases/$REL"
mkdir -p "$R"
tar xzf "$R.tgz" -C "$R" --no-same-owner && rm -f "$R.tgz"
chown -R hackalem:hackalem "$R"
chmod -R u=rwX,go=rX "$R"  # статику читает nginx (www-data)
cd "$R/backend"
runuser -u hackalem -- env HOME="$B" uv venv -q --python 3.13 .venv
runuser -u hackalem -- env HOME="$B" uv pip install -q --python .venv/bin/python -r requirements.txt

PREV="$(readlink -f "$B/current" 2>/dev/null || true)"
ln -sfn "$R" "$B/current.tmp" && mv -Tf "$B/current.tmp" "$B/current"
systemctl restart hackalem

ok=""
for _ in $(seq 1 30); do
  sleep 1
  if curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null; then ok=1; break; fi
done
if [ -z "$ok" ]; then
  echo "!! health-check не прошёл, журнал:"
  journalctl -u hackalem -n 40 --no-pager -o cat || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "!! откат на $(basename "$PREV")"
    ln -sfn "$PREV" "$B/current.tmp" && mv -Tf "$B/current.tmp" "$B/current"
    systemctl restart hackalem
  fi
  exit 1
fi

# храним 5 последних релизов (текущий не удаляется никогда)
CUR="$(readlink -f "$B/current")"
ls -1dt "$B"/releases/*/ | sed 's:/$::' | grep -vx "$CUR" | tail -n +5 | xargs -r rm -rf
echo "ok: релиз $REL активен"
REMOTE

echo "==> проверка снаружи"
curl -sf -m 10 "https://$DOMAIN/health" && echo
echo "Готово: https://$DOMAIN"

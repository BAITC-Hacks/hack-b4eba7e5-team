#!/usr/bin/env bash
# Разовая подготовка сервера под приложение. Идемпотентен: повторный запуск ничего не ломает.
# Создаёт: пользователя hackalem, /opt/hackalem, /var/lib/hackalem, /etc/hackalem/app.env,
# systemd-юнит, nginx-сайт и сертификат Let's Encrypt (webroot).
# Чужие nginx-сайты и сертификаты не трогает; nginx перезагружается только после успешного nginx -t.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/config.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" "$DIR/nginx.conf" > "$TMP/nginx-full.conf"
# временный конфиг только на :80 — для выпуска сертификата, пока его нет
awk '/^server \{/{n++} n==2' "$TMP/nginx-full.conf" > "$TMP/nginx-http.conf"

scp -q -i "$SSH_KEY" -o BatchMode=yes "$DIR/hackalem.service" "$TMP/nginx-full.conf" "$TMP/nginx-http.conf" "$SSH_HOST:/tmp/"

$SSH "DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -euo pipefail
step() { echo "==> $*"; }

step "пользователь и каталоги"
id hackalem >/dev/null 2>&1 || useradd --system --home-dir /opt/hackalem --shell /usr/sbin/nologin hackalem
install -d -m 755 -o hackalem -g hackalem /opt/hackalem /opt/hackalem/releases
install -d -m 750 -o hackalem -g hackalem /var/lib/hackalem
install -d -m 750 -o root -g hackalem /etc/hackalem
[ -f /etc/hackalem/app.env ] || install -m 640 -o root -g hackalem /dev/null /etc/hackalem/app.env
install -d -m 755 /var/www/hackalem-acme

step "Python 3.13 для hackalem (uv)"
cd /opt/hackalem  # uv ищет конфиг в текущем каталоге, а /root пользователю закрыт
runuser -u hackalem -- env HOME=/opt/hackalem uv python install 3.13 -q

step "systemd-юнит"
install -m 644 /tmp/hackalem.service /etc/systemd/system/hackalem.service
systemctl daemon-reload
systemctl enable -q hackalem

SITE=/etc/nginx/sites-available/hackalem
LINK=/etc/nginx/sites-enabled/hackalem
apply_nginx() {  # $1 — файл конфига; при провале nginx -t возвращаем прежнее состояние
  local backup=""
  [ -f "$SITE" ] && backup="$(mktemp)" && cp "$SITE" "$backup"
  install -m 644 "$1" "$SITE"
  ln -sfn "$SITE" "$LINK"
  if nginx -t -q 2>/dev/null; then
    systemctl reload nginx
  else
    nginx -t || true
    if [ -n "$backup" ]; then install -m 644 "$backup" "$SITE"; else rm -f "$LINK" "$SITE"; fi
    echo "!! nginx -t провален, конфиг откатан, nginx НЕ перезагружался"; exit 1
  fi
}

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  step "nginx: временный HTTP-конфиг для проверки домена"
  apply_nginx /tmp/nginx-http.conf
  step "сертификат для $DOMAIN (webroot)"
  certbot certonly --webroot -w /var/www/hackalem-acme -d "$DOMAIN" \
    --non-interactive --quiet --deploy-hook "systemctl reload nginx"
fi

step "nginx: полный конфиг (HTTPS)"
apply_nginx /tmp/nginx-full.conf
rm -f /tmp/hackalem.service /tmp/nginx-full.conf /tmp/nginx-http.conf
echo "ok: сервер готов. Дальше: deploy/deploy.sh"
REMOTE

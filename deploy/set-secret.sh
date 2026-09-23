#!/usr/bin/env bash
# Записать переменную в /etc/hackalem/app.env на сервере и перезапустить приложение.
#   deploy/set-secret.sh OPENAI_API_KEY        — значение спросит скрыто (не попадёт в историю shell)
#   deploy/set-secret.sh OPENAI_MODEL gpt-5    — несекретное можно передать аргументом
set -euo pipefail
. "$(dirname "$0")/config.sh"
NAME="${1:?укажи имя переменной, например OPENAI_API_KEY}"
[[ "$NAME" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "плохое имя: $NAME"; exit 1; }
if [ $# -ge 2 ]; then VAL="$2"; else read -rsp "$NAME = " VAL; echo; fi
[ -n "$VAL" ] || { echo "пустое значение"; exit 1; }

# значение идёт через stdin, а не в командной строке — его не видно в ps и логах
printf '%s\n' "$VAL" | $SSH "NAME='$NAME' bash -c '
  set -euo pipefail
  IFS= read -r VAL
  F=/etc/hackalem/app.env
  TMP=\$(mktemp)
  grep -v \"^\$NAME=\" \"\$F\" > \"\$TMP\" || true
  printf \"%s=%s\n\" \"\$NAME\" \"\$VAL\" >> \"\$TMP\"
  install -m 640 -o root -g hackalem \"\$TMP\" \"\$F\"
  rm -f \"\$TMP\"
  systemctl restart hackalem
  sleep 3
  curl -sf -m 5 http://127.0.0.1:$PORT/health
'"
echo
echo "$NAME обновлён, приложение перезапущено"

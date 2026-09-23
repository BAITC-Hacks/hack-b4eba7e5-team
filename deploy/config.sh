# Общие параметры деплоя. Подключается из остальных скриптов deploy/*.sh.
APP=hackalem
DOMAIN=hackalem.oqcrm.kz
PORT=8900
SSH_HOST=root@185.113.132.120
SSH_KEY="$HOME/.ssh/oqcrm"
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=15 $SSH_HOST"

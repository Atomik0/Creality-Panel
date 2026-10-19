#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .deploy.env ]]; then
  echo "Falta .deploy.env. Cópialo desde .deploy.env.example y pon los datos de tu servidor:" >&2
  echo "  cp .deploy.env.example .deploy.env" >&2
  exit 1
fi
source .deploy.env

: "${DEPLOY_HOST:?Falta DEPLOY_HOST en .deploy.env}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/panel}"
DEPLOY_PATH="${DEPLOY_PATH%/}"
FILES=(index.html css js img)

for f in "${FILES[@]}"; do
  [[ -e "$f" ]] || { echo "No encuentro $f en $(pwd)" >&2; exit 1; }
done

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "${DEPLOY_KEY/#\~/$HOME}")
REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
NEW="$DEPLOY_PATH.new"
OLD="$DEPLOY_PATH.old"
remote() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }

# ./deploy.sh clave: autoriza tu clave SSH en el servidor (pide la contraseña una sola vez).
if [[ "${1:-}" == "clave" ]]; then
  KEY="${DEPLOY_KEY:-~/.ssh/id_ed25519}"; KEY="${KEY/#\~/$HOME}"
  if [[ ! -f "$KEY.pub" ]]; then
    echo "No tienes clave SSH en $KEY; creando una nueva."
    mkdir -p "$(dirname "$KEY")" && ssh-keygen -q -t ed25519 -N "" -f "$KEY"
  fi
  echo "Autorizando $KEY.pub en $REMOTE. Escribe la contraseña de $DEPLOY_USER en el servidor:"
  ssh-copy-id -i "$KEY.pub" -o StrictHostKeyChecking=accept-new "$REMOTE"
  exit
fi

if ! ERR="$(remote true 2>&1)"; then
  echo "$ERR" >&2
  if grep -q "Permission denied" <<< "$ERR"; then
    echo "El servidor no acepta tu clave SSH para $DEPLOY_USER. Autorízala con: ./deploy.sh clave" >&2
    exit 3
  fi
  exit 1
fi

echo "Desplegando en $REMOTE:$DEPLOY_PATH"
remote "rm -rf $(printf %q "$NEW") && mkdir -p $(printf %q "$NEW")"

if command -v rsync >/dev/null; then
  RSYNC_OPTS=(-a --delete --chmod=D755,F644)
  [[ -n "${DEPLOY_OWNER:-}" ]] && RSYNC_OPTS+=(--chown="$DEPLOY_OWNER")
  rsync "${RSYNC_OPTS[@]}" -e "ssh ${SSH_OPTS[*]}" "${FILES[@]}" "$REMOTE:$NEW/"
else
  # Git Bash en Windows no trae rsync: se envía un tar por SSH y los permisos se ajustan allí.
  FIX="find $(printf %q "$NEW") -type d -exec chmod 755 {} + && find $(printf %q "$NEW") -type f -exec chmod 644 {} +"
  [[ -n "${DEPLOY_OWNER:-}" ]] && FIX+=" && chown -R $(printf %q "$DEPLOY_OWNER") $(printf %q "$NEW")"
  # El uid de Windows no existe en el servidor: los archivos quedan del usuario que los extrae.
  tar -cf - "${FILES[@]}" | remote "tar --no-same-owner -xf - -C $(printf %q "$NEW") && $FIX"
fi

remote "set -e; if [ -d $(printf %q "$DEPLOY_PATH") ]; then mv $(printf %q "$DEPLOY_PATH") $(printf %q "$OLD"); fi; \
  mv $(printf %q "$NEW") $(printf %q "$DEPLOY_PATH"); rm -rf $(printf %q "$OLD")"

# El sha1sum de Git Bash marca los archivos con " *" (modo binario); el de Linux usa dos espacios.
LOCAL_SUMS="$(find "${FILES[@]}" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha1sum | sed 's/^\([0-9a-f]*\) \*/\1  /')"
REMOTE_SUMS="$(remote "cd $(printf %q "$DEPLOY_PATH") && find ${FILES[*]} -type f -print0 | LC_ALL=C sort -z | xargs -0 sha1sum")"
if [[ "$LOCAL_SUMS" == "$REMOTE_SUMS" ]]; then
  echo "Listo: $(wc -l <<< "$LOCAL_SUMS") archivos publicados y verificados."
else
  echo "Atención: los archivos del servidor no coinciden con los locales:" >&2
  diff <(echo "$LOCAL_SUMS") <(echo "$REMOTE_SUMS") >&2 || true
  exit 1
fi

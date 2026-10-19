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

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "${DEPLOY_KEY/#\~/$HOME}")
REMOTE="$DEPLOY_USER@$DEPLOY_HOST"
NEW="$DEPLOY_PATH.new"
OLD="$DEPLOY_PATH.old"
remote() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }

echo "Desplegando en $REMOTE:$DEPLOY_PATH"
remote "rm -rf $(printf %q "$NEW") && mkdir -p $(printf %q "$NEW")"

RSYNC_OPTS=(-a --delete --chmod=D755,F644)
[[ -n "${DEPLOY_OWNER:-}" ]] && RSYNC_OPTS+=(--chown="$DEPLOY_OWNER")
rsync "${RSYNC_OPTS[@]}" -e "ssh ${SSH_OPTS[*]}" "${FILES[@]}" "$REMOTE:$NEW/"

remote "set -e; if [ -d $(printf %q "$DEPLOY_PATH") ]; then mv $(printf %q "$DEPLOY_PATH") $(printf %q "$OLD"); fi; \
  mv $(printf %q "$NEW") $(printf %q "$DEPLOY_PATH"); rm -rf $(printf %q "$OLD")"

LOCAL_SUMS="$(find "${FILES[@]}" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha1sum)"
REMOTE_SUMS="$(remote "cd $(printf %q "$DEPLOY_PATH") && find ${FILES[*]} -type f -print0 | LC_ALL=C sort -z | xargs -0 sha1sum")"
if [[ "$LOCAL_SUMS" == "$REMOTE_SUMS" ]]; then
  echo "Listo: $(wc -l <<< "$LOCAL_SUMS") archivos publicados y verificados."
else
  echo "Atención: los archivos del servidor no coinciden con los locales:" >&2
  diff <(echo "$LOCAL_SUMS") <(echo "$REMOTE_SUMS") >&2 || true
  exit 1
fi

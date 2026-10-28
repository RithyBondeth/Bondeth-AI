#!/usr/bin/env bash
# Check .env, then build and start (or update) Bondeth AI behind Caddy.
#
#   deploy/start.sh            # CPU, or GPU when nvidia-smi works
#   GPU=0 deploy/start.sh      # force CPU
#
# Re-run it after `git pull` to deploy an update (take a backup first).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env here. Run deploy/setup-server.sh or copy .env.production.example." >&2; exit 1; }
. deploy/lib.sh
APP_DOMAIN=$(env_get APP_DOMAIN) PUBLIC_APP_URL=$(env_get PUBLIC_APP_URL) PUBLIC_API_URL=$(env_get PUBLIC_API_URL)
BONDETH_EMAIL_FROM=$(env_get BONDETH_EMAIL_FROM) CONTACT_EMAIL=$(env_get CONTACT_EMAIL)
BONDETH_STT_LIVE_PARTIALS=$(env_get BONDETH_STT_LIVE_PARTIALS)

problems=()
for key in BONDETH_JWT_SECRET POSTGRES_PASSWORD APP_DOMAIN ACME_EMAIL PUBLIC_APP_URL PUBLIC_API_URL \
           BONDETH_SMTP_HOST BONDETH_SMTP_USERNAME BONDETH_SMTP_PASSWORD; do
  [ -n "$(env_get "$key")" ] || problems+=("$key is empty")
done
case "${APP_DOMAIN:-}" in *example.org|*example.com) problems+=("APP_DOMAIN is still the example domain");; esac
[ "${PUBLIC_APP_URL:-}" = "https://${APP_DOMAIN:-}" ] || problems+=("PUBLIC_APP_URL must be https://$APP_DOMAIN")
[ "${PUBLIC_API_URL:-}" = "https://${APP_DOMAIN:-}" ] || problems+=("PUBLIC_API_URL must be https://$APP_DOMAIN")
case "${BONDETH_EMAIL_FROM:-}" in *example.org*|*example.com*|"") problems+=("BONDETH_EMAIL_FROM still uses the example domain");; esac
[ -n "${CONTACT_EMAIL:-}" ] || echo "Note: CONTACT_EMAIL is empty; /privacy and /terms will point to GitHub issues."
if [ ${#problems[@]} -gt 0 ]; then
  printf 'Fix .env first:\n'; printf '  - %s\n' "${problems[@]}"; exit 1
fi

files="-f docker-compose.yml"
if [ "${GPU:-auto}" != 0 ] && command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  files="$files -f docker-compose.gpu.yml"; echo "GPU detected: using docker-compose.gpu.yml"
elif [ "${BONDETH_STT_LIVE_PARTIALS:-true}" = true ]; then
  echo "Note: no GPU; consider BONDETH_STT_LIVE_PARTIALS=false in .env (see docs/deploy.md)."
fi
files="$files -f docker-compose.prod.yml"
echo "$files" > .compose-files  # read by the backup cron job

# shellcheck disable=SC2086
docker compose $files --profile app up -d --build --remove-orphans

echo "Waiting for https://$APP_DOMAIN/api/v1/health (the first start downloads ~6 GB of models)..."
for _ in $(seq 180); do
  if curl -fsS "https://$APP_DOMAIN/api/v1/health" 2>/dev/null | grep -q '"status":"ok"'; then
    echo "Bondeth AI is up at https://$APP_DOMAIN"
    echo "Check it from your computer: cd backend && .venv/bin/python -m scripts.smoke_prod https://$APP_DOMAIN"
    exit 0
  fi
  sleep 10
done
echo "Not healthy after 30 minutes. Look at: docker compose $files logs --tail 100 backend caddy" >&2
exit 1

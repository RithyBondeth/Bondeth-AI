#!/usr/bin/env bash
# Prepare a fresh Ubuntu 24.04 server for Bondeth AI. Run once, as root:
#
#   curl -fsSL https://raw.githubusercontent.com/RithyBondeth/Bondeth-AI/main/deploy/setup-server.sh | bash
#
# Installs Docker and a firewall (SSH, 80, 443 only), adds swap, clones the app to
# /srv/bondeth-ai, writes .env with generated secrets, and schedules daily backups.
# It never starts the app: fill in .env, then run deploy/start.sh. Safe to re-run.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/bondeth-ai}"
REPO="${REPO:-https://github.com/RithyBondeth/Bondeth-AI.git}"
BRANCH="${BRANCH:-main}"
SWAP_GB="${SWAP_GB:-8}"
# SKIP_SYSTEM=1 skips packages, Docker, firewall and swap (used by the setup test).

log() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)." >&2; exit 1; }

if [ "${SKIP_SYSTEM:-}" != 1 ]; then
  log "System packages and automatic security updates"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get upgrade -yq
  apt-get install -yq ca-certificates curl git ufw cron unattended-upgrades
  dpkg-reconfigure -f noninteractive unattended-upgrades

  if ! command -v docker >/dev/null; then
    log "Docker Engine and Compose (official repository)"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker

  log "Firewall: SSH, HTTP and HTTPS only"
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null

  if ! swapon --show | grep -q /swapfile && [ "$SWAP_GB" -gt 0 ]; then
    log "${SWAP_GB} GB swap (headroom while models load)"
    fallocate -l "${SWAP_GB}G" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi

log "App in $APP_DIR ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

secret() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }
set_env() {  # replace KEY=... only when it is still empty
  if grep -q "^$1=$" .env; then sed -i "s|^$1=$|$1=$2|" .env; fi
}
if [ ! -f .env ]; then
  log "Writing .env from .env.production.example with generated secrets"
  cp .env.production.example .env
fi
set_env BONDETH_JWT_SECRET "$(secret 64)"
set_env POSTGRES_PASSWORD "$(secret 40)"
chmod 600 .env

log "Daily backup at 03:15 server time (backups/, newest 14 kept)"
cron_line="15 3 * * * cd $APP_DIR && COMPOSE_FILES=\"\$(cat .compose-files 2>/dev/null)\" deploy/backup.sh >> backups/backup.log 2>&1"
mkdir -p backups
# No crontab yet is fine: `crontab -l` and `grep -v` both "fail" on empty input.
{ { crontab -l 2>/dev/null || true; } | { grep -v 'deploy/backup.sh' || true; }; echo "$cron_line"; } | crontab -

cat <<EOF

Server prepared. Next:
  1. Point DNS for your domain (A/AAAA records) at this server's IP.
  2. Edit $APP_DIR/.env: APP_DOMAIN, ACME_EMAIL, PUBLIC_APP_URL, PUBLIC_API_URL,
     CONTACT_EMAIL and the SMTP settings (secrets are already generated).
  3. Start it:  $APP_DIR/deploy/start.sh
EOF

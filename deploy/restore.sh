#!/usr/bin/env bash
# Restore a backup made by deploy/backup.sh. REPLACES the current database, data volume
# and Redis contents. Run from the repository root with the same COMPOSE_FILES as the backup.
#
#   deploy/restore.sh backups/20261027T030000Z
#
# The app is stopped for the restore; start it again with your usual `up -d` command.
set -euo pipefail

dir="${1:?Usage: deploy/restore.sh <backup directory>}"
compose=(docker compose ${COMPOSE_FILES:-} --profile app)
set -a; [ -f .env ] && . ./.env; set +a
user="${POSTGRES_USER:-bondeth}" db="${POSTGRES_DB:-bondeth}"

for f in postgres.dump backend-data.tar.gz redis-data.tar.gz SHA256SUMS; do
  [ -f "$dir/$f" ] || { echo "Missing $dir/$f" >&2; exit 1; }
done
sum=$(command -v sha256sum || echo "shasum -a 256")
(cd "$dir" && $sum -c SHA256SUMS --quiet)

if [ "${RESTORE_YES:-}" != "1" ]; then
  read -r -p "Replace the current database, data volume and Redis with $dir? Type 'restore': " answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
fi

echo "Stopping the app (keeping PostgreSQL and Redis up)"
running=$("${compose[@]}" ps --services --status running)
for service in $running; do
  case "$service" in postgres|redis) ;; *) "${compose[@]}" stop "$service" ;; esac
done
"${compose[@]}" up -d postgres redis

echo "PostgreSQL <- postgres.dump"
"${compose[@]}" exec -T postgres pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner \
  < "$dir/postgres.dump"

echo "Backend data volume <- backend-data.tar.gz"
"${compose[@]}" run --rm --no-deps -T --entrypoint sh backend \
  -c 'find /app/data -mindepth 1 -delete && tar xzf - -C /app/data' < "$dir/backend-data.tar.gz"

echo "Redis <- redis-data.tar.gz"
"${compose[@]}" stop redis
"${compose[@]}" run --rm --no-deps -T --entrypoint sh redis \
  -c 'find /data -mindepth 1 -delete && tar xzf - -C /data' < "$dir/redis-data.tar.gz"
"${compose[@]}" up -d redis

echo "Restored $dir. Start the app again, then check /api/v1/health."

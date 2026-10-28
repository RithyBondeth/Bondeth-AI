#!/usr/bin/env bash
# Back up everything that can't be re-created: PostgreSQL, the backend data volume
# (saved voices, audio library, transcript recordings, queued job files) and Redis
# (sessions, quotas, queued jobs). Models are re-downloadable and not included.
#
#   deploy/backup.sh [backup-root]        # default: ./backups; run from the repository root
#
# Pass the same -f files as your deployment in COMPOSE_FILES, e.g.
#   COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml" deploy/backup.sh
# Keeps the newest BACKUP_KEEP backups (default 14). Copy them off this server too.
set -euo pipefail

root="${1:-./backups}"
keep="${BACKUP_KEEP:-14}"
compose=(docker compose ${COMPOSE_FILES:-} --profile app)
. "$(dirname "$0")/lib.sh"
user="$(env_get POSTGRES_USER)" db="$(env_get POSTGRES_DB)"
user="${user:-bondeth}" db="${db:-bondeth}"

dir="$root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"
trap 'echo "Backup failed; removing incomplete $dir" >&2; rm -rf "$dir"' ERR

echo "PostgreSQL -> $dir/postgres.dump"
"${compose[@]}" exec -T postgres pg_dump -U "$user" -d "$db" --format=custom > "$dir/postgres.dump"

echo "Backend data volume -> $dir/backend-data.tar.gz"
"${compose[@]}" run --rm --no-deps -T --entrypoint tar backend czf - -C /app/data . > "$dir/backend-data.tar.gz"

echo "Redis -> $dir/redis-data.tar.gz"
before=$("${compose[@]}" exec -T redis redis-cli LASTSAVE | tr -d '\r')
"${compose[@]}" exec -T redis redis-cli BGSAVE > /dev/null
for _ in $(seq 120); do
  [ "$("${compose[@]}" exec -T redis redis-cli LASTSAVE | tr -d '\r')" != "$before" ] && break
  sleep 1
done
"${compose[@]}" exec -T redis tar czf - -C /data . > "$dir/redis-data.tar.gz"

trap - ERR
sum=$(command -v sha256sum || echo "shasum -a 256")
(cd "$dir" && $sum ./* > SHA256SUMS)
echo "Done: $dir ($(du -sh "$dir" | cut -f1))"

# Retention: newest $keep timestamped directories survive.
ls -1d "$root"/2*/ 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  echo "Removing old backup $old"; rm -rf "$old"
done

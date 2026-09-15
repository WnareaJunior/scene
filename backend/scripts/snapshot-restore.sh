#!/usr/bin/env bash
# Copy a cloud database into a local one and scrub it, in one go.
#
#   scripts/snapshot-restore.sh staging postgresql://dev:…@localhost:5433/scene_snapshot
#   scripts/snapshot-restore.sh staging postgresql://dev:…@localhost:5433/scene_snapshot --keep-dump
#
# 1. pg_dump the source (via with-env.sh, so the name must be typed) — custom
#    format, no owners/privileges, without the ROWS of search_logs (raw user queries) and
#    refresh_tokens (sessions).
# 2. pg_restore --clean into the LOCAL target. The target must exist and must
#    be on a local host; it is dropped-and-recreated at the table level.
# 3. scrub.sql: every email becomes <id>@scrub.test, every password becomes
#    "password123", tokens/reports/blocks emptied. Same transaction as the
#    restore's aftermath, so a half-scrubbed copy never exists.
#
# Needs pg_dump / pg_restore / psql of the source's major version on PATH. On
# the devbox, run it inside the dev-postgres image:
#   docker run --rm -it --network data_default -v "$PWD:/b" -w /b devbox-postgres:17 \
#     scripts/snapshot-restore.sh staging postgresql://dev:…@dev-postgres:5432/scene_snapshot
# Production snapshots are allowed but think first: even scrubbed, the data
# is real people's parties.
set -euo pipefail
cd "$(dirname "$0")/.."

src=${1:-}; target=${2:-}; keep=${3:-}
case "$src" in staging|production) ;; *) echo "usage: $0 <staging|production> <local DATABASE_URL> [--keep-dump]" >&2; exit 2;; esac
[[ -n "$target" ]] || { echo "usage: $0 <staging|production> <local DATABASE_URL> [--keep-dump]" >&2; exit 2; }

# hostname between the last "@" and the next ":" or "/" (no node needed, so this
# also runs inside a bare postgres container)
host=$(printf '%s' "$target" | sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*$#\2#')
case "$host" in localhost|127.0.0.1|devbox|dev-postgres|postgres|::1) ;;
  *) echo "snapshot-restore: target host \"$host\" is not local — refusing to restore over it" >&2; exit 1;; esac

dump=$(mktemp -t scene-"$src"-XXXXXX.dump)
trap '[[ "$keep" == "--keep-dump" ]] || rm -f "$dump"' EXIT

echo "── dump $src (excluding search_logs, refresh_tokens)"
scripts/with-env.sh "$src" sh -c 'pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges --exclude-table-data=search_logs --exclude-table-data=refresh_tokens -f "$0"' "$dump"
echo "   $(du -h "$dump" | cut -f1) written"

echo "── restore into $host"
# --clean --if-exists drops each object before recreating it; extensions and
# the schema_migrations table come along, so migrate.js --status stays right.
pg_restore --clean --if-exists --no-owner --no-privileges -d "$target" "$dump" 2> >(grep -v 'does not exist, skipping' >&2 || true)

echo "── scrub"
psql "$target" -v ON_ERROR_STOP=1 -q -f scripts/scrub.sql
psql "$target" -Atc "select count(*)||' users, '||count(*) filter (where email not like '%@scrub.test')||' unscrubbed' from users"
[[ "$keep" == "--keep-dump" ]] && echo "   dump kept at $dump"
echo "done"

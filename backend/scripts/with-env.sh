#!/usr/bin/env bash
# Run a command with a cloud environment's variables — explicitly, never
# ambiently.
#
#   scripts/with-env.sh staging    node scripts/migrate.js --status
#   scripts/with-env.sh production node scripts/migrate.js --baseline 0003
#
# Reads backend/.env.staging or backend/.env.production (both gitignored).
# backend/.env itself is reserved for the local target (the devbox), so nothing
# reaches Supabase unless you typed the environment's name.
set -euo pipefail
cd "$(dirname "$0")/.."

env_name=${1:-}; shift || true
case "$env_name" in
  staging|production) ;;
  *) echo "usage: scripts/with-env.sh <staging|production> <command...>" >&2; exit 2 ;;
esac
file=".env.$env_name"
[[ -f "$file" ]] || { echo "with-env: $file not found (this machine may not hold $env_name credentials)" >&2; exit 1; }
[[ $# -gt 0 ]] || { echo "with-env: no command given" >&2; exit 2; }

echo "with-env: $env_name ($file)" >&2
set -a; . "./$file"; set +a
exec "$@"

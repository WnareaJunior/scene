#!/usr/bin/env bash
# Rehearse pending migrations on a scrubbed copy of a hosted database, before
# running them there for real.
#
#   scripts/rehearse-migrations.sh staging postgresql://dev:…@localhost:5433/scene_rehearsal
#
# 1. snapshot-restore.sh: dump the source (typed by name, via with-env.sh),
#    restore into the LOCAL target, scrub it.
# 2. migrate.js --status: what the source database has applied, and what is
#    pending against the files in this checkout.
# 3. migrate.js: apply the pending files, timed. A failure here is the whole
#    point: it would have failed on the real database too.
# 4. migrate.js again: must say "up to date" (no drift, nothing left over).
#
# Run it from the branch that adds the migrations. The target is overwritten
# at the table level; it must be local (snapshot-restore.sh enforces that).
# .github/workflows/rehearse-migrations.yml runs the same thing on a CI runner.
set -euo pipefail
cd "$(dirname "$0")/.."

src=${1:-}; target=${2:-}
case "$src" in staging|production) ;; *) echo "usage: $0 <staging|production> <local DATABASE_URL>" >&2; exit 2;; esac
[[ -n "$target" ]] || { echo "usage: $0 <staging|production> <local DATABASE_URL>" >&2; exit 2; }

scripts/snapshot-restore.sh "$src" "$target"

export DATABASE_URL="$target"
export DATABASE_SSL=disable

echo "── ledger copied from $src, against this checkout's migrations"
node scripts/migrate.js --status

echo "── apply pending"
started=$(date +%s)
node scripts/migrate.js
echo "   took $(( $(date +%s) - started ))s"

echo "── second run must be a no-op"
out=$(node scripts/migrate.js)
echo "$out"
grep -q 'up to date' <<<"$out" || { echo "rehearse: second run was not a no-op" >&2; exit 1; }

echo "rehearsal passed: the pending migrations apply cleanly to a copy of $src"

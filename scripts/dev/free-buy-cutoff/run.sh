#!/usr/bin/env bash
# Native proof for 20261106195136 (a Free Buy's promo chip moves at the cutoff).
# Runs the migration on a throwaway local Postgres database against exact
# production copies of the functions it amends or reads, then the owner's
# acceptance table, legacy in-flight events, retries, PKO, mystery and
# unregistration. Never point this at production: it creates and drops schemas.
# Usage: PGDATABASE=<scratch db> bash scripts/dev/free-buy-cutoff/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
db="${PGDATABASE:?set PGDATABASE to a scratch database}"
case "$db" in *prod*|postgres) echo "refusing database $db" >&2; exit 2;; esac
for f in 00_base.sql 01_prod_functions.sql 02_old_promo_head.sql 03_helpers.sql 04_legacy_events.sql \
         "$root/supabase/migrations/20261106195136_a_free_buy_promo_chip_moves_at_cutoff_not_signup.sql" 05_cases.sql; do
  case "$f" in /*) path="$f";; *) path="$here/$f";; esac
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -t -f "$path"
done | grep -E 'PASS|FAIL'

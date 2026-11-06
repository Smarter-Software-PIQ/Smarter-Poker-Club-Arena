#!/usr/bin/env bash
# Native proof for migration 20261106195136 (a Free Buy's promo chip moves at
# the cutoff, not at sign-up) on a throwaway PostgreSQL 17 cluster: the owner's
# six-row acceptance table, mystery and PKO, legacy in-flight events, retries,
# unregistration and promo conservation. See scripts/dev/free-buy-cutoff/.
set -euo pipefail
export LC_ALL=C LANG=C

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}"
scratch_parent="${FREE_BUY_CUTOFF_PG_SCRATCH_PARENT:-/Volumes/SmarterWork/agent-work}"
cases="$repo/scripts/dev/free-buy-cutoff"
migration="$repo/supabase/migrations/20261106195136_a_free_buy_promo_chip_moves_at_cutoff_not_signup.sql"

[[ -x "$pgbin/initdb" && -x "$pgbin/postgres" ]] || {
  echo 'PostgreSQL 17 tools unavailable; set PG17_BINDIR.' >&2; exit 2;
}
[[ -d "$scratch_parent" ]] || { echo "Free Buy cutoff scratch parent is unavailable: $scratch_parent" >&2; exit 2; }

work="$(mktemp -d "$scratch_parent/free-buy-cutoff-fixture.XXXXXX")"
data="$work/data"
socket="$work/socket"
port="$((57000 + ($$ % 7000)))"
mkdir -p "$socket"
cleanup() {
  "$pgbin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true
  [[ "$work" == "$scratch_parent"/free-buy-cutoff-fixture.* ]] && find "$work" -depth -delete
}
trap cleanup EXIT

"$pgbin/initdb" -D "$data" -U postgres --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$data" -o "-h '' -k '$socket' -p $port" -w start >/dev/null
psql=("$pgbin/psql" -X -q -t -v ON_ERROR_STOP=1 -h "$socket" -p "$port" -U postgres -d postgres)
out="$("${psql[@]}" \
  -f "$cases/00_base.sql" -f "$cases/01_prod_functions.sql" -f "$cases/02_old_promo_head.sql" \
  -f "$cases/03_helpers.sql" -f "$cases/04_legacy_events.sql" -f "$migration" -f "$cases/05_cases.sql" 2>&1)"
printf '%s\n' "$out" | grep -E 'PASS|FAIL' || true
if printf '%s\n' "$out" | grep -q 'FAIL'; then echo 'free-buy-cutoff: FAILED' >&2; exit 1; fi
passes="$(printf '%s\n' "$out" | grep -c 'PASS')"
[[ "$passes" -ge 16 ]] || { echo "free-buy-cutoff: expected 16 PASS lines, saw $passes" >&2; printf '%s\n' "$out" | tail -20 >&2; exit 1; }
echo "free-buy-cutoff: $passes checks passed"

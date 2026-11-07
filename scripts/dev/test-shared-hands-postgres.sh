#!/usr/bin/env bash
# Native proof for migration 20261107021555 (short shared-hand links) on a
# throwaway PostgreSQL cluster: every door, as the role that really calls it.
# PG17_BINDIR points at the server binaries (default: the Mac's Homebrew PG17).
set -euo pipefail
export LC_ALL=C LANG=C

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}"
cases="$repo/scripts/dev/shared-hands"
migration="$repo/supabase/migrations/20261107021555_short_share_links_for_hands.sql"
expected=23

[[ -x "$pgbin/initdb" && -x "$pgbin/postgres" ]] || {
  echo 'PostgreSQL tools unavailable; set PG17_BINDIR.' >&2; exit 2;
}

work="$(mktemp -d "${TMPDIR:-/tmp}/shared-hands-fixture.XXXXXX")"
data="$work/data"
socket="$work/socket"
port="$((57000 + ($$ % 7000)))"
mkdir -p "$socket"
cleanup() {
  "$pgbin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true
  [[ "$work" == "${TMPDIR:-/tmp}"/shared-hands-fixture.* ]] && find "$work" -depth -delete
}
trap cleanup EXIT

"$pgbin/initdb" -D "$data" -U postgres --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$data" -o "-h '' -k '$socket' -p $port" -w start >/dev/null
psql=("${PSQL:-$pgbin/psql}" -X -q -t -v ON_ERROR_STOP=1 -h "$socket" -p "$port" -U postgres -d postgres)
out="$("${psql[@]}" -f "$cases/00_base.sql" -f "$migration" -f "$cases/01_cases.sql" 2>&1)"
printf '%s\n' "$out" | grep -E 'PASS|FAIL' | sed 's/^.*NOTICE: *//' || true
if printf '%s\n' "$out" | grep -q 'FAIL'; then echo 'shared-hands: FAILED' >&2; exit 1; fi
passes="$(printf '%s\n' "$out" | grep -c 'PASS')"
[[ "$passes" -eq "$expected" ]] || {
  echo "shared-hands: expected $expected PASS lines, saw $passes" >&2; printf '%s\n' "$out" | tail -20 >&2; exit 1;
}
echo "shared-hands: $passes/$expected PASS"

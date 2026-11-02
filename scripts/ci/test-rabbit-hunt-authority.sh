#!/usr/bin/env bash
# Native PostgreSQL 17 regression for 20261102080031: the rabbit hunt
# availability check describes only hands the caller was dealt into, and a
# charge correction is bound to its receipts, audited and applied at most once.
# Disposable database only; no credentials, no production access.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/rha.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57651" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57651 -U fixture_admin -d postgres)
fixture="$repo/tests/fixtures/rabbit-hunt-authority"
migrations=("$repo"/supabase/migrations/20261102080031_rabbit_hunt_status_hides_other_players_hands_and_audited_cha.sql)
test -f "${migrations[0]}"
"${psql[@]}" -f "$fixture/bootstrap.sql" -f "$fixture/status-before.sql" -f "$fixture/scenario.sql"
if "${psql[@]}" -f "$fixture/regression.sql" > "$work/before.log" 2>&1; then echo 'Rabbit hunt regression unexpectedly passed before the migration'; exit 1; fi
grep -q 'Non-dealt-in caller can tell a saved hand from no hand' "$work/before.log"
"${psql[@]}" -f "${migrations[0]}" -f "$fixture/regression.sql"
"${psql[@]}" -f "$fixture/assertions.sql" | tee "$work/after.log"
grep -q RABBIT_HUNT_AUTHORITY_ASSERTIONS_OK "$work/after.log"
# Re-applying the migration is safe and keeps the audit.
"${psql[@]}" -f "${migrations[0]}"
"${psql[@]}" -At -c "SELECT count(*) FROM public.rabbit_hunt_charge_corrections" | grep -qx 2
echo 'RABBIT_HUNT_AUTHORITY PASS: before/after, non-participant reads equal no hand, dealt-in saved/expired, signed out, grants, service-only correction, exact engine request id, credit and allowance bindings, month binding, diamonds refused, replay and duplicate protection, append-only audit, replay-safe migration'

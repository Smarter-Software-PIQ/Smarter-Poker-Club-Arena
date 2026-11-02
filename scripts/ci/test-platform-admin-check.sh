#!/usr/bin/env bash
# Native PostgreSQL 17 regression for #9390: fn_is_platform_admin() answers
# true or false, never NULL, and a `NOT fn_is_platform_admin()` gate refuses a
# caller with no profile row or a NULL role. Disposable database only.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/pac.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57656" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57656 -U fixture_admin -d postgres)
"${psql[@]}" -f "$repo/tests/fixtures/platform-admin-check/bootstrap.sql"
# The defect, reproduced on the old body.
"${psql[@]}" -At -c "SET test.viewer='99999999-9999-9999-9999-999999999999'; SELECT coalesce(fn_is_platform_admin()::text,'NULL')" | grep -qx NULL
migration="$(ls "$repo"/supabase/migrations/*_platform_admin_check_answers_false_never_null.sql)"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$repo/tests/fixtures/platform-admin-check/assertions.sql" | tee "$work/after.log"
grep -q PLATFORM_ADMIN_CHECK_OK "$work/after.log"
echo 'PLATFORM_ADMIN_CHECK PASS: no caller, no profile and NULL role answer false (never NULL), staff roles true, NOT gates refuse, grants kept, replay-safe'

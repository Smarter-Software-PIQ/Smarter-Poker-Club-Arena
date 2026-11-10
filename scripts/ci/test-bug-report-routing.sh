#!/usr/bin/env bash
# Native PostgreSQL regression for the owner instruction of 2026-11-09: every
# bug report reaches the owner's Messenger and the push outbox exactly once,
# from the row's own insert. Disposable database only.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/brr.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57671" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57671 -U fixture_admin -d postgres)
fixtures="$repo/tests/fixtures/bug-report-routing"
"${psql[@]}" -f "$fixtures/bootstrap.sql"
# The defect, reproduced: before the migration a new ticket reaches nobody.
"${psql[@]}" -At -c "INSERT INTO public.live_help_tickets (id, subject, description) VALUES ('99999999-9999-4999-8999-999999999999', '[BUG] Before', 'x'); SELECT count(*) FROM public.social_messages" | grep -qx 0
"${psql[@]}" -c "DELETE FROM public.live_help_tickets WHERE id = '99999999-9999-4999-8999-999999999999'"
migration="$(ls "$repo"/supabase/migrations/*_bug_reports_reach_the_owner_messenger_and_phone.sql)"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$fixtures/assertions.sql" 2>&1 | tee "$work/after.log"
grep -q BUG_REPORT_ROUTING_OK "$work/after.log"
echo 'BUG_REPORT_ROUTING PASS: one message, one push and one receipt per report; backfill once; replay-safe; RLS callers covered; faults recorded; Production Alerts routing kept'

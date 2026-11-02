#!/usr/bin/env bash
# Native PostgreSQL 17 regression for 20261102134711: only reserved certification
# accounts can receive a short, audited, self-expiring test VIP, never over a real
# entitlement. Disposable database only.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/cvg.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57653" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57653 -U fixture_admin -d postgres)
fixture="$repo/tests/fixtures/certification-vip-grant"
migration="$repo/supabase/migrations/20261102134711_certification_accounts_get_a_short_audited_test_vip_grant.sql"
"${psql[@]}" -f "$fixture/bootstrap.sql"
if "${psql[@]}" -c "SELECT fn_ca_certification_vip_grant(null,1,null,null,null)" > "$work/before.log" 2>&1; then echo 'Grant existed before the migration'; exit 1; fi
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$fixture/assertions.sql" | tee "$work/after.log"
grep -q CERTIFICATION_VIP_GRANT_ASSERTIONS_OK "$work/after.log"
"${psql[@]}" -f "$migration"
"${psql[@]}" -At -c "SELECT count(*) FROM public.ca_certification_vip_grants" | grep -qx 3
echo 'CERTIFICATION_VIP_GRANT PASS: service-only, reserved accounts only, real entitlements untouched, bounds, replay, one open grant, scoped end, append-only audit, replay-safe migration'

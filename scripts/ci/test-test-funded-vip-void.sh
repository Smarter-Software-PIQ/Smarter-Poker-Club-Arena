#!/usr/bin/env bash
# Native PostgreSQL 17 regression for the test-funded VIP purchase void: only a
# purchase proven paid with admin-minted test funding is voided, its entitlement
# ends, nothing is refunded or rewritten, one void per purchase, append-only.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/tfv.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57657" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57657 -U fixture_admin -d postgres)
"${psql[@]}" -f "$repo/tests/fixtures/test-funded-vip-void/bootstrap.sql"
migration="$(ls "$repo"/supabase/migrations/*_void_a_vip_purchase_paid_with_admin_minted_test_funding.sql)"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$repo/tests/fixtures/test-funded-vip-void/assertions.sql" | tee "$work/after.log"
grep -q TEST_FUNDED_VOID_OK "$work/after.log"
echo 'TEST_FUNDED_VIP_VOID PASS: real purchases refused, minted-funded purchase voided once, entitlement ended, no refund or ledger rewrite, extended VIP refused, append-only, replay-safe'

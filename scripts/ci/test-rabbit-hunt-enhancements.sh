#!/usr/bin/env bash
# Native PostgreSQL 17 regression for 20261102165142: price preview in the charge
# order, bought run-outs kept for their buyer only, and the staff correction door
# over the unchanged audited core. Disposable database only.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/rhe.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57655" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57655 -U fixture_admin -d postgres)
"${psql[@]}" -f "$repo/tests/fixtures/rabbit-hunt-authority/bootstrap.sql" -f "$repo/tests/fixtures/rabbit-hunt-enhancements/bootstrap.sql"
"${psql[@]}" -f "$repo/supabase/migrations/20261102080031_rabbit_hunt_status_hides_other_players_hands_and_audited_cha.sql"
if "${psql[@]}" -c "SELECT fn_rabbit_hunt_charge_preview()" > "$work/before.log" 2>&1; then echo 'Preview existed before the migration'; exit 1; fi
migration="$repo/supabase/migrations/20261102165142_rabbit_hunt_price_preview_owned_runouts_and_staff_correction.sql"
"${psql[@]}" -f "$migration"
"${psql[@]}" -f "$repo/tests/fixtures/rabbit-hunt-enhancements/assertions.sql" | tee "$work/after.log"
grep -q RABBIT_HUNT_ENHANCEMENTS_ASSERTIONS_OK "$work/after.log"
"${psql[@]}" -f "$migration"
"${psql[@]}" -At -c "SELECT count(*) FROM public.rabbit_hunt_owned_runouts" | grep -qx 2
# 20261102181258: the receipt may land before the saved run-out (Auto Run).
either="$repo/supabase/migrations/20261102181258_rabbit_hunt_kept_runout_either_write_order.sql"
"${psql[@]}" -f "$either"
"${psql[@]}" -f "$either"
"${psql[@]}" -f "$repo/tests/fixtures/rabbit-hunt-enhancements/either-order.sql" | tee "$work/either.log"
grep -q RABBIT_HUNT_EITHER_ORDER_OK "$work/either.log"
echo 'RABBIT_HUNT_ENHANCEMENTS PASS: preview order and bounds, no cards, owned run-out exact slice, buyer only, kept after prune, backfill, staff door audited and replay-safe, service door unchanged, private core, replay-safe migration, kept in either write order'

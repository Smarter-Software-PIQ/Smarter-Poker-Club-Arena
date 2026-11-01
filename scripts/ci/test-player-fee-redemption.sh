#!/usr/bin/env bash
# Native regression against the three production reader definitions captured
# October 23. No financial writes or credentials, only a disposable database.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:?Set PG_BIN to PostgreSQL 17 binaries}"
WORK="$(mktemp -d "${FEE_REDEMPTION_SCRATCH:?Set an external SSD scratch path on macOS}/fee-redemption.XXXXXX")"
FIXTURE="$ROOT/scripts/ci/fixtures/player-fee-redemption"
restore_fixture_clock() {
  if [ -f "$WORK/restore-now.sql" ]; then
    "${PSQL[@]}" -f "$WORK/restore-now.sql"
    rm "$WORK/restore-now.sql"
  fi
}
cleanup() {
  restore_fixture_clock || true
  "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$WORK/data" -U fee_test -A trust --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" \
  -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -h "$WORK" -U fee_test -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$FIXTURE/fee-redemption-schema.sql" -f "$FIXTURE/fee-redemption-source-functions.sql"
# The regression must demonstrably fail on the captured pre-fix reader.
if "${PSQL[@]}" -c "DO \$\$ BEGIN ASSERT (SELECT cash_fees FROM ca_club_member_fee_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4',null,null,'69f2cefa-017d-49f3-ac3e-61505633747c'))=373.06, 'redemption missing'; END \$\$;" > "$WORK/before.log" 2>&1; then
  echo 'FAIL: regression unexpectedly passed before the migration' >&2
  exit 1
fi
grep -q 'redemption missing' "$WORK/before.log"
MIGRATIONS=("$ROOT"/supabase/migrations/*_player_fee_redemption_reaches_metrics_and_statistics.sql)
test "${#MIGRATIONS[@]}" = 1
test -f "${MIGRATIONS[0]}"
"${PSQL[@]}" -f "${MIGRATIONS[0]}" -f "$FIXTURE/fee-redemption-assert.sql"
echo 'PASS: regression fails before and passes after; fixed redemption, repeated reads, date, player, club, asset, gross evidence, grants, duplicate operation and future fees'

# October 24: the WooWoo-to-KingFish half share reached production as a
# five-minute cron (recorded byte-exact as 20261024223153). Rebuild that state,
# add a hand the cron has not seen, and prove the standing rule replaces it.
OUT_OF_BAND=("$ROOT"/supabase/migrations/20261024223153_woowoo_half_earned_rake_credited_to_kingfish.sql)
SHARE=("$ROOT"/supabase/migrations/*_a_standing_rake_share_replaces_the_woowoo_cron.sql)
test "${#SHARE[@]}" = 1
test -f "${OUT_OF_BAND[0]}"
test -f "${SHARE[0]}"
# Replay the historical cutover at its recorded day, not a drifting seven-day
# boundary. This changes only this disposable database's zero-argument clock;
# the original builtin definition is restored normally and by the EXIT trap.
"${PSQL[@]}" -At -c "SELECT pg_get_functiondef('pg_catalog.now()'::regprocedure)" > "$WORK/restore-now.sql"
"${PSQL[@]}" -v fixture_data_directory="$WORK/data" -f "$FIXTURE/fixture-clock.sql"
# THE REPLAY READS THE CLOCK THE MIGRATION WAS INSTALLED UNDER (2026-10-31).
# Its proof compares a seven-day window that starts at now() - 7 days with
# cron splits filtered from that day's UTC midnight. The fixture's hands are
# fixed on Oct 24-25, so a replay failed whenever now() - 7 days fell between
# a fixture hand and the end of that hand's UTC day (first seen 23:00Z Oct 31,
# blocking every pull request's required accounting check). The migration,
# its lag fixture and its assertions are replayed as of its own install moment
# (version 20261025030629), byte-for-byte otherwise; nothing outside this
# section and no recorded migration file is changed.
SHARE_CLOCK="${RAKE_SHARE_REPLAY_CLOCK:-2026-10-25 03:06:29+00}"
pin_share_clock() {
  python3 -c 'import sys; src=open(sys.argv[1]).read(); assert "now()" in src or sys.argv[3]=="optional"; open(sys.argv[2],"w").write(src.replace("now()", "\x27"+sys.argv[4]+"\x27::timestamptz"))' "$1" "$2" "${3:-required}" "$SHARE_CLOCK"
}
pin_share_clock "$FIXTURE/rake-share-lag.sql" "$WORK/rake-share-lag.sql"
"${PSQL[@]}" -f "$FIXTURE/rake-share-out-of-band.sql" -f "${OUT_OF_BAND[0]}" -f "$WORK/rake-share-lag.sql"
# The cron trails the hands: before the fix KingFish's statistics miss hand D.
if "${PSQL[@]}" -c "DO \$\$ BEGIN ASSERT (ca_player_rake_stats('47965354-0e56-43ef-931c-ddaab82af765')->>'rake_paid')::numeric=576.77, 'share lags the hands'; END \$\$;" > "$WORK/share-before.log" 2>&1; then
  echo 'FAIL: rake share regression unexpectedly passed before the migration' >&2
  exit 1
fi
grep -q 'share lags the hands' "$WORK/share-before.log"
pin_share_clock "${SHARE[0]}" "$WORK/rake-share-migration.sql"
pin_share_clock "$FIXTURE/rake-share-assert.sql" "$WORK/rake-share-assert.sql"
"${PSQL[@]}" -f "$WORK/rake-share-migration.sql" -f "$WORK/rake-share-assert.sql"
echo 'PASS: the standing rake share replaces the cron; exact, immediate, funded club, ended rule, grants, fixed events kept and no cron writes the redemptions'
restore_fixture_clock
"${PSQL[@]}" <<'RESTORED_CLOCK'
DO $$ BEGIN ASSERT (SELECT l.lanname = 'internal' AND p.prosrc = 'now' FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'pg_catalog.now()'::regprocedure), 'builtin clock not restored'; END $$;
RESTORED_CLOCK


# Rake uses the same viewer-calendar population as the Stats overview.
CALENDAR="$ROOT/scripts/ci/fixtures/rake-calendar"
CALENDAR_MIGRATION="$ROOT/supabase/migrations/20261030050254_rake_statistics_use_the_selected_calendar_window.sql"
"${PSQL[@]}" -f "$CALENDAR/preimages.sql" -f "$CALENDAR/share-preimage.sql" -f "$CALENDAR/before.sql"
if "${PSQL[@]}" -f "$CALENDAR/after.sql" > "$WORK/calendar-before.log" 2>&1; then
  echo 'Calendar rake regression unexpectedly passed before the fix'; exit 1
fi
grep -q 'ca_player_rake_stats_calendar' "$WORK/calendar-before.log"
"${PSQL[@]}" -f "$CALENDAR_MIGRATION" -f "$CALENDAR/after.sql"
if "${PSQL[@]}" -f "$CALENDAR_MIGRATION" > "$WORK/calendar-replay.log" 2>&1; then
  echo 'Calendar rake migration replay unexpectedly accepted'; exit 1
fi
grep -q 'already exists' "$WORK/calendar-replay.log"

# The member's applied ledger dates also scope each downline fee row.
DOWNLINE_MIGRATION="$ROOT/supabase/migrations/20261030051204_member_downline_fees_follow_the_applied_ledger_range.sql"
"${PSQL[@]}" -f "$CALENDAR/downline-before.sql" -f "$CALENDAR/downline-preimage.sql"
if "${PSQL[@]}" -f "$CALENDAR/downline-after.sql" > "$WORK/downline-before.log" 2>&1; then
  echo 'Downline range regression unexpectedly passed before the fix'; exit 1
fi
grep -q 'ca_club_member_downline_in_range' "$WORK/downline-before.log"
"${PSQL[@]}" -f "$DOWNLINE_MIGRATION" -f "$CALENDAR/downline-after.sql"
if "${PSQL[@]}" -f "$DOWNLINE_MIGRATION" > "$WORK/downline-replay.log" 2>&1; then
  echo 'Downline range migration replay unexpectedly accepted'; exit 1
fi
grep -q 'already exists' "$WORK/downline-replay.log"

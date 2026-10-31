#!/usr/bin/env bash
# Native regression against the three production reader definitions captured
# October 23. No financial writes or credentials, only a disposable database.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:?Set PG_BIN to PostgreSQL 17 binaries}"
WORK="$(mktemp -d "${FEE_REDEMPTION_SCRATCH:?Set an external SSD scratch path on macOS}/fee-redemption.XXXXXX")"
FIXTURE="$ROOT/scripts/ci/fixtures/player-fee-redemption"
cleanup() {
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
# PINNED CLOCK (2026-10-31). 20261025030629 proves itself against now(): its
# seven-day window must still contain the October 24 hands it was written
# against. From 2026-10-31 ~22:00 UTC that window has moved past them and the
# migration's own guard refuses ("the rule reports less than the cron wrote"),
# turning every migration pull request red. The proof is about the state it was
# installed into, so this block runs on a server whose clock starts at
# 2026-10-25 03:30 UTC (21 minutes after production installed it) via
# libfaketime. The rest of this script keeps the real clock.
FAKETIME_LIB=""
for candidate in /usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 \
  /usr/lib/aarch64-linux-gnu/faketime/libfaketime.so.1 \
  /opt/homebrew/lib/faketime/libfaketime.1.dylib /usr/local/lib/faketime/libfaketime.1.dylib; do
  [ -f "$candidate" ] && { FAKETIME_LIB="$candidate"; break; }
done
[ -n "$FAKETIME_LIB" ] || { echo 'FAIL: libfaketime is required to replay the dated rake-share proof (apt-get install faketime / brew install libfaketime)' >&2; exit 1; }
# A relative offset, applied by preloading the library on pg_ctl and the
# postmaster it starts. Not the `faketime` wrapper (it waits on the daemonised
# postmaster) and not an '@' start time (every exec restarts that clock, so
# pg_ctl -w sees a postmaster older than itself and waits for ever).
PINNED_OFFSET=$(python3 -c 'import calendar,time; print("%+d" % (calendar.timegm((2026,10,25,3,30,0,0,0,0)) - int(time.time())))')
"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null
if [ "$(uname -s)" = Darwin ]; then
  DYLD_FORCE_FLAT_NAMESPACE=1 DYLD_INSERT_LIBRARIES="$FAKETIME_LIB" FAKETIME="$PINNED_OFFSET" FAKETIME_DONT_FAKE_MONOTONIC=1 \
    "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
else
  LD_PRELOAD="$FAKETIME_LIB" FAKETIME="$PINNED_OFFSET" FAKETIME_DONT_FAKE_MONOTONIC=1 \
    "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -o "-k $WORK -c listen_addresses=''" -w start >/dev/null
fi
"${PSQL[@]}" -tAc "SELECT now() < '2026-10-26'::timestamptz" | grep -qx t \
  || { echo 'FAIL: the pinned clock did not take effect' >&2; exit 1; }
"${PSQL[@]}" -f "$FIXTURE/rake-share-out-of-band.sql" -f "${OUT_OF_BAND[0]}" -f "$FIXTURE/rake-share-lag.sql"
# The cron trails the hands: before the fix KingFish's statistics miss hand D.
if "${PSQL[@]}" -c "DO \$\$ BEGIN ASSERT (ca_player_rake_stats('47965354-0e56-43ef-931c-ddaab82af765')->>'rake_paid')::numeric=576.77, 'share lags the hands'; END \$\$;" > "$WORK/share-before.log" 2>&1; then
  echo 'FAIL: rake share regression unexpectedly passed before the migration' >&2
  exit 1
fi
grep -q 'share lags the hands' "$WORK/share-before.log"
"${PSQL[@]}" -f "${SHARE[0]}" -f "$FIXTURE/rake-share-assert.sql"
echo 'PASS: the standing rake share replaces the cron; exact, immediate, funded club, ended rule, grants, fixed events kept and no cron writes the redemptions'
"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" \
  -o "-k $WORK -c listen_addresses=''" -w start >/dev/null

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

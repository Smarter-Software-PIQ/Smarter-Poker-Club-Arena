#!/usr/bin/env bash
# Native PostgreSQL 17 proof for 20261124144034 and 20261124145120: a player's
# hand result (ca_hand_player_facts_one / _range / the dispatcher) counts the
# bomb-pot ante and charges no blind nobody posted; ordinary hands (blinds,
# antes, straddles, split and side pots, rake, legacy logs) project exactly as
# before; and the one-off recompute corrects stored bomb-pot stat rows only.
# Starts from the LIVE production bodies (live-predecessor.sql, md5-checked)
# and shows the defect on them first. Disposable database only.
set -euo pipefail
export LC_ALL=C LANG=C
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
"$pgbin/postgres" --version | grep -Eq ' 17\.' || { echo 'PostgreSQL 17 is required.' >&2; exit 2; }
fixture="$repo/tests/fixtures/hand-player-facts-bomb-pot"
patch="$repo/supabase/migrations/20261124144034_a_player_s_hand_result_counts_the_bomb_pot_ante_and_charges_.sql"
recompute="$repo/supabase/migrations/20261124145120_stored_bomb_pot_stat_rows_take_the_corrected_hand_result.sql"
work="$(mktemp -d "$parent/bpf.XXXXXX")"
port="$((50000 + ($$ % 7000)))"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/s"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/s' -p $port" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/s" -p "$port" -U fixture_admin -d postgres)

"${psql[@]}" -f "$fixture/bootstrap.sql" -f "$fixture/live-predecessor.sql" -f "$fixture/hands.sql"
# The predecessor is the production text, byte for byte.
"${psql[@]}" -At -c "SELECT string_agg(proname||'='||md5(prosrc), ' ' ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'ca_hand_player_facts%'" \
  | grep -qx 'ca_hand_player_facts=879698cbd93a2904c302c4152bf6091a ca_hand_player_facts_one=d46c2d00befaa6cf9de3b18a3dd4c6de ca_hand_player_facts_range=7b9262c9ce78a30d099876a03845cd7d'
"${psql[@]}" -f "$fixture/stored-rows.sql"
"${psql[@]}" -f "$fixture/ordinary.sql" > "$work/ordinary-before.txt"
[ "$(wc -l < "$work/ordinary-before.txt")" -ge 32 ] || { echo 'ordinary projection is empty'; exit 1; }

# The defect, on the live bodies: a bomb-pot seat's result is wrong.
if "${psql[@]}" -f "$fixture/assertions.sql" > "$work/before.log" 2>&1; then
  echo 'The live bodies unexpectedly passed the bomb-pot assertions' >&2; exit 1
fi
grep -q 'Hand result wrong (hand bb000000-0000-4000-8000-0000000000b' "$work/before.log" || { cat "$work/before.log" >&2; exit 1; }

# The patch, with its own self-proof against these hands.
"${psql[@]}" -f "$patch"
"${psql[@]}" -f "$fixture/assertions.sql" | tee "$work/after.log"
grep -q HAND_PLAYER_FACTS_BOMB_POT_OK "$work/after.log"
"${psql[@]}" -f "$fixture/ordinary.sql" > "$work/ordinary-after.txt"
cmp "$work/ordinary-before.txt" "$work/ordinary-after.txt"
"${psql[@]}" -f "$fixture/privileges.sql" | grep -q HAND_PLAYER_FACTS_PRIVILEGES_OK

# A replay is refused and changes nothing.
if "${psql[@]}" -f "$patch" > "$work/replay.log" 2>&1; then
  echo 'Bomb-pot patch replay unexpectedly succeeded' >&2; exit 1
fi
grep -q 'Bomb-pot patch already installed' "$work/replay.log"

# The one-off recompute: bomb-pot rows only, money columns only; a replay is a no-op.
"${psql[@]}" -f "$recompute"
"${psql[@]}" -f "$fixture/recompute-assertions.sql" | grep -q BOMB_POT_STAT_RECOMPUTE_OK
"${psql[@]}" -f "$recompute"
"${psql[@]}" -f "$fixture/recompute-assertions.sql" | grep -q BOMB_POT_STAT_RECOMPUTE_OK
echo 'HAND_PLAYER_FACTS_BOMB_POT PASS: live bodies reproduce the defect; patched bodies count every ante and charge no bomb-pot blind on all four paths; ordinary hands byte-identical; grants kept; replay refused; stored bomb-pot rows corrected alone'

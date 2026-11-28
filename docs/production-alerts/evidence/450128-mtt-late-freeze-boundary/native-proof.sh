#!/usr/bin/env bash
# Native PG16 proof for 20261128160858 (Production Alerts row 450128).
# Builds the four relations fn_tournament_launch_lateness_metrics reads, seeds
# the exact 2026-11-28 16:00Z cutover shape (freeze stamped 1 ms after the
# boundary) shifted to "now", and compares the 20261128075041 and
# 20261128160858 definitions on identical fixtures. Read-only to everything
# outside the throwaway cluster it creates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
TMP="$(mktemp -d)"; trap 'pg_ctl_stop; rm -rf "$TMP"' EXIT
pg_ctl_stop() { "$BIN/pg_ctl" -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; }
RUNAS=(); [ "$(id -u)" = 0 ] && { chown -R nobody "$TMP"; RUNAS=(runuser -u nobody --); }
"${RUNAS[@]}" "$BIN/initdb" -D "$TMP/db" -U postgres >/dev/null
"${RUNAS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -o "-k $TMP -p 54329 -c listen_addresses=''" -l "$TMP/log" start >/dev/null
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p 54329 -U postgres -d postgres)
"${P[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE tournaments(id uuid PRIMARY KEY, start_time timestamptz, status text, format_contract text, current_players int DEFAULT 0);
CREATE TABLE tournament_players(tournament_id uuid, status text);
CREATE TABLE hand_history(tournament_id uuid, created_at timestamptz, started_at timestamptz);
CREATE TABLE engine_maintenance_break_log(break_started_at timestamptz, break_ended_at timestamptz);
CREATE TABLE engine_maintenance_thaws(contract_version int, shifted jsonb, freeze_started_at timestamptz, release_target_at timestamptz);
-- Anchor: the start minute is 6 minutes ago, like the 16:00 start read at 16:06.
CREATE TABLE anchor AS SELECT date_trunc('second', now()) - interval '6 minutes' AS s;
-- A: the live shape. start :00.000, freeze :00.001-:05:00.149, first hand :05:01.156.
INSERT INTO tournaments SELECT '00000000-0000-0000-0000-00000000000a', s, 'RUNNING', 'mtt-v2', 38 FROM anchor;
INSERT INTO tournament_players VALUES ('00000000-0000-0000-0000-00000000000a', 'playing');
INSERT INTO hand_history SELECT '00000000-0000-0000-0000-00000000000a', s + interval '5 min 20 s', s + interval '5 min 1.156 s' FROM anchor;
INSERT INTO engine_maintenance_break_log SELECT s + interval '1 ms', s + interval '5 min 0.149 s' FROM anchor;
INSERT INTO engine_maintenance_thaws SELECT 3, '{"complete":true}', s + interval '1 ms', s + interval '5 min 1 ms' FROM anchor;
SQL
run() { # $1 = migration file
  sed -e '/^DO \$preimage\$/,/^END \$preimage\$;/d' "$ROOT/supabase/migrations/$1" | "${P[@]}" >/dev/null
  "${P[@]}" -At -c "SELECT late_first_hands||','||late_waiting||','||worst_late_seconds FROM public.fn_tournament_launch_lateness_metrics(120,120,15,24)"
}
fail=0
pre=$(run 20261128075041_mtt_launch_lateness_measures_from_bounded_maintenance_thaw.sql)
post=$(run 20261128160858_mtt_launch_lateness_freeze_starting_at_the_start_minute.sql)
echo "A live shape   pre-fix: $pre   post-fix: $post"
[ "$pre" = "1,0,301" ] || { echo "FAIL: pre-fix did not reproduce the 301 s false alarm"; fail=1; }
[ "$post" = "0,0,0" ] || { echo "FAIL: post-fix still reports the thawed start late"; fail=1; }
# B: a real post-thaw stall still alerts (first hand 3 min after the thaw).
"${P[@]}" -c "UPDATE hand_history SET started_at = (SELECT s FROM anchor) + interval '8 min 1 s', created_at = (SELECT s FROM anchor) + interval '8 min 30 s'" >/dev/null
"${P[@]}" -c "UPDATE anchor SET s = s - interval '3 min'; UPDATE tournaments SET start_time=(SELECT s FROM anchor); UPDATE engine_maintenance_break_log SET break_started_at=break_started_at - interval '3 min', break_ended_at=break_ended_at - interval '3 min'; UPDATE engine_maintenance_thaws SET freeze_started_at=freeze_started_at - interval '3 min', release_target_at=release_target_at - interval '3 min'; UPDATE hand_history SET started_at=started_at - interval '3 min', created_at=created_at - interval '3 min'" >/dev/null
stall=$("${P[@]}" -At -c "SELECT late_first_hands||','||late_waiting||','||worst_late_seconds FROM public.fn_tournament_launch_lateness_metrics(120,120,15,24)")
echo "B post-thaw stall post-fix: $stall"
[ "${stall%%,*}" = "1" ] || { echo "FAIL: a 181 s post-thaw stall no longer alerts"; fail=1; }
# C: a freeze that begins after the late bar earns no credit (event already late).
"${P[@]}" -c "UPDATE engine_maintenance_break_log SET break_started_at=(SELECT s FROM anchor) + interval '121 s'; UPDATE engine_maintenance_thaws SET freeze_started_at=(SELECT s FROM anchor) + interval '121 s'; UPDATE hand_history SET started_at=(SELECT s FROM anchor) + interval '5 min 1 s'" >/dev/null
late=$("${P[@]}" -At -c "SELECT late_first_hands||','||late_waiting||','||worst_late_seconds FROM public.fn_tournament_launch_lateness_metrics(120,120,15,24)")
echo "C freeze after late bar post-fix: $late"
[ "${late%%,*}" = "1" ] || { echo "FAIL: a freeze opened after the event was already late excused it"; fail=1; }
# D: an unbounded (13 minute) freeze earns no credit.
"${P[@]}" -c "UPDATE engine_maintenance_break_log SET break_started_at=(SELECT s FROM anchor) + interval '1 ms', break_ended_at=(SELECT s FROM anchor) + interval '13 min 1 ms'; UPDATE engine_maintenance_thaws SET freeze_started_at=(SELECT s FROM anchor) + interval '1 ms', release_target_at=(SELECT s FROM anchor) + interval '13 min 1 ms'" >/dev/null
unb=$("${P[@]}" -At -c "SELECT late_first_hands||','||late_waiting||','||worst_late_seconds FROM public.fn_tournament_launch_lateness_metrics(120,120,15,24)")
echo "D unbounded freeze post-fix: $unb"
[ "${unb%%,*}" = "1" ] || { echo "FAIL: an unbounded freeze excused a late start"; fail=1; }
# E (row 450194): an event nobody entered, 7 minutes past start, REGISTERING,
# no hand, no tournament_players row, current_players 0 (the daily "Daily 25
# Chip Freezeout" of pilot club 652f121d) is the empty-event cancel's, not a
# late launch; one registered entrant makes it late again.
"${P[@]}" -c "INSERT INTO tournaments VALUES ('00000000-0000-0000-0000-00000000000e', date_trunc('second', now()) - interval '7 minutes', 'REGISTERING', 'mtt-v2', 0)" >/dev/null
lw() { "${P[@]}" -At -c "SELECT late_waiting FROM public.fn_tournament_launch_lateness_metrics(120,120,15,24)"; }
sed -e '/^DO \$preimage\$/,/^END \$preimage\$;/d' "$ROOT/supabase/migrations/20261128075041_mtt_launch_lateness_measures_from_bounded_maintenance_thaw.sql" | "${P[@]}" >/dev/null
e_pre=$(lw)
sed -e '/^DO \$preimage\$/,/^END \$preimage\$;/d' "$ROOT/supabase/migrations/20261128160858_mtt_launch_lateness_freeze_starting_at_the_start_minute.sql" | "${P[@]}" >/dev/null
e_post=$(lw)
"${P[@]}" -c "INSERT INTO tournament_players VALUES ('00000000-0000-0000-0000-00000000000e', 'registered')" >/dev/null
e_one=$(lw)
echo "E empty event late_waiting pre-fix: $e_pre   post-fix: $e_post   with one entrant: $e_one"
[ "$e_pre" = "1" ] || { echo "FAIL: pre-fix did not reproduce the empty-event false alarm"; fail=1; }
[ "$e_post" = "0" ] || { echo "FAIL: post-fix still counts an event nobody entered"; fail=1; }
[ "$e_one" = "1" ] || { echo "FAIL: an event with an entrant and no hand no longer alerts"; fail=1; }
[ $fail = 0 ] && echo "native-proof: PASS" || { echo "native-proof: FAIL"; exit 1; }

#!/usr/bin/env bash
# Native proof for migration 20261123052751 (a rebuy's capacity check never
# upgrades its tournament lock). Runs on a THROWAWAY local PostgreSQL cluster
# it creates and removes; it never connects to any other database.
#
# It loads production's own text for fn_ensure_late_registration_capacity
# (scripts/dev/fixtures/a-rebuy-capacity-check-never-upgrades-its-tournament-
# lock, md5 asserted equal to production's) and replays what production
# logged at 05:18:06 UTC on 2026-11-23, with each side's lock statements
# copied from the live bodies:
#
#   rebuy  fn_ca_lock_tournament_rebuy_acquisition lines 52-59 and 65-68:
#          tournament row FOR NO KEY UPDATE, candidate table FOR UPDATE;
#          1.5 s later fn_ca_choose_tournament_seat_locked line 15 calls
#          fn_ensure_late_registration_capacity(t, 0)
#   hand   fn_ca_commit_hand_settlement_exact_before_obligations lines 84-87
#          and 96-99, 0.5 s in: tournament row FOR KEY SHARE, then its table
#          (the candidate's table) FOR UPDATE
#
# Before the migration Postgres reports a deadlock. The script then runs the
# migration file itself and replays it: both commit. It also checks that two
# capacity checks still serialise, and that the capacity check answers
# exactly the same, table for table, on the same state before and after.
#
# Usage: bash scripts/dev/prove-a-rebuy-capacity-check-never-upgrades-its-tournament-lock.sh
# (PG_BIN defaults to /usr/lib/postgresql/16/bin; as root the server runs as
# the postgres user.)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FX="$ROOT/scripts/dev/fixtures/a-rebuy-capacity-check-never-upgrades-its-tournament-lock"
MIGRATION="$ROOT/supabase/migrations/20261123052751_a_rebuy_capacity_check_never_upgrades_its_tournament_lock.sql"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
AS_PG=()
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; AS_PG=(runuser -u postgres --); fi
trap '"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"${AS_PG[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5548 -c deadlock_timeout=1s" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p 5548 -U postgres -d postgres)

[ "$(md5sum < "$FX/fn_ensure_late_registration_capacity.preimage.sql" | cut -c1-32)" = a539fd43bb2992f8d75253f2d7a4dd7c ] \
  || { echo 'PROOF FAILED: the fixture is not production text' >&2; exit 1; }

T=00000000-0000-4000-8000-0000000000a7      # tournament
T1=00000000-0000-4000-8000-0000000000b7     # the candidate's table, where the hand is

"${PSQL[@]}" <<SQL
CREATE SCHEMA smarter_private;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text, game_type text, max_players integer,
  table_size integer, name text, club_id uuid, action_time_seconds integer, big_blind_ante boolean,
  all_in_or_fold boolean, allow_rabbit_hunt boolean, started_at timestamptz);
CREATE TABLE public.tournament_players(id bigserial PRIMARY KEY, tournament_id uuid REFERENCES public.tournaments(id),
  user_id uuid, status text);
CREATE TABLE public.tables(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid,
  tournament_id uuid REFERENCES public.tournaments(id), name text, game_type text, game_variant text,
  stakes text, small_blind numeric, big_blind numeric, ante numeric, min_buy_in numeric, max_buy_in numeric,
  max_players integer, current_players integer, status text, action_time_seconds integer,
  big_blind_ante_enabled boolean, all_in_or_fold boolean, allow_rabbit_hunt boolean, is_deleted boolean DEFAULT false);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid REFERENCES public.tables(id),
  user_id uuid, seat_number integer, left_at timestamptz);
CREATE TABLE smarter_private.f06_operations(id bigserial PRIMARY KEY, source_table_id uuid, state text);
CREATE TABLE public.tournament_capacity_table_receipts(table_id uuid PRIMARY KEY, tournament_id uuid,
  manager_wake_id bigint, manager_admitted_at timestamptz, created_at timestamptz DEFAULT clock_timestamp(),
  updated_at timestamptz);
CREATE TABLE public.tournament_manager_wakes(id bigserial PRIMARY KEY, tournament_id uuid, reason text,
  generation bigint DEFAULT 1, created_at timestamptz DEFAULT clock_timestamp(), consumed_at timestamptz);
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION public.fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.fn_ca_tournament_recorded_format(uuid) RETURNS text LANGUAGE sql AS \$\$SELECT 'mtt-v1'\$\$;
CREATE FUNCTION public.fn_tournament_current_blinds(uuid) RETURNS jsonb LANGUAGE sql
  AS \$\$SELECT '{"small_blind":50,"big_blind":100,"ante":10}'::jsonb\$\$;
CREATE FUNCTION public.fn_emit_tournament_manager_wake(uuid, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
\i $FX/fn_ensure_late_registration_capacity.preimage.sql
REVOKE ALL ON FUNCTION public.fn_ensure_late_registration_capacity(uuid,integer) FROM PUBLIC;
INSERT INTO public.tournaments VALUES ('$T','RUNNING','nlh',100,9,'Proof MTT',NULL,15,false,false,true,now());
INSERT INTO public.tables(id, tournament_id, name, max_players, status) VALUES ('$T1','$T','Proof MTT - Table 1',9,'running');
SQL

# A full table of nine; $1 more accepted entries hold no chair (the seatless re-entry).
seed() {
  "${PSQL[@]}" -c "DELETE FROM public.tournament_capacity_table_receipts; DELETE FROM public.table_seats;
    DELETE FROM public.tables WHERE id<>'$T1'; DELETE FROM public.tournament_players;
    INSERT INTO public.tournament_players(tournament_id,user_id,status) SELECT '$T',gen_random_uuid(),'playing' FROM generate_series(1,9+$1);
    INSERT INTO public.table_seats(table_id,user_id,seat_number)
      SELECT '$T1',user_id,row_number() OVER (ORDER BY id) FROM public.tournament_players ORDER BY id LIMIT 9;"
}
outcome() { local all; all=$(cat); if grep -q 'deadlock detected' <<<"$all"; then echo "DEADLOCK ($(grep -o 'while [a-z]* tuple ([0-9,]*) in relation "[a-z_]*"' <<<"$all" | head -1))"; elif grep -q 'lock timeout' <<<"$all"; then echo 'lock timeout'; elif grep -q 'ERROR' <<<"$all"; then echo "error: $all"; else echo "committed $(grep -v '^$' <<<"$all" | tail -1)"; fi; }

REBUY_SQL="BEGIN;
  SELECT upper(COALESCE(t.status::text, '')), COALESCE(t.max_players, 0), t.started_at
    FROM public.tournaments t WHERE t.id = '$T' FOR NO KEY UPDATE;
  SELECT tb.tournament_id FROM public.tables tb WHERE tb.id = '$T1' FOR UPDATE;
  SELECT pg_sleep(1.5);
  SELECT public.fn_ensure_late_registration_capacity('$T',0)->>'created';
  COMMIT;"
HAND_SQL="BEGIN;
  SELECT 1 FROM public.tournaments t WHERE t.id = '$T' FOR KEY SHARE;
  SELECT t.tournament_id FROM public.tables t WHERE t.id = '$T1' FOR UPDATE;
  COMMIT; SELECT 'hand';"

replay() {
  seed 1
  local r h rp
  ("${PSQL[@]}" -c "$REBUY_SQL" 2>&1 | outcome > "$WORK/r") & rp=$!
  sleep 0.5
  h=$("${PSQL[@]}" -c "$HAND_SQL" 2>&1 | outcome)
  wait "$rp"; r=$(cat "$WORK/r")
  echo "replay | rebuy: $r | hand: $h"
}
serialise() {
  seed 1
  local a b ap
  ("${PSQL[@]}" -c "BEGIN; SELECT public.fn_ensure_late_registration_capacity('$T',0)->>'created'; SELECT pg_sleep(1.5); COMMIT; SELECT 'first';" 2>&1 | outcome > "$WORK/a") & ap=$!
  sleep 0.5
  b=$("${PSQL[@]}" -c "SET lock_timeout='500ms'; SELECT public.fn_ensure_late_registration_capacity('$T',0)->>'created';" 2>&1 | outcome)
  wait "$ap"; a=$(cat "$WORK/a")
  echo "two capacity checks | first: $a | second: $b"
}
# The full answer on a fixed state, minus the new table's random id.
answers() {
  local out=''
  for unseated in 0 1 12; do
    seed "$unseated"
    out+="unseated=$unseated $("${PSQL[@]}" -c "SELECT (public.fn_ensure_late_registration_capacity('$T',0) - 'table_id' - 'pending_table_ids')::text;") ;"
  done
  echo "$out"
}

echo '-- production text (before 20261123052751)'
b1=$(replay); echo "$b1"
b2=$(serialise); echo "$b2"
b3=$(answers); echo "answers: $b3"

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
echo '-- after 20261123052751 (the migration file itself, run on this copy)'
a1=$(replay); echo "$a1"
a2=$(serialise); echo "$a2"
a3=$(answers); echo "answers: $a3"

grep -q 'DEADLOCK' <<<"$b1" || { echo 'PROOF FAILED: the old capacity check did not deadlock with the hand' >&2; exit 1; }
grep -q 'rebuy: committed true | hand: committed hand' <<<"$a1" || { echo "PROOF FAILED: $a1" >&2; exit 1; }
grep -q 'second: lock timeout' <<<"$a2" || { echo "PROOF FAILED: capacity checks no longer serialise: $a2" >&2; exit 1; }
[ "$b3" = "$a3" ] || { echo 'PROOF FAILED: the capacity check answers differently' >&2; exit 1; }
grep -q '"created": true' <<<"$a3" && grep -q '"created": false' <<<"$a3" || { echo "PROOF FAILED: answers did not cover both paths: $a3" >&2; exit 1; }
echo 'PROOF OK'

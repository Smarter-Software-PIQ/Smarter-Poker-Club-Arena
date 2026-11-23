#!/usr/bin/env bash
# Native proof for migration 20261123024034 (a sit-out or a departure takes
# its table before its seat). Runs on a THROWAWAY local PostgreSQL cluster it
# creates and removes; it never connects to any other database.
#
# It loads production's own text for the four functions in the cycle
# (scripts/dev/fixtures/a-sit-out-takes-its-table-before-its-seat, each md5
# asserted equal to production's), then replays the interleaving production
# logged on 2026-11-22:
#
#   writer  fn_cash_seat_sitout / fn_request_seat_departure of a person's seat:
#           locks the seat, then its UPDATE fires zz_note_human_seat_seen,
#           which updates the table row
#   lane    fn_ca_f06_share_table_lane (what fn_f06_retain_hand_continuation
#           calls first): table row FOR UPDATE, then every seat in id order
#
# A test-only BEFORE UPDATE trigger holds the writer for 2 s after it has its
# seat (only while proof.pause is on), so the lane takes the table and then
# waits for that seat. Before the migration Postgres reports a deadlock; the
# script then runs the migration file itself and the same interleaving
# commits on both sides, with the same rows written.
#
# Usage: bash scripts/dev/prove-a-sit-out-takes-its-table-before-its-seat.sh
# (PG_BIN defaults to /usr/lib/postgresql/16/bin; as root the server runs as
# the postgres user.)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FX="$ROOT/scripts/dev/fixtures/a-sit-out-takes-its-table-before-its-seat"
MIGRATION="$ROOT/supabase/migrations/20261123024034_a_sit_out_takes_its_table_before_its_seat.sql"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
AS_PG=()
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; AS_PG=(runuser -u postgres --); fi
trap '"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"${AS_PG[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5546 -c deadlock_timeout=1s" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p 5546 -U postgres -d postgres)

# Production's text, byte for byte.
check_md5() { [ "$(md5sum < "$FX/$1" | cut -c1-32)" = "$2" ] || { echo "PROOF FAILED: $1 is not production's text" >&2; exit 1; }; }
check_md5 fn_ca_f06_share_table_lane.preimage.sql 6cea02b2f02dc4e238e7ae17ad0bf9c8
check_md5 fn_note_human_seat_seen.preimage.sql e076918bb9c42284b47ac0670e970cf8
check_md5 fn_cash_seat_sitout.preimage.sql e583aa15d0ecc82fa5a80f2c14185815
check_md5 fn_request_seat_departure.preimage.sql 8f5c00c607a00bc1fa0d464095da5398

T=00000000-0000-4000-8000-0000000000a1      # tournament
TB=00000000-0000-4000-8000-0000000000b1     # its table
PERSON=00000000-0000-4000-8000-0000000000c1 # a person, seat 2
HORSE=00000000-0000-4000-8000-0000000000c2  # a horse, seat 1
OCC=00000000-0000-4000-8000-0000000000d1    # the person's occupancy
HOCC=00000000-0000-4000-8000-0000000000d2   # the horse's occupancy

"${PSQL[@]}" <<SQL
CREATE SCHEMA smarter_private;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, is_horse boolean);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text);
CREATE TABLE public.cash_games(id uuid PRIMARY KEY, cluster_mode text);
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, cluster_id uuid,
  last_human_seen_at timestamptz);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY, table_id uuid REFERENCES public.tables(id),
  user_id uuid, occupancy_id uuid, seat_number integer, left_at timestamptz, status text,
  is_sitting_out boolean DEFAULT false, leave_pending boolean DEFAULT false, stack numeric);
CREATE TABLE public.lightning_pool_session(id uuid PRIMARY KEY, cluster_id uuid,
  anchor_seat_id uuid, player_id uuid, exited_at timestamptz, stop_requested_at timestamptz,
  updated_at timestamptz);
CREATE TABLE public.seat_departure_requests(occupancy_id uuid PRIMARY KEY, user_id uuid,
  table_id uuid, seat_number integer, leave_mode text);
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid) RETURNS void LANGUAGE sql AS '';
CREATE FUNCTION smarter_private.f06_authority(uuid, uuid, boolean) RETURNS void LANGUAGE sql AS '';
\i $FX/fn_note_human_seat_seen.preimage.sql
\i $FX/fn_ca_f06_share_table_lane.preimage.sql
\i $FX/fn_cash_seat_sitout.preimage.sql
\i $FX/fn_request_seat_departure.preimage.sql
CREATE TRIGGER zz_note_human_seat_seen
AFTER INSERT OR DELETE OR UPDATE OF leave_pending, is_sitting_out ON public.table_seats
FOR EACH ROW EXECUTE FUNCTION public.fn_note_human_seat_seen();
-- Test only: hold the writer after it has locked its seat.
CREATE FUNCTION public.proof_pause() RETURNS trigger LANGUAGE plpgsql AS \$p\$
BEGIN
  IF current_setting('proof.pause', true) = 'on' THEN PERFORM pg_sleep(2); END IF;
  RETURN NEW;
END \$p\$;
CREATE TRIGGER a_proof_pause BEFORE UPDATE ON public.table_seats
FOR EACH ROW EXECUTE FUNCTION public.proof_pause();
INSERT INTO public.profiles VALUES ('$PERSON', false), ('$HORSE', true);
INSERT INTO public.tournaments VALUES ('$T', 'RUNNING');
INSERT INTO public.tables VALUES ('$TB', '$T', NULL, NULL);
INSERT INTO public.table_seats(id, table_id, user_id, occupancy_id, seat_number, status, stack) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '$TB', '$HORSE', '$HOCC', 1, 'active', 1500),
  ('00000000-0000-4000-8000-0000000000e2', '$TB', '$PERSON', '$OCC', 2, 'active', 1500);
SQL

reset_rows() {
  "${PSQL[@]}" -c "UPDATE public.table_seats SET is_sitting_out=false, leave_pending=false, status='active';
    DELETE FROM public.seat_departure_requests; UPDATE public.tables SET last_human_seen_at=NULL;"
}
writer_sql() { # $1 = sitout | departure | horse-sitout
  case "$1" in
    sitout) echo "SELECT public.fn_cash_seat_sitout('$TB','$PERSON','$OCC',true)->'seat'->>'is_sitting_out';" ;;
    horse-sitout) echo "SELECT public.fn_cash_seat_sitout('$TB','$HORSE','$HOCC',true)->'seat'->>'is_sitting_out';" ;;
    departure) echo "SELECT public.fn_request_seat_departure('$PERSON','$TB',2,'$OCC','voluntary')->>'accepted';" ;;
  esac
}
LANE_SQL="SELECT public.fn_ca_f06_share_table_lane('$T', gen_random_uuid(), '$TB');"
outcome() { local all; all=$(cat); if grep -q 'deadlock detected' <<<"$all"; then echo "DEADLOCK ($(grep -o 'while [a-z]* tuple ([0-9,]*) in relation "[a-z_]*"' <<<"$all" | head -1))"; elif grep -q 'ERROR' <<<"$all"; then echo "error: $all"; else echo 'committed'; fi; }

# The writer takes its seat first and is held; the lane arrives 0.7 s later.
writer_first() {
  reset_rows
  local w l wp
  ("${PSQL[@]}" -c "SET proof.pause='on'; $(writer_sql "$1")" 2>&1 | outcome > "$WORK/w") & wp=$!
  sleep 0.7
  l=$("${PSQL[@]}" -c "BEGIN; $LANE_SQL COMMIT;" 2>&1 | outcome)
  wait "$wp"; w=$(cat "$WORK/w")
  echo "$1 | writer: $w | lane: $l | $(state)"
}
# The lane holds its table and seats for 2 s; the writer arrives 0.7 s later.
lane_first() {
  reset_rows
  local w l lp
  ("${PSQL[@]}" -c "BEGIN; $LANE_SQL SELECT pg_sleep(2); COMMIT;" 2>&1 | outcome > "$WORK/l") & lp=$!
  sleep 0.7
  w=$("${PSQL[@]}" -c "$(writer_sql "$1")" 2>&1 | outcome)
  wait "$lp"; l=$(cat "$WORK/l")
  echo "$1, lane first | writer: $w | lane: $l | $(state)"
}
state() {
  "${PSQL[@]}" -c "SELECT 'person sitting out=' || s.is_sitting_out || ' horse sitting out=' || h.is_sitting_out
      || ' departures=' || (SELECT count(*) FROM public.seat_departure_requests)
      || ' human stamp=' || (t.last_human_seen_at IS NOT NULL)
    FROM public.table_seats s, public.table_seats h, public.tables t
   WHERE s.user_id='$PERSON' AND h.user_id='$HORSE' AND t.id='$TB';"
}

echo '-- production text (before 20261123024034)'
b1=$(writer_first sitout); echo "$b1"
b2=$(writer_first departure); echo "$b2"

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
echo '-- after 20261123024034 (the migration file itself, run on this copy)'
a1=$(writer_first sitout); echo "$a1"
a2=$(writer_first departure); echo "$a2"
a3=$(lane_first sitout); echo "$a3"
a4=$(lane_first departure); echo "$a4"
a5=$(writer_first horse-sitout); echo "$a5"

grep -q 'DEADLOCK' <<<"$b1" || { echo 'PROOF FAILED: the old sit-out did not deadlock with the lane' >&2; exit 1; }
grep -q 'DEADLOCK' <<<"$b2" || { echo 'PROOF FAILED: the old departure did not deadlock with the lane' >&2; exit 1; }
for line in "$a1" "$a2" "$a3" "$a4" "$a5"; do
  grep -q 'writer: committed | lane: committed' <<<"$line" || { echo "PROOF FAILED: $line" >&2; exit 1; }
done
grep -q 'person sitting out=true horse sitting out=false departures=0 human stamp=true' <<<"$a1" || { echo 'PROOF FAILED: the sit-out wrote different rows' >&2; exit 1; }
grep -q 'person sitting out=true horse sitting out=false departures=1 human stamp=true' <<<"$a2" || { echo 'PROOF FAILED: the departure wrote different rows' >&2; exit 1; }
grep -q 'person sitting out=false horse sitting out=true departures=0 human stamp=false' <<<"$a5" || { echo 'PROOF FAILED: the horse sit-out wrote different rows' >&2; exit 1; }
echo 'PROOF OK'

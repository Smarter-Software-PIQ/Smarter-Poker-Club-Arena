#!/usr/bin/env bash
# Native proof for migration 20261123025756 (a wake acknowledgement never holds
# a wake while it waits). Runs on a THROWAWAY local PostgreSQL cluster it
# creates and removes; it never connects to any other database.
#
# It loads production's own text for the three functions that write
# tournament_manager_wakes rows (scripts/dev/fixtures/a-wake-ack-never-holds-
# a-wake-while-it-waits, each md5 asserted equal to production's) on the
# table's production shape, then replays what production logged on
# 2026-11-22 at 18:50:25 UTC:
#
#   pending wakes  id 1 = rebuy, id 2 = bounty_settled (1390195 / 1390196)
#   rebuy          one transaction: emit bounty_settled (row 2), 1.5 s of
#                  purchase work, emit rebuy (row 1), commit
#   ack            fn_ack_tournament_manager_wakes(t, {1,2}, {1,1}) 0.5 s in:
#                  locks row 1, then waits for row 2
#
# Before the migration Postgres reports a deadlock. The script then runs the
# migration file itself and replays it: both commit, and the ack answers what
# it would have answered had it simply waited (both generations moved on, so
# nothing is consumed and the manager runs them). Then it checks the key
# costs nothing else: emitters of two reasons do not wait for each other, a
# one-wake ack still takes no key, an ack with nothing in flight consumes
# both, and the terminal retirement still consumes every pending wake.
#
# Usage: bash scripts/dev/prove-a-wake-ack-never-holds-a-wake-while-it-waits.sh
# (PG_BIN defaults to /usr/lib/postgresql/16/bin; as root the server runs as
# the postgres user.)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FX="$ROOT/scripts/dev/fixtures/a-wake-ack-never-holds-a-wake-while-it-waits"
MIGRATION="$ROOT/supabase/migrations/20261123025756_a_wake_ack_never_holds_a_wake_while_it_waits.sql"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
AS_PG=()
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; AS_PG=(runuser -u postgres --); fi
trap '"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"${AS_PG[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5547 -c deadlock_timeout=1s" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p 5547 -U postgres -d postgres)

check_md5() { [ "$(md5sum < "$FX/$1" | cut -c1-32)" = "$2" ] || { echo "PROOF FAILED: $1 is not production's text" >&2; exit 1; }; }
check_md5 fn_emit_tournament_manager_wake.preimage.sql c74a777eacc98bed6cfd90ac0043829c
check_md5 fn_ack_tournament_manager_wakes.preimage.sql 4e948510fa754f68323981b245ffa0ae
check_md5 fn_retire_manager_wakes_after_terminal_status.preimage.sql 2fa4c2d4bb63ece41ed78c3f11cd770c

T=00000000-0000-4000-8000-0000000000f1

"${PSQL[@]}" <<SQL
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text);
-- production's shape: columns, defaults, checks, keys and indexes
CREATE TABLE public.tournament_manager_wakes(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason = ANY (ARRAY['rebuy','reentry','addon','late_registration','deal_vote','bounty_settled'])),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz);
CREATE INDEX idx_tournament_manager_wakes_pending ON public.tournament_manager_wakes (created_at, id) WHERE consumed_at IS NULL;
CREATE UNIQUE INDEX uq_tournament_manager_wakes_pending_by_reason ON public.tournament_manager_wakes (tournament_id, reason) WHERE consumed_at IS NULL;
CREATE INDEX idx_tournament_manager_wakes_tournament_id ON public.tournament_manager_wakes (tournament_id);
\i $FX/fn_emit_tournament_manager_wake.preimage.sql
\i $FX/fn_ack_tournament_manager_wakes.preimage.sql
\i $FX/fn_retire_manager_wakes_after_terminal_status.preimage.sql
CREATE TRIGGER trg_retire_manager_wakes_after_terminal_status AFTER UPDATE OF status ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.fn_retire_manager_wakes_after_terminal_status();
INSERT INTO public.tournaments VALUES ('$T', 'RUNNING');
SQL

# Two pending wakes, the lower id for rebuy, as production held them.
reset_wakes() {
  "${PSQL[@]}" -c "UPDATE public.tournaments SET status='RUNNING';
    TRUNCATE public.tournament_manager_wakes RESTART IDENTITY;
    INSERT INTO public.tournament_manager_wakes(tournament_id, reason) VALUES ('$T','rebuy');
    INSERT INTO public.tournament_manager_wakes(tournament_id, reason) VALUES ('$T','bounty_settled');"
}
outcome() { local all; all=$(cat); if grep -q 'deadlock detected' <<<"$all"; then echo "DEADLOCK ($(grep -o 'while [a-z]* tuple ([0-9,]*) in relation "[a-z_]*"' <<<"$all" | head -1))"; elif grep -q 'lock timeout' <<<"$all"; then echo 'lock timeout'; elif grep -q 'ERROR' <<<"$all"; then echo "error: $all"; else echo "committed $(grep -v '^$' <<<"$all" | tail -1)"; fi; }
wakes() { "${PSQL[@]}" -c "SELECT string_agg(id || ':' || reason || ':g' || generation || ':' || CASE WHEN consumed_at IS NULL THEN 'pending' ELSE 'consumed' END, ' ' ORDER BY id) FROM public.tournament_manager_wakes;"; }

REBUY_SQL="BEGIN; SELECT public.fn_emit_tournament_manager_wake('$T','bounty_settled'); SELECT pg_sleep(1.5);
  SELECT public.fn_emit_tournament_manager_wake('$T','rebuy'); COMMIT; SELECT 'rebuy';"
ACK_BOTH="SELECT public.fn_ack_tournament_manager_wakes('$T', ARRAY[1,2]::bigint[], ARRAY[1,1]::bigint[])->>'newly_acknowledged';"

# The bounty rebuy is in flight; the manager acknowledges both wakes 0.5 s in.
replay() {
  reset_wakes
  local r k rp
  ("${PSQL[@]}" -c "$REBUY_SQL" 2>&1 | outcome > "$WORK/r") & rp=$!
  sleep 0.5
  k=$("${PSQL[@]}" -c "$ACK_BOTH" 2>&1 | outcome)
  wait "$rp"; r=$(cat "$WORK/r")
  echo "replay | rebuy: $r | ack: $k | $(wakes)"
}
# One transaction holds what $1 writes for 1.5 s; $2 runs 0.5 s in with a 500 ms lock_timeout.
beside() {
  reset_wakes
  local a b ap
  ("${PSQL[@]}" -c "BEGIN; $1 SELECT pg_sleep(1.5); COMMIT; SELECT 'first';" 2>&1 | outcome > "$WORK/a") & ap=$!
  sleep 0.5
  b=$("${PSQL[@]}" -c "SET lock_timeout='500ms'; $2" 2>&1 | outcome)
  wait "$ap"; a=$(cat "$WORK/a")
  echo "$3 | first: $a | second: $b | $(wakes)"
}

echo '-- production text (before 20261123025756)'
b1=$(replay); echo "$b1"

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
echo '-- after 20261123025756 (the migration file itself, run on this copy)'
a1=$(replay); echo "$a1"
a2=$(beside "SELECT public.fn_emit_tournament_manager_wake('$T','bounty_settled');" \
            "SELECT public.fn_emit_tournament_manager_wake('$T','late_registration');" \
            'two emitters, two reasons'); echo "$a2"
a3=$(beside "SELECT public.fn_emit_tournament_manager_wake('$T','bounty_settled');" \
            "SELECT public.fn_ack_tournament_manager_wakes('$T', ARRAY[1]::bigint[], ARRAY[1]::bigint[])->>'newly_acknowledged';" \
            'one-wake ack beside an emitter'); echo "$a3"
reset_wakes
a4="ack with nothing in flight | ack: $("${PSQL[@]}" -c "$ACK_BOTH" 2>&1 | outcome) | $(wakes)"; echo "$a4"
a5=$(beside "SELECT public.fn_ack_tournament_manager_wakes('$T', ARRAY[1,2]::bigint[], ARRAY[1,1]::bigint[])->>'ok';" \
            "SET lock_timeout='5s'; UPDATE public.tournaments SET status='COMPLETED' WHERE id='$T'; SELECT 'completed';" \
            'terminal retirement beside a held ack'); echo "$a5"
reset_wakes
"${PSQL[@]}" -c "UPDATE public.tournaments SET status='COMPLETED' WHERE id='$T';"
a6="terminal retirement alone | $(wakes)"; echo "$a6"

grep -q 'DEADLOCK' <<<"$b1" || { echo 'PROOF FAILED: the old acknowledgement did not deadlock with the bounty rebuy' >&2; exit 1; }
grep -q 'rebuy: committed rebuy | ack: committed 0 | 1:rebuy:g2:pending 2:bounty_settled:g2:pending' <<<"$a1" || { echo "PROOF FAILED: $a1" >&2; exit 1; }
grep -q 'first: committed first | second: committed' <<<"$a2" || { echo "PROOF FAILED: emitters now wait for each other: $a2" >&2; exit 1; }
grep -q 'second: committed 1 | 1:rebuy:g1:consumed 2:bounty_settled:g2:pending' <<<"$a3" || { echo "PROOF FAILED: a one-wake ack changed: $a3" >&2; exit 1; }
grep -q 'ack: committed 2 | 1:rebuy:g1:consumed 2:bounty_settled:g1:consumed' <<<"$a4" || { echo "PROOF FAILED: $a4" >&2; exit 1; }
grep -q 'first: committed first | second: committed completed | 1:rebuy:g1:consumed 2:bounty_settled:g1:consumed' <<<"$a5" || { echo "PROOF FAILED: $a5" >&2; exit 1; }
grep -q '1:rebuy:g1:consumed 2:bounty_settled:g1:consumed' <<<"$a6" || { echo "PROOF FAILED: $a6" >&2; exit 1; }
echo 'PROOF OK'

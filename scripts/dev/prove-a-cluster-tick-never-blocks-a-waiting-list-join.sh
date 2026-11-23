#!/usr/bin/env bash
# Native proof for migration 20261122232612 (a cluster tick never blocks a
# waiting-list join). Runs on a THROWAWAY local PostgreSQL cluster it creates
# and removes; it never connects to any other database.
#
# A "tick" session holds a cash game row the way fn_cash_cluster_tick takes it
# and keeps its transaction open. A "join" session then inserts a waiting-list
# row for that game, which makes the same foreign key check production logs
# show on the join's side of every deadlock (FOR KEY SHARE on cash_games), with
# a 1 s lock_timeout. Before (FOR UPDATE) the join waits and times out; after
# (FOR NO KEY UPDATE) it commits at once. A second tick holding the same row is
# still refused by a wake's SKIP LOCKED, and a FOR SHARE reader still waits.
#
# Usage (as a non-root user that may run postgres):
#   PG_BIN=/usr/lib/postgresql/16/bin bash scripts/dev/prove-a-cluster-tick-never-blocks-a-waiting-list-join.sh
set -euo pipefail
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
trap '"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
"$PG_BIN/initdb" -D "$WORK/data" -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p 5545" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p 5545 -d postgres)
"${PSQL[@]}" -c "
CREATE TABLE public.cash_games(id uuid PRIMARY KEY, state text, last_tick_at timestamptz);
CREATE TABLE public.cash_game_waitlist(id bigserial PRIMARY KEY,
  game_id uuid REFERENCES public.cash_games(id) ON DELETE CASCADE, user_id uuid, status text);
INSERT INTO public.cash_games VALUES ('00000000-0000-4000-8000-000000000001','running',now());"

G=00000000-0000-4000-8000-000000000001
# One word per session: what it answered, or "lock timeout" when it waited.
outcome() { local all; all=$(cat); if grep -q 'canceling statement due to lock timeout' <<<"$all"; then echo 'lock timeout'; else grep -v '^$' <<<"$all" | tail -1; fi; }
case_for() { # $1 = row lock the tick takes; prints the join outcome and the other readers'
  local lock="$1"
  "${PSQL[@]}" -c "BEGIN; SELECT 1 FROM public.cash_games WHERE id='$G' FOR $lock;
    UPDATE public.cash_games SET last_tick_at=now(), state='running' WHERE id='$G';
    SELECT pg_sleep(4); COMMIT;" >/dev/null &
  local tick=$!
  sleep 1
  local join wake share
  join=$("${PSQL[@]}" -c "SET lock_timeout='1s';
    INSERT INTO public.cash_game_waitlist(game_id,user_id,status) VALUES ('$G',gen_random_uuid(),'waiting');
    SELECT 'committed';" 2>&1 | outcome)
  wake=$("${PSQL[@]}" -c "BEGIN; SELECT CASE WHEN count(*)=0 THEN 'skipped' ELSE 'took the row' END
    FROM (SELECT 1 FROM public.cash_games WHERE id='$G' FOR NO KEY UPDATE SKIP LOCKED) s; COMMIT;" 2>&1 | outcome)
  share=$("${PSQL[@]}" -c "SET lock_timeout='500ms'; SELECT 'not blocked' FROM public.cash_games WHERE id='$G' FOR SHARE;" 2>&1 | outcome)
  wait "$tick"
  echo "$lock | join: ${join} | wake: ${wake} | share reader: ${share}"
}
before=$(case_for 'UPDATE'); after=$(case_for 'NO KEY UPDATE')
echo "before: $before"; echo "after:  $after"
grep -q 'join: .*lock timeout' <<<"$before" || { echo 'PROOF FAILED: the old lock did not block the join' >&2; exit 1; }
grep -q 'join: committed' <<<"$after" || { echo 'PROOF FAILED: the new lock still blocks the join' >&2; exit 1; }
grep -q 'wake: skipped' <<<"$after" || { echo 'PROOF FAILED: a wake no longer skips a held game' >&2; exit 1; }
grep -q 'share reader: .*lock timeout' <<<"$after" || { echo 'PROOF FAILED: a FOR SHARE reader is no longer excluded' >&2; exit 1; }
echo 'PROOF OK'

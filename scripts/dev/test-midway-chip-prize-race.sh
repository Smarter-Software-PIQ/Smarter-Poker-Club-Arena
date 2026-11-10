#!/usr/bin/env bash
# Run only in the disposable cluster created by test-accounting-delivery.
set -euo pipefail
fixture=${1:?private accounting fixture required}
pgbin=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
db=("$pgbin/psql" -XqAt -v ON_ERROR_STOP=1 -h "$fixture/socket" -p 55487 -U postgres -d "${2:-diamond_games_probe}")
[[ "$("${db[@]}" -c "SELECT count(*) FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current")" == 1 ]]
pay() {
  "${db[@]}" -v app="$1" -v key="$2" -v hold="$3" <<'SQL'
BEGIN;
SET LOCAL statement_timeout='12s';
-- The first test session holds the wallet for 2s. Contenders must have time to observe that lock, then commit.
SET LOCAL lock_timeout='10s';
SET LOCAL application_name=:'app';
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SELECT member_after FROM public.fn_diamond_game_pay_chips('wheel_prize','fade0000-0000-0000-0000-000000000001','union',
 'd1000000-0000-4000-8000-000000000059','d1000000-0000-4000-8000-000000000001',1.25,:'key','Concurrent Midway proof','{}');
SELECT pg_sleep(:'hold');
COMMIT;
SQL
}
pay midway_first midway-race-a 2 >"$fixture/midway-first.out" &
first=$!
for attempt in $(seq 1 80); do
  [[ "$("${db[@]}" -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='midway_first' AND wait_event='PgSleep'")" == 1 ]] && break
  sleep .02
done
pay midway_second midway-race-a 0 >"$fixture/midway-second.out" &
second=$!
pay midway_third midway-race-b 0 >"$fixture/midway-third.out" &
third=$!
blocked=0
for attempt in $(seq 1 80); do
  blocked=$("${db[@]}" -c "SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('midway_second','midway_third') AND cardinality(pg_blocking_pids(pid))>0")
  [[ "$blocked" == 2 ]] && break
  sleep .02
done
wait "$first"; wait "$second"; wait "$third"
[[ "$blocked" == 2 ]]
"${db[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT sum(amount) FROM public.wheel_midway_chip_funding WHERE prize_key IN ('midway-race-a','midway-race-b')) IS DISTINCT FROM 2.50
 OR (SELECT sum(amount) FROM public.ca_mint_ledger WHERE op_id IN ('midway-race-a:platform-issue','midway-race-b:platform-issue')) IS DISTINCT FROM 2.50
 OR (SELECT chip_balance FROM public.club_members WHERE club_id='d1000000-0000-4000-8000-000000000059' AND user_id='d1000000-0000-4000-8000-000000000001') IS DISTINCT FROM 19.75
 THEN RAISE EXCEPTION 'Concurrent Midway prize settlement or replay diverged'; END IF;
END $$;
SQL
echo 'PASS: simultaneous Midway prizes and a duplicate pay each distinct obligation exactly once'

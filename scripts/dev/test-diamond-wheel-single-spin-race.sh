#!/usr/bin/env bash
# The parent accounting fixture supplies its own private cluster and disposable database.
set -euo pipefail
pgbin=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
fixture=${1:?private accounting fixture directory required}
template=${2:-diamond_games_probe}
socket="$fixture/socket"
psql_base=("$pgbin/psql" -Xq -v ON_ERROR_STOP=1 -h "$socket" -p 55487 -U postgres)
fixture_identity=$("${psql_base[@]}" -At -d "$template" -c "SELECT count(*) FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current")
[[ "$fixture_identity" == 1 ]] || { echo 'Private accounting fixture required' >&2; exit 1; }
race_db="diamond_wheel_single_race_$$"
"$pgbin/createdb" -h "$socket" -p 55487 -U postgres -T "$template" "$race_db"
trap '"$pgbin/dropdb" -h "$socket" -p 55487 -U postgres "$race_db"' EXIT
db=("${psql_base[@]}" -d "$race_db")
"${db[@]}" <<'SQL'
DO $$
DECLARE
 player constant uuid:='d1000000-0000-4000-8000-000000000005'; club constant uuid:='d1000000-0000-4000-8000-000000000003';
 seed text; balance bigint; first_id constant uuid:='2248ea4c-7e77-443b-bbba-d4772e4ba108'; second_id constant uuid:='2248ea4c-7e77-443b-bbba-d4772e4ba109';
 receipt jsonb; chosen text;
BEGIN
 UPDATE public.wheel_configs SET enabled=true,min_seconds_between_spins=0,max_spins_per_player_per_day=1 WHERE host_id=club;
 INSERT INTO public.diamond_game_configs(host_id,host_kind,game,enabled,min_seconds_between_rounds,exposure_allowance_chips)
  SELECT club,'club',g,true,0,1 FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 INSERT INTO public.diamond_game_pools(host_id,game) SELECT club,g FROM unnest(ARRAY['plinko','crash','crossing','mines']) g ON CONFLICT DO NOTHING;
 UPDATE public.diamond_game_configs SET enabled=true,min_seconds_between_rounds=0,max_multiplier_cents=2000 WHERE host_id=club;
 UPDATE public.diamond_wheel_release SET enabled=true;
 PERFORM set_config('test.user',player::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 SELECT diamonds INTO STRICT balance FROM public.profiles WHERE id=player;
 FOR i IN 1..100 LOOP
  BEGIN
   seed:=encode(extensions.digest('wheel-race:'||i,'sha256'),'hex');
   INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
    VALUES(first_id,player,seed,encode(extensions.digest(seed,'sha256'),'hex'));
   SET LOCAL ROLE authenticated;
   receipt:=public.fn_wheel_spin_v2(club,first_id,'race-proof',balance,'paid',NULL);
   RESET ROLE;
   IF receipt->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'First spin refused: %',receipt; END IF;
   IF receipt#>>'{outcome,kind}'='chips' THEN chosen:=seed; END IF;
   RAISE EXCEPTION USING ERRCODE='P0098',MESSAGE='restore wallet before race';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
  END;
  EXIT WHEN chosen IS NOT NULL;
 END LOOP;
 IF chosen IS NULL THEN RAISE EXCEPTION 'Expected an immediate payout fixture'; END IF;
 INSERT INTO public.wheel_seed_commits(id,user_id,server_seed,server_seed_hash)
  SELECT t,player,chosen,encode(extensions.digest(chosen,'sha256'),'hex') FROM unnest(ARRAY[first_id,second_id]) t;
END $$;
SQL
amount=$("${db[@]}" -Atc "SELECT diamonds FROM public.profiles WHERE id='d1000000-0000-4000-8000-000000000005'")
run_spin() {
  local app=$1 ticket=$2 hold=$3
  "${db[@]}" -At -v amount="$amount" -v app="$app" -v ticket="$ticket" -v hold="$hold" <<'SQL'
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL application_name=:'app';
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.fn_wheel_spin_v2('d1000000-0000-4000-8000-000000000003',:'ticket','race-proof',:'amount','paid',NULL)->>'ok';
SELECT pg_sleep(:'hold');
COMMIT;
SQL
}
run_spin wheel_funded_first 2248ea4c-7e77-443b-bbba-d4772e4ba108 2 >"$fixture/wheel-first.out" &
first=$!
observed=0
for attempt in $(seq 1 70); do
 if [[ $("${db[@]}" -Atc "SELECT count(*) FROM pg_stat_activity WHERE application_name='wheel_funded_first' AND wait_event='PgSleep'") == 1 ]]; then observed=1; break; fi
 sleep .02
done
if [[ $observed != 1 ]]; then wait "$first"; echo 'First spin did not hold its transaction' >&2; exit 1; fi
run_spin wheel_funded_second 2248ea4c-7e77-443b-bbba-d4772e4ba109 0 >"$fixture/wheel-second.out" &
second=$!
blocked=0
for attempt in $(seq 1 70); do
 if [[ $("${db[@]}" -Atc "SELECT count(*) FROM pg_stat_activity a,pg_stat_activity b WHERE a.application_name='wheel_funded_first' AND b.application_name='wheel_funded_second' AND a.pid=ANY(pg_blocking_pids(b.pid))") == 1 ]]; then blocked=1; break; fi
 sleep .02
done
wait "$first"; wait "$second"
[[ $blocked == 1 ]] && grep -Fxq true "$fixture/wheel-first.out" && grep -Fxq false "$fixture/wheel-second.out" || { echo 'Concurrent full-wallet spin did not serialize and refuse the second charge' >&2; exit 1; }
"${db[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT diamonds FROM public.profiles WHERE id='d1000000-0000-4000-8000-000000000005') IS DISTINCT FROM 0
  OR (SELECT count(*) FROM public.wheel_spins WHERE commit_id IN ('2248ea4c-7e77-443b-bbba-d4772e4ba108','2248ea4c-7e77-443b-bbba-d4772e4ba109'))<>1
  OR (SELECT consumed_by FROM public.wheel_seed_commits WHERE id='2248ea4c-7e77-443b-bbba-d4772e4ba109') IS NOT NULL
 THEN RAISE EXCEPTION 'Concurrent balance, receipts or ticket ownership diverged'; END IF;
END $$;
SQL
echo 'PASS: concurrent full-wallet spins commit exactly one debit and leave zero diamonds'

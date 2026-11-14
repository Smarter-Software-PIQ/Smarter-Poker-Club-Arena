#!/usr/bin/env bash
# Native PG17 proof for 20261114190106_bust_money_path_timing_spans.sql.
# Scratch cluster only: applies the migration as written (stub tables stand in
# for the %ROWTYPE relations so both instrumented functions compile with
# check_function_bodies on) and proves the span helper is bounded and never
# raises. Nothing here touches production.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bin="${PG_BIN:-/usr/lib/postgresql/17/bin}"
work="$(mktemp -d)"; trap '"$bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
"$bin/initdb" -D "$work/data" -U postgres -A trust >/dev/null
"$bin/pg_ctl" -D "$work/data" -o "-k $work -p 55439 -c listen_addresses=''" -l "$work/log" start >/dev/null
psql=(psql -X -v ON_ERROR_STOP=1 -h "$work" -p 55439 -U postgres -d postgres -q)
"${psql[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private;
CREATE TABLE public.tournaments (id uuid);
CREATE TABLE public.tournament_players (id uuid);
CREATE TABLE public.tournament_knockout_candidates (id uuid);
CREATE TABLE public.hand_atomic_commits (id uuid);
CREATE TABLE public.table_seats (id uuid);
CREATE TABLE public.tournament_bounty_obligations (id uuid);
SET check_function_bodies = on;
SQL
"${psql[@]}" -f "$root/supabase/migrations/20261114190106_bust_money_path_timing_spans.sql"
"${psql[@]}" <<'SQL'
DO $proof$
DECLARE n bigint; t0 timestamptz := clock_timestamp() - interval '5 milliseconds';
BEGIN
  -- Both instrumented functions exist and compiled.
  PERFORM 'public.fn_claim_tournament_bounty_elimination(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamptz,uuid,jsonb,numeric,boolean)'::regprocedure;
  PERFORM 'public.fn_collect_bounty_obligation(uuid)'::regprocedure;
  -- Inside the window: one row, a non-negative duration.
  PERFORM smarter_private.fn_ca_bust_money_span('door','lane',gen_random_uuid(),t0);
  SELECT count(*) INTO n FROM smarter_private.ca_bust_money_spans WHERE ms >= 5;
  IF n <> 1 THEN RAISE EXCEPTION 'expected one span inside the window, got %', n; END IF;
  -- Window closed: nothing written.
  UPDATE smarter_private.ca_bust_money_span_control SET enabled_until = clock_timestamp() - interval '1 second';
  PERFORM smarter_private.fn_ca_bust_money_span('door','lane',gen_random_uuid(),t0);
  SELECT count(*) INTO n FROM smarter_private.ca_bust_money_spans;
  IF n <> 1 THEN RAISE EXCEPTION 'expired window still wrote (% rows)', n; END IF;
  -- Row cap reached: nothing written.
  UPDATE smarter_private.ca_bust_money_span_control SET enabled_until = clock_timestamp() + interval '1 hour', row_cap = 1;
  PERFORM smarter_private.fn_ca_bust_money_span('door','lane',gen_random_uuid(),t0);
  SELECT count(*) INTO n FROM smarter_private.ca_bust_money_spans;
  IF n <> 1 THEN RAISE EXCEPTION 'row cap exceeded (% rows)', n; END IF;
  -- FOUND after a span is TRUE (why the law test forbids a span before a FOUND read).
  PERFORM 1 WHERE false;
  PERFORM smarter_private.fn_ca_bust_money_span('door','lane',NULL,t0);
  IF NOT FOUND THEN RAISE EXCEPTION 'expected FOUND true after a span'; END IF;
  -- Grants restated exactly as production holds them.
  IF (SELECT proacl::text FROM pg_proc WHERE proname='fn_collect_bounty_obligation') <> '{postgres=X/postgres,service_role=X/postgres}'
     OR (SELECT proacl::text FROM pg_proc WHERE proname='fn_claim_tournament_bounty_elimination') <> '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'grants differ from production';
  END IF;
  RAISE NOTICE 'span helper bounded: window, cap, FOUND semantics proven';
END $proof$;
-- The helper never raises, even with its log gone.
DROP TABLE smarter_private.ca_bust_money_spans;
SELECT smarter_private.fn_ca_bust_money_span('payer','core',NULL,clock_timestamp());
DO $$ BEGIN RAISE NOTICE 'span helper with no log table returned without error'; END $$;
SQL
echo "bust money spans: native PG17 proof passed"

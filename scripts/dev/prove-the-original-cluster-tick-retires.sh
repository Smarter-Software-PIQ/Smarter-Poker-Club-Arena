#!/usr/bin/env bash
# Native proof for migration
# 20261123083628_the_original_cluster_tick_retires_and_readiness_reads_the_un.sql.
#
# Runs on a THROWAWAY local PostgreSQL cluster it creates and removes; it never
# connects to any other database.
#
# Proves:
#   1. Before the migration: dropping fn_cash_clusters_tick_all(jsonb) without
#      repointing breaks fn_lightning_rollout_readiness(uuid) with undefined_function,
#      and an anti-manipulation token in fn_cash_clusters_tick_all_uncapped(jsonb)
#      went unseen by the old readiness check.
#   2. Guard check: if another function still references fn_cash_cluster_tick(,
#      the migration refuses and rolls back cleanly.
#   3. After the migration (applied verbatim, including its @probe-for block):
#      - fn_cash_clusters_tick_all(jsonb) and fn_cash_cluster_tick(uuid,integer)
#        are dropped;
#      - fn_cash_clusters_tick_all_uncapped(jsonb) and
#        fn_cash_cluster_tick_uncapped(uuid,integer) remain intact;
#      - fn_lightning_rollout_readiness(uuid) succeeds with ok=true and
#        anti_manipulation=true;
#      - an anti-manipulation violation in fn_cash_clusters_tick_all_uncapped(jsonb)
#        is now caught (anti_manipulation=false).
#
# Usage: bash scripts/dev/prove-the-original-cluster-tick-retires.sh
#   (PG_BIN to override; defaults to /usr/lib/postgresql/16/bin)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
MIG="$ROOT/supabase/migrations/20261123083628_the_original_cluster_tick_retires_and_readiness_reads_the_un.sql"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/prove-retire-tick.XXXXXX")"
AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; AS=(runuser -u postgres --); fi
trap '"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

"${AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p 5547" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5547 -U postgres -d postgres)

"${PSQL[@]}" <<'SQL'
CREATE SCHEMA smarter_private;
CREATE SCHEMA auth;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

CREATE TABLE public.cash_games (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL
);
INSERT INTO public.cash_games (id, club_id)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

CREATE FUNCTION public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamptz,text,uuid,jsonb)
RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)
RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_lightning_match(uuid,timestamptz,uuid[],text,jsonb)
RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_lightning_match_plan(uuid,timestamptz,uuid[],text,integer,jsonb)
RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_lightning_match_and_form(uuid,timestamptz,uuid[],integer,uuid,jsonb)
RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;

CREATE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid, p_eligible_horses integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('ok', true); END$$;
CREATE FUNCTION public.fn_cash_clusters_tick_all(p_eligible jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('ok', true); END$$;

CREATE FUNCTION public.fn_cash_cluster_tick_uncapped(p_game_id uuid, p_eligible_horses integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('ok', true); END$$;
CREATE FUNCTION public.fn_cash_clusters_tick_all_uncapped(p_eligible jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN jsonb_build_object('ok', true); END$$;

CREATE FUNCTION public.fn_lightning_rollout_readiness(p_cluster_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  g       record;
  v_anti  boolean;
  v_strip text := '--[^' || chr(10) || ']*';
BEGIN
  SELECT cg.id, cg.club_id INTO g FROM public.cash_games cg WHERE cg.id = p_cluster_id;
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  END IF;
  IF g.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  v_anti := (SELECT coalesce(bool_and(regexp_replace(pg_get_functiondef(p.oid), v_strip, '', 'g')
                                      !~ 'integrity|shadow_comparison|quality_|latency|lightning_alert|fn_lightning_operator_'), false)
                    AND count(*) = 6
               FROM pg_proc p
              WHERE p.oid IN ('public.fn_lightning_form_hand(uuid,uuid[],smallint,smallint,uuid,interval,interval,timestamp with time zone,text,uuid,jsonb)'::regprocedure,
                              'public.fn_lightning_player_legality(uuid,timestamp with time zone,uuid[],jsonb)'::regprocedure,
                              'public.fn_lightning_match(uuid,timestamp with time zone,uuid[],text,jsonb)'::regprocedure,
                              'public.fn_lightning_match_plan(uuid,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure,
                              'public.fn_lightning_match_and_form(uuid,timestamp with time zone,uuid[],integer,uuid,jsonb)'::regprocedure,
                              'public.fn_cash_clusters_tick_all(jsonb)'::regprocedure));
  RETURN jsonb_build_object(
    'ok', true,
    'cluster_id', g.id,
    'evidence', jsonb_build_object('invariants', jsonb_build_object('anti_manipulation', v_anti))
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_lightning_rollout_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lightning_rollout_readiness(uuid) TO authenticated, service_role;
SQL

echo "before (dropping original without repointing breaks readiness):"
BEFORE_ERR="$("${PSQL[@]}" 2>&1 <<'SQL'
BEGIN;
DROP FUNCTION public.fn_cash_clusters_tick_all(jsonb);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
BEGIN
  PERFORM public.fn_lightning_rollout_readiness('11111111-1111-1111-1111-111111111111');
  RAISE EXCEPTION 'expected undefined_function';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'caught_expected_undefined_function';
END $$;
ROLLBACK;
SQL
)"
echo "$BEFORE_ERR" | grep -q 'caught_expected_undefined_function'
echo "  drop without repoint -> caught undefined_function (rolled back)"

echo "guard (a straggler caller blocks retirement and rolls back):"
"${PSQL[@]}" -c "CREATE FUNCTION public.fn_test_straggler() RETURNS jsonb LANGUAGE sql AS \$\$SELECT public.fn_cash_cluster_tick(gen_random_uuid(), 0)\$\$;"
if "${PSQL[@]}" -f "$MIG" >/dev/null 2>&1; then
  echo "ERROR: migration should have refused while fn_test_straggler referenced fn_cash_cluster_tick" >&2
  exit 1
fi
STILL_THERE="$("${PSQL[@]}" -c "SELECT to_regprocedure('public.fn_cash_cluster_tick(uuid,integer)') IS NOT NULL;")"
[ "$STILL_THERE" = "t" ]
"${PSQL[@]}" -c "DROP FUNCTION public.fn_test_straggler();"
echo "  straggler detected -> refused and rolled back cleanly"

echo "apply (migration verbatim including @probe-for):"
"${PSQL[@]}" -f "$MIG"

echo "after (verify dropped originals, live uncapped, and readiness anti-manipulation audit):"
AFTER="$("${PSQL[@]}" <<'SQL'
SELECT
  to_regprocedure('public.fn_cash_cluster_tick(uuid,integer)') IS NULL,
  to_regprocedure('public.fn_cash_clusters_tick_all(jsonb)') IS NULL,
  to_regprocedure('public.fn_cash_cluster_tick_uncapped(uuid,integer)') IS NOT NULL,
  to_regprocedure('public.fn_cash_clusters_tick_all_uncapped(jsonb)') IS NOT NULL;
SQL
)"
[ "$AFTER" = "t|t|t|t" ]

READINESS_OK="$("${PSQL[@]}" <<'SQL'
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL
   AND (public.fn_lightning_rollout_readiness('11111111-1111-1111-1111-111111111111') ->> 'ok')::boolean
   AND (public.fn_lightning_rollout_readiness('11111111-1111-1111-1111-111111111111') -> 'evidence' -> 'invariants' ->> 'anti_manipulation')::boolean;
SQL
)"
[ "$READINESS_OK" = "t" ]
echo "  originals dropped, uncapped intact, readiness ok=true anti_manipulation=true"

CAUGHT_VIOLATION="$("${PSQL[@]}" <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_cash_clusters_tick_all_uncapped(p_eligible jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE x text := 'lightning_alert'; BEGIN RETURN jsonb_build_object('ok', true, 'x', x); END$$;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL
   AND NOT (public.fn_lightning_rollout_readiness('11111111-1111-1111-1111-111111111111') -> 'evidence' -> 'invariants' ->> 'anti_manipulation')::boolean;
ROLLBACK;
SQL
)"
[ "$CAUGHT_VIOLATION" = "t" ]
echo "  anti-manipulation violation in uncapped tick -> caught (anti_manipulation=false)"

echo "PROOF OK"

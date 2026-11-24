#!/usr/bin/env bash
# Native PostgreSQL proof for the cluster tick's plan-source report
# (migration 20261124172239_the_cluster_tick_names_the_tables_it_planned_moves_from.sql). Runs on a THROWAWAY local PostgreSQL cluster
# it creates and removes; it never connects to any other database.
#
# A. EXACT PRODUCTION PRE-IMAGE: the live body of
#    fn_cash_cluster_tick_uncapped(uuid,integer), read with pg_get_functiondef
#    on 2026-11-24 (scripts/ci/fixtures/cluster-tick-source-table-ids/
#    production-preimage.sql), is installed and the real migration file is
#    applied to it. The body afterwards differs from the pre-image by exactly
#    three added lines and one changed line (diff below), owner/ACL/security/
#    search_path/volatility are unchanged, and a second apply is refused.
# B. BEHAVIOUR: a native model holding the same three anchors verbatim plans
#    must-moves from two feeders into one Main. Before the migration the
#    moves_planned action has NO source_table_ids (the defect); after it, the
#    key is a JSON array of uuid strings equal to the inserted rows'
#    from_table_id values, with one entry per planned move, and a tick that
#    plans nothing emits no moves_planned action at all.
set -euo pipefail
# postmaster refuses to start without a valid locale on macOS.
export LC_ALL="${LC_ALL:-C}"

if [[ -n "${PG_BIN:-}" ]]; then
  :
elif command -v initdb >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v initdb)")"
else
  for candidate in /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin /usr/lib/postgresql/15/bin /opt/homebrew/bin; do
    if [[ -x "$candidate/initdb" ]]; then PG_BIN="$candidate"; break; fi
  done
fi
if [[ -z "${PG_BIN:-}" || ! -x "$PG_BIN/initdb" ]]; then
  echo "initdb not found; set PG_BIN" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261124172239_the_cluster_tick_names_the_tables_it_planned_moves_from.sql"
PRE="$ROOT/scripts/ci/fixtures/cluster-tick-source-table-ids/production-preimage.sql"
WORK="$(mktemp -d)"
PORT=$((5550 + ($$ % 400)))
trap '"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

"$PG_BIN/initdb" -D "$WORK/data" -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-c listen_addresses='' -k $WORK -p $PORT" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT")

# ── A. the exact production pre-image ──────────────────────────────────────
"$PG_BIN/createdb" -h "$WORK" -p "$PORT" exact
"${PSQL[@]}" -d exact <<'SQL'
CREATE ROLE service_role NOLOGIN;
CREATE TYPE public.cash_cluster_census_row AS (id uuid);
-- The probe in the migration calls the tick; a frozen platform returns at once.
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT true';
SQL
{ cat "$PRE"; printf '\n;\n'; } | "${PSQL[@]}" -d exact
"${PSQL[@]}" -d exact <<'SQL'
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick_uncapped(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick_uncapped(uuid,integer) TO service_role;
SQL
DEF="SELECT pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure)"
AUTH="SELECT proowner::text||'|'||coalesce(proacl::text,'')||'|'||coalesce(proconfig::text,'')||'|'||prosecdef::text||'|'||provolatile::text FROM pg_proc WHERE oid='public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure"
"${PSQL[@]}" -d exact -c "$DEF" > "$WORK/before.sql"
cmp -s "$WORK/before.sql" <(cat "$PRE"; echo) || cmp -s "$WORK/before.sql" "$PRE" \
  || { echo "installed pre-image differs from the production fixture" >&2; diff "$PRE" "$WORK/before.sql" | head -20 >&2; exit 1; }
auth_before=$("${PSQL[@]}" -d exact -c "$AUTH")
"${PSQL[@]}" -d exact -f "$MIG"
"${PSQL[@]}" -d exact -c "$DEF" > "$WORK/after.sql"
auth_after=$("${PSQL[@]}" -d exact -c "$AUTH")
[[ "$auth_before" == "$auth_after" ]] || { echo "authority changed: $auth_before -> $auth_after" >&2; exit 1; }
diff "$WORK/before.sql" "$WORK/after.sql" > "$WORK/body.diff" || true
sed 's/^/  /' "$WORK/body.diff"
removed=$(grep -c '^<' "$WORK/body.diff" || true)
added=$(grep -c '^>' "$WORK/body.diff" || true)
[[ "$removed" == "1" && "$added" == "3" ]] \
  || { echo "expected 1 changed line and 2 added lines (diff: -1 +3), got -$removed +$added" >&2; exit 1; }
grep -q "^>   v_move_sources uuid\[\] := '{}'::uuid\[\];$" "$WORK/body.diff"
grep -q "^>       v_move_sources := v_move_sources || r.table_id;$" "$WORK/body.diff"
grep -qF ">   IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves, 'source_table_ids', to_jsonb(v_move_sources)); END IF;" "$WORK/body.diff"
echo "exact_preimage_md5_before=$(md5 -q "$WORK/before.sql" 2>/dev/null || md5sum "$WORK/before.sql" | cut -d' ' -f1)"
echo "exact_preimage_md5_after=$(md5 -q "$WORK/after.sql" 2>/dev/null || md5sum "$WORK/after.sql" | cut -d' ' -f1)"
if "${PSQL[@]}" -d exact -f "$MIG" >/dev/null 2>&1; then
  echo "a second apply should have been refused" >&2; exit 1
fi
echo "exact_production_preimage_only_this_change=ok"

# ── B. behaviour ───────────────────────────────────────────────────────────
"$PG_BIN/createdb" -h "$WORK" -p "$PORT" model
"${PSQL[@]}" -d model <<'SQL'
-- service_role is cluster-wide: created with database "exact" above.
CREATE TABLE public.cash_seat_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL, player_id uuid NOT NULL,
  from_table_id uuid NOT NULL, to_table_id uuid NOT NULL, reason text NOT NULL
);
CREATE TABLE public.model_plan (game_id uuid, user_id uuid, table_id uuid, to_id uuid);
-- The pre-image's DECLARE line, Step 2 must_move insert/increment and the sole
-- moves_planned emission, verbatim, followed (as in production) by a later
-- increment that is never emitted.
CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick_uncapped(p_game_id uuid, p_eligible_horses integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record; t record; r record;
  v_actions jsonb := '[]'::jsonb;
  v_moves integer := 0;
BEGIN
  SELECT p_game_id AS id INTO g;
  FOR t IN SELECT DISTINCT mp.to_id AS id FROM public.model_plan mp WHERE mp.game_id = g.id ORDER BY 1 LOOP
    FOR r IN SELECT mp.user_id, mp.table_id FROM public.model_plan mp WHERE mp.game_id = g.id AND mp.to_id = t.id ORDER BY mp.user_id LOOP
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_moves := v_moves + 1;
    END LOOP;
  END LOOP;
  IF v_moves > 0 THEN v_actions := v_actions || jsonb_build_object('moves_planned', v_moves); END IF;
  -- a later plan (balance/break in production) increments after the emission
  IF v_moves > 0 THEN v_moves := v_moves + 1; END IF;
  RETURN jsonb_build_object('ok', true, 'game_id', g.id, 'actions', v_actions);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick_uncapped(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick_uncapped(uuid,integer) TO service_role;
CREATE FUNCTION public.model_seed(p_game uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.cash_seat_moves; DELETE FROM public.model_plan;
  INSERT INTO public.model_plan VALUES
    (p_game, '00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000002'),
    (p_game, '00000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000002'),
    (p_game, '00000000-0000-4000-8000-0000000000a3', '33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000002');
$$;
-- The contract: a moves_planned action carries source_table_ids equal to the
-- from_table_id of exactly the rows this tick inserted, one per move.
CREATE FUNCTION public.model_contract(p_game uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb; a jsonb; got text[]; want text[];
BEGIN
  PERFORM public.model_seed(p_game);
  v := public.fn_cash_cluster_tick_uncapped(p_game, 0);
  SELECT x INTO a FROM jsonb_array_elements(v->'actions') x WHERE x ? 'moves_planned';
  IF a IS NULL THEN RETURN 'no_moves_planned_action'; END IF;
  IF NOT a ? 'source_table_ids' THEN RETURN 'source_table_ids_missing'; END IF;
  IF jsonb_typeof(a->'source_table_ids') <> 'array' THEN RETURN 'source_table_ids_not_array'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(a->'source_table_ids') e WHERE jsonb_typeof(e) <> 'string') THEN
    RETURN 'source_table_ids_not_strings';
  END IF;
  IF jsonb_array_length(a->'source_table_ids') <> (a->>'moves_planned')::int THEN RETURN 'length_differs_from_moves_planned'; END IF;
  SELECT array_agg(e ORDER BY e) INTO got FROM jsonb_array_elements_text(a->'source_table_ids') e;
  SELECT array_agg(m.from_table_id::text ORDER BY m.from_table_id::text) INTO want
    FROM public.cash_seat_moves m WHERE m.game_id = p_game;
  IF got IS DISTINCT FROM want THEN RETURN 'sources_differ_from_inserted_rows'; END IF;
  RETURN 'ok:' || (a->>'moves_planned');
END $$;
SQL
G="'00000000-0000-4000-8000-0000000000f1'"
before=$("${PSQL[@]}" -d model -c "SELECT public.model_contract($G)")
echo "contract_before=$before"
[[ "$before" == "source_table_ids_missing" ]] || { echo "expected the defect before the migration, got $before" >&2; exit 1; }
# The model has no fn_platform_frozen and its probe reads model tables only.
"${PSQL[@]}" -d model -f "$MIG"
after=$("${PSQL[@]}" -d model -c "SELECT public.model_contract($G)")
echo "contract_after=$after"
[[ "$after" == "ok:3" ]] || { echo "expected ok:3 after the migration, got $after" >&2; exit 1; }
idle=$("${PSQL[@]}" -d model -c "DELETE FROM public.model_plan; DELETE FROM public.cash_seat_moves; SELECT public.fn_cash_cluster_tick_uncapped($G, 0)->'actions';")
[[ "$idle" == "[]" ]] || { echo "a tick that plans nothing must emit no moves_planned action, got $idle" >&2; exit 1; }
echo "source_table_ids_match_inserted_rows=ok"
echo "PROOF OK"

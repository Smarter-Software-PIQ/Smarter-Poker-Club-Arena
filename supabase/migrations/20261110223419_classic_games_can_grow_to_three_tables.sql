-- Version reserved by scripts/new-migration.mjs.
-- November 10 owner direction: varied Classic games run two or three tables.
-- Keep the existing second-table selection and all opening/admission checks.
-- A stable subset may open a third; Lightning capacity is unchanged.
-- Compatible with the previous engine: it can keep serving its existing tables
-- while the successor expands Horse admission to the new secondary allowance.
-- @live-proof: (to_regprocedure('public.fn_cash_game_third_table_picked(uuid,timestamptz)') IS NOT NULL AND position('fn_cash_game_third_table_picked(g.id, v_now)' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_cash_game_third_table_picked(p_game_id uuid, p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT public.fn_cash_game_second_table_picked(p_game_id, p_at)
     AND (('x' || lpad(substr(md5(p_game_id::text || ':third_table:'
           || floor(extract(epoch FROM p_at) / 10800)::bigint::text), 1, 8), 16, '0'))::bit(64)::bigint % 100) < 40
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_game_third_table_picked(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_game_third_table_picked(uuid, timestamptz) TO authenticated, service_role;

DO $patch$
DECLARE original text; patched text;
  anchor text := $anchor$  IF v_plo_lifecycle THEN v_table_cap := greatest(v_table_cap, 2); END IF;$anchor$;
BEGIN
  SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
  IF (length(original) - length(replace(original, anchor, ''))) / length(anchor) <> 1
     OR position('fn_cash_game_third_table_picked(g.id, v_now)' IN original) > 0 THEN
    RAISE EXCEPTION 'classic_third_table_capacity_preimage_changed' USING ERRCODE = '55000';
  END IF;
  patched := replace(original, anchor, $insert$  -- Classic demand may grow to THREE tables; Lightning retains its own controller.
  IF NOT coalesce(g.lightning_enabled, false)
     AND public.fn_cash_game_third_table_picked(g.id, v_now) THEN
    v_table_cap := greatest(v_table_cap, 3);
  END IF;
  IF v_plo_lifecycle THEN v_table_cap := greatest(v_table_cap, 2); END IF;$insert$);
  EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;
COMMIT;

-- 20261105020906_a_null_max_buy_in_is_uncapped_in_the_pending_addon_resolver.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A NULL MAX BUY-IN IS UNCAPPED IN THE PENDING ADD-ON RESOLVER
--
-- PR #9450 made the engine's getMaxBuyIn() return NULL for fixed-limit
-- variants (flh/flo8): a fixed-limit cash table has no top-up cap. The
-- pre-deal sweep in server/src/engine/ServerTableEngineSeating.ts passes that
-- NULL straight into fn_ca_resolve_unbound_pending_addons(p_table_id,
-- p_max_buy_in, p_instance_id, p_lease_generation), whose first guard read
--
--     OR p_max_buy_in IS NULL OR p_max_buy_in <= 0
--
-- and answered {ok:false, reason:'invalid_request'}. The engine treats a
-- refused exact resolver as unreachable and kills the table for restart
-- (pending_addon_exact_refused), so since 02:02 UTC on 2026-11-05 every
-- fixed-limit cash table (nine of them, each with seated players) has been in
-- a start -> refuse -> kill loop and has dealt nothing; engine_recovery_events
-- recorded about one watchdog_kill_rebuild per second with that detail.
--
-- The inner function public.resolve_pending_addon(p_pending_id, p_max_buy_in
-- DEFAULT NULL) already treats NULL as "no cap". This migration makes the
-- outer function agree: the guard becomes
--
--     OR (p_max_buy_in IS NOT NULL AND p_max_buy_in <= 0)
--
-- so NULL means uncapped and a zero or negative cap is still refused. Nothing
-- else in the body changes: same locks, same lease proof, same frozen-envelope
-- exclusion, same SECURITY DEFINER, search_path, owner and ACL
-- ({postgres=X/postgres,service_role=X/postgres}). The preimage guard below
-- pins the exact definition this replaces (md5 3b69f7d3d104ff1c612df0581ca05493)
-- so the file refuses to run against a body it has not read.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- @live-proof: position('(p_max_buy_in IS NOT NULL AND p_max_buy_in <= 0)' in pg_get_functiondef('public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)'::regprocedure)) > 0 AND position('OR p_max_buy_in IS NULL' in pg_get_functiondef('public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)'::regprocedure)) = 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $pre$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)'::regprocedure
       AND md5(pg_get_functiondef(p.oid)) = '3b69f7d3d104ff1c612df0581ca05493'
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig = ARRAY['search_path=public, extensions, pg_temp']
       AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'PENDING_ADDON_RESOLVER_PREIMAGE_DRIFT';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_resolve_unbound_pending_addons(p_table_id uuid, p_max_buy_in numeric, p_instance_id text, p_lease_generation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_holder text;
  v_generation uuid;
  v_protocol integer;
  v_heartbeat timestamptz;
  v_tournament_id uuid;
  v_addon public.table_pending_addons%ROWTYPE;
  v_resolution record;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  /* A NULL cap is "uncapped" (fixed-limit tables have no top-up ceiling), the
     same reading public.resolve_pending_addon gives its DEFAULT NULL. Only a
     zero or negative cap is an invalid request. */
  IF p_table_id IS NULL
     OR (p_max_buy_in IS NOT NULL AND p_max_buy_in <= 0)
     OR length(btrim(COALESCE(p_instance_id, ''))) = 0
     OR p_lease_generation IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  /* One lock vocabulary with the durable hand processor. Take it first on
     both paths so two pending-row consumers cannot form a reverse lock order
     through resolve_pending_addon's seat lock. */
  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-post-commit:' || p_table_id::text, 0)
  );

  SELECT l.instance_id, l.lease_generation, l.protocol_version, l.heartbeat_at
    INTO v_holder, v_generation, v_protocol, v_heartbeat
    FROM public.engine_table_leases l
   WHERE l.table_id = p_table_id
   FOR KEY SHARE;
  IF NOT FOUND
     OR v_protocol IS DISTINCT FROM 2
     OR v_holder IS DISTINCT FROM p_instance_id
     OR v_generation IS DISTINCT FROM p_lease_generation
     OR v_heartbeat < clock_timestamp() - make_interval(
          secs => public.fn_engine_lease_stale_seconds()
        ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'lease_lost',
      'lease_generation', v_generation
    );
  END IF;

  /* Exact hand settlement takes lease -> table as well. Holding this row
     through selection and delivery makes "not frozen" a stable statement. */
  SELECT t.tournament_id INTO v_tournament_id
    FROM public.tables t
   WHERE t.id = p_table_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_not_found');
  END IF;
  IF v_tournament_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cash_table_required');
  END IF;

  FOR v_addon IN
    SELECT a.*
      FROM public.table_pending_addons a
     WHERE a.table_id = p_table_id
       AND a.resolved_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.hand_atomic_commits c
          WHERE c.table_id = p_table_id
            AND jsonb_typeof(
                  c.post_commit_payload #> '{pending_addons,ids}'
                ) = 'array'
            AND (c.post_commit_payload #> '{pending_addons,ids}') ? a.id::text
       )
     ORDER BY a.created_at, a.id
     FOR UPDATE
  LOOP
    SELECT * INTO STRICT v_resolution
      FROM public.resolve_pending_addon(v_addon.id, p_max_buy_in);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_addon.id,
      'user_id', v_addon.user_id,
      'kind', COALESCE(v_addon.kind, 'addon'),
      'applied', COALESCE(v_resolution.applied, 0),
      'refunded', COALESCE(v_resolution.refunded, 0)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'table_id', p_table_id,
    'lease_generation', p_lease_generation,
    'resolved', jsonb_array_length(v_rows),
    'rows', v_rows
  );
END;
$function$;

-- CREATE OR REPLACE keeps the owner and ACL; restate them so the proof below
-- is a statement about this file and not about what happened to be there.
REVOKE ALL ON FUNCTION public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid) TO service_role;

DO $post$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.oid = 'public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)'::regprocedure
     AND p.proowner = 'postgres'::regrole
     AND p.prosecdef
     AND p.proconfig = ARRAY['search_path=public, extensions, pg_temp']
     AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}';
  IF v_def IS NULL
     OR position('(p_max_buy_in IS NOT NULL AND p_max_buy_in <= 0)' in v_def) = 0
     OR position('OR p_max_buy_in IS NULL' in v_def) > 0
     OR position('public.resolve_pending_addon(v_addon.id, p_max_buy_in)' in v_def) = 0 THEN
    RAISE EXCEPTION 'PENDING_ADDON_RESOLVER_POSTIMAGE_DRIFT';
  END IF;
END $post$;

COMMIT;

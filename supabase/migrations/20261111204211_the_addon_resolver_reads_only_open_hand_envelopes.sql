-- 20261111204211_the_addon_resolver_reads_only_open_hand_envelopes
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11.
--
-- THE ADD-ON RESOLVER READS ONLY OPEN HAND ENVELOPES (2026-11-11).
--
-- WHAT WAS WRONG (proven live). fn_ca_resolve_unbound_pending_addons excludes
-- add-ons frozen into an accepted hand's obligation envelope with a NOT EXISTS
-- over hand_atomic_commits restricted only by table_id, so it read and
-- detoasted the post_commit_payload of EVERY commit the table ever had
-- (6.66 M rows / 59 GB in total). On table 0183f083 (PLO4 1/2 Lightning
-- Games, 160,470 commits) each call ran past the 8 s statement timeout; the
-- engine retries once and then kills the table (pending_addon_exact_unreachable):
-- 135 kill/restart cycles 18:05-18:50Z 2026-11-11 with 0 hands dealt, two
-- rebuys created 15:01/15:03Z unresolved until 18:50:33Z, and the table's
-- hand-post-commit lock and tables row held for each 8 s attempt (a must-move
-- into 0183f083 from feeder 90fd4b45 completed 97 ms after the second timeout,
-- 18:38:18.215 -> .312, making that feeder's next hand 22.8 s late).
--
-- WHAT THIS CHANGES. One predicate inside that NOT EXISTS:
--   AND c.post_commit_payload IS NOT NULL AND c.post_commit_completed_at IS NULL
-- so it is answered from idx_hand_atomic_commits_post_commit_pending
-- (table_id, hand_number) WHERE payload IS NOT NULL AND completed IS NULL.
-- Same call on 0183f083: >25 s -> 0.1 ms, 2 buffers. Every other byte is the
-- live body (pg_get_functiondef md5 763f593d..., captured in
-- scripts/ci/probes/addon-resolver-bound/live-predecessor.sql); owner, ACL,
-- proconfig and SECURITY DEFINER unchanged; resolve_pending_addon untouched.
--
-- WHY THE SELECTED ADD-ONS ARE EXACTLY THE SAME. The outer query only ever
-- considers rows with resolved_at IS NULL. post_commit_completed_at has ONE
-- writer, fn_ca_process_hand_post_commit_obligations, which in the same
-- transaction calls resolve_pending_addon on every id frozen in that envelope
-- and raises on any incomplete receipt; nothing ever sets resolved_at back to
-- NULL. So an unresolved add-on can be frozen only in an envelope whose
-- post-commit has not completed, and a commit with a NULL payload never
-- matched (jsonb_typeof(NULL) is not 'array'). Excluding completed or
-- payload-less commits therefore excludes nothing the old query could match.
-- Live readback before this change: 0 of the 23 unresolved add-ons are frozen
-- in a completed envelope. Recipients, amounts, ordering (created_at, id), the
-- hand-post-commit mutex, the lease check, the tables row lock, FOR UPDATE on
-- the add-on rows and exactly-once delivery by resolve_pending_addon are all
-- unchanged.
--
-- Function body only; no table is locked. An ordinary install.
-- Native proof: scripts/ci/test-addon-resolver-bound.py (PostgreSQL 17).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)');
  v_def text;
  v_old text := $f$          WHERE c.table_id = p_table_id
            AND jsonb_typeof(
$f$;
  v_new text := $f$          WHERE c.table_id = p_table_id
            AND c.post_commit_payload IS NOT NULL
            AND c.post_commit_completed_at IS NULL
            AND jsonb_typeof(
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'fn_ca_resolve_unbound_pending_addons is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> '763f593d8a9cf7739150d3a65cebd1c7' AND md5(replace(v_def, v_new, v_old)) <> '763f593d8a9cf7739150d3a65cebd1c7' THEN
    RAISE EXCEPTION 'fn_ca_resolve_unbound_pending_addons is not the pinned text (md5 %)', md5(v_def);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{"search_path=public, extensions, pg_temp"}') THEN
    RAISE EXCEPTION 'fn_ca_resolve_unbound_pending_addons authority changed';
  END IF;
END $m$;

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
            AND c.post_commit_payload IS NOT NULL
            AND c.post_commit_completed_at IS NULL
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

-- Restated, unchanged: CREATE OR REPLACE keeps the existing grants, and the
-- postflight below proves the ACL is exactly what it was.
REVOKE ALL ON FUNCTION public.fn_ca_resolve_unbound_pending_addons(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_resolve_unbound_pending_addons(uuid, numeric, text, uuid) TO service_role;

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)');
  v_def text := pg_get_functiondef(to_regprocedure('public.fn_ca_resolve_unbound_pending_addons(uuid,numeric,text,uuid)'));
  v_old text := $f$          WHERE c.table_id = p_table_id
            AND jsonb_typeof(
$f$;
  v_new text := $f$          WHERE c.table_id = p_table_id
            AND c.post_commit_payload IS NOT NULL
            AND c.post_commit_completed_at IS NULL
            AND jsonb_typeof(
$f$;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1
     OR position(v_old IN v_def) <> 0
     OR md5(replace(v_def, v_new, v_old)) <> '763f593d8a9cf7739150d3a65cebd1c7' THEN
    RAISE EXCEPTION 'fn_ca_resolve_unbound_pending_addons: the change is not exactly the bounded envelope predicate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{"search_path=public, extensions, pg_temp"}') THEN
    RAISE EXCEPTION 'fn_ca_resolve_unbound_pending_addons authority changed';
  END IF;
END $m$;

COMMIT;

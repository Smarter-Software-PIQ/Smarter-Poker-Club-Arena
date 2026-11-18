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
$function$

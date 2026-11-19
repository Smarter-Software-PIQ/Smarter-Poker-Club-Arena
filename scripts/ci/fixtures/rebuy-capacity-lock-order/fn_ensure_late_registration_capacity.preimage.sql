CREATE OR REPLACE FUNCTION public.fn_ensure_late_registration_capacity(p_tournament_id uuid, p_reserved_entries integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_table_id uuid;
  v_table_number integer;
  v_level jsonb;
  v_variant text;
  v_format text;
  v_cap integer;
  v_sb numeric;
  v_bb numeric;
  v_ante numeric;
  v_active_entries bigint;
  v_live_capacity bigint;
  v_occupied_seats bigint;
  v_open_seats bigint;
  v_unseated_entries bigint;
  v_required_open_seats bigint;
  v_pending_table_ids jsonb := '[]'::jsonb;
  v_pending_table_count bigint := 0;
  v_wake_id bigint;
BEGIN
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  IF p_reserved_entries NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'Capacity reservation must be zero or one'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE='P0002';
  END IF;
  IF v_t.status<>'RUNNING' THEN
    RETURN jsonb_build_object(
      'ok',true,'created',false,'reason','tournament_not_running');
  END IF;
  -- Only a new reservation needs an open entry window. An already accepted
  -- `registered`/`playing` entrant remains owed a seat after the clock or
  -- field cap closes; p_reserved_entries=0 lets the manager satisfy that
  -- durable demand without reopening registration.
  IF p_reserved_entries>0
     AND NOT public.fn_tournament_late_registration_open(p_tournament_id) THEN
    RETURN jsonb_build_object(
      'ok',true,'created',false,'reason','entry_window_closed');
  END IF;

  v_variant := lower(COALESCE(NULLIF(v_t.game_type,''),'nlh'));
  v_format := public.fn_ca_tournament_recorded_format(p_tournament_id);
  v_cap := CASE
    WHEN v_format='spin-v1'
      -- createTablesAndSeatPlayers and the Spin contract both own a
      -- three-handed table. `tournaments.max_players` is the field cap, not a
      -- second per-table Spin setting, so letting a stale value of 1 or 2
      -- shrink only an expansion table would split one event across two
      -- incompatible table contracts.
      THEN 3
    WHEN v_format='seat-first-satellite-v1' THEN 2
    WHEN v_format='sng-v1'
      THEN LEAST(COALESCE(NULLIF(v_t.max_players,0),6),9)
    ELSE LEAST(COALESCE(NULLIF(v_t.table_size,0),9),10)
  END;
  -- Tournament tables need one board only. This mirrors VariantRules.maxSeatsFor:
  -- floor((deck - 5 board cards) / hole cards), then the product's 10-seat cap.
  v_cap := LEAST(v_cap,CASE v_variant
    WHEN 'plo5' THEN 9
    WHEN 'plo6' THEN 7
    ELSE 10
  END);
  v_cap := GREATEST(v_cap,2);

  -- This is the re-check that closes the race. `registered` is included
  -- because a paid entrant is real demand before the manager promotes them to
  -- `playing`; registration itself contributes one reservation because its
  -- failed first attempt was rolled back before it reached this function.
  SELECT count(*) INTO v_active_entries
    FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status IN ('registered','playing');

  -- Sum the legal chairs AND the rows currently occupying those chairs. A
  -- nominal nine-seat table is not nine seats of usable capacity when a stale
  -- eliminated/closed-generation row still physically owns one of them. The
  -- old table-count multiplication could therefore strand a paid entrant
  -- forever while insisting capacity was sufficient.
  WITH live_tables AS (
    SELECT tb.id,
           LEAST(v_cap,GREATEST(2,COALESCE(NULLIF(tb.max_players,0),v_cap)))
             AS capacity
      FROM public.tables tb
     WHERE tb.tournament_id=p_tournament_id
       AND tb.status IN ('running','waiting','active')
       AND COALESCE(tb.is_deleted,false)=false
       AND NOT EXISTS (SELECT 1 FROM smarter_private.f06_operations o
                      WHERE o.source_table_id = tb.id
                        AND o.state NOT IN ('acknowledged', 'withdrawn_before_manifest'))
  ), occupancy AS (
    SELECT lt.id,lt.capacity,
           count(s.id) FILTER (
             WHERE s.seat_number BETWEEN 1 AND lt.capacity
           ) AS occupied
      FROM live_tables lt
      LEFT JOIN public.table_seats s
        ON s.table_id=lt.id AND s.left_at IS NULL
     GROUP BY lt.id,lt.capacity
  )
  SELECT COALESCE(sum(o.capacity),0),COALESCE(sum(o.occupied),0)
    INTO v_live_capacity,v_occupied_seats
    FROM occupancy o;
  v_open_seats := GREATEST(v_live_capacity-v_occupied_seats,0);

  -- Demand means an accepted active entry that does not already own a usable
  -- live chair. Count by entrant, not by seat row, so a duplicate-seat defect
  -- cannot make the field look larger and trigger another duplicate table.
  SELECT count(*) INTO v_unseated_entries
    FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.status IN ('registered','playing')
     AND NOT EXISTS (
       SELECT 1
         FROM public.table_seats s
         JOIN public.tables tb ON tb.id=s.table_id
        WHERE tb.tournament_id=p_tournament_id
          AND tb.status IN ('running','waiting','active')
          AND COALESCE(tb.is_deleted,false)=false
          AND s.user_id=tp.user_id
          AND s.left_at IS NULL
          AND s.seat_number BETWEEN 1 AND
              LEAST(v_cap,GREATEST(2,COALESCE(NULLIF(tb.max_players,0),v_cap)))
     );
  v_required_open_seats := v_unseated_entries+p_reserved_entries;

  IF v_required_open_seats<=v_open_seats THEN
    -- If an older manager consumed the wake but crashed before admitting the
    -- table, recreate the level-triggered signal. Never increment a wake that
    -- is still pending: its exact generation already represents this work.
    IF EXISTS (
      SELECT 1 FROM public.tournament_capacity_table_receipts r
       WHERE r.tournament_id=p_tournament_id AND r.manager_admitted_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.tournament_manager_wakes w
       WHERE w.tournament_id=p_tournament_id
         AND w.reason='late_registration' AND w.consumed_at IS NULL
    ) THEN
      v_wake_id := public.fn_emit_tournament_manager_wake(
        p_tournament_id,'late_registration');
      UPDATE public.tournament_capacity_table_receipts
         SET manager_wake_id=v_wake_id,updated_at=clock_timestamp()
       WHERE tournament_id=p_tournament_id AND manager_admitted_at IS NULL;
    END IF;
    SELECT COALESCE(jsonb_agg(p.table_id ORDER BY p.created_at,p.table_id),'[]'::jsonb),
           COALESCE(max(p.pending_count),0)
      INTO v_pending_table_ids,v_pending_table_count
      FROM (
        SELECT r.table_id,r.created_at,count(*) OVER () AS pending_count
          FROM public.tournament_capacity_table_receipts r
         WHERE r.tournament_id=p_tournament_id AND r.manager_admitted_at IS NULL
         ORDER BY r.created_at,r.table_id
         LIMIT 20
      ) p;
    RETURN jsonb_build_object(
      'ok',true,
      'created',false,
      'reason','capacity_sufficient',
      'active_entries',v_active_entries,
      'unseated_entries',v_unseated_entries,
      'reserved_entries',p_reserved_entries,
      'live_capacity',v_live_capacity,
      'occupied_seats',v_occupied_seats,
      'open_seats',v_open_seats,
      'pending_table_ids',v_pending_table_ids,
      'pending_table_count',v_pending_table_count,
      'remaining_deficit',0
    );
  END IF;

  v_level := public.fn_tournament_current_blinds(p_tournament_id);
  v_sb := (v_level->>'small_blind')::numeric;
  v_bb := (v_level->>'big_blind')::numeric;
  v_ante := (v_level->>'ante')::numeric;
  IF v_sb IS NULL OR v_bb IS NULL OR v_sb<0 OR v_bb<=0 OR v_ante<0 OR v_sb>v_bb THEN
    RAISE EXCEPTION 'Tournament current blind level is invalid' USING ERRCODE='55000';
  END IF;

  SELECT count(*)+1 INTO v_table_number
    FROM public.tables tb WHERE tb.tournament_id=p_tournament_id;
  INSERT INTO public.tables(
    club_id,tournament_id,name,game_type,game_variant,stakes,
    small_blind,big_blind,ante,min_buy_in,max_buy_in,max_players,
    current_players,status,action_time_seconds,
    big_blind_ante_enabled,all_in_or_fold,allow_rabbit_hunt
  ) VALUES (
    v_t.club_id,p_tournament_id,
    COALESCE(v_t.name,'Tournament')||' - Table '||v_table_number,
    'tournament',v_variant,v_sb::text||'/'||v_bb::text,
    v_sb,v_bb,v_ante,0,0,v_cap,0,'running',
    LEAST(120,GREATEST(10,COALESCE(v_t.action_time_seconds,15))),
    COALESCE(v_t.big_blind_ante,false),COALESCE(v_t.all_in_or_fold,false),
    COALESCE(v_t.allow_rabbit_hunt,true)
  ) RETURNING id INTO v_table_id;
  -- The manager wake is emitted before the receipt, but both are inside this
  -- transaction. Any failure below rolls the table and wake back together.
  v_wake_id := public.fn_emit_tournament_manager_wake(
    p_tournament_id,'late_registration');
  INSERT INTO public.tournament_capacity_table_receipts(
    table_id,tournament_id,manager_wake_id
  ) VALUES (v_table_id,p_tournament_id,v_wake_id);
  -- All still-unadmitted tables are now represented by the newest generation
  -- of the one level-triggered wake for this tournament/reason.
  UPDATE public.tournament_capacity_table_receipts
     SET manager_wake_id=v_wake_id,updated_at=clock_timestamp()
   WHERE tournament_id=p_tournament_id AND manager_admitted_at IS NULL;
  SELECT COALESCE(jsonb_agg(
           p.table_id ORDER BY p.current_created DESC,p.created_at,p.table_id
         ),'[]'::jsonb),
         COALESCE(max(p.pending_count),0)
    INTO v_pending_table_ids,v_pending_table_count
    FROM (
      SELECT r.table_id,r.created_at,r.table_id=v_table_id AS current_created,
             count(*) OVER () AS pending_count
        FROM public.tournament_capacity_table_receipts r
       WHERE r.tournament_id=p_tournament_id AND r.manager_admitted_at IS NULL
       ORDER BY (r.table_id=v_table_id) DESC,r.created_at,r.table_id
       LIMIT 20
    ) p;
  RETURN jsonb_build_object(
    'ok',true,
    'created',true,
    'table_id',v_table_id,
    'table_number',v_table_number,
    'table_capacity',v_cap,
    'active_entries',v_active_entries,
    'unseated_entries',v_unseated_entries,
    'reserved_entries',p_reserved_entries,
    'live_capacity_before',v_live_capacity,
    'live_capacity_after',v_live_capacity+v_cap,
    'occupied_seats',v_occupied_seats,
    'open_seats_before',v_open_seats,
    'open_seats_after',v_open_seats+v_cap,
    'pending_table_ids',v_pending_table_ids,
    'pending_table_count',v_pending_table_count,
    'remaining_deficit',GREATEST(v_required_open_seats-(v_open_seats+v_cap),0)
  );
END;
$function$

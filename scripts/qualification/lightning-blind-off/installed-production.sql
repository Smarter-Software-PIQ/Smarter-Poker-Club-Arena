-- Installed production definitions, read with pg_get_functiondef on
-- 2026-11-09 (project kuklfnapbkmacvwxktbh), byte for byte. The harness
-- asserts md5(pg_get_functiondef) of each against the production hash in
-- manifest.json before any behavior runs, so a retyped character fails here.
CREATE OR REPLACE FUNCTION public.fn_lightning_pool_stack(p_pool_session_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN ts.id IS NULL
                OR ts.left_at IS NOT NULL
                OR ts.user_id IS DISTINCT FROM s.player_id THEN 0::numeric
              ELSE GREATEST(round(coalesce(ts.stack, 0), 2) - public.fn_lightning_pool_exposure(s.player_id, s.cluster_id), 0::numeric) END
    FROM public.lightning_pool_session s
    LEFT JOIN public.table_seats ts ON ts.id = s.anchor_seat_id
   WHERE s.id = p_pool_session_id;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_lightning_stop_playing(p_cluster_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_now     timestamptz := clock_timestamp();
  s         record;
  v_table   uuid;
  v_in_hand boolean;
  v_first   boolean := false;
  v_frozen  boolean := false;
  v_stack   numeric;
BEGIN
  IF v_uid IS NULL OR p_cluster_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The caller's newest session in the Cluster, locked so the matcher, the
  -- reaper and a doubled tap serialize against this mark.
  SELECT ps.id, ps.cluster_id, ps.cluster_epoch, ps.player_id, ps.anchor_seat_id,
         ps.state, ps.exited_at, ps.exit_reason, ps.stop_requested_at
    INTO s
    FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = p_cluster_id AND ps.player_id = v_uid
   ORDER BY ps.entered_at DESC, ps.id
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  END IF;

  -- Already exited: stopping is a no-op that answers what stands.
  IF s.exited_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'exited', true,
                              'in_hand', false, 'exit_reason', s.exit_reason,
                              'stop_requested_at', s.stop_requested_at);
  END IF;

  IF s.stop_requested_at IS NULL THEN
    UPDATE public.lightning_pool_session ps
       SET stop_requested_at = v_now, updated_at = v_now
     WHERE ps.id = s.id;
    s.stop_requested_at := v_now;
    v_first := true;
  END IF;

  -- CURRENT HAND AND ACTION RULES ARE RESPECTED: a live hand, or any live
  -- reservation on the way into one, is never cut short by a stop.
  -- LIGHTNING PHASE 9 REMEDIATION (20261008142857), FINDING 6: A FROZEN
  -- CLUSTER IS EVIDENCE (the reaper's own doctrine). The stop mark above
  -- stands - a responsible-gaming request is never dropped, and the matcher
  -- must never deal this player again - but no pool-session row of a frozen
  -- Cluster is exited here: the exit waits for fn_cash_cluster_unfreeze or
  -- the first reaper pass after the thaw (consistency beats speed).
  v_frozen := EXISTS (SELECT 1 FROM public.cash_games fz
                       WHERE fz.id = s.cluster_id AND fz.cluster_mode = 'frozen');

  v_in_hand := public.fn_lightning_player_live_hand(v_uid, p_cluster_id) IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.lightning_reservation r
                        WHERE r.cluster_id = p_cluster_id AND r.player_id = v_uid
                          AND r.state IN ('pending', 'committed'));

  SELECT ts.table_id INTO v_table FROM public.table_seats ts WHERE ts.id = s.anchor_seat_id;

  IF v_first THEN
    INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
    VALUES (s.cluster_id, v_table, 'stop_playing_requested', jsonb_build_object(
      'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch, 'player_id', s.player_id,
      'pool_session_id', s.id, 'anchor_seat_id', s.anchor_seat_id, 'in_hand', v_in_hand,
      'at', v_now), s.cluster_epoch);
  END IF;

  IF NOT v_in_hand AND NOT v_frozen THEN
    UPDATE public.lightning_pool_session ps
       SET exited_at = GREATEST(v_now, ps.entered_at),
           exit_reason = 'stop_playing',
           state = 'closed',
           ending_stack = public.fn_lightning_pool_stack(ps.id),
           updated_at = v_now
     WHERE ps.id = s.id AND ps.exited_at IS NULL
    RETURNING ps.ending_stack INTO v_stack;
    IF FOUND THEN
      UPDATE public.lightning_pool_slot sl
         SET closed_at = GREATEST(v_now, sl.opened_at),
             close_reason = 'pool_session_exited',
             updated_at = v_now
       WHERE sl.pool_session_id = s.id AND sl.closed_at IS NULL;

      -- EVERY EXIT PATH SAYS pool_player_left, this one included, in the
      -- anchor-seat trigger's own payload shape.
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
      VALUES (s.cluster_id, v_table, 'pool_player_left', jsonb_build_object(
        'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch, 'player_id', s.player_id,
        'pool_session_id', s.id, 'anchor_seat_id', s.anchor_seat_id, 'reason', 'stop_playing',
        'ending_stack', v_stack, 'at', v_now), s.cluster_epoch);
    END IF;
    RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'exited', true,
                              'in_hand', false, 'stop_requested_at', s.stop_requested_at);
  END IF;

  -- FINDING 2 (20261008142857): PRESSING STOP IS ITSELF A HEARTBEAT. A
  -- session that stays open past this door (a live hand, or a freeze) does
  -- so CONNECTED: the caller's own stale disconnect stamp - a lost presence
  -- report - is cleared, only when set and never on a frozen Cluster, with
  -- one player_reconnected event in the presence door's own ledger shape.
  IF NOT v_frozen THEN
    UPDATE public.lightning_pool_session ps
       SET disconnected_at = NULL,
           state = CASE WHEN ps.state = 'disconnected' THEN 'active' ELSE ps.state END,
           updated_at = v_now
     WHERE ps.id = s.id AND ps.exited_at IS NULL AND ps.disconnected_at IS NOT NULL;
    IF FOUND THEN
      INSERT INTO public.cash_cluster_events (game_id, kind, payload, cluster_epoch)
      VALUES (s.cluster_id, 'player_reconnected', jsonb_build_object(
        'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch,
        'players', jsonb_build_array(jsonb_build_object('player_id', s.player_id, 'pool_session_id', s.id)),
        'at', v_now), s.cluster_epoch);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'exited', false,
                            'in_hand', v_in_hand, 'stop_requested_at', s.stop_requested_at);
END
$function$
;
CREATE OR REPLACE FUNCTION public.fn_lightning_reap_expired_disconnects(p_cluster_id uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT clock_timestamp(), p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s          record;
  v_exited   integer := 0;
  v_rows     jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
  v_errors   jsonb := '[]'::jsonb;
  v_expired  jsonb;
  v_seat     record;
  v_stack    numeric;
  v_sqlstate text;
  v_message  text;
  c          record;
BEGIN
  -- NEVER REAP BY A CLOCK THAT HAS NOT ARRIVED (the formation reaper's rule):
  -- a future p_now would expire a disconnect that has not yet stood its time.
  p_now := LEAST(coalesce(p_now, clock_timestamp()), clock_timestamp());

  FOR s IN
    SELECT ps.id, ps.cluster_id, ps.cluster_epoch, ps.player_id, ps.anchor_seat_id,
           ps.disconnected_at, ps.stop_requested_at, cfg.timeout_ms, rg.refused AS rg_refused
      FROM public.lightning_pool_session ps
      JOIN LATERAL (SELECT (public.fn_lightning_config(ps.cluster_id) ->> 'disconnect_timeout_ms')::integer
                      AS timeout_ms) cfg ON true
      -- LIGHTNING PHASE 12 (20261009143757): RESPONSIBLE GAMING ENDS THE
      -- SESSION, NOT ONLY THE NEXT DEAL. The SAME helper every Lightning door
      -- consults (fn_rg_require_not_excluded: self-exclusion, cooling-off);
      -- the EXISTS on its own primary key only spares the call for a player
      -- with no limits row, whom the helper answers ok by construction.
      JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.responsible_gaming_limits rgl
                                    WHERE rgl.user_id = ps.player_id)
                           AND (public.fn_rg_require_not_excluded(ps.player_id) ->> 'ok')::boolean IS DISTINCT FROM true
                      AS refused) rg ON true
     WHERE ps.exited_at IS NULL
       AND (p_cluster_id IS NULL OR ps.cluster_id = p_cluster_id)
       -- LIGHTNING PHASE 9 REMEDIATION (20261008142857), FINDING 6: A FROZEN
       -- CLUSTER IS EVIDENCE. cluster_mode 'frozen'
       -- (fn_lightning_settlement_freeze) marks a Cluster under forensic
       -- investigation, and its pool-session rows are not mutated here: not
       -- a timed-out disconnect, and not a standing Stop Playing request
       -- either - an idle stopper waits out the freeze (consistency beats
       -- speed). fn_cash_cluster_unfreeze owns the frozen Cluster's recovery
       -- and exits its sessions itself ('cluster_unfrozen'); a Cluster
       -- thawed any other way is reaped on the next pass. The formation
       -- reaper's "recovery during the break" doctrine covers buried
       -- instances, never session exits.
       AND NOT EXISTS (SELECT 1 FROM public.cash_games fz
                        WHERE fz.id = ps.cluster_id AND fz.cluster_mode = 'frozen')
       -- LIGHTNING PHASE 10 (20261008111425): the worklist is a disconnect
       -- past its timeout OR a standing Stop Playing request, which owes
       -- nobody a timeout - it exits the moment the hand lets go.
       AND ((ps.disconnected_at IS NOT NULL
             AND ps.disconnected_at + make_interval(secs => cfg.timeout_ms / 1000.0) <= p_now)
            OR ps.stop_requested_at IS NOT NULL
            -- LIGHTNING PHASE 12: a player responsible gaming refuses is
            -- finished like a stopper, the moment the hand lets go.
            OR rg.refused)
     ORDER BY coalesce(LEAST(coalesce(ps.disconnected_at, ps.stop_requested_at),
                             coalesce(ps.stop_requested_at, ps.disconnected_at)), ps.entered_at), ps.id
     -- FINDING 3 (20261008142857): an upper clamp too - one pass can never
     -- lock more than 2000 sessions however large p_limit comes in.
     LIMIT LEAST(GREATEST(1, coalesce(p_limit, 200)), 2000)
       FOR UPDATE OF ps SKIP LOCKED
  LOOP
    BEGIN
      -- RELEASE NOTHING IN-HAND. A player in a live hand - or holding any
      -- live reservation on the way into one - is never expired here: the
      -- hand's own clock, fold rules and settlement own them, and the
      -- formation reaper owns a reservation nothing vouches for. The next
      -- pass expires them once the hand lets go.
      IF public.fn_lightning_player_live_hand(s.player_id, s.cluster_id) IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.lightning_reservation r
                     WHERE r.cluster_id = s.cluster_id AND r.player_id = s.player_id
                       AND r.state IN ('pending', 'committed')) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'pool_session_id', s.id, 'cluster_id', s.cluster_id, 'player_id', s.player_id,
          'reason', 'in_hand_or_reserved');
        CONTINUE;
      END IF;

      UPDATE public.lightning_pool_session ps
         SET exited_at = GREATEST(p_now, ps.entered_at),
             exit_reason = CASE WHEN s.stop_requested_at IS NOT NULL THEN 'stop_playing'
                                WHEN s.rg_refused THEN 'rg_limit'
                                ELSE 'disconnect_expired' END,
             state = 'closed',
             ending_stack = public.fn_lightning_pool_stack(ps.id),
             updated_at = p_now
       WHERE ps.id = s.id AND ps.exited_at IS NULL
      RETURNING ps.ending_stack INTO v_stack;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      UPDATE public.lightning_pool_slot sl
         SET closed_at = GREATEST(p_now, sl.opened_at),
             close_reason = 'pool_session_exited',
             updated_at = p_now
       WHERE sl.pool_session_id = s.id AND sl.closed_at IS NULL;

      SELECT ts.table_id INTO v_seat FROM public.table_seats ts WHERE ts.id = s.anchor_seat_id;

      -- EVERY EXIT PATH SAYS pool_player_left, this one included, in the
      -- anchor-seat trigger's own payload shape.
      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
      VALUES (s.cluster_id, v_seat.table_id, 'pool_player_left', jsonb_build_object(
        'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch, 'player_id', s.player_id,
        'pool_session_id', s.id, 'anchor_seat_id', s.anchor_seat_id,
        'reason', CASE WHEN s.stop_requested_at IS NOT NULL THEN 'stop_playing'
                       WHEN s.rg_refused THEN 'rg_limit'
                       ELSE 'disconnect_expired' END,
        'ending_stack', v_stack, 'at', p_now), s.cluster_epoch);

      v_exited := v_exited + 1;
      v_rows := v_rows || jsonb_build_object(
        'pool_session_id', s.id, 'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch,
        'player_id', s.player_id, 'disconnected_at', s.disconnected_at,
        'stopped', s.stop_requested_at IS NOT NULL,
        'rg_limit', s.stop_requested_at IS NULL AND coalesce(s.rg_refused, false),
        'timeout_ms', s.timeout_ms);
    EXCEPTION WHEN OTHERS THEN
      -- PER-ITEM ISOLATION: one session's failure is a row, not the reap's.
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_object(
        'pool_session_id', s.id, 'cluster_id', s.cluster_id, 'player_id', s.player_id,
        'sqlstate', v_sqlstate, 'message', v_message);
    END;
  END LOOP;

  -- ONE player_expired EVENT PER CLUSTER PER CALL, carrying that Cluster's
  -- expired players, after the loop so an isolated failure cannot double it.
  FOR c IN
    SELECT (x ->> 'cluster_id')::uuid AS cluster_id,
           max((x ->> 'cluster_epoch')::integer) AS cluster_epoch,
           jsonb_agg(x - 'cluster_id' - 'cluster_epoch' - 'stopped' - 'rg_limit' ORDER BY x ->> 'player_id') AS players
      FROM jsonb_array_elements(v_rows) x
     -- A stopped session left of its own will is not an expired disconnect.
     WHERE (x ->> 'stopped')::boolean IS NOT TRUE
     -- Nor is a session responsible gaming ended (Phase 12).
       AND (x ->> 'rg_limit')::boolean IS NOT TRUE
     GROUP BY 1
  LOOP
    v_expired := c.players;
    INSERT INTO public.cash_cluster_events (game_id, kind, payload, cluster_epoch)
    VALUES (c.cluster_id, 'player_expired', jsonb_build_object(
      'cluster_id', c.cluster_id, 'cluster_epoch', c.cluster_epoch,
      'players', v_expired, 'at', p_now), c.cluster_epoch);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'expired', v_exited,
    'rows', v_rows, 'skipped', v_skipped, 'errors', v_errors);
END
$function$
;
CREATE OR REPLACE FUNCTION public.fn_lightning_player_legality(p_cluster_id uuid, p_now timestamp with time zone, p_disconnected uuid[], p_player_platforms jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(player_id uuid, pool_session_id uuid, pool_slot_id uuid, legal boolean, reason_code text, detail jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- MATERIALIZED, twice: an inlined CTE substitutes its expressions into
  -- every reference, which would ask the configuration once per player and
  -- run the whole reason chain once per use of its answer.
  WITH g AS MATERIALIZED (
    SELECT cg.id AS cluster_id, cg.cluster_mode, coalesce(cg.lightning_enabled, false) AS enabled,
           cg.cluster_epoch,
           EXISTS (SELECT 1 FROM public.cash_cluster_epoch e
                    WHERE e.cluster_id = cg.id AND e.epoch = cg.cluster_epoch AND e.ended_at IS NULL) AS epoch_open,
           public.fn_platform_frozen() AS platform_frozen,
           -- THE SEAT DOOR'S GATE: fn_ca_refuse_restricted_entry refuses only
           -- when the operator policy enforces restrictions, and otherwise
           -- only observes. The matcher follows the door.
           coalesce((SELECT op.restrictions_enforced FROM public.ca_operator_policy op LIMIT 1), false) AS restrictions_enforced,
           public.fn_lightning_config(cg.id) AS lcfg
      FROM public.cash_games cg
     WHERE cg.id = p_cluster_id
  ), f AS (
    SELECT g.cluster_id, g.cluster_mode, g.enabled, g.cluster_epoch, g.epoch_open, g.platform_frozen,
           g.restrictions_enforced,
           -- LIGHTNING PHASE 8 (20261007212735), TIGHTENED BY 20261008043021:
           -- the caller names each player's platform; missing or anything
           -- else is the NARROWEST limit (mobile), so an unreported platform
           -- can never buy a wider limit than the client would enforce.
           CASE WHEN (p_player_platforms ->> ps.player_id::text) IN ('desktop', 'tablet', 'mobile')
                THEN p_player_platforms ->> ps.player_id::text ELSE 'mobile' END AS platform,
           coalesce(((g.lcfg -> 'multi_table_limit') ->> CASE WHEN (p_player_platforms ->> ps.player_id::text) IN ('desktop', 'tablet', 'mobile')
                                                    THEN p_player_platforms ->> ps.player_id::text ELSE 'mobile' END)::integer,
                    2) AS multi_table_limit,
           ps.player_id, ps.id AS pool_session_id, ps.state AS pool_state, ps.cluster_epoch AS pool_epoch,
           ps.anchor_seat_id,
           ps.stop_requested_at,
           -- LIGHTNING PHASE 13 (20261009235505): when the pool closed to
           -- newcomers, and when this session entered it.
           ps.entered_at AS pool_entered_at,
           CASE WHEN (g.lcfg ->> 'lightning_joins_enabled')::boolean IS FALSE
                THEN (g.lcfg ->> 'lightning_joins_disabled_at')::timestamptz END AS joins_closed_at,
           sl.id AS slot_id, sl.cluster_epoch AS slot_epoch, sl.pool_session_id AS slot_session_id,
           cps.id AS cash_session_id, cps.closed_at AS cash_session_closed_at,
           ts.id AS seat_id, ts.left_at AS seat_left_at, ts.user_id AS seat_user_id,
           coalesce(ts.is_sitting_out, false) AS seat_sitting_out,
           coalesce(ts.leave_pending, false) AS seat_leave_pending,
           tb.cluster_id AS seat_cluster_id, coalesce(tb.is_deleted, false) AS table_deleted,
           coalesce(tb.lifecycle, '') AS table_lifecycle
      FROM g
      JOIN public.lightning_pool_session ps
        ON ps.cluster_id = g.cluster_id AND ps.exited_at IS NULL
      LEFT JOIN public.lightning_pool_slot sl
        ON sl.cluster_id = ps.cluster_id AND sl.player_id = ps.player_id AND sl.closed_at IS NULL
      LEFT JOIN public.cash_player_session cps ON cps.id = ps.cash_player_session_id
      LEFT JOIN public.table_seats ts ON ts.id = ps.anchor_seat_id
      LEFT JOIN public.tables tb ON tb.id = ts.table_id
  ), c AS MATERIALIZED (
    SELECT f.*, CASE
        WHEN coalesce(f.cluster_mode, '') NOT IN ('lightning', 'frozen', 'paused') THEN 'CLUSTER_NOT_LIGHTNING'
        WHEN f.cluster_mode IN ('frozen', 'paused') THEN 'CLUSTER_FROZEN'
        WHEN NOT f.enabled THEN 'LIGHTNING_DISABLED'
        WHEN f.platform_frozen THEN 'PLATFORM_FROZEN'
        WHEN f.pool_epoch IS DISTINCT FROM f.cluster_epoch OR NOT f.epoch_open THEN 'WRONG_EPOCH'
        WHEN f.cash_session_id IS NULL OR f.cash_session_closed_at IS NOT NULL
             OR f.pool_state = 'closed' THEN 'SESSION_CLOSED'
        WHEN f.pool_state IN ('joining', 'eligibility_check') THEN 'POOL_SESSION_NOT_ACTIVE'
        WHEN f.pool_state = 'leaving' OR f.seat_leave_pending THEN 'CASHOUT_PENDING'
        WHEN f.seat_id IS NULL OR f.seat_left_at IS NOT NULL
             OR f.seat_user_id IS DISTINCT FROM f.player_id
             OR f.seat_cluster_id IS DISTINCT FROM f.cluster_id
             OR f.table_deleted OR f.table_lifecycle = 'closed' THEN 'ANCHOR_LEFT'
        WHEN f.pool_state = 'sit_out' OR f.seat_sitting_out THEN 'SITTING_OUT'
        WHEN smarter_private.lightning_top_up_pending(f.anchor_seat_id) THEN 'TOP_UP_PENDING'
        WHEN coalesce(public.fn_lightning_pool_stack(f.pool_session_id), 0) <= 0 THEN 'NO_STACK'
        -- THE POPULATION'S PREDICATE HAS THE LAST WORD ON THE ANCHOR: anything
        -- it refuses that the four arms above did not name is still refused.
        WHEN NOT public.fn_lightning_anchor_is_live_eligible(f.anchor_seat_id, f.cluster_id, f.player_id) THEN 'ANCHOR_LEFT'
        WHEN f.restrictions_enforced AND public.fn_ca_player_restricted(f.player_id, 'cash') THEN 'RESTRICTED'
        WHEN (public.fn_rg_require_not_excluded(f.player_id) ->> 'ok')::boolean IS DISTINCT FROM true THEN 'RG_EXCLUDED'
        WHEN f.pool_state = 'disconnected'
             OR f.player_id = ANY (coalesce(p_disconnected, ARRAY[]::uuid[])) THEN 'DISCONNECTED'
        WHEN f.pool_state IS DISTINCT FROM 'active' THEN 'POOL_SESSION_NOT_ACTIVE'
        WHEN EXISTS (SELECT 1 FROM public.lightning_reservation r
                      WHERE r.cluster_id = f.cluster_id AND r.player_id = f.player_id
                        AND r.state IN ('pending', 'committed'))
             AND NOT public.fn_lightning_player_in_hand(f.player_id, f.cluster_id) THEN 'ALREADY_RESERVED'
        WHEN public.fn_lightning_player_in_hand(f.player_id, f.cluster_id) THEN 'IN_HAND'
        -- LIGHTNING PHASE 10 (20261008111425): a player who pressed Stop
        -- Playing is never matched into another hand. After the hand arms,
        -- so a stopper still playing reads IN_HAND until the hand lets go.
        -- LIGHTNING PHASE 13 (20261009235505): a session that entered after
        -- an operator closed joins is held; everyone already in plays on.
        WHEN f.joins_closed_at IS NOT NULL AND f.pool_entered_at >= f.joins_closed_at THEN 'LIGHTNING_JOINS_DISABLED'
        WHEN f.stop_requested_at IS NOT NULL THEN 'STOP_REQUESTED'
        WHEN f.slot_id IS NULL OR f.slot_epoch IS DISTINCT FROM f.cluster_epoch
             OR f.slot_session_id IS DISTINCT FROM f.pool_session_id THEN 'SLOT_NOT_OPEN'
        WHEN (SELECT count(DISTINCT r.cluster_id)
                FROM public.lightning_reservation r
                JOIN public.lightning_instance i ON i.id = r.lightning_instance_id
               WHERE r.player_id = f.player_id AND r.cluster_id <> f.cluster_id
                 AND r.state = 'committed'
                 AND i.state IN ('forming', 'reserved', 'dealing', 'settling')) >= f.multi_table_limit THEN 'MULTI_TABLE_LIMIT'
      END AS code
      FROM f
  )
  SELECT c.player_id, c.pool_session_id, c.slot_id,
         c.code IS NULL,
         c.code,
         jsonb_strip_nulls(jsonb_build_object(
           'cluster_mode', c.cluster_mode, 'cluster_epoch', c.cluster_epoch,
           'pool_epoch', c.pool_epoch, 'slot_epoch', c.slot_epoch, 'pool_state', c.pool_state,
           'anchor_seat_id', c.anchor_seat_id))
         || CASE c.code
              WHEN 'RG_EXCLUDED' THEN jsonb_build_object('responsible_gaming', public.fn_rg_require_not_excluded(c.player_id))
              WHEN 'RESTRICTED' THEN jsonb_build_object('restriction_scope', 'cash',
                'restriction_reason', (public.fn_ca_player_restriction_for(c.player_id, 'cash')).reason_code)
              WHEN 'MULTI_TABLE_LIMIT' THEN jsonb_build_object('multi_table_limit', c.multi_table_limit, 'platform', c.platform,
                'live_hands_elsewhere', (SELECT count(DISTINCT r.cluster_id)
                                           FROM public.lightning_reservation r
                                           JOIN public.lightning_instance i ON i.id = r.lightning_instance_id
                                          WHERE r.player_id = c.player_id AND r.cluster_id <> c.cluster_id
                                            AND r.state = 'committed'
                                            AND i.state IN ('forming', 'reserved', 'dealing', 'settling')))
              WHEN 'LIGHTNING_JOINS_DISABLED' THEN jsonb_build_object('joins_disabled_at', c.joins_closed_at)
              WHEN 'STOP_REQUESTED' THEN jsonb_build_object('stop_requested_at', c.stop_requested_at)
              WHEN 'DISCONNECTED' THEN jsonb_build_object('reported_disconnected',
                c.player_id = ANY (coalesce(p_disconnected, ARRAY[]::uuid[])))
              ELSE '{}'::jsonb
            END
    FROM c
   ORDER BY c.player_id;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_table_seats_lightning_pool_follows_seat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ps      record;
  v_other uuid;
  v_now   timestamptz := clock_timestamp();
  v_lock_cluster uuid;
  v_old_table    uuid;
BEGIN
  -- A SEAT WAITS FOR THE MODE CHANGE IN FLIGHT (2026-10-15, Lightning Phase
  -- 12 load and chaos): the Cluster's mode lock, SHARED, before anything
  -- below reads the mode, the epoch or the pool. A conversion or reversion
  -- holds it EXCLUSIVE from just after its seat FOR SHARE to its commit, so
  -- this waits for one in flight and then reads what it committed; one that
  -- comes after waits for this commit and then sees this seat. Without it an
  -- arrival read 'pending_on', entered nothing, and the conversion that could
  -- not see the uncommitted seat left the player out of the pool for good.
  IF TG_OP = 'UPDATE' THEN v_old_table := OLD.table_id; END IF;
  FOR v_lock_cluster IN
    SELECT DISTINCT tb.cluster_id FROM public.tables tb
     WHERE tb.id IN (NEW.table_id, v_old_table) AND tb.cluster_id IS NOT NULL
     ORDER BY tb.cluster_id
  LOOP
    PERFORM pg_advisory_xact_lock_shared(
      pg_catalog.hashtextextended('lightning_cluster_mode:' || v_lock_cluster::text, 0));
  END LOOP;
  v_now := clock_timestamp();

  IF TG_OP = 'UPDATE'
     AND ((OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)
          OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    FOR ps IN
      UPDATE public.lightning_pool_session s
         SET exited_at    = GREATEST(v_now, s.entered_at),
             exit_reason  = CASE WHEN NEW.user_id IS DISTINCT FROM OLD.user_id
                                 THEN 'anchor_seat_turned_over' ELSE 'anchor_seat_left' END,
             state        = 'closed',
             ending_stack = OLD.stack,
             updated_at   = v_now
       WHERE s.anchor_seat_id = OLD.id AND s.exited_at IS NULL
      RETURNING s.id, s.cluster_id, s.cluster_epoch, s.player_id, s.exit_reason, s.ending_stack
    LOOP
      UPDATE public.lightning_pool_slot sl
         SET closed_at = GREATEST(v_now, sl.opened_at),
             close_reason = 'pool_session_exited',
             updated_at = v_now
       WHERE sl.pool_session_id = ps.id AND sl.closed_at IS NULL;

      INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
      VALUES (ps.cluster_id, OLD.table_id, 'pool_player_left', jsonb_build_object(
        'cluster_id', ps.cluster_id, 'cluster_epoch', ps.cluster_epoch, 'player_id', ps.player_id,
        'pool_session_id', ps.id, 'anchor_seat_id', OLD.id, 'reason', ps.exit_reason,
        'ending_stack', ps.ending_stack, 'at', v_now), ps.cluster_epoch);

      SELECT ts.id INTO v_other
        FROM public.table_seats ts
        JOIN public.tables tb ON tb.id = ts.table_id
       WHERE tb.cluster_id = ps.cluster_id AND ts.user_id = ps.player_id AND ts.id <> OLD.id
         AND public.fn_lightning_anchor_is_live_eligible(ts.id, ps.cluster_id, ps.player_id)
       ORDER BY ts.joined_at, ts.id
       LIMIT 1;
      IF v_other IS NOT NULL THEN
        PERFORM public.fn_lightning_pool_enter(v_other, v_now);
      END IF;
    END LOOP;
  END IF;

  IF TG_OP='UPDATE' AND ((OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)
      OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM smarter_private.lightning_top_up_finish(OLD.table_id,OLD.user_id,'seat_left');
  END IF;

  IF NEW.left_at IS NULL AND NEW.user_id IS NOT NULL
     AND coalesce(NEW.stack, 0) > 0
     AND coalesce(NEW.is_sitting_out, false) = false
     AND coalesce(NEW.leave_pending, false) = false
     AND EXISTS (SELECT 1 FROM public.tables tb
                   JOIN public.cash_games g ON g.id = tb.cluster_id
                  WHERE tb.id = NEW.table_id AND g.cluster_mode = 'lightning') THEN
    PERFORM public.fn_lightning_pool_enter(NEW.id, v_now);
  END IF;
  RETURN NULL;
END
$function$
;
CREATE OR REPLACE FUNCTION public.fn_lightning_pool_enter(p_seat_id uuid, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s     record;
  g     record;
  v_ps  uuid;
  v_cps uuid;
  v_now timestamptz := LEAST(coalesce(p_now, clock_timestamp()), clock_timestamp());
BEGIN
  SELECT ts.id, ts.user_id, ts.table_id, ts.stack, tb.cluster_id
    INTO s
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
   WHERE ts.id = p_seat_id;
  IF NOT FOUND OR s.cluster_id IS NULL OR s.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cg.id, cg.cluster_mode, cg.lightning_enabled, cg.cluster_epoch
    INTO g FROM public.cash_games cg WHERE cg.id = s.cluster_id;
  IF NOT FOUND OR g.cluster_mode IS DISTINCT FROM 'lightning'
     OR coalesce(g.lightning_enabled, false) = false THEN
    RETURN NULL;
  END IF;

  IF NOT public.fn_lightning_anchor_is_live_eligible(s.id, g.id, s.user_id) THEN
    RETURN NULL;
  END IF;

  -- LIGHTNING PHASE 10 (20261008111425): THE POOL DOOR HONORS RESPONSIBLE
  -- GAMING. The same gate the matcher consults (fn_rg_require_not_excluded:
  -- self-exclusion and cooling-off) refuses entry outright, so an excluded
  -- player never sits in the pool at all. The door's refusal is its NULL,
  -- as for every other ineligible seat.
  IF (public.fn_rg_require_not_excluded(s.user_id) ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RETURN NULL;
  END IF;

  SELECT ps.id INTO v_ps
    FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = g.id AND ps.player_id = s.user_id AND ps.exited_at IS NULL;
  IF v_ps IS NOT NULL THEN
    PERFORM public.fn_lightning_pool_slot_open(v_ps, v_now);
    RETURN v_ps;
  END IF;

  -- LIGHTNING PHASE 13 (20261009235505): JOINS CAN BE CLOSED. An operator's
  -- disable_joins closes the pool to newcomers; the door's refusal is its
  -- NULL, as for every other ineligible seat, and the player's seat and
  -- cash session are untouched.
  IF NOT public.fn_lightning_joins_enabled(g.id) THEN
    RETURN NULL;
  END IF;

  SELECT cps.id INTO v_cps
    FROM public.cash_player_session cps
   WHERE cps.player_id = s.user_id AND cps.closed_at IS NULL
     AND (cps.cluster_id = g.id
          OR cps.scope_id IN (SELECT t.id FROM public.tables t WHERE t.cluster_id = g.id)
          OR cps.table_id IN (SELECT t.id FROM public.tables t WHERE t.cluster_id = g.id))
   ORDER BY coalesce(cps.cluster_id = g.id, false) DESC, cps.opened_at DESC, cps.id
   LIMIT 1;
  IF v_cps IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.lightning_pool_session
      (cluster_id, cluster_epoch, player_id, cash_player_session_id, state, entered_at,
       starting_stack, anchor_seat_id)
    VALUES (g.id, g.cluster_epoch, s.user_id, v_cps, 'active', v_now, s.stack, s.id)
    RETURNING id INTO v_ps;
  EXCEPTION WHEN unique_violation THEN
    SELECT ps.id INTO v_ps
      FROM public.lightning_pool_session ps
     WHERE ps.cluster_id = g.id AND ps.player_id = s.user_id AND ps.exited_at IS NULL;
    RETURN v_ps;
  END;

  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
  VALUES (g.id, s.table_id, 'pool_player_joined', jsonb_build_object(
    'cluster_id', g.id, 'cluster_epoch', g.cluster_epoch, 'player_id', s.user_id,
    'pool_session_id', v_ps, 'anchor_seat_id', s.id, 'starting_stack', s.stack,
    'cash_player_session_id', v_cps, 'via', 'fn_lightning_pool_enter', 'at', v_now), g.cluster_epoch);

  -- THE PLAYER IS TOLD THE ROOM IS OPEN (20261025025154), exactly as the
  -- conversion tells every player it enters: one owner-only signal, delivered
  -- only if this entry commits, answered by a re-read of fn_lightning_my_session.
  PERFORM realtime.send(
    jsonb_build_object('user_id', s.user_id, 'cluster_id', g.id,
      'reason', 'lightning_room_opened', 'domains', '[]'::jsonb),
    'account_changed', 'profile-account:' || s.user_id::text, true);

  PERFORM public.fn_lightning_pool_slot_open(v_ps, v_now);
  RETURN v_ps;
END
$function$
;

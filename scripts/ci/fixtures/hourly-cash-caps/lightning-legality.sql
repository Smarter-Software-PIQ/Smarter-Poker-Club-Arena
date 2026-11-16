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
        -- A LIGHTNING BLIND OFF ALWAYS COMPLETES (20261109224717): a confirmed
        -- blind off that still owes hands is dealt with nobody at the client;
        -- its hand host checks or folds the seat (fn_lightning_blind_off_players).
        WHEN (f.pool_state = 'disconnected'
              OR f.player_id = ANY (coalesce(p_disconnected, ARRAY[]::uuid[])))
             AND public.fn_lightning_hands_owed(f.pool_session_id, true) = 0 THEN 'DISCONNECTED'
        WHEN f.pool_state IS NULL OR f.pool_state NOT IN ('active', 'disconnected') THEN 'POOL_SESSION_NOT_ACTIVE'
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
        WHEN f.stop_requested_at IS NOT NULL
             AND public.fn_lightning_hands_owed(f.pool_session_id, true) = 0 THEN 'STOP_REQUESTED'
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

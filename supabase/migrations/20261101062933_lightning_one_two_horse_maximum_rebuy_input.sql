-- 20261101062933_lightning_one_two_horse_maximum_rebuy_input.sql
-- Owner input policy: every busted 1/2 cash horse requests its legal maximum
-- through the existing reload door, across all variants. Discretionary opt-in
-- and initial-target settings do not suppress that request. Hard responsible-
-- gaming, count/session budgets, session/hand/reservation/pending constraints,
-- funding and accounting remain unchanged. Caller flags cannot select policy.
-- The two immutable Phase 10/12 blanket input proofs are carried forward by
-- exact-byte registry replacements; every other RG/helper ban is retained.
-- @live-proof: (SELECT md5(p.prosrc)='0fd21bd298e0ee6b6c126169c917bc94' AND NOT p.prosecdef AND p.provolatile='v' AND p.proconfig @> ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner)='postgres' AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid='public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)'::regprocedure)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)'::regprocedure)
     NOT IN ('423d45746bacaa3de19ce0bee93c1ccb','0fd21bd298e0ee6b6c126169c917bc94') THEN
    RAISE EXCEPTION 'Lightning auto-rebuy source differs from qualified predecessor';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_lightning_auto_rebuy(p_cluster_id uuid, p_player_id uuid,
                                                          p_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_now      timestamptz := LEAST(coalesce(p_now, clock_timestamp()), clock_timestamp());
  v_cfg      jsonb;
  s          record;
  v_seat     record;
  v_tbl      record;
  v_bb       numeric;
  v_max_buy  numeric;
  v_stack    numeric;
  v_target   numeric;
  v_amount   numeric;
  v_cap      numeric;
  v_key      uuid;
  v_balance  numeric;
  v_sqlstate text;
  v_message  text;
  v_mandatory boolean := false;
BEGIN
  IF p_cluster_id IS NULL OR p_player_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_REQUEST');
  END IF;

  v_cfg := public.fn_lightning_config(p_cluster_id);
  -- Owner November 1: a busted 1/2 horse requests the legal maximum.
  -- Identity and stake are read here, never accepted from an engine flag.
  -- This first read only preserves the existing cheap disabled-human refusal;
  -- the locked session and actual anchor are checked again before funding.
  SELECT EXISTS (
    SELECT 1 FROM public.lightning_pool_session ps
    JOIN public.table_seats a ON a.id=ps.anchor_seat_id AND a.user_id=ps.player_id
    JOIN public.tables t ON t.id=a.table_id
    JOIN public.clubs c ON c.id=t.club_id
    JOIN public.profiles p ON p.id=ps.player_id
    WHERE ps.cluster_id=p_cluster_id AND ps.player_id=p_player_id
      AND ps.exited_at IS NULL AND ps.state='active'
      AND a.left_at IS NULL AND a.stack<=0 AND p.is_horse IS TRUE
      AND t.cluster_id=p_cluster_id
      AND t.tournament_id IS NULL AND t.small_blind=1 AND t.big_blind=2
      AND c.asset='chips'
  ) INTO v_mandatory;
  IF coalesce((v_cfg ->> 'auto_rebuy_enabled')::boolean, false) IS NOT TRUE
     AND NOT v_mandatory THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'DISABLED');
  END IF;

  SELECT ps.id, ps.cluster_id, ps.cluster_epoch, ps.player_id, ps.anchor_seat_id, ps.state,
         ps.starting_stack, ps.stop_requested_at, ps.disconnected_at,
         ps.auto_rebuys, ps.auto_rebuy_total
    INTO s
    FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = p_cluster_id AND ps.player_id = p_player_id AND ps.exited_at IS NULL
   ORDER BY ps.entered_at DESC, ps.id
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  END IF;
  IF s.state IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SESSION_NOT_ACTIVE', 'state', s.state);
  END IF;
  IF s.stop_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'STOP_REQUESTED');
  END IF;
  IF s.disconnected_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'DISCONNECTED');
  END IF;

  -- BETWEEN HANDS ONLY: a live hand, or any live reservation on the way into
  -- one, refuses the top-up; the engine asks again after the settle.
  IF public.fn_lightning_player_in_hand(p_player_id, p_cluster_id)
     OR EXISTS (SELECT 1 FROM public.lightning_reservation r
                 WHERE r.cluster_id = p_cluster_id AND r.player_id = p_player_id
                   AND r.state IN ('pending', 'committed')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'IN_HAND');
  END IF;

  -- RESPONSIBLE GAMING HAS THE SAME LAST WORD HERE AS AT EVERY DOOR.
  IF (public.fn_rg_require_not_excluded(p_player_id) ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RG_EXCLUDED',
                              'responsible_gaming', public.fn_rg_require_not_excluded(p_player_id));
  END IF;

  SELECT ts.id, ts.table_id, ts.stack INTO v_seat
    FROM public.table_seats ts
   WHERE ts.id = s.anchor_seat_id AND ts.left_at IS NULL AND ts.user_id = p_player_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ANCHOR_LEFT');
  END IF;

  -- One top-up in flight at a time: an unresolved pending addon means the
  -- previous purchase has not yet landed on the seat.
  IF EXISTS (SELECT 1 FROM public.table_pending_addons a
              WHERE a.table_id = v_seat.table_id AND a.user_id = p_player_id
                AND a.resolved_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PENDING_ADDON');
  END IF;

  IF coalesce(s.auto_rebuys, 0) >= (v_cfg ->> 'auto_rebuy_max_count')::integer THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MAX_COUNT',
                              'auto_rebuys', coalesce(s.auto_rebuys, 0),
                              'auto_rebuy_max_count', (v_cfg ->> 'auto_rebuy_max_count')::integer);
  END IF;

  SELECT t.max_buy_in, t.big_blind,
         (p.is_horse IS TRUE AND t.cluster_id=p_cluster_id
          AND t.tournament_id IS NULL AND t.small_blind=1
          AND t.big_blind=2 AND c.asset='chips') AS mandatory
    INTO v_tbl FROM public.tables t
    LEFT JOIN public.clubs c ON c.id=t.club_id
    LEFT JOIN public.profiles p ON p.id=p_player_id
   WHERE t.id=v_seat.table_id;
  v_mandatory := coalesce(v_tbl.mandatory, false);
  v_bb := coalesce(nullif(v_tbl.big_blind, 0),
                   (SELECT cg.bb FROM public.cash_games cg WHERE cg.id = p_cluster_id), 0);
  -- The effective-buyin reader's own fallback: an unset table maximum is
  -- two hundred big blinds.
  v_max_buy := CASE WHEN coalesce(v_tbl.max_buy_in, 0) > 0 THEN v_tbl.max_buy_in ELSE v_bb * 200 END;

  v_stack := coalesce(public.fn_lightning_pool_stack(s.id), 0);
  v_mandatory := v_mandatory AND v_stack<=0;
  IF coalesce((v_cfg ->> 'auto_rebuy_enabled')::boolean, false) IS NOT TRUE
     AND NOT v_mandatory THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'DISABLED');
  END IF;
  v_target := CASE WHEN v_mandatory THEN v_max_buy
               WHEN v_cfg ->> 'auto_rebuy_target' = 'max' THEN v_max_buy
               ELSE LEAST(coalesce(s.starting_stack, 0), v_max_buy)
              END;

  IF NOT (v_mandatory OR CASE v_cfg ->> 'auto_rebuy_trigger'
            WHEN 'zero'      THEN v_stack <= 0
            WHEN 'below_bb'  THEN v_stack < (v_cfg ->> 'auto_rebuy_threshold_bb')::numeric * v_bb
            WHEN 'below_pct' THEN v_stack < v_target * (v_cfg ->> 'auto_rebuy_threshold_pct')::numeric / 100.0
            ELSE false
          END) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_TRIGGERED',
                              'stack', v_stack, 'target', v_target,
                              'trigger', v_cfg ->> 'auto_rebuy_trigger');
  END IF;

  v_amount := round(v_target - v_stack, 2);
  v_cap := (v_cfg ->> 'auto_rebuy_session_cap')::numeric;
  IF v_cap > 0 THEN
    -- A hard session budget still refuses the purchase. The mandatory policy
    -- never silently turns a full maximum request into a smaller reload.
    IF v_mandatory AND round(v_cap-coalesce(s.auto_rebuy_total, 0),2)<v_amount THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'SESSION_CAP',
                                'auto_rebuy_total', coalesce(s.auto_rebuy_total,0),
                                'auto_rebuy_session_cap', v_cap);
    END IF;
    v_amount := LEAST(v_amount, round(v_cap - coalesce(s.auto_rebuy_total, 0), 2));
    IF v_amount <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'SESSION_CAP',
                                'auto_rebuy_total', coalesce(s.auto_rebuy_total, 0),
                                'auto_rebuy_session_cap', v_cap);
    END IF;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_AT_TARGET',
                              'stack', v_stack, 'target', v_target);
  END IF;

  -- THE DETERMINISTIC PURCHASE KEY: one per (session, count), so however the
  -- engine retries, the reload door's receipt makes the debit happen once.
  v_key := md5('lightning_auto_rebuy:' || s.id::text || ':' || (coalesce(s.auto_rebuys, 0) + 1)::text)::uuid;

  BEGIN
    v_balance := public.atomic_table_rebuy(p_player_id, v_seat.table_id, v_amount, v_key);
  EXCEPTION WHEN OTHERS THEN
    -- The reload door refused (insufficient club chips, a freeze, a seat
    -- vacated under us): its sub-transaction rolled back and nothing moved.
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('ok', false, 'reason', 'RELOAD_REFUSED',
                              'sqlstate', v_sqlstate, 'message', v_message,
                              'amount', v_amount, 'purchase_key', v_key);
  END;

  UPDATE public.lightning_pool_session ps
     SET auto_rebuys = coalesce(ps.auto_rebuys, 0) + 1,
         auto_rebuy_total = coalesce(ps.auto_rebuy_total, 0) + v_amount,
         updated_at = v_now
   WHERE ps.id = s.id;

  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
  VALUES (s.cluster_id, v_seat.table_id, 'auto_rebuy', jsonb_build_object(
    'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch, 'player_id', s.player_id,
    'pool_session_id', s.id, 'anchor_seat_id', s.anchor_seat_id,
    'amount', v_amount, 'stack_before', v_stack,
    'stack_after_delivery', round(v_stack + v_amount, 2),
    'trigger', v_cfg ->> 'auto_rebuy_trigger',
    'target', CASE WHEN v_mandatory THEN 'max' ELSE v_cfg ->> 'auto_rebuy_target' END,
    'count', coalesce(s.auto_rebuys, 0) + 1, 'purchase_key', v_key, 'at', v_now), s.cluster_epoch);

  RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'amount', v_amount,
                            'stack_before', v_stack,
                            'stack_after_delivery', round(v_stack + v_amount, 2),
                            'count', coalesce(s.auto_rebuys, 0) + 1,
                            'balance', v_balance, 'purchase_key', v_key);
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone) TO service_role;
DO $proof$
BEGIN
  IF ((SELECT md5(p.prosrc)='0fd21bd298e0ee6b6c126169c917bc94' AND NOT p.prosecdef AND p.provolatile='v' AND p.proconfig @> ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner)='postgres' AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid='public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Lightning maximum input body or privileges differ from qualification'
      USING DETAIL=(SELECT jsonb_build_object('body_md5',md5(prosrc),
        'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,
        'volatility',provolatile,'config',proconfig,'acl',proacl)::text
        FROM pg_proc WHERE oid='public.fn_lightning_auto_rebuy(uuid,uuid,timestamp with time zone)'::regprocedure);
  END IF;
END $proof$;
COMMIT;

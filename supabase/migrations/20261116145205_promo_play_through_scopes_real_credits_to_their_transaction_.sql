-- Promo play-through: real credits belong to one transaction and club.
-- Version reserved by scripts/new-migration.mjs.
-- Two reproduced failures in 20261116013806: deferred credit events subtract
-- one leg from the final wallet, and cash stacks are read across all clubs.
-- Subtract the whole visible uncommitted credit set and scope cash custody.
-- Changes only the existing function, without locking chip_ledger or changing
-- a trigger. No migration replay, financial write or engine activation.
-- @live-proof: position('v_real_credits' in pg_get_functiondef('public.fn_ca_promo_play_through_on_real_chips()'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_on_real_chips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_summary   jsonb;
  v_locked    numeric;
  v_held      numeric;
  v_real_credits numeric;
  v_shortfall numeric;
  v_take      numeric;
  v_grant     record;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.ca_promo_play_through_grants g
        WHERE g.club_id = NEW.club_id
          AND g.user_id = NEW.to_entity_id
          AND g.closed_at IS NULL) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.user_id = NEW.to_entity_id
          AND tp.status IN ('registered', 'playing')) THEN
    RETURN NULL;
  END IF;

  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id, NEW.to_entity_id);
  v_summary := public.fn_ca_promo_play_through_summary(NEW.club_id, NEW.to_entity_id);
  v_locked  := COALESCE((v_summary ->> 'locked')::numeric, 0);
  IF v_locked <= 0 THEN
    RETURN NULL;
  END IF;

  -- Every deferred event sees the final wallet. Subtract the complete real
  -- credit set visible to this transaction, including subtransaction rows.
  SELECT COALESCE(sum(l.amount), 0) INTO v_real_credits
    FROM public.chip_ledger l
   WHERE l.club_id = NEW.club_id
     AND l.to_entity_id = NEW.to_entity_id
     AND l.to_type = 'player_wallet'
     AND l.amount > 0
     AND COALESCE(l.status, 'posted') = 'posted'
     AND l.from_type IN ('club_treasury', 'agent_wallet', 'player_wallet', 'leaderboard_round')
     AND l.category <> 'settlement'
     AND l.from_entity_id IS DISTINCT FROM l.to_entity_id
     AND pg_xact_status(l.xmin::text::xid8) = 'in progress';

  v_held := GREATEST(COALESCE((v_summary ->> 'wallet')::numeric, 0) - v_real_credits, 0)
            + COALESCE((
                SELECT sum(s.stack)
                  FROM public.table_seats s
                  JOIN public.tables t ON t.id = s.table_id
                 WHERE s.user_id = NEW.to_entity_id
                   AND s.left_at IS NULL
                   AND t.tournament_id IS NULL
                   AND t.club_id = NEW.club_id
              ), 0);

  v_shortfall := v_locked - v_held;
  IF v_shortfall <= 0 THEN
    RETURN NULL;
  END IF;

  FOR v_grant IN
    SELECT s.grant_id, s.remaining
      FROM public.fn_ca_promo_play_through_state(NEW.club_id, NEW.to_entity_id) s
     WHERE s.state IN ('locked', 'expired_pending')
     ORDER BY s.granted_at DESC, s.grant_id DESC
  LOOP
    EXIT WHEN v_shortfall <= 0;
    v_take := LEAST(v_grant.remaining, v_shortfall);
    UPDATE public.ca_promo_play_through_grants g
       SET remaining    = g.remaining - v_take,
           closed_at    = CASE WHEN g.remaining - v_take <= 0 THEN clock_timestamp() ELSE g.closed_at END,
           close_reason = CASE WHEN g.remaining - v_take <= 0 THEN 'spent' ELSE g.close_reason END,
           close_note   = CASE WHEN g.remaining - v_take <= 0
                               THEN 'lost at the tables before chip_ledger ' || NEW.id::text ELSE g.close_note END
     WHERE g.id = v_grant.grant_id;
    v_shortfall := v_shortfall - v_take;
  END LOOP;

  RETURN NULL;
END;
$function$;



-- Same financial visibility as the existing Players Management roster. The
-- browser gets summaries only, never direct access to grant or fee tables.
CREATE FUNCTION public.fn_ca_members_promo_play_through(p_club_id uuid, p_user_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_club_id IS NULL
     OR COALESCE(cardinality(p_user_ids),0) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('success',false,'error','Choose Up To 100 Members');
  END IF;
  SELECT COALESCE(jsonb_object_agg(t.user_id::text,
    jsonb_build_object('success',true) || public.fn_ca_promo_play_through_summary(p_club_id,t.user_id)), '{}'::jsonb)
    INTO v_rows
    FROM (SELECT DISTINCT unnest(p_user_ids) AS user_id) t
   WHERE public.ca_club_roster_access(p_club_id,t.user_id) IN ('staff','downline','service');
  RETURN jsonb_build_object('success',true,'members',v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_members_promo_play_through(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_members_promo_play_through(uuid,uuid[]) TO authenticated,service_role;

COMMIT;

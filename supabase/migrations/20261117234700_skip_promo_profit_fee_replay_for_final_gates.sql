-- A cash hand's deferred fee trigger used to read lifetime fee history even
-- when every winnings release for that member had already become final.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_settle(uuid,uuid)'::regprocedure)) = 'c07f4e3eebcb0de8f34079c07dd2aac8')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_profit_settle(uuid,uuid)'::regprocedure))
     <> '5505abba8cf4cf862c73b1160fce5445' THEN
    RAISE EXCEPTION 'promo profit settler changed; revalidate the final-gate check';
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_settle(p_club uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
 PERFORM 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=p_club AND g.user_id=p_user ORDER BY g.granted_at,g.id FOR UPDATE;
 -- A final winnings release cannot reopen. Keep the original grant locks and
 -- FIFO history whenever even one winnings gate could still change.
 IF NOT EXISTS (
   SELECT 1 FROM public.ca_promo_play_through_grants g
   JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
   WHERE g.club_id = p_club AND g.user_id = p_user
     AND w.unlocked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = g.id)
 ) THEN
   RETURN;
 END IF;
 FOR r IN SELECT DISTINCT s.grant_id FROM public.fn_ca_promo_shared_fee_state(p_club,p_user)s WHERE s.profit_earned>=s.profit_target AND s.profit_target>0 LOOP
  UPDATE public.ca_promo_profit_gates SET unlocked_at=clock_timestamp() WHERE grant_id=r.grant_id AND unlocked_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=r.grant_id);
 END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_settle(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

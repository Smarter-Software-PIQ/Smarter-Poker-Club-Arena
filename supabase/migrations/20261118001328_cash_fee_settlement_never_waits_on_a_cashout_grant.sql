-- The cash fee has already written its Club Data reporting row when this
-- deferred trigger fires. A seat cashout takes the grant first, then that row.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_after_original_fee()'::regprocedure)) = '2d1a95ea3f79d752dad7af75d0d3107f')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_profit_after_original_fee()'::regprocedure))
     <> 'e09a7e44e09b193fcc904497942b6dad' THEN
    RAISE EXCEPTION 'cash fee trigger changed; revalidate promo grant admission';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_after_original_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 -- Rake reporting has already written the same club/day/player row that a
 -- cashout writes after taking its promo grant. A final release has no work.
 IF NOT EXISTS (
   SELECT 1
   FROM public.ca_promo_play_through_grants g
   JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
   WHERE g.club_id = NEW.club_id AND g.user_id = NEW.player_id
     AND w.unlocked_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = g.id
     )
 ) THEN
   RETURN NULL;
 END IF;

 -- Do not wait for a cashout while holding the reporting row. A busy scope
 -- aborts the fee transaction, leaving its original hand receipt retryable.
 PERFORM public.fn_ca_promo_profit_try_member(NEW.club_id, NEW.player_id);
 PERFORM public.fn_ca_promo_profit_settle(NEW.club_id,NEW.player_id);
 RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_after_original_fee() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

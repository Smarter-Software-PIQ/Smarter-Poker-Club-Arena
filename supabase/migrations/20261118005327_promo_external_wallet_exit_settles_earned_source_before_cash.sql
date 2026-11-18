-- Settle physically held winnings at the real wallet exit under the original
-- earning membership before comparing the post-debit wallet with restrictions.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_play_through_on_exit()'::regprocedure))='8a850f705e213a7bb89bbf9ce64357c0')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $checked$
DECLARE
  definition text:=pg_get_functiondef('public.fn_ca_promo_play_through_on_exit()'::regprocedure);
  anchor text:=' PERFORM public.fn_ca_promo_integrity_guard_exit(NEW.id);';
BEGIN
  IF md5(definition)<>'cf75e6c1eff4796c0d24b243fde1ef17'
    OR length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
    RAISE EXCEPTION 'the original promo wallet exit changed; verify its earning scopes before installing';
  END IF;
  definition:=replace(definition,'DECLARE locked numeric;','DECLARE source record; locked numeric;');
  definition:=replace(definition,anchor,$body$
 -- A player's winnings can be in a different club from their source grant.
 -- Lock the same grant and membership scopes as the existing wallet owner.
 IF EXISTS (
   SELECT 1 FROM public.ca_promo_profit_custody c
   JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id AND w.unlocked_at IS NULL
   WHERE c.club_id=NEW.club_id AND c.user_id=NEW.from_entity_id
     AND c.kind=NEW.from_type AND c.entity_id=NEW.from_entity_id AND c.amount>0
     AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id)
 ) THEN
   PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,NEW.from_entity_id,NEW.from_type,NEW.from_entity_id);
   FOR source IN
     SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_profit_custody c
     JOIN public.ca_promo_profit_gates w ON w.grant_id=c.grant_id AND w.unlocked_at IS NULL
     JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
     WHERE c.club_id=NEW.club_id AND c.user_id=NEW.from_entity_id
       AND c.kind=NEW.from_type AND c.entity_id=NEW.from_entity_id AND c.amount>0
       AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id)
     ORDER BY g.club_id,g.user_id
   LOOP
     PERFORM public.fn_ca_promo_profit_settle(source.club_id,source.user_id);
   END LOOP;
 END IF;
$body$||anchor);
  EXECUTE definition;
END
$checked$;
COMMIT;

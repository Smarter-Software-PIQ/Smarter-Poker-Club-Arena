-- The finished Afternoon Free Buy could not settle: its cutoff funding posts
-- one promo grant per entrant inside the event's own transaction, and each
-- grant first settled the member, which re-reads that member's whole fee
-- history. With hundreds of entrants already holding an open grant that used
-- most of the statement budget, the payout rolled back every attempt, and the
-- union wallet row it held stalled cash-hand fee posting.
--
-- Only the Free Buy funding owner changes. It now writes its grant itself,
-- exactly as fn_ca_promo_play_through_record_grant writes it and under the
-- same member row lock, without reading fee history. The promo grant recorder
-- and every other grant door are untouched and still settle first.
--
-- Money outcome is unchanged. A grant's fee block starts at the fees observed
-- when its phase activates and after every earlier block
-- (fn_ca_promo_shared_fee_state); a met grant is unlocked by its state, not by
-- its closing row; and every custody mover and wallet exit settles the member
-- before it acts. What is no longer done here: closing the member's
-- already-met grants at the moment of the Free Buy funding. They close at the
-- member's next settlement, so a new Free Buy grant can carry the open met
-- grant's cycle_started_at, a column no fee arithmetic reads.
-- @live-proof: (SELECT md5(pg_get_functiondef(p.oid)) = '46bf53f61b34c8ce9e480fee5de571d6' AND p.prosecdef AND p.proowner = 'postgres'::regrole AND p.proacl::text = '{postgres=X/postgres}' AND p.proconfig::text = '{"search_path=public, smarter_private, pg_temp"}' FROM pg_proc p WHERE p.oid = 'public.fn_ca_promo_free_buy_funded()'::regprocedure)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_free_buy_funded()'::regprocedure))
     <> '7292fe8ac29956106555fcb9a29146d5' THEN
    RAISE EXCEPTION 'Free Buy funding owner changed; revalidate posting its grants without fee history';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_play_through_record_grant(uuid,uuid,numeric,text,text,uuid,text,uuid,numeric)'::regprocedure))
     <> '8b9cff0501b5882cc6b99e68d809021c' THEN
    RAISE EXCEPTION 'promo grant recorder changed; the Free Buy funding owner must write the same grant';
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_free_buy_funded()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'smarter_private', 'pg_temp'
AS $function$
DECLARE r record;gid uuid;capacity numeric;budget numeric;take numeric;total_cents bigint;index_no bigint:=0;member_count bigint;
 settings public.ca_promo_play_through_settings%ROWTYPE;grant_ref text;granted timestamptz;
BEGIN
 IF NEW.category<>'promo_send' OR NEW.from_type<>'union_wallet' OR NEW.to_type<>'prize_liability'
  OR NEW.metadata->>'kind' IS DISTINCT FROM 'midway_free_buy_promo_head'
  OR NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN NULL; END IF;
 IF NEW.from_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
  OR NEW.from_label IS DISTINCT FROM 'union_wallets.promo_wallet'
  OR NEW.tournament_id IS DISTINCT FROM NEW.to_entity_id OR NEW.amount<=0 THEN RAISE EXCEPTION 'promo_free_buy_original_funding_conflict'; END IF;
 IF NEW.metadata->>'stage'='cutoff' THEN
  IF NEW.idempotency_key IS DISTINCT FROM 'tourney:'||NEW.tournament_id||':free_buy_cutoff_funding' THEN RAISE EXCEPTION 'promo_free_buy_original_cutoff_conflict'; END IF;
 ELSE
  IF NEW.idempotency_key IS DISTINCT FROM 'tourney:'||NEW.tournament_id||':promo_head:'||(NEW.metadata->>'registration_id') THEN RAISE EXCEPTION 'promo_free_buy_original_head_conflict'; END IF;
 END IF;
 -- Original funding owner already holds the tournament lock. Snapshot only
 -- its valid redeemed registrations, sorted to make cent allocation stable.
 SELECT count(*),COALESCE(sum(greatest(0,1-COALESCE((SELECT sum(f.amount) FROM public.ca_promo_free_buy_funding_slices f WHERE f.registration_id=p.id),0))),0)
  INTO member_count,capacity FROM public.tournament_players p JOIN smarter_private.free_buy_ticket_redemptions d ON d.registration_id=p.id AND d.user_id=p.user_id AND d.tournament_id=p.tournament_id
  WHERE p.tournament_id=NEW.tournament_id AND d.returned_at IS NULL
   AND (NEW.metadata->>'stage'='cutoff' OR p.id::text=NEW.metadata->>'registration_id');
 budget:=least(NEW.amount,capacity);total_cents:=floor(budget*100);
 IF member_count=0 OR total_cents<=0 THEN RETURN NULL; END IF;
 -- Allocate exact cents in canonical registration order.
 -- Every previous source event consumes its face capacity even after loss/met.
 FOR r IN SELECT p.id,p.user_id,COALESCE(p.club_id,public.fn_tournament_club_for_user(p.user_id,p.tournament_id,NULL)) club_id,greatest(0,1-COALESCE((SELECT sum(f.amount) FROM public.ca_promo_free_buy_funding_slices f WHERE f.registration_id=p.id),0)) available
  FROM public.tournament_players p JOIN public.tournaments t ON t.id=p.tournament_id
  JOIN smarter_private.free_buy_ticket_redemptions d ON d.registration_id=p.id AND d.user_id=p.user_id AND d.tournament_id=p.tournament_id
  WHERE p.tournament_id=NEW.tournament_id AND d.returned_at IS NULL
   AND (NEW.metadata->>'stage'='cutoff' OR p.id::text=NEW.metadata->>'registration_id') ORDER BY p.id LOOP
  -- All coupons in a format have the same original funded components. The
  -- remaining budget/capacity proportional cut also handles legacy mixtures.
  IF capacity<=0 OR budget<=0 THEN EXIT; END IF;
  take:=least(r.available,trunc(budget*r.available/capacity,2));
  IF index_no=member_count-1 THEN take:=least(r.available,budget); END IF;
  index_no:=index_no+1;capacity:=capacity-r.available;budget:=budget-take;
  IF take<=0 THEN CONTINUE; END IF;
  -- One grant per funded coupon, written exactly as the promo grant recorder
  -- (fn_ca_promo_play_through_record_grant) writes it and under the member
  -- row lock the settler takes. It reads no fee history: a cutoff posts one
  -- grant per entrant inside the event's funding transaction, the new grant's
  -- fee block starts at its own activation, and whoever next moves or
  -- releases this member's chips settles first. A member holding an open
  -- grant whose target is below two times its amount still settles here.
  grant_ref:='free_buy_funding:'||NEW.id||':'||r.id;granted:=clock_timestamp();
  IF r.club_id IS NULL OR r.user_id IS NULL THEN
   RAISE EXCEPTION 'promo play-through grant needs a club, a member, a positive amount and a source reference'; END IF;
  SELECT * INTO settings FROM public.ca_promo_play_through_settings WHERE id;
  IF NOT FOUND OR settings.enforced_from IS NULL OR granted<settings.enforced_from THEN gid:=NULL;
  ELSE
   SELECT g.id INTO gid FROM public.ca_promo_play_through_grants g WHERE g.source_ref=grant_ref;
   IF gid IS NULL THEN
    PERFORM 1 FROM public.club_members m WHERE m.club_id=r.club_id AND m.user_id=r.user_id FOR NO KEY UPDATE;
    IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants g WHERE g.club_id=r.club_id AND g.user_id=r.user_id
     AND g.closed_at IS NULL AND g.fee_target<g.amount*2) THEN
     PERFORM public.fn_ca_promo_play_through_settle(r.club_id,r.user_id); END IF;
    INSERT INTO public.ca_promo_play_through_grants(club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,
     source_ledger_id,funded_from_type,funded_from_id,cycle_started_at,granted_at,expires_at)
    VALUES(r.club_id,r.user_id,take,take,settings.multiplier,'promo_ticket_prize',grant_ref,NEW.id,'union_wallet',NEW.from_entity_id,
     COALESCE((SELECT min(g.cycle_started_at) FROM public.ca_promo_play_through_grants g
      WHERE g.club_id=r.club_id AND g.user_id=r.user_id AND g.closed_at IS NULL),granted),
     granted,granted+make_interval(days=>settings.expiry_days))
    ON CONFLICT ON CONSTRAINT ca_promo_play_through_grants_source_once DO NOTHING RETURNING id INTO gid;
    IF gid IS NULL THEN SELECT g.id INTO gid FROM public.ca_promo_play_through_grants g WHERE g.source_ref=grant_ref; END IF;
   END IF;
  END IF;
  IF gid IS NOT NULL THEN
   UPDATE public.ca_promo_principal_custody SET kind='event',entity_id=NEW.tournament_id WHERE grant_id=gid AND kind='player_wallet' AND entity_id=r.user_id;
   INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining)
    VALUES(gid,NEW.tournament_id,NEW.id,'free_buy_funding:'||NEW.id||':'||r.id,take,take);
   INSERT INTO public.ca_promo_free_buy_funding_slices VALUES(NEW.id,r.id,gid,take);
   IF EXISTS(SELECT 1 FROM public.ca_promo_free_buy_exhaustions exhausted WHERE exhausted.registration_id=r.id) THEN UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent',close_note='Original Free Buy entry already exhausted before its deferred funding' WHERE id=gid; END IF;
  END IF;
 END LOOP;
 RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_free_buy_funded() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

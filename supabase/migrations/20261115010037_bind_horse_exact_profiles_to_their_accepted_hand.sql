-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- Private profile provenance. Existing counters have no reconstructible last
-- receipt. Only future eligible updates bind the version to an accepted hand.
BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE public.horse_exact_profiles ADD COLUMN last_accepted_hand_id uuid;
CREATE OR REPLACE FUNCTION public.fn_horse_exact_accept_hand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE actor record; h public.hand_history%ROWTYPE; m text; sz text;
BEGIN
 -- Receipt insertion follows history inside the original settlement transaction.
 -- A service/manual history INSERT alone is not accepted engine provenance.
 SELECT * INTO h FROM public.hand_history
 WHERE id=NEW.hand_id AND table_id=NEW.table_id AND hand_number=NEW.hand_number;
 IF NOT FOUND THEN RETURN NEW; END IF;
 -- Never reject an old/unknown-domain accepted hand or infer its rules.
 IF NOT public.fn_horse_public_domain_valid(h.public_memory_domain) THEN RETURN NEW; END IF;
 IF h.game_variant NOT IN ('nlh','plo4','plo5','plo6','plo8','flh','flo8','short_deck','pineapple')
    OR h.game_variant IS NULL THEN RETURN NEW; END IF;
 IF h.horse_exploit_dealt_count IS NULL OR h.horse_exploit_dealt_count NOT BETWEEN 2 AND 10 THEN RETURN NEW; END IF;
 m:=CASE WHEN h.tournament_id IS NULL THEN 'cash' ELSE 'tournament' END;
 sz:=CASE WHEN h.horse_exploit_dealt_count<=2 THEN 'hu' WHEN h.horse_exploit_dealt_count<=5 THEN 'short' ELSE 'full' END;
 FOR actor IN SELECT * FROM jsonb_each(public.fn_horse_exploit_increments(h.actions)) ORDER BY key LOOP
   INSERT INTO public.horse_exact_profiles(user_id,variant,mode,size,public_memory_domain,counters,observed_hands,initialized,last_accepted_hand_id)
   VALUES(actor.key,h.game_variant,m,sz,h.public_memory_domain,actor.value,1,true,NEW.hand_id)
   ON CONFLICT(user_id,variant,mode,size,public_memory_domain) DO UPDATE SET
     last_accepted_hand_id=excluded.last_accepted_hand_id,
     counters=public.fn_horse_exploit_add(horse_exact_profiles.counters,excluded.counters),
     observed_hands=horse_exact_profiles.observed_hands+1,updated_at=clock_timestamp();
 END LOOP;
 RETURN NEW;
END $f$;
COMMIT;

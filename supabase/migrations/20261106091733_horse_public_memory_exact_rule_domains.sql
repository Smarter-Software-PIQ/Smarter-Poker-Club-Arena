-- @install-window: daily-maintenance
-- Exact public rule domains. Legacy writers/RPC/rows retain their original contract.
-- New engine requires this additive schema before activation; old missing context
-- skips only the new learner. No historical counters are relabelled or backfilled.
BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE public.hand_history ADD COLUMN public_memory_domain jsonb;
CREATE TABLE public.horse_exact_profiles (
 LIKE public.horse_exploit_profiles INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
 public_memory_domain jsonb NOT NULL,
 PRIMARY KEY (user_id,variant,mode,size,public_memory_domain)
);
ALTER TABLE public.horse_exact_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.horse_exact_profiles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.horse_exact_profiles TO service_role;
CREATE FUNCTION public.fn_horse_public_domain_valid(d jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN jsonb_typeof(d) IS DISTINCT FROM 'object' THEN false ELSE COALESCE(d->'version'='1'::jsonb
   AND d->>'speed' IN ('table','lightning')
   AND d->>'ante' IN ('none','individual','big_blind')
   AND d - ARRAY['version','speed','ante']='{}'::jsonb,false) END
$f$;
CREATE FUNCTION public.fn_horse_exact_accept_hand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE actor record; m text; sz text;
BEGIN
 -- Never reject an old/unknown-domain accepted hand or infer its rules.
 IF NOT public.fn_horse_public_domain_valid(NEW.public_memory_domain) THEN RETURN NEW; END IF;
 IF NEW.game_variant NOT IN ('nlh','plo4','plo5','plo6','plo8','flh','flo8','short_deck','pineapple')
    OR NEW.game_variant IS NULL THEN RETURN NEW; END IF;
 IF NEW.horse_exploit_dealt_count IS NULL OR NEW.horse_exploit_dealt_count NOT BETWEEN 2 AND 10 THEN RETURN NEW; END IF;
 m:=CASE WHEN NEW.tournament_id IS NULL THEN 'cash' ELSE 'tournament' END;
 sz:=CASE WHEN NEW.horse_exploit_dealt_count<=2 THEN 'hu' WHEN NEW.horse_exploit_dealt_count<=5 THEN 'short' ELSE 'full' END;
 FOR actor IN SELECT * FROM jsonb_each(public.fn_horse_exploit_increments(NEW.actions)) ORDER BY key LOOP
   INSERT INTO public.horse_exact_profiles(user_id,variant,mode,size,public_memory_domain,counters,observed_hands,initialized)
   VALUES(actor.key,NEW.game_variant,m,sz,NEW.public_memory_domain,actor.value,1,true)
   ON CONFLICT(user_id,variant,mode,size,public_memory_domain) DO UPDATE SET
     counters=public.fn_horse_exploit_add(horse_exact_profiles.counters,excluded.counters),
     observed_hands=horse_exact_profiles.observed_hands+1,updated_at=clock_timestamp();
 END LOOP;
 RETURN NEW;
END $f$;
-- Same accepted INSERT transaction and existing hand uniqueness supply dedup.
CREATE TRIGGER horse_exact_accept_hand AFTER INSERT ON public.hand_history
 FOR EACH ROW EXECUTE FUNCTION public.fn_horse_exact_accept_hand();
CREATE FUNCTION public.fn_horse_exact_profiles_read(p_user_ids text[],p_variant text,p_mode text,p_size text,p_speed text,p_ante text)
RETURNS SETOF public.horse_exact_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE d jsonb:=jsonb_build_object('version',1,'speed',p_speed,'ante',p_ante);
BEGIN
 IF coalesce(cardinality(p_user_ids),0) NOT BETWEEN 1 AND 10 OR
    cardinality(p_user_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_user_ids) x) OR
    NOT public.fn_horse_public_domain_valid(d) THEN RETURN; END IF;
 RETURN QUERY SELECT p.* FROM public.horse_exact_profiles p
 WHERE p.user_id=ANY(p_user_ids) AND p.variant=p_variant AND p.mode=p_mode AND p.size=p_size
 AND p.public_memory_domain=d ORDER BY p.user_id;
END $f$;
REVOKE ALL ON FUNCTION public.fn_horse_public_domain_valid(jsonb),public.fn_horse_exact_accept_hand(),public.fn_horse_exact_profiles_read(text[],text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_horse_exact_profiles_read(text[],text,text,text,text,text) TO service_role;
COMMIT;

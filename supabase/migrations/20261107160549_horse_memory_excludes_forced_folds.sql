-- @install-window: daily-maintenance
-- Explicit player, pre-action and Horse policy folds are intentional. A missing,
-- unknown, fallback or forced origin is preserved in history but cannot train a fold.
BEGIN;
SET LOCAL lock_timeout='1s';

-- Drain accepted writers and cold readers before freezing the old aggregate epoch.
-- Use the established cold-reader advisory lock. No history rows are scanned.
SELECT pg_advisory_xact_lock(hashtextextended('horse-opponent-legacy-initialization:v1',0));
LOCK TABLE public.hand_history, public.hand_atomic_commits IN SHARE MODE;
LOCK TABLE public.horse_exploit_profiles, public.horse_exact_profiles IN SHARE ROW EXCLUSIVE MODE;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exploit_increments(jsonb,text)', $a$IF id IS NULL OR id='' OR act NOT IN$a$,
   $b$IF a->>'origin'='forced' OR (act='fold' AND coalesce(a->>'origin','') NOT IN ('player','pre_action','horse_policy')) OR id IS NULL OR id='' OR act NOT IN$b$),
  ('public.fn_horse_exploit_actor_increments(jsonb,text)', $a$action text,stage text,"isFullRaise" text) LOOP$a$,
   $b$action text,stage text,"isFullRaise" text,origin text) LOOP$b$),
  ('public.fn_horse_exploit_actor_increments(jsonb,text)', $a$IF a."userId" IS NULL OR$a$,
   $b$IF a.origin='forced' OR (a.action='fold' AND coalesce(a.origin,'') NOT IN ('player','pre_action','horse_policy')) OR a."userId" IS NULL OR$b$),
  ('public.fn_horse_exploit_profiles_read(text[],text,text,text)', $a$WHERE a->>'userId'=uid AND a->>'action' IN$a$,
   $b$WHERE a->>'origin' IS DISTINCT FROM 'forced' AND (a->>'action'<>'fold' OR a->>'origin' IN ('player','pre_action','horse_policy')) AND a->>'userId'=uid AND a->>'action' IN$b$)
 ) edits(name,old_fragment,new_fragment) LOOP
  signature:=item.name::regprocedure;
  def:=pg_get_functiondef(signature);
  IF strpos(def,item.new_fragment)>0 THEN CONTINUE; END IF;
  IF (length(def)-length(replace(def,item.old_fragment,'')))<>length(item.old_fragment) THEN
   RAISE EXCEPTION 'unexpected public-memory reducer preimage: %',item.name;
  END IF;
  EXECUTE replace(def,item.old_fragment,item.new_fragment);
 END LOOP;
END $patch$;

-- Take one immutable epoch snapshot. Existing decayed counters do not retain
-- individual fold provenance. There is no mathematically valid subtraction.
-- Keep every pre-epoch human or unclassified row intact for restricted audit.
-- Only explicitly classified Horses retain their rows in the active models.
DO $cutoff$
BEGIN
 IF to_regclass('public.horse_memory_before_fold_provenance') IS NOT NULL THEN RETURN; END IF;
 CREATE TABLE public.horse_memory_before_fold_provenance (
  source text NOT NULL, profile jsonb NOT NULL
 );
 ALTER TABLE public.horse_memory_before_fold_provenance ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON public.horse_memory_before_fold_provenance FROM PUBLIC,anon,authenticated,service_role;
 WITH retired AS (
  DELETE FROM public.horse_exploit_profiles p WHERE NOT EXISTS
    (SELECT 1 FROM public.profiles u WHERE u.id::text=p.user_id AND u.is_horse IS TRUE)
  RETURNING p.*
 ) INSERT INTO public.horse_memory_before_fold_provenance SELECT 'legacy',to_jsonb(r) FROM retired r;
 WITH retired AS (
  DELETE FROM public.horse_exact_profiles p WHERE NOT EXISTS
    (SELECT 1 FROM public.profiles u WHERE u.id::text=p.user_id AND u.is_horse IS TRUE)
  RETURNING p.*
 ) INSERT INTO public.horse_memory_before_fold_provenance SELECT 'exact',to_jsonb(r) FROM retired r;
 -- A missing legacy key follows its ordinary filtered cold-read path. Exact
 -- contexts resume on their next accepted discretionary observation.
END $cutoff$;
COMMIT;

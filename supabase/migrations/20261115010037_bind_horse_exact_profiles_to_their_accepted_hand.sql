-- @install-window: daily-maintenance
-- @locks: public.horse_exact_profiles
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='last_accepted_hand_id' AND atttypid='uuid'::regtype AND NOT attisdropped) AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.hand_atomic_commits') AND tgname='horse_exact_accept_hand' AND tgenabled IN ('O','A') AND tgtype=5 AND tgfoid=to_regprocedure('public.fn_horse_exact_accept_hand()')) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'INSERT INTO public.horse_exact_profiles(last_accepted_hand_id,user_id,')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'VALUES(NEW.hand_id,actor.key,h.game_variant,')>0 AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'last_accepted_hand_id=excluded.last_accepted_hand_id')>0)
-- Private profile provenance. Existing counters have no reconstructible last
-- receipt. Only future eligible updates bind the version to an accepted hand.
BEGIN;
SET LOCAL lock_timeout = '1s';
ALTER TABLE public.horse_exact_profiles ADD COLUMN last_accepted_hand_id uuid;
-- Insert before the domain/counter fields so the independent long-window
-- migration can extend their suffix, in either installation order.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_horse_exact_accept_hand()'::regprocedure);
  edit record;
BEGIN
  FOR edit IN SELECT * FROM (VALUES
    ('INSERT INTO public.horse_exact_profiles(user_id,',
     'INSERT INTO public.horse_exact_profiles(last_accepted_hand_id,user_id,'),
    ('VALUES(actor.key,h.game_variant,', 'VALUES(NEW.hand_id,actor.key,h.game_variant,'),
    ('ON CONFLICT(user_id,variant,mode,size,public_memory_domain) DO UPDATE SET',
     'ON CONFLICT(user_id,variant,mode,size,public_memory_domain) DO UPDATE SET last_accepted_hand_id=excluded.last_accepted_hand_id,')
  ) edits(before_sql,after_sql) LOOP
    IF length(definition) - length(replace(definition,edit.before_sql,'')) <> length(edit.before_sql) THEN
      RAISE EXCEPTION 'unexpected accepted-hand lineage preimage: %',edit.before_sql;
    END IF;
    definition := replace(definition,edit.before_sql,edit.after_sql);
  END LOOP;
  EXECUTE definition;
END $patch$;
COMMIT;

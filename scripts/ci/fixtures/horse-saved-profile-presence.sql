BEGIN;
CREATE TEMP TABLE subjects AS SELECT array_agg(('10000000-0000-4000-8000-' || lpad(i::text, 12, '0')) ORDER BY i) AS ids FROM generate_series(1,3) i;
INSERT INTO public.horse_exact_profiles (user_id,variant,mode,size,public_memory_domain)
SELECT ids[1], 'nlh', 'cash', 'short', '{"version":1,"speed":"table","ante":"none"}'::jsonb FROM subjects
UNION ALL SELECT ids[2], 'nlh', 'cash', 'short', '{"version":1,"speed":"lightning","ante":"none"}'::jsonb FROM subjects;
-- Exercise the same read on both sides of the independent long-window migration.
DO $seed$
BEGIN
  IF EXISTS (SELECT FROM pg_attribute WHERE attrelid='public.horse_exact_profiles'::regclass AND attname='long_counters' AND NOT attisdropped) THEN
    UPDATE public.horse_exact_profiles p SET
      counters=public.fn_horse_exploit_increments(jsonb_build_array(jsonb_build_object('userId',p.user_id,'action','call','stage','preflop','origin','player')))->p.user_id,
      observed_hands=1, long_counters='{"lHands":1,"lVpip":1,"lPfr":0}'::jsonb
    FROM subjects WHERE p.user_id=subjects.ids[2];
  END IF;
END $seed$;
GRANT SELECT ON subjects TO service_role;
SET LOCAL ROLE service_role;
DO $test$
DECLARE actors text[]; actual text[]; profile jsonb; expected_long jsonb; domain jsonb := '{"version":1,"speed":"table","ante":"none"}';
BEGIN
  SELECT ids INTO actors FROM subjects;
  SELECT array_agg(presence ORDER BY user_id) INTO actual FROM public.fn_horse_saved_profile_presence(actors,'nlh','cash','short',domain);
  IF actual IS DISTINCT FROM ARRAY['exact','other_context','no_saved_row'] THEN RAISE EXCEPTION 'incorrect saved presence: %',actual; END IF;
  IF NOT EXISTS (SELECT FROM public.fn_horse_saved_profile_presence(actors,'nlh','cash','short',domain)
    WHERE user_id=actors[1] AND presence='exact' AND exact_profile->>'observed_hands'='0' AND exact_profile->>'last_accepted_hand_id' IS NULL) THEN
    RAISE EXCEPTION 'unobserved exact row lost or acquired unproven lineage';
  END IF;
  IF EXISTS (SELECT FROM public.fn_horse_saved_profile_presence(actors,'nlh','cash','short',domain)
    WHERE presence<>'exact' AND exact_profile IS NOT NULL) THEN
    RAISE EXCEPTION 'other context counters leaked';
  END IF;
  SELECT exact_profile INTO STRICT profile FROM public.fn_horse_saved_profile_presence(
    ARRAY[actors[2]],'nlh','cash','short','{"version":1,"speed":"lightning","ante":"none"}');
  SELECT to_jsonb(p)->'long_counters' INTO expected_long FROM public.horse_exact_profiles p WHERE p.user_id=actors[2];
  IF profile->'long_counters' IS DISTINCT FROM coalesce(expected_long,'null'::jsonb)
    OR (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(profile) k)
      IS DISTINCT FROM ARRAY['counters','initialized','last_accepted_hand_id','long_counters','mode','observed_hands','public_memory_domain','size','user_id','variant'] THEN
    RAISE EXCEPTION 'exact public profile fields or long counters changed';
  END IF;
  BEGIN
    PERFORM * FROM public.fn_horse_saved_profile_presence(actors||actors,'nlh','cash','short',domain);
    RAISE EXCEPTION 'duplicate subjects accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF has_function_privilege('anon','public.fn_horse_saved_profile_presence(text[],text,text,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.fn_horse_saved_profile_presence(text[],text,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'player-readable presence function';
  END IF;
END $test$;
ROLLBACK;

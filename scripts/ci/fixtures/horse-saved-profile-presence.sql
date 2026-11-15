BEGIN;
CREATE TEMP TABLE subjects AS SELECT array_agg(('10000000-0000-4000-8000-' || lpad(i::text, 12, '0')) ORDER BY i) AS ids FROM generate_series(1,3) i;
INSERT INTO public.horse_exact_profiles (user_id,variant,mode,size,public_memory_domain)
SELECT ids[1], 'nlh', 'cash', 'short', '{"version":1,"speed":"table","ante":"none"}'::jsonb FROM subjects
UNION ALL SELECT ids[2], 'nlh', 'cash', 'short', '{"version":1,"speed":"lightning","ante":"none"}'::jsonb FROM subjects;
GRANT SELECT ON subjects TO service_role;
SET LOCAL ROLE service_role;
DO $test$
DECLARE actors text[]; actual text[]; domain jsonb := '{"version":1,"speed":"table","ante":"none"}';
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

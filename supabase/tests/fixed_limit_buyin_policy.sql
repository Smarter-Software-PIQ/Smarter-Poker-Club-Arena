-- Run against the isolated qualified schema after the migration. Never production.
BEGIN;
DO $test$
DECLARE variant text; stake record;
BEGIN
 FOREACH variant IN ARRAY ARRAY['flh','flo8'] LOOP
  FOR stake IN SELECT * FROM (VALUES (1::numeric,2::numeric),(2::numeric,5::numeric),(5::numeric,10::numeric)) s(sb,bb) LOOP
   IF NOT public.fn_horse_cash_game_allowed(variant,stake.sb,stake.bb,NULL,'2026-11-03 12:00Z') THEN
    RAISE EXCEPTION 'Requested fixed-limit blinds refused: % %/%',variant,stake.sb,stake.bb;
   END IF;
  END LOOP;
  IF public.fn_horse_cash_game_allowed(variant,5,11,NULL,'2026-11-03 12:00Z') THEN
   RAISE EXCEPTION 'Fixed-limit horse exceeded blind ceiling';
  END IF;
  IF public.fn_cash_template_defaults('classic',variant)->>'max_buyin_bb' IS NOT NULL THEN
   RAISE EXCEPTION 'Fixed-limit template still caps buy-in';
  END IF;
  IF (public.fn_cash_template_defaults('classic',variant)->>'min_buyin_bb')::numeric<=0 THEN
   RAISE EXCEPTION 'Fixed-limit minimum lost';
  END IF;
 END LOOP;
 FOREACH variant IN ARRAY ARRAY['nlh','plo','plo4','plo5','plo6'] LOOP
  IF NOT public.fn_horse_cash_game_allowed(variant,1,2,NULL,'2026-11-03 12:00Z') THEN RAISE EXCEPTION '1/2 horse refused'; END IF;
  IF public.fn_horse_cash_game_allowed(variant,2,5,NULL,'2026-11-03 12:00Z') THEN RAISE EXCEPTION 'Non-limit horse ceiling broadened'; END IF;
 END LOOP;
 IF (public.fn_cash_template_defaults('classic','nlh')->>'max_buyin_bb')::numeric<>200 THEN RAISE EXCEPTION 'NLH max changed'; END IF;
END
$test$;
ROLLBACK;

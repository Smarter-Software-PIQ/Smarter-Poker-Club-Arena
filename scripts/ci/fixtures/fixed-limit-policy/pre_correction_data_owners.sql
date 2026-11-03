BEGIN;
-- Update configuration through its original projection; no financial rows change.
UPDATE public.cash_games SET ruleset_snapshot=ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL),updated_at=now()
WHERE variant IN ('flh','flo8') AND enabled AND ruleset_snapshot->>'max_buyin_bb' IS NOT NULL;
SELECT public.fn_cash_apply_ruleset(id) FROM public.cash_games WHERE enabled AND variant IN ('flh','flo8');
UPDATE public.tables SET max_buy_in=NULL WHERE tournament_id IS NULL AND game_variant IN ('flh','flo8')
AND max_buy_in IS NOT NULL AND lifecycle<>'closed' AND NOT coalesce(is_deleted,false);
-- Ensure new Classic games only for hosts already operating fixed limit.
-- This opens a new table through the maintained owner; closed historical tables stay closed.
DO $catalogue$
DECLARE host record; stake record;
BEGIN
 FOR host IN SELECT DISTINCT club_id,variant FROM public.cash_games
   WHERE enabled AND closed_at IS NULL AND variant IN ('flh','flo8') LOOP
   FOR stake IN SELECT * FROM (VALUES (1::numeric,2::numeric),(2::numeric,5::numeric),(5::numeric,10::numeric)) s(sb,bb) LOOP
     PERFORM public.fn_cash_game_ensure(host.club_id,host.variant,stake.sb,stake.bb,'classic',NULL);
   END LOOP;
 END LOOP;
END
$catalogue$;
COMMIT;

-- Owner November 1: halve future guarantees except the 200 entry / 25K event.
-- Finite transition instances created by the old engine after the initial capture.
-- Exact IDs and original amounts prevent double reduction. Preserve entered,
-- locked, finalized, running and pre-midnight contracts; no wallet or payout edit.
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t JOIN (VALUES  ('94ef58cf-5f0b-47dd-bbe1-d490e036b083'::uuid, 2500::numeric),  ('92b73021-1e8e-410f-9ad0-72ae70e185ba'::uuid, 1500::numeric),  ('678f4121-944d-4120-b8b9-ec6b4fa49405'::uuid, 2000::numeric) ) AS b(id,old_guarantee) ON t.id=b.id WHERE t.id=b.id AND t.guaranteed_prize=b.old_guarantee  AND t.start_time >= '2026-11-02 06:00:00+00'::timestamptz  AND upper(t.status) IN ('ANNOUNCED','REGISTERING')  AND NOT coalesce(t.prize_pool_finalized,false)  AND NOT coalesce(t.entry_contract_locked,false)  AND NOT (coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=200 AND t.guaranteed_prize=25000)  AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id))
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION pg_temp.reduced_guarantee_copy(p_text text, p_before numeric, p_after numeric)
RETURNS text LANGUAGE plpgsql AS $copy$
DECLARE result text := p_text; old_label text; new_label text; suffix text; i integer;
BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 FOR i IN 1..2 LOOP
  old_label := trim_scale(CASE WHEN i=1 AND p_before>=1000 THEN p_before/1000 ELSE p_before END)::text || CASE WHEN i=1 AND p_before>=1000 THEN 'K' ELSE '' END;
  new_label := trim_scale(CASE WHEN i=1 AND p_after>=1000 THEN p_after/1000 ELSE p_after END)::text || CASE WHEN i=1 AND p_after>=1000 THEN 'K' ELSE '' END;
  FOREACH suffix IN ARRAY ARRAY[' GTD',' Guarantee',' Chip Guarantee',' Diamond Guarantee'] LOOP
   result := regexp_replace(result, '(^|[^0-9.])' || replace(old_label,'.','\.') || suffix, '\1' || new_label || suffix, 'g');
  END LOOP;
  result := replace(result,'Nightly '||old_label,'Nightly '||new_label);
 END LOOP;
 RETURN result;
END $copy$;

WITH baseline(id, old_guarantee) AS (VALUES
 ('94ef58cf-5f0b-47dd-bbe1-d490e036b083'::uuid, 2500::numeric),
 ('92b73021-1e8e-410f-9ad0-72ae70e185ba'::uuid, 1500::numeric),
 ('678f4121-944d-4120-b8b9-ec6b4fa49405'::uuid, 2000::numeric)
)
UPDATE public.tournaments t
SET guaranteed_prize = round(b.old_guarantee / 2, 2),
    name = pg_temp.reduced_guarantee_copy(t.name,b.old_guarantee,round(b.old_guarantee/2,2)),
    description = pg_temp.reduced_guarantee_copy(t.description,b.old_guarantee,round(b.old_guarantee/2,2)),
    short_description = pg_temp.reduced_guarantee_copy(t.short_description,b.old_guarantee,round(b.old_guarantee/2,2))
FROM baseline b
WHERE t.id=b.id AND t.guaranteed_prize=b.old_guarantee
 AND t.start_time >= '2026-11-02 06:00:00+00'::timestamptz
 AND upper(t.status) IN ('ANNOUNCED','REGISTERING')
 AND NOT coalesce(t.prize_pool_finalized,false)
 AND NOT coalesce(t.entry_contract_locked,false)
 AND NOT (coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=200 AND t.guaranteed_prize=25000)
 AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id);
COMMIT;

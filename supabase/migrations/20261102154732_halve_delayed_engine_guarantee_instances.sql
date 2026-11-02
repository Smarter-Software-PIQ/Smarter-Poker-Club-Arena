-- Complete the November 2 guarantee policy for exact instances created by the
-- old engine while its replacement was blocked. The permanent producer fix is
-- TournamentGuaranteePolicy.ts (protected PRs 9264 and 9296).
-- Preserve the final nightly 10K, 1.5K, Six-Card 500 and 200-entry/25K terms.
-- Exact IDs, schedule identities and original amounts make this finite and
-- idempotent. No wallet, payout, tournament participation or schedule edits.
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t JOIN (VALUES  ('b84fcc96-cf94-4b94-a76b-329d80a7f555'::uuid,'6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid,500::numeric,250::numeric),  ('ce952f30-825a-4080-acd0-aa83a4503855'::uuid,'b9c31f19-70df-4b5c-9e8a-04ebaa945f61'::uuid,250::numeric,125::numeric),  ('5435baf9-b626-4a94-8282-e927f02fc30a'::uuid,'207585bc-9ff4-4abe-ad91-cfd1a4bd486c'::uuid,500::numeric,250::numeric),  ('aaf3a0ac-81ba-4b68-8d2d-a9ae75095f72'::uuid,'496fe7e6-28a9-4383-9038-692fcf48fa0a'::uuid,500::numeric,250::numeric),  ('930eee14-faaf-43cf-8f4a-bd8a92c48fd6'::uuid,'a4e5ac92-019f-415a-b4c4-fb95bc037ecc'::uuid,250::numeric,125::numeric),  ('2e51996a-a226-4b0d-8def-4931aa9d4a9c'::uuid,'e6953809-af43-4397-a15c-4ea2ce50aa14'::uuid,500::numeric,250::numeric),  ('4b07b775-26d9-471d-bfd0-fd3f3e86817a'::uuid,'2392cd18-8604-41cc-8037-bcd17c57d2d2'::uuid,500::numeric,250::numeric)) AS b(id,schedule_id,old_guarantee,new_guarantee) ON t.id=b.id WHERE t.id=b.id AND t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee  AND t.created_at >= '2026-11-02 06:00+00'::timestamptz  AND t.start_time >= '2026-11-02 06:00+00'::timestamptz  AND upper(t.status) IN ('ANNOUNCED','REGISTERING')  AND NOT coalesce(t.prize_pool_finalized,false)  AND NOT coalesce(t.entry_contract_locked,false)  AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id))
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

WITH baseline(id,schedule_id,old_guarantee,new_guarantee) AS (VALUES
 ('b84fcc96-cf94-4b94-a76b-329d80a7f555'::uuid,'6ad0e7a7-a08a-4ab5-8b5d-2d568211ec78'::uuid,500::numeric,250::numeric),
 ('ce952f30-825a-4080-acd0-aa83a4503855'::uuid,'b9c31f19-70df-4b5c-9e8a-04ebaa945f61'::uuid,250::numeric,125::numeric),
 ('5435baf9-b626-4a94-8282-e927f02fc30a'::uuid,'207585bc-9ff4-4abe-ad91-cfd1a4bd486c'::uuid,500::numeric,250::numeric),
 ('aaf3a0ac-81ba-4b68-8d2d-a9ae75095f72'::uuid,'496fe7e6-28a9-4383-9038-692fcf48fa0a'::uuid,500::numeric,250::numeric),
 ('930eee14-faaf-43cf-8f4a-bd8a92c48fd6'::uuid,'a4e5ac92-019f-415a-b4c4-fb95bc037ecc'::uuid,250::numeric,125::numeric),
 ('2e51996a-a226-4b0d-8def-4931aa9d4a9c'::uuid,'e6953809-af43-4397-a15c-4ea2ce50aa14'::uuid,500::numeric,250::numeric),
 ('4b07b775-26d9-471d-bfd0-fd3f3e86817a'::uuid,'2392cd18-8604-41cc-8037-bcd17c57d2d2'::uuid,500::numeric,250::numeric)
)
UPDATE public.tournaments t
SET guaranteed_prize=b.new_guarantee,
 name=pg_temp.reduced_guarantee_copy(t.name,b.old_guarantee,b.new_guarantee),
 description=pg_temp.reduced_guarantee_copy(t.description,b.old_guarantee,b.new_guarantee),
 short_description=pg_temp.reduced_guarantee_copy(t.short_description,b.old_guarantee,b.new_guarantee)
FROM baseline b
WHERE t.id=b.id AND t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee
 AND t.created_at >= '2026-11-02 06:00+00'::timestamptz
 AND t.start_time >= '2026-11-02 06:00+00'::timestamptz
 AND upper(t.status) IN ('ANNOUNCED','REGISTERING')
 AND NOT coalesce(t.prize_pool_finalized,false)
 AND NOT coalesce(t.entry_contract_locked,false)
 AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id);
COMMIT;

-- Complete final guarantee terms for captured exact instances created by the
-- old engine while its replacement was blocked. The permanent producer fix is
-- TournamentGuaranteePolicy.ts (protected PRs 9264 and 9296).
-- Preserve the final nightly 10K, 1.5K, Six-Card 500 and 200-entry/25K terms.
-- Exact IDs, schedule identities and original amounts make this finite and
-- idempotent. No wallet, payout, tournament participation or schedule edits.
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t JOIN (VALUES  ('4b235295-d4d9-4f8c-b1b4-e5f2fc195dc2'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),  ('6eb99ddf-8e57-4b39-8a30-9151dbcaa350'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric)) AS b(id,schedule_id,old_guarantee,new_guarantee) ON t.id=b.id WHERE t.id=b.id AND t.schedule_id=b.schedule_id AND t.guaranteed_prize=b.old_guarantee  AND t.created_at >= '2026-11-02 06:00+00'::timestamptz  AND t.start_time >= '2026-11-02 06:00+00'::timestamptz  AND upper(t.status) IN ('ANNOUNCED','REGISTERING')  AND NOT coalesce(t.prize_pool_finalized,false)  AND NOT coalesce(t.entry_contract_locked,false)  AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id))
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
 ('4b235295-d4d9-4f8c-b1b4-e5f2fc195dc2'::uuid,'df30c416-0f1f-482c-9b04-0ead175eb6fe'::uuid,500::numeric,250::numeric),
 ('6eb99ddf-8e57-4b39-8a30-9151dbcaa350'::uuid,'594dcaae-3c08-49ab-937a-e9191f9e21a9'::uuid,500::numeric,250::numeric)
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

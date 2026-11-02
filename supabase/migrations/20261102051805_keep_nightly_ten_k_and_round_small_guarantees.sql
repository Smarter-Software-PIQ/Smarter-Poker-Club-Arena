-- Owner final instruction: nightly 7pm 35-chip rebuy/add-on stays 10K;
-- both 1200 and 1250 become 1500. Every other current guarantee is unchanged.
-- Permanent future creation is implemented in TournamentGuaranteePolicy.ts.
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.start_time >= '2026-11-02 06:00+00'::timestamptz AND upper(t.status) IN ('ANNOUNCED','REGISTERING') AND NOT coalesce(t.prize_pool_finalized,false) AND NOT coalesce(t.entry_contract_locked,false) AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id) AND (t.guaranteed_prize IN (1200,1250) OR (t.schedule_id='099ac5a4-c866-4acb-917c-31337bf468b1'::uuid AND t.guaranteed_prize=5000 AND coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=35)))
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

WITH selected AS (SELECT t.id,t.guaranteed_prize AS old_guarantee, CASE WHEN t.guaranteed_prize IN (1200,1250) THEN 1500 ELSE 10000 END::numeric AS new_guarantee FROM public.tournaments t WHERE t.start_time >= '2026-11-02 06:00+00'::timestamptz AND upper(t.status) IN ('ANNOUNCED','REGISTERING') AND NOT coalesce(t.prize_pool_finalized,false) AND NOT coalesce(t.entry_contract_locked,false) AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id) AND (t.guaranteed_prize IN (1200,1250) OR (t.schedule_id='099ac5a4-c866-4acb-917c-31337bf468b1'::uuid AND t.guaranteed_prize=5000 AND coalesce(t.buy_in_amount,0)+coalesce(t.buy_in_fee,0)=35)))
UPDATE public.tournaments t SET guaranteed_prize=s.new_guarantee, name=pg_temp.reduced_guarantee_copy(t.name,s.old_guarantee,s.new_guarantee), description=pg_temp.reduced_guarantee_copy(t.description,s.old_guarantee,s.new_guarantee), short_description=pg_temp.reduced_guarantee_copy(t.short_description,s.old_guarantee,s.new_guarantee) FROM selected s WHERE t.id=s.id;
COMMIT;

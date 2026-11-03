-- Owner-requested November 3 Chicago no-guarantee tournaments.
-- Attendance is preserved separately; this never supplies prize money or tickets.
-- Existing fourteen unstarted offers were read with zero entrants/charges/pools.
-- No historical/started event, recurring template, wallet or payout is changed.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_overlay_at_risk(uuid)'::regprocedure)) <> '460e3d0b66c6092c07489b9746c51554' THEN
    RAISE EXCEPTION 'nov3_overlay_owner_changed';
  END IF;
END $preimage$;

-- No FK to the hot tournaments table: this private immutable planning record
-- is not financial authority, and must not take a writer-blocking FK lock.
CREATE TABLE smarter_private.nov3_tournament_attendance (
  tournament_id uuid PRIMARY KEY,
  attendance_floor integer NOT NULL CHECK(attendance_floor >= 0),
  original_guarantee numeric NOT NULL CHECK(original_guarantee >= 0),
  original_start_time timestamptz NOT NULL,
  original_name text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((original_start_time AT TIME ZONE 'America/Chicago')::date=DATE '2026-11-03')
);
ALTER TABLE smarter_private.nov3_tournament_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.nov3_tournament_attendance FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.nov3_without_guarantee_copy(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
   btrim(regexp_replace(regexp_replace(regexp_replace(
     replace(p_text,'Nightly 10K','Nightly'),
     '[[:space:]]*(-[[:space:]]*)?[$]?[0-9][0-9,.]*[kKmM]?[[:space:]]+(GTD|Guaranteed)[.]?', '', 'gi'),
     'Liquidity-Sized Guarantee','No Guarantee','gi'),
     '[[:space:]]{2,}',' ','g')) END
$body$;
REVOKE ALL ON FUNCTION smarter_private.nov3_without_guarantee_copy(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.apply_nov3_zero_guarantee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE v_charge numeric; v_floor integer;
BEGIN
  IF NEW.started_at IS NOT NULL OR upper(NEW.status) NOT IN ('SCHEDULED','ANNOUNCED','REGISTERING')
    OR NEW.start_time IS NULL OR (NEW.start_time AT TIME ZONE 'America/Chicago')::date <> DATE '2026-11-03'
  THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (OLD.started_at IS NOT NULL OR upper(OLD.status) IN ('RUNNING','BREAK','LATE_REG','COMPLETING','COMPLETED','CANCELLED')) THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.guaranteed_prize,0)>0 AND (
    EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=NEW.id)
    OR EXISTS(SELECT 1 FROM public.tournament_refund_entitlements WHERE tournament_id=NEW.id)
    OR coalesce(NEW.prize_pool,0)<>0 OR coalesce(NEW.prize_pool_finalized,false)) THEN
    RAISE EXCEPTION 'nov3_existing_financial_contract_refused';
  END IF;
  v_charge := round(coalesce(NEW.buy_in_amount,0),2)+round(coalesce(NEW.buy_in_fee,0),2);
  v_floor := CASE WHEN v_charge>0 THEN ceil(greatest(coalesce(NEW.guaranteed_prize,0),0)/v_charge)::integer ELSE 0 END;
  INSERT INTO smarter_private.nov3_tournament_attendance(tournament_id,attendance_floor,original_guarantee,original_start_time,original_name)
    VALUES(NEW.id,v_floor,greatest(coalesce(NEW.guaranteed_prize,0),0),NEW.start_time,NEW.name)
    ON CONFLICT(tournament_id) DO NOTHING;
  NEW.guaranteed_prize := 0;
  NEW.name := smarter_private.nov3_without_guarantee_copy(NEW.name);
  NEW.description := smarter_private.nov3_without_guarantee_copy(NEW.description);
  NEW.short_description := smarter_private.nov3_without_guarantee_copy(NEW.short_description);
  RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION smarter_private.apply_nov3_zero_guarantee() FROM PUBLIC,anon,authenticated,service_role;
-- Runs after the diamond copy normalizer, before affordability/funding guards.
CREATE TRIGGER ab_nov3_zero_guarantee BEFORE INSERT OR UPDATE OF status,start_time,buy_in_amount,buy_in_fee,guaranteed_prize,name,description,short_description
 ON public.tournaments FOR EACH ROW EXECUTE FUNCTION smarter_private.apply_nov3_zero_guarantee();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES('tournaments','ab_nov3_zero_guarantee','Owner-requested Nov3 unstarted cash guarantees become zero; private attendance count cannot fund prizes; existing financial and registration guards remain.')
ON CONFLICT(table_name,trigger_name) DO NOTHING;

CREATE FUNCTION public.fn_ca_nov3_tournament_attendance(p_tournament_ids uuid[])
RETURNS TABLE(tournament_id uuid,attendance_floor integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_tournament_ids IS NULL OR cardinality(p_tournament_ids)>1000 OR array_position(p_tournament_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_tournament_ids';
  END IF;
  RETURN QUERY SELECT a.tournament_id,a.attendance_floor
    FROM smarter_private.nov3_tournament_attendance a JOIN public.tournaments t ON t.id=a.tournament_id
    WHERE a.tournament_id=ANY(p_tournament_ids)
      AND (t.start_time AT TIME ZONE 'America/Chicago')::date=DATE '2026-11-03';
END $body$;
REVOKE ALL ON FUNCTION public.fn_ca_nov3_tournament_attendance(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_nov3_tournament_attendance(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_overlay_at_risk(p_union uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tournament_id uuid, name text, club_id uuid, status text, start_time timestamp with time zone, buy_in numeric, guaranteed_prize numeric, entries_needed integer, current_players integer, shortfall integer, max_players integer, minutes_to_start numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH admission AS MATERIALIZED (SELECT public.fn_ca_read_mtt_admission_contract() AS abi)
  select t.id, t.name, t.club_id, t.status, t.start_time,
         funding.charge, t.guaranteed_prize,
         coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(funding.charge, 0))::int),
         coalesce(t.current_players, 0),
         greatest(
           least(
             coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(funding.charge, 0))::int)
               - coalesce(t.current_players, 0),
             CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL
               ELSE coalesce(t.max_players, 0) - coalesce(t.current_players, 0) END
           ), 0)::int,
         CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL ELSE coalesce(t.max_players, 0) END,
         round(extract(epoch from (t.start_time - now())) / 60.0, 1)
  from tournaments t CROSS JOIN admission a
  CROSS JOIN LATERAL public.fn_tournament_entry_split(
    t.buy_in_amount, t.buy_in_fee, t.bounty_amount,
    COALESCE(t.is_bounty,false) OR COALESCE(t.is_pko,false)
      OR COALESCE(t.is_mystery_bounty,false)) funding
  LEFT JOIN smarter_private.nov3_tournament_attendance att ON att.tournament_id=t.id
    AND (t.start_time AT TIME ZONE 'America/Chicago')::date=DATE '2026-11-03'
  left join clubs c on c.id = t.club_id
  where (t.guaranteed_prize > 0 OR att.attendance_floor > 0)
    and funding.charge > 0
    and upper(t.status) in ('SCHEDULED', 'REGISTERING', 'ANNOUNCED', 'RUNNING')
    and t.start_time > now() - interval '30 minutes'
    and t.start_time < now() + interval '3 hours'
    and (p_union is null or c.union_id = p_union or c.id = p_union)
    and coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(funding.charge, 0))::int) > coalesce(t.current_players, 0)
  order by t.start_time asc;
$function$
;

-- Restate the measured existing ACL; CREATE OR REPLACE retains its owner.
REVOKE ALL ON FUNCTION public.fn_overlay_at_risk(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_overlay_at_risk(uuid) TO service_role;

DO $existing$
DECLARE v_count integer;
BEGIN
  PERFORM 1 FROM public.tournaments WHERE start_time >= '2026-11-03 06:00Z'
    AND start_time < '2026-11-04 06:00Z' AND started_at IS NULL
    AND status IN ('SCHEDULED','REGISTERING','ANNOUNCED') FOR UPDATE;
  SELECT count(*) INTO v_count FROM (VALUES
('069ccf16-2b6f-4eb1-b980-a875860c4b44'::uuid,2500.00::numeric,45.00::numeric,5.00::numeric,'2026-11-03 23:00:00+00'::timestamptz),
('d2a02215-d396-4d61-a342-9c6039276899'::uuid,500.00::numeric,9.00::numeric,1.00::numeric,'2026-11-03 23:30:00+00'::timestamptz),
('e6e1267f-8692-4ac6-adfd-1a30cc7df50d'::uuid,1500.00::numeric,27.00::numeric,3.00::numeric,'2026-11-04 00:00:00+00'::timestamptz),
('18897dc9-5c0a-4cdf-993b-5ca08f81fc09'::uuid,1000.00::numeric,18.00::numeric,2.00::numeric,'2026-11-04 00:30:00+00'::timestamptz),
('450e6c55-bd7c-4e6d-8f30-864c826f02cc'::uuid,10000.00::numeric,31.50::numeric,3.50::numeric,'2026-11-04 01:00:00+00'::timestamptz),
('80c063a5-13c6-4826-aa0d-0fde538219fb'::uuid,750.00::numeric,18.00::numeric,2.00::numeric,'2026-11-04 01:30:00+00'::timestamptz),
('861c1dab-b976-43ae-b9dd-f2582f0edf5d'::uuid,750.00::numeric,18.00::numeric,2.00::numeric,'2026-11-04 02:00:00+00'::timestamptz),
('a38e811c-2835-4366-a3f6-0f8c823018c2'::uuid,2500.00::numeric,36.00::numeric,4.00::numeric,'2026-11-04 02:00:00+00'::timestamptz),
('896cf989-f85f-4d4f-9e57-5d853db8864a'::uuid,1500.00::numeric,27.00::numeric,3.00::numeric,'2026-11-04 03:00:00+00'::timestamptz),
('8785c24a-13ea-40bb-91e7-426275babd80'::uuid,750.00::numeric,18.00::numeric,2.00::numeric,'2026-11-04 03:30:00+00'::timestamptz),
('ab634fbe-96eb-4ac5-91ed-d4ae75803e7e'::uuid,1500.00::numeric,18.00::numeric,2.00::numeric,'2026-11-04 04:00:00+00'::timestamptz),
('353b8c1c-ecae-4bc6-8c47-c07b0f9af64d'::uuid,750.00::numeric,18.00::numeric,2.00::numeric,'2026-11-04 04:30:00+00'::timestamptz),
('2f767681-2e15-4bfa-8246-78eeabe27ba9'::uuid,250.00::numeric,9.00::numeric,1.00::numeric,'2026-11-04 05:00:00+00'::timestamptz),
('f64f0c23-c095-48d0-9489-568559333d19'::uuid,500.00::numeric,9.00::numeric,1.00::numeric,'2026-11-04 05:30:00+00'::timestamptz)
  ) e(id,guarantee,buyin,fee,scheduled)
  JOIN public.tournaments t ON t.id=e.id
  WHERE t.guaranteed_prize=e.guarantee AND t.buy_in_amount=e.buyin AND t.buy_in_fee=e.fee
    AND t.start_time=e.scheduled AND t.started_at IS NULL AND t.status='REGISTERING'
    AND coalesce(t.prize_pool,0)=0 AND NOT coalesce(t.prize_pool_finalized,false)
    AND NOT EXISTS(SELECT 1 FROM public.tournament_players p WHERE p.tournament_id=t.id)
    AND NOT EXISTS(SELECT 1 FROM public.tournament_refund_entitlements r WHERE r.tournament_id=t.id);
  IF v_count<>14 THEN RAISE EXCEPTION 'nov3_fourteen_preimage_changed: %',v_count; END IF;
  UPDATE public.tournaments SET guaranteed_prize=guaranteed_prize
    WHERE start_time >= (TIMESTAMP '2026-11-03' AT TIME ZONE 'America/Chicago')
      AND start_time < (TIMESTAMP '2026-11-04' AT TIME ZONE 'America/Chicago')
      AND started_at IS NULL AND status IN ('SCHEDULED','REGISTERING','ANNOUNCED');
  IF EXISTS(SELECT 1 FROM public.tournaments WHERE start_time >= '2026-11-03 06:00Z'
    AND start_time < '2026-11-04 06:00Z' AND started_at IS NULL
    AND status IN ('SCHEDULED','REGISTERING','ANNOUNCED') AND guaranteed_prize<>0) THEN
    RAISE EXCEPTION 'nov3_guarantee_not_zero';
  END IF;
END $existing$;
COMMIT;

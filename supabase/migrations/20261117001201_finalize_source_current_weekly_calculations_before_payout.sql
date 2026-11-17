-- The closed-week preparer must refresh an earlier complete calculation when
-- the financial owner sees a later closed-week earning. Finalize only the original
-- calculator's finished parts before 04:00, without admitting a financial round.
-- @live-proof: to_regprocedure('smarter_private.weekly_finalize_club_calculation(uuid,date,date)') IS NOT NULL AND strpos(pg_get_functiondef('public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure),'weekly_club_calculation_current')>0 AND strpos(pg_get_functiondef('smarter_private.weekly_prep_unit(text,uuid,timestamptz,timestamptz,text,uuid,int)'::regprocedure),'weekly_club_calculation_current')>0
BEGIN;
CREATE FUNCTION smarter_private.weekly_club_calculation_current(club uuid,from_date date,to_date date)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path=pg_catalog,public AS $current$
 WITH boundary AS (
 SELECT from_date::timestamp AT TIME ZONE 'America/Los_Angeles' AS p_from,
        (to_date+1)::timestamp AT TIME ZONE 'America/Los_Angeles' AS p_to
 )
 SELECT to_date=from_date+6 AND extract(isodow FROM from_date)=1 AND p_to<=now() AND
 EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q
    WHERE q.club_id=club AND q.period_start=from_date AND q.period_end=to_date
     AND q.status='complete' AND q.attempted_at>=p_to
     AND q.last_requested_at<=q.attempted_at
     AND q.last_result->>'accounting_version'='2' AND q.last_result->>'status'='ready'
     AND q.last_result->>'club_id'=club::text AND q.last_result->>'period_start'=from_date::text
     AND q.last_result->>'period_end'=to_date::text
     AND NOT EXISTS(SELECT 1 FROM (
       SELECT s.earned_at FROM public.accounting_cash_rake_sources s
       WHERE s.club_id=club AND s.recorded_at>q.attempted_at-interval '1 minute' OFFSET 0
      ) s WHERE s.earned_at>=p_from AND s.earned_at<p_to)
     AND NOT EXISTS(SELECT 1 FROM (
       SELECT a.source_id FROM public.accounting_cash_atomic_contract_admissions a
       WHERE a.admitted_at>q.attempted_at-interval '1 minute' OFFSET 0
      ) a CROSS JOIN LATERAL (
       SELECT s.club_id,s.earned_at FROM public.accounting_cash_rake_sources s WHERE s.id=a.source_id OFFSET 0
      ) s WHERE s.club_id=club AND s.earned_at>=p_from AND s.earned_at<p_to)
     AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
       WHERE f.club_id=club AND f.charged_at<p_to AND f.recorded_at>q.attempted_at-interval '1 minute')) FROM boundary
$current$;
REVOKE ALL ON FUNCTION smarter_private.weekly_club_calculation_current(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.weekly_finalize_club_calculation(p_club uuid,p_from date,p_to date)
RETURNS boolean LANGUAGE plpgsql
 SET search_path=pg_catalog,public,smarter_private
AS $final$
DECLARE result jsonb; saved_chunked text; saved_finalize text;
BEGIN
 IF smarter_private.weekly_club_calculation_current(p_club,p_from,p_to) THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT FROM public.accounting_recompute_split_parts
   WHERE club_id=p_club AND period_start=p_from AND period_end=p_to) THEN RETURN false; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('accounting_rakeback_period:'||p_club::text||':'||p_from::text,0))
 THEN RETURN false; END IF;
 -- The same calculator checks late sources, authoritative counts, per-player
 -- evidence and every written page. In this mode it returns on missing work.
 -- Early exits above leave the caller's context intact. A raised error
 -- unwinds the statement/subtransaction and these local settings with it.
 saved_chunked:=coalesce(current_setting('app.weekly_accounting_chunked',true),'');
 saved_finalize:=coalesce(current_setting('app.weekly_calculation_finalize_only',true),'');
 PERFORM set_config('app.weekly_accounting_chunked','on',true);
 PERFORM set_config('app.weekly_calculation_finalize_only','on',true);
 result:=public.fn_rakeback_recompute_split(p_club,p_from,p_to);
 PERFORM set_config('app.weekly_calculation_finalize_only',saved_finalize,true);
 PERFORM set_config('app.weekly_accounting_chunked',saved_chunked,true);
 RETURN coalesce(result->>'status'='ready',false) AND smarter_private.weekly_club_calculation_current(p_club,p_from,p_to);
END $final$;
REVOKE ALL ON FUNCTION smarter_private.weekly_finalize_club_calculation(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE
  prep regprocedure:='public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure;
  unit regprocedure:='smarter_private.weekly_prep_unit(text,uuid,timestamptz,timestamptz,text,uuid,int)'::regprocedure;
  split regprocedure:='public.fn_rakeback_recompute_split(uuid,date,date)'::regprocedure;
  body text;
BEGIN
 IF md5(pg_get_functiondef(prep))<>'39a7e057da9a65dab5d0b2f761428f13'
 OR md5(pg_get_functiondef(unit))<>'0d108c0a0e62d78885f8138479eea5ad'
 OR md5(pg_get_functiondef(split))<>'c588b50d35036fc2be1fecbbe5514324' THEN RAISE EXCEPTION 'weekly_calculator_preparation_owner_changed'; END IF;
 EXECUTE replace(pg_get_functiondef(prep),$old$EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q
    WHERE q.club_id=club AND q.period_start=from_date AND q.period_end=to_date
     AND q.status='complete' AND q.attempted_at IS NOT NULL
     AND q.last_requested_at<=q.attempted_at
     AND q.last_result->>'accounting_version'='2' AND q.last_result->>'status'='ready'
     AND q.last_result->>'club_id'=club::text AND q.last_result->>'period_start'=from_date::text
     AND q.last_result->>'period_end'=to_date::text
     AND NOT EXISTS(SELECT 1 FROM (
       SELECT s.earned_at FROM public.accounting_cash_rake_sources s
       WHERE s.club_id=club AND s.recorded_at>q.attempted_at-interval '1 minute' OFFSET 0
      ) s WHERE s.earned_at>=p_from AND s.earned_at<p_to)
     AND NOT EXISTS(SELECT 1 FROM (
       SELECT a.source_id FROM public.accounting_cash_atomic_contract_admissions a
       WHERE a.admitted_at>q.attempted_at-interval '1 minute' OFFSET 0
      ) a CROSS JOIN LATERAL (
       SELECT s.club_id,s.earned_at FROM public.accounting_cash_rake_sources s WHERE s.id=a.source_id OFFSET 0
      ) s WHERE s.club_id=club AND s.earned_at>=p_from AND s.earned_at<p_to)
     AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
       WHERE f.club_id=club AND f.charged_at<p_to AND f.recorded_at>q.attempted_at-interval '1 minute'))$old$,
   'smarter_private.weekly_club_calculation_current(club,from_date,to_date)');
 EXECUTE replace(pg_get_functiondef(unit),$old$ IF EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q WHERE q.club_id=p_club AND q.period_start=d_from AND q.period_end=d_to AND q.status='complete'
   AND q.attempted_at>=v_to AND q.last_requested_at<=q.attempted_at AND q.last_result->>'status'='ready') THEN RETURN NULL; END IF;
$old$,$new$ -- A current, empty workset is checked once at its players unit. Other
 -- shards operate only on the durable pages for a club needing preparation.
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('accounting_rakeback_period:'||p_club::text||':'||d_from::text,0)) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM public.accounting_recompute_split_parts
   WHERE club_id=p_club AND period_start=d_from AND kind='players' AND part=0) THEN
   IF p_step<>'players' OR smarter_private.weekly_club_calculation_current(p_club,d_from,d_to) THEN RETURN NULL; END IF;
 END IF;
$new$);
 body:=pg_get_functiondef(split);
 body:=replace(body,'DECLARE v_from timestamptz;', 'DECLARE finalize_only boolean:=coalesce(current_setting(''app.weekly_calculation_finalize_only'',true),'''')=''on''; v_from timestamptz;');
 body:=replace(body,'OR NULLIF(current_setting(''app.weekly_accounting_scope_deadline'',true),'''') IS NULL','OR (NOT finalize_only AND NULLIF(current_setting(''app.weekly_accounting_scope_deadline'',true),'''') IS NULL)');
 IF cardinality(string_to_array(body,'IF did AND clock_timestamp()>began+interval ''90 seconds'''))<>6 THEN RAISE EXCEPTION 'weekly_calculator_missing_part_gates_changed'; END IF;
 body:=replace(body,'IF did AND clock_timestamp()>began+interval ''90 seconds''','IF finalize_only OR (did AND clock_timestamp()>began+interval ''90 seconds'')');
 EXECUTE body;
 IF position('weekly_club_calculation_current' IN pg_get_functiondef(prep))=0
 OR position('weekly_club_calculation_current' IN pg_get_functiondef(unit))=0
 OR position('DECLARE finalize_only boolean' IN pg_get_functiondef(split))=0 THEN RAISE EXCEPTION 'weekly_calculator_preparation_not_installed'; END IF;
END $patch$;
COMMIT;

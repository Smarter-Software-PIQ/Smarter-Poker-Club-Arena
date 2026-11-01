-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- THIS WEEK SO FAR / SUNDAY PREVIEW (owner, 2026-10-31: "live verified so far"
-- and "Sunday-night preview"). Every hand a player is raked in is recorded at
-- commit as an accounting source carrying the agreement in effect when it was
-- played (contract.membership.terms.player_rakeback_pct: split by time). This
-- reads, for the CALLER only, the current week's recorded cash and tournament
-- rake per club and an ESTIMATE of rakeback (each recorded rake times the rate
-- in effect for it, cut at each recorded change of the player's own rate). It is labelled an estimate: the paid amount is computed by
-- the Monday close from certified windows. Read-only; no rate, ledger, payout,
-- receipt or report change; execute granted to authenticated only.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public;

CREATE FUNCTION public.fn_my_rakeback_week_so_far()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
-- Split by time without reading every hand's contract: the rate in effect is
-- the member's recorded agreement (accounting_agreement_history, the same
-- history each source's contract.membership cites), so the week is cut at each
-- change of the player's own rate and each segment's recorded rake is summed
-- from the (club, player, time) indexes.
DECLARE v_uid uuid:=auth.uid(); v_start timestamptz; v_end timestamptz; v_now timestamptz:=clock_timestamp();
 c record; h record; seg_from timestamptz; seg_rate numeric; seg_rake numeric; seg_tour numeric;
 cash_total numeric; tour_total numeric; est numeric; n bigint; v_last timestamptz; v_clubs jsonb:='[]'::jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
 v_start:=public.fn_union_week_start(v_now);
 v_end:=public.fn_union_week_start(v_start+interval '8 days');
 FOR c IN SELECT DISTINCT m.club_id,cl.name FROM public.club_members m JOIN public.clubs cl ON cl.id=m.club_id
   WHERE m.user_id=v_uid ORDER BY cl.name LOOP
  cash_total:=0;tour_total:=0;est:=0;
  SELECT NULLIF(x.after_terms->>'player_rakeback_pct','')::numeric INTO seg_rate FROM public.accounting_agreement_history x
   WHERE x.entity_type='club_members' AND x.entity_key=c.club_id::text||':'||v_uid::text AND x.observed_at<=v_start
   ORDER BY x.observed_at DESC,x.id DESC LIMIT 1;
  seg_from:=v_start;
  FOR h IN SELECT x.observed_at,NULLIF(x.after_terms->>'player_rakeback_pct','')::numeric rate FROM public.accounting_agreement_history x
    WHERE x.entity_type='club_members' AND x.entity_key=c.club_id::text||':'||v_uid::text AND x.observed_at>v_start AND x.observed_at<v_end
    UNION ALL SELECT v_end,NULL ORDER BY 1 LOOP
   SELECT COALESCE(sum(s.rake_credit),0) INTO seg_rake FROM public.accounting_cash_rake_sources s
    WHERE s.club_id=c.club_id AND s.player_id=v_uid AND s.earned_at>=seg_from AND s.earned_at<h.observed_at;
   SELECT COALESCE(sum(s.rake_credit),0) INTO seg_tour FROM public.accounting_tournament_fee_sources s
    WHERE s.club_id=c.club_id AND s.player_id=v_uid AND s.charged_at>=seg_from AND s.charged_at<h.observed_at;
   cash_total:=cash_total+seg_rake;tour_total:=tour_total+seg_tour;est:=est+(seg_rake+seg_tour)*COALESCE(seg_rate,0);
   seg_from:=h.observed_at;IF h.rate IS NOT NULL OR h.observed_at<v_end THEN seg_rate:=COALESCE(h.rate,seg_rate);END IF;
  END LOOP;
  IF cash_total+tour_total>0 THEN
   SELECT max(s.earned_at) INTO v_last FROM public.accounting_cash_rake_sources s
    WHERE s.club_id=c.club_id AND s.player_id=v_uid AND s.earned_at>=v_start AND s.earned_at<v_end;
   v_clubs:=v_clubs||jsonb_build_array(jsonb_build_object('club_id',c.club_id,'club_name',c.name,
    'cash_rake',round(cash_total,2),'tournament_rake',round(tour_total,2),'rake_recorded',round(cash_total+tour_total,2),
    'estimated_rakeback',round(est,2),'current_rate_pct',round(COALESCE(seg_rate,0)*100,2),'last_recorded_at',v_last));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('week_start',v_start,'week_end',v_end,'paid_at',public.fn_union_accounting_run_at(v_end),
  'clubs',v_clubs,'estimate',true,'read_at',v_now);
END $function$;
REVOKE ALL ON FUNCTION public.fn_my_rakeback_week_so_far() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_my_rakeback_week_so_far() TO authenticated;
COMMENT ON FUNCTION public.fn_my_rakeback_week_so_far() IS
 'Read-only: the caller''s own recorded rake this week per club and an estimated rakeback at the rates in effect per hand; the Monday close computes the paid amount.';
COMMIT;

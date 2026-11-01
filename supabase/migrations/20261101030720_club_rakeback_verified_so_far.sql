-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- VERIFIED SO FAR IN CLUB DATA (owner, 2026-10-31: "live verified so far" and
-- "these numbers accumulate daily"). A running tally of the current accounting
-- week for a club the caller may view as a whole (ca_can_view_whole_club_report,
-- the gate Club Data already uses):
--   * every cash and tournament rake source RECORDED so far this week (each
--     committed hand or fee is an accounting source carrying the agreement in
--     effect when it was played), per player and in total;
--   * an ESTIMATE of player rakeback: each source's rake at the player's rate in
--     effect when it was played (split by time, from accounting_agreement_history);
--   * how many of the week's two-hour windows the close has proved (proofs only
--     count once the week has ended), the last close's status and the last paid
--     week's totals.
--
-- WHY A TALLY. A Midway club records ~870k cash sources a week; one read of the
-- week measured 23.9 s on production, past any page's budget. Sources are
-- appended in commit order and carry recorded_at, so each COMPLETED recording
-- hour is summed once into smarter_private.club_rakeback_tally_hours and never
-- read again; a call extends the tally by at most ~4 s of completed hours and
-- reads the recent tail live. Until every completed hour is counted the answer says so
-- (tally.complete=false, counted_through) instead of showing a partial number as
-- the week. A source belongs to the week its earned_at/charged_at falls in, and is
-- counted in the hour it was recorded, so a late-recorded source is never lost.
--
-- No rate, ledger, payout, receipt, proof or report is read for payment or
-- changed; the paid amount is always the Monday close's. No cron, trigger or
-- watcher: the tally advances only when someone opens the view.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog,public;

CREATE TABLE smarter_private.club_rakeback_tally_hours (
 club_id uuid NOT NULL,
 hour_start timestamptz NOT NULL,
 week_start timestamptz NOT NULL,
 player_id uuid NOT NULL,
 cash_rake numeric NOT NULL,
 tournament_rake numeric NOT NULL,
 sources bigint NOT NULL,
 estimated_rakeback numeric NOT NULL,
 last_recorded_at timestamptz,
 PRIMARY KEY (club_id, week_start, hour_start, player_id)
);
CREATE TABLE smarter_private.club_rakeback_tally_done (
 club_id uuid NOT NULL,
 hour_start timestamptz NOT NULL,
 computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sources bigint NOT NULL,
 PRIMARY KEY (club_id, hour_start)
);
ALTER TABLE smarter_private.club_rakeback_tally_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.club_rakeback_tally_done ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.club_rakeback_tally_hours, smarter_private.club_rakeback_tally_done FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE smarter_private.club_rakeback_tally_hours IS
 'Display-only running tally for Club Data "verified so far": per club, recording hour, week and player. Never read by any payout, close or report.';

-- One recording hour [p_from, p_to) of a club, per player, for the week the
-- hour is in (a source recorded this week but played in an earlier, already
-- closed week is not this week's and is left out; recorded_at is never before
-- the time played, so every source played this week is recorded this week or
-- after its end). Rate in
-- effect when played: latest recorded club_members agreement at or before the
-- source's earned/charged time (the history every source contract cites).
CREATE FUNCTION smarter_private.club_rakeback_tally_rows(p_club_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(week_start timestamptz, player_id uuid, cash_rake numeric, tournament_rake numeric, sources bigint,
  estimated_rakeback numeric, last_recorded_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- Planned for the hour's actual bounds every time (EXECUTE): a generic plan
-- cannot see that one recording hour is a few thousand rows and walks the
-- club's whole week instead.
BEGIN
 RETURN QUERY EXECUTE $q$
 WITH src AS (
  SELECT s.player_id,s.rake_credit,s.earned_at played_at,s.recorded_at,true is_cash
  FROM public.accounting_cash_rake_sources s
  WHERE s.club_id=$1 AND s.recorded_at>=$2 AND s.recorded_at<$3 AND s.player_id IS NOT NULL
    AND s.earned_at>=(SELECT public.fn_union_week_start($2))
  UNION ALL
  SELECT s.player_id,s.rake_credit,s.charged_at,s.recorded_at,false
  FROM public.accounting_tournament_fee_sources s
  WHERE s.club_id=$1 AND s.recorded_at>=$2 AND s.recorded_at<$3 AND s.player_id IS NOT NULL
    AND s.charged_at>=(SELECT public.fn_union_week_start($2)))
 , wk AS (SELECT public.fn_union_week_start($2) w),
 pl AS (SELECT src.player_id,min(src.played_at) lo,max(src.played_at) hi FROM src GROUP BY src.player_id),
 -- Rate at the player's earliest source in the hour; only a player whose rate
 -- changed between that and their latest source is rated source by source.
 pr AS (SELECT pl.player_id,
   (SELECT NULLIF(x.after_terms->>'player_rakeback_pct','')::numeric FROM public.accounting_agreement_history x
     WHERE x.entity_type='club_members' AND x.entity_key=$1::text||':'||pl.player_id::text AND x.observed_at<=pl.lo
     ORDER BY x.observed_at DESC,x.id DESC LIMIT 1) rate_lo,
   EXISTS(SELECT 1 FROM public.accounting_agreement_history x
     WHERE x.entity_type='club_members' AND x.entity_key=$1::text||':'||pl.player_id::text
       AND x.observed_at>pl.lo AND x.observed_at<=pl.hi) changed
  FROM pl)
 SELECT wk.w,src.player_id,
  COALESCE(sum(src.rake_credit) FILTER (WHERE src.is_cash),0),
  COALESCE(sum(src.rake_credit) FILTER (WHERE NOT src.is_cash),0),
  count(*),
  COALESCE(sum(src.rake_credit*COALESCE(CASE WHEN pr.changed THEN
    (SELECT NULLIF(x.after_terms->>'player_rakeback_pct','')::numeric FROM public.accounting_agreement_history x
      WHERE x.entity_type='club_members' AND x.entity_key=$1::text||':'||src.player_id::text
        AND x.observed_at<=src.played_at ORDER BY x.observed_at DESC,x.id DESC LIMIT 1)
    ELSE pr.rate_lo END,0)),0),
  max(src.recorded_at)
 FROM src CROSS JOIN wk JOIN pr ON pr.player_id=src.player_id
 GROUP BY 1,2
$q$ USING p_club_id,p_from,p_to;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.club_rakeback_tally_rows(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_club_rakeback_verified_so_far(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_now timestamptz:=clock_timestamp(); v_start timestamptz; v_end timestamptz; v_union uuid;
 v_scope_kind text; v_scope_id uuid; v_h timestamptz; v_n bigint; v_settled timestamptz; v_through timestamptz;
 v_complete boolean; v_windows jsonb; v_elapsed int; v_run jsonb; v_paid jsonb; v_totals jsonb; v_players jsonb;
 v_budget interval:=interval '4 seconds';
BEGIN
 -- Who is asking: a signed-in viewer of this whole club, never a parameter.
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
 IF p_club_id IS NULL OR NOT public.ca_can_view_whole_club_report(p_club_id) THEN
  RAISE EXCEPTION 'not authorized for this club' USING ERRCODE='42501';
 END IF;
 v_start:=public.fn_union_week_start(v_now);
 v_end:=public.fn_union_week_start(v_start+interval '8 days');
 -- An hour is summed only once every source in it has committed: recorded_at
 -- is stamped inside the writing transaction, and no money statement runs past
 -- 240 s, so ten minutes after an hour ends nothing more can appear in it.
 v_settled:=date_trunc('hour',LEAST(v_now,v_end+interval '1 hour')-interval '10 minutes');

 -- Extend the tally oldest hour first, within the call's budget. A concurrent
 -- viewer of the same club simply reads what is already counted.
 IF pg_try_advisory_xact_lock(hashtextextended('club_rakeback_tally:'||p_club_id::text,0)) THEN
  v_h:=v_start;
  WHILE v_h<v_settled AND clock_timestamp()-v_now<v_budget LOOP
   IF NOT EXISTS(SELECT 1 FROM smarter_private.club_rakeback_tally_done d WHERE d.club_id=p_club_id AND d.hour_start=v_h) THEN
    INSERT INTO smarter_private.club_rakeback_tally_hours(club_id,hour_start,week_start,player_id,cash_rake,
      tournament_rake,sources,estimated_rakeback,last_recorded_at)
    SELECT p_club_id,v_h,t.week_start,t.player_id,t.cash_rake,t.tournament_rake,t.sources,t.estimated_rakeback,t.last_recorded_at
    FROM smarter_private.club_rakeback_tally_rows(p_club_id,v_h,v_h+interval '1 hour') t;
    GET DIAGNOSTICS v_n=ROW_COUNT;
    INSERT INTO smarter_private.club_rakeback_tally_done(club_id,hour_start,sources) VALUES (p_club_id,v_h,v_n);
   END IF;
   v_h:=v_h+interval '1 hour';
  END LOOP;
  -- Display data only: keep three weeks.
  DELETE FROM smarter_private.club_rakeback_tally_hours t WHERE t.club_id=p_club_id AND t.hour_start<v_start-interval '21 days';
  DELETE FROM smarter_private.club_rakeback_tally_done d WHERE d.club_id=p_club_id AND d.hour_start<v_start-interval '21 days';
 END IF;

 -- Counted through: the end of the contiguous run of summed hours from the week start.
 SELECT COALESCE(max(g.h)+interval '1 hour',v_start) INTO v_through
 FROM generate_series(v_start,v_settled-interval '1 hour',interval '1 hour') g(h)
 WHERE g.h<COALESCE((SELECT min(g2.h) FROM generate_series(v_start,v_settled-interval '1 hour',interval '1 hour') g2(h)
   WHERE NOT EXISTS(SELECT 1 FROM smarter_private.club_rakeback_tally_done d WHERE d.club_id=p_club_id AND d.hour_start=g2.h)),'infinity');
 v_complete:=v_through>=v_settled;

 WITH tally AS (
  SELECT t.player_id,t.cash_rake,t.tournament_rake,t.sources,t.estimated_rakeback,t.last_recorded_at
  FROM smarter_private.club_rakeback_tally_hours t
  WHERE t.club_id=p_club_id AND t.week_start=v_start AND t.hour_start>=v_start AND t.hour_start<v_through
  UNION ALL
  -- The recent tail, read live, only once everything before it is counted.
  SELECT l.player_id,l.cash_rake,l.tournament_rake,l.sources,l.estimated_rakeback,l.last_recorded_at
  FROM smarter_private.club_rakeback_tally_rows(p_club_id,v_through,v_now+interval '1 second') l
  WHERE v_complete AND l.week_start=v_start),
 per AS (
  SELECT t.player_id,sum(t.cash_rake) cash,sum(t.tournament_rake) tour,sum(t.sources) n,
   sum(t.estimated_rakeback) est,max(t.last_recorded_at) last_at
  FROM tally t GROUP BY t.player_id)
 SELECT jsonb_build_object('players',count(*),'sources',COALESCE(sum(per.n),0),'cash_rake',round(COALESCE(sum(per.cash),0),2),
   'tournament_rake',round(COALESCE(sum(per.tour),0),2),'rake_recorded',round(COALESCE(sum(per.cash+per.tour),0),2),
   'estimated_player_rakeback',round(COALESCE(sum(per.est),0),2),'last_recorded_at',max(per.last_at)),
  COALESCE(jsonb_agg(jsonb_build_object('player_id',per.player_id,
   'player_name',(SELECT COALESCE(NULLIF(pr.display_name,''),pr.username) FROM public.profiles pr WHERE pr.id=per.player_id),
   'cash_rake',round(per.cash,2),'tournament_rake',round(per.tour,2),'rake_recorded',round(per.cash+per.tour,2),
   'sources',per.n,'estimated_rakeback',round(per.est,2),'last_recorded_at',per.last_at)
   ORDER BY per.cash+per.tour DESC),'[]'::jsonb)
 INTO v_totals,v_players FROM per;

 SELECT uc.union_id INTO v_union FROM public.union_clubs uc WHERE uc.club_id=p_club_id LIMIT 1;
 IF v_union IS NULL THEN v_scope_kind:='club';v_scope_id:=p_club_id;
 ELSE v_scope_kind:='union';v_scope_id:=v_union; END IF;
 v_elapsed:=ceil(extract(epoch FROM (LEAST(v_now,v_end)-v_start))/7200)::int;
 SELECT COALESCE(jsonb_object_agg(k.kind,k.n),'{}'::jsonb) INTO v_windows FROM (
  SELECT p.kind,count(*) n FROM public.accounting_close_partials p
  WHERE p.union_id=v_scope_id AND p.period_end=v_end AND p.computed_at>=v_end
    AND p.kind IN ('earned_plan_window','round2_union_window','round3_union_window') GROUP BY p.kind) k;
 SELECT jsonb_build_object('period_start',r.period_start,'period_end',r.period_end,'status',r.status,
   'attempts',r.attempts,'finished_at',r.finished_at) INTO v_run
 FROM public.union_accounting_runs r
 WHERE r.scope_kind=v_scope_kind AND r.scope_id=v_scope_id AND r.period_end<=v_start
 ORDER BY r.period_end DESC LIMIT 1;
 SELECT jsonb_build_object('period_start',x.period_start,'period_end',x.period_end,'players',x.n,
   'paid',round(x.paid,2),'paid_at',x.paid_at) INTO v_paid
 FROM (SELECT rp.period_start,rp.period_end,count(*) n,sum(pp.payout_amount) paid,max(pp.paid_at) paid_at
   FROM public.rakeback_period_payouts pp JOIN public.rakeback_periods rp ON rp.id=pp.rakeback_period_id
   WHERE pp.club_id=p_club_id AND pp.status='paid'
   GROUP BY rp.period_start,rp.period_end ORDER BY rp.period_end DESC LIMIT 1) x;

 RETURN jsonb_build_object(
  'club_id',p_club_id,'week_start',v_start,'week_end',v_end,'paid_at',public.fn_union_accounting_run_at(v_end),
  'tally',jsonb_build_object('complete',v_complete,'counted_through',v_through,'live_through',CASE WHEN v_complete THEN v_now END,
    'hours_counted',GREATEST(0,(extract(epoch FROM (v_through-v_start))/3600)::int),
    'hours_settled',GREATEST(0,(extract(epoch FROM (v_settled-v_start))/3600)::int)),
  'totals',v_totals,'players',v_players,
  'windows',jsonb_build_object('proved',v_windows,'elapsed',v_elapsed,
    'per_week',ceil(extract(epoch FROM (v_end-v_start))/7200)::int,'proved_after',v_end),
  'last_close',v_run,'last_paid_week',v_paid,'estimate',true,'read_at',v_now);
END $function$;
REVOKE ALL ON FUNCTION public.fn_club_rakeback_verified_so_far(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fn_club_rakeback_verified_so_far(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_club_rakeback_verified_so_far(uuid) IS
 'Club Data "verified so far": this week''s recorded rake per player and in total (running tally), estimated rakeback at the rate in effect per hand, window proofs, last close and last paid week. Display only; the Monday close computes the paid amount.';
COMMIT;

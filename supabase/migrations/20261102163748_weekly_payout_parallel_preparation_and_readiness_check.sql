-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- PARALLEL CLOSED-WEEK PREPARATION, READINESS AT 03:30, SHARED CALCULATOR PARTS (owner, 2026-11-02).
-- On 2026-11-02 the 04:00 payout prepared serially (one calculator part or
-- round window per club per five-minute tick) and missed 04:00 by hours.
-- From the week's close, four shard jobs now prove every closed-week unit in
-- parallel (own-agent clean windows, earned plan windows, the calculator's
-- players/tq/counts/check/write parts, round 2 and round 3 windows), each in
-- its own committed transaction, so job 272 (still the one financial writer)
-- only reuses finished proofs. Shards stop once the week's payout boundary is
-- booked and never move money. A read-only check at 03:30 records a
-- Production Alert when the 04:00 boundary is not booked. The calculator's
-- part inserts become ON CONFLICT DO NOTHING so a part a shard already made is
-- kept instead of refusing the attempt.
-- periodic-work: the weekly close itself, done in parallel: the shards ARE the closed week's preparation (the same proofs job 272 makes one per tick), run only between the week's close and its payout, and the 03:30 check is the owner's required readiness notice, not a retry of anything.
-- @live-proof: (SELECT to_regprocedure('smarter_private.weekly_prep_shard(integer,integer)') IS NOT NULL AND (SELECT count(*) FROM cron.job WHERE jobname LIKE 'weekly-prep-shard-%' AND active)=4 AND position('PARTS SHARED WITH THE PREPARATION SHARDS' IN pg_get_functiondef('public.fn_rakeback_recompute_split(uuid,date,date)'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.fn_rakeback_recompute_split(uuid,date,date)'::regprocedure)) IS DISTINCT FROM '2d8ab8647146824b837ee193b624834c' THEN RAISE EXCEPTION 'recompute_split_preimage_changed'; END IF;
 IF to_regclass('smarter_private.own_agent_clean_windows') IS NULL THEN RAISE EXCEPTION 'own_agent_clean_windows_required'; END IF;
END $guard$;
CREATE TABLE IF NOT EXISTS smarter_private.weekly_prep_scope_clubs(
 scope_kind text NOT NULL, scope_id uuid NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
 club_ids uuid[] NOT NULL, resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope_kind,scope_id,period_start,period_end));
ALTER TABLE smarter_private.weekly_prep_scope_clubs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_prep_scope_clubs FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS smarter_private.weekly_prep_shard_runs(
 id bigserial PRIMARY KEY, shard int NOT NULL, period_end timestamptz, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz, units int NOT NULL DEFAULT 0, last_unit text, last_error text);
ALTER TABLE smarter_private.weekly_prep_shard_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_prep_shard_runs FROM PUBLIC, anon, authenticated, service_role;

-- One unit of closed-week preparation work. Returns a label when it did work,
-- NULL when the unit was already done. Every unit is pure proof/calculation
-- (partials, split parts, clean-window markers); no money moves here.
CREATE OR REPLACE FUNCTION smarter_private.weekly_prep_unit(p_kind text,p_scope uuid,p_from timestamptz,p_to timestamptz,p_step text,p_club uuid,p_idx int)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE w record; sc record; r record; v jsonb; d_from date; d_to date; v_from timestamptz; v_to timestamptz;
 pages jsonb; n_pages int; ids uuid[]; ev bigint; inc bigint; dr bigint; issue_count bigint; life interval:=public.fn_accounting_close_proof_lifetime();
 club_ids uuid[]; u uuid; s uuid;
BEGIN
 u:=CASE WHEN p_kind='union' THEN p_scope END; s:=CASE WHEN p_kind='club' THEN p_scope END;
 IF p_step IN('clean','earned','r2','r3') THEN
  SELECT c.window_start,c.window_end INTO w FROM public.fn_accounting_close_windows(p_from,p_to) c ORDER BY c.window_start OFFSET p_idx LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 IF p_step='clean' THEN
  IF EXISTS(SELECT 1 FROM smarter_private.own_agent_clean_windows k WHERE k.scope_kind=p_kind AND k.scope_id=p_scope AND k.period_start=p_from AND k.period_end=p_to AND k.window_start=w.window_start) THEN RETURN NULL; END IF;
  INSERT INTO smarter_private.own_agent_clean_windows(scope_kind,scope_id,period_start,period_end,window_start,checked_at)
  SELECT p_kind,p_scope,p_from,p_to,w.window_start,statement_timestamp()
  WHERE NOT EXISTS(SELECT 1 FROM public.accounting_cash_rake_sources x WHERE x.earned_at>=w.window_start AND x.earned_at<w.window_end
    AND ((u IS NOT NULL AND x.coordinator_union_id=u) OR (s IS NOT NULL AND x.club_id=s AND x.coordinator_union_id IS NULL))
    AND coalesce(x.contract#>>'{membership,terms,role}','') IN('super_agent','agent','sub_agent') AND x.contract#>>'{tiers,0,user_id}' IS DISTINCT FROM x.player_id::text
    AND NOT(coalesce((x.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=.70,false) AND EXISTS(SELECT FROM public.clubs c WHERE c.id=x.club_id AND c.owner_id=NULLIF(x.contract#>>'{membership,terms,agent_id}','')::uuid))
    AND NOT EXISTS(SELECT FROM public.accounting_own_agent_source_reviews a WHERE a.source_type='cash_rake_accrual' AND a.source_id=x.id))
   AND NOT EXISTS(SELECT 1 FROM public.accounting_payable_earning_sources x WHERE x.source_type='tournament_fee_accrual' AND x.earned_at>=w.window_start AND x.earned_at<w.window_end
    AND ((u IS NOT NULL AND x.coordinator_union_id=u) OR (s IS NOT NULL AND x.club_id=s AND x.coordinator_union_id IS NULL))
    AND coalesce(x.contract#>>'{membership,terms,role}','') IN('super_agent','agent','sub_agent') AND x.contract#>>'{tiers,0,user_id}' IS DISTINCT FROM x.player_id::text
    AND NOT EXISTS(SELECT FROM public.accounting_own_agent_source_reviews a WHERE a.source_type=x.source_type AND a.source_id=x.source_id))
  ON CONFLICT DO NOTHING;
  RETURN 'clean '||p_idx;
 END IF;
 IF p_step IN('earned','r2','r3') THEN
  IF EXISTS(SELECT 1 FROM public.accounting_close_partials p WHERE p.kind=CASE p_step WHEN 'earned' THEN 'earned_plan_window' WHEN 'r2' THEN 'round2_'||p_kind||'_window' ELSE 'round3_'||p_kind||'_window' END
    AND p.union_id=p_scope AND p.period_start=p_from AND p.period_end=p_to AND p.window_start=w.window_start AND p.window_end=w.window_end
    AND p.computed_at>=p_to AND p.computed_at>clock_timestamp()-life) THEN RETURN NULL; END IF;
  IF p_step='earned' THEN
   SELECT * INTO r FROM public.fn_accounting_union_earned_plan_window(p_scope,w.window_start,w.window_end);
   IF NOT FOUND THEN RETURN 'earned-unproved '||p_idx; END IF;
   INSERT INTO public.accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,cash_ids,cash_md5,fee_ids,fee_md5,computed_at)
   VALUES('earned_plan_window',p_scope,p_from,p_to,w.window_start,w.window_end,r.value,r.cash_ids,r.cash_md5,r.fee_ids,r.fee_md5,clock_timestamp())
   ON CONFLICT(kind,union_id,period_start,period_end,window_start) DO UPDATE SET window_end=EXCLUDED.window_end,value=EXCLUDED.value,cash_ids=EXCLUDED.cash_ids,cash_md5=EXCLUDED.cash_md5,fee_ids=EXCLUDED.fee_ids,fee_md5=EXCLUDED.fee_md5,computed_at=EXCLUDED.computed_at;
  ELSIF p_step='r2' THEN
   IF EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs x WHERE x.scope_kind=p_kind AND x.scope_id=p_scope AND x.period_start=p_from AND x.period_end=p_to AND x.round_no=2) THEN RETURN NULL; END IF;
   SELECT q.club_ids INTO club_ids FROM smarter_private.weekly_prep_scope_clubs q WHERE q.scope_kind=p_kind AND q.scope_id=p_scope AND q.period_start=p_from AND q.period_end=p_to;
   IF club_ids IS NULL THEN RETURN NULL; END IF;
   SELECT * INTO r FROM public.fn_settle_accounting_commission_window(u,s,club_ids,w.window_start,w.window_end);
   INSERT INTO public.accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,cash_ids,cash_md5,fee_ids,fee_md5,computed_at)
   VALUES('round2_'||p_kind||'_window',p_scope,p_from,p_to,w.window_start,w.window_end,r.value,r.cash_ids,r.cash_md5,r.fee_ids,r.fee_md5,clock_timestamp())
   ON CONFLICT(kind,union_id,period_start,period_end,window_start) DO UPDATE SET window_end=EXCLUDED.window_end,value=EXCLUDED.value,cash_ids=EXCLUDED.cash_ids,cash_md5=EXCLUDED.cash_md5,fee_ids=EXCLUDED.fee_ids,fee_md5=EXCLUDED.fee_md5,computed_at=EXCLUDED.computed_at;
  ELSE
   IF EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs x WHERE x.scope_kind=p_kind AND x.scope_id=p_scope AND x.period_start=p_from AND x.period_end=p_to AND x.round_no=3) THEN RETURN NULL; END IF;
   INSERT INTO public.accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,computed_at)
   VALUES('round3_'||p_kind||'_window',p_scope,p_from,p_to,w.window_start,w.window_end,public.fn_settle_accounting_rakeback_window(u,s,w.window_start,w.window_end),clock_timestamp())
   ON CONFLICT(kind,union_id,period_start,period_end,window_start) DO UPDATE SET window_end=EXCLUDED.window_end,value=EXCLUDED.value,cash_ids=NULL,cash_md5=NULL,fee_ids=NULL,fee_md5=NULL,computed_at=EXCLUDED.computed_at;
  END IF;
  RETURN p_step||' '||p_idx;
 END IF;
 -- Split recompute parts of one club-week (the calculator's own parts).
 d_from:=(p_from AT TIME ZONE 'America/Los_Angeles')::date; d_to:=d_from+6;
 v_from:=d_from::timestamp AT TIME ZONE 'America/Los_Angeles'; v_to:=(d_to+1)::timestamp AT TIME ZONE 'America/Los_Angeles';
 IF v_to>clock_timestamp() THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q WHERE q.club_id=p_club AND q.period_start=d_from AND q.period_end=d_to AND q.status='complete'
   AND q.attempted_at>=v_to AND q.last_requested_at<=q.attempted_at AND q.last_result->>'status'='ready') THEN RETURN NULL; END IF;
 IF p_step='players' THEN
  IF EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='players') THEN RETURN NULL; END IF;
  WITH p AS (SELECT x.player_id,count(*) AS n FROM public.accounting_payable_earning_sources x WHERE x.club_id=p_club AND x.earned_at>=v_from AND x.earned_at<v_to GROUP BY x.player_id),
  q AS (SELECT p.player_id,((sum(p.n) OVER(ORDER BY p.player_id)-p.n)/20000)::bigint AS pg FROM p)
  SELECT COALESCE(jsonb_agg(x.ids ORDER BY x.pg),'[]'::jsonb) INTO pages FROM (SELECT q.pg,jsonb_agg(q.player_id ORDER BY q.player_id) AS ids FROM q GROUP BY q.pg) x;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value) VALUES(p_club,d_from,d_to,'players',0,jsonb_build_object('pages',pages)) ON CONFLICT DO NOTHING;
  RETURN 'players';
 END IF;
 IF p_step='tq' THEN
  SELECT g INTO w FROM (SELECT (row_number() OVER(ORDER BY g)-1)::int AS i,g FROM generate_series(v_from,v_to-interval '1 microsecond',interval '6 hours') g) t WHERE t.i=p_idx;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='tq' AND part=p_idx) THEN RETURN NULL; END IF;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club,d_from,d_to,'tq',p_idx,public.fn_accounting_tournament_week_quality(p_club,w.g,LEAST(w.g+interval '6 hours',v_to))) ON CONFLICT DO NOTHING;
  RETURN 'tq '||p_idx;
 END IF;
 IF p_step='counts' THEN
  SELECT g INTO w FROM (SELECT (row_number() OVER(ORDER BY g)-1)::int AS i,g FROM generate_series(v_from,v_to-interval '1 microsecond',interval '2 hours') g) t WHERE t.i=p_idx;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='counts' AND part=p_idx) THEN RETURN NULL; END IF;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club,d_from,d_to,'counts',p_idx,public.fn_rakeback_split_counts(p_club,v_from,v_to,w.g,LEAST(w.g+interval '2 hours',v_to))) ON CONFLICT DO NOTHING;
  RETURN 'counts '||p_idx;
 END IF;
 -- check/write pages follow the calculator's own gates in its order.
 SELECT value->'pages' INTO pages FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='players' AND part=0;
 IF pages IS NULL THEN RETURN NULL; END IF;
 n_pages:=jsonb_array_length(pages);
 IF p_idx>=n_pages THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='tq')<>(SELECT count(*) FROM generate_series(v_from,v_to-interval '1 microsecond',interval '6 hours'))
  OR (SELECT count(*) FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='counts')<>(SELECT count(*) FROM generate_series(v_from,v_to-interval '1 microsecond',interval '2 hours'))
  OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='tq' AND value->>'status' IS DISTINCT FROM 'ready') THEN RETURN NULL; END IF;
 SELECT sum((value->>'evidence')::bigint),sum((value->>'incomplete')::bigint),sum((value->>'drifted')::bigint) INTO ev,inc,dr FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='counts';
 SELECT count(*) INTO issue_count FROM public.rakeback_periods rp WHERE rp.club_id=p_club AND rp.period_start<=d_to AND rp.period_end>=d_from
   AND (rp.status<>'pending' OR rp.period_start<>d_from OR rp.period_end<>d_to OR NOT EXISTS(SELECT 1 FROM public.accounting_rakeback_period_calculations c WHERE c.period_id=rp.id));
 IF ev>0 OR inc>0 OR dr>0 OR issue_count>0 THEN RETURN NULL; END IF;
 ids:=ARRAY(SELECT jsonb_array_elements_text(pages->p_idx)::uuid);
 IF p_step='check' THEN
  IF EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='check' AND part=p_idx) THEN RETURN NULL; END IF;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club,d_from,d_to,'check',p_idx,public.fn_rakeback_split_check(p_club,d_from,d_to,ids)) ON CONFLICT DO NOTHING;
  RETURN 'check '||p_idx;
 END IF;
 IF p_step='write' THEN
  IF EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='write' AND part=p_idx)
   OR (SELECT count(*) FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='check')<>n_pages
   OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club AND period_start=d_from AND kind='check' AND value ? 'reason') THEN RETURN NULL; END IF;
  -- One writer per page: the page's own lock, so two shards never write it twice.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('weekly-prep-write:'||p_club||':'||d_from||':'||p_idx,0)) THEN RETURN NULL; END IF;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club,d_from,d_to,'write',p_idx,public.fn_rakeback_split_write(p_club,d_from,d_to,ids)) ON CONFLICT DO NOTHING;
  RETURN 'write '||p_idx;
 END IF;
 RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_prep_unit(text,uuid,timestamptz,timestamptz,text,uuid,int) FROM PUBLIC, anon, authenticated, service_role;

-- PARALLEL CLOSED-WEEK PREPARATION (owner, 2026-11-02): from the moment the
-- union week closes, N shard jobs prove the closed week's windows and the
-- calculator's parts in parallel, each unit committed on its own, so job 272's
-- 04:00 preparation only reuses finished proofs. Shards stop as soon as the
-- week's payout boundary exists (no work during money) and never pay anything.
CREATE OR REPLACE PROCEDURE smarter_private.weekly_prep_shard(p_shard int,p_shards int)
LANGUAGE plpgsql AS $p$
DECLARE n timestamptz:=clock_timestamp(); e timestamptz; due timestamptz; plan jsonb; item jsonb; k text; id uuid; ps timestamptz; pe timestamptz;
 began timestamptz:=clock_timestamp(); run_id bigint; units int:=0; lbl text; c uuid; i int; nw int; step text; did boolean; d_from date; npages int;
BEGIN
 IF p_shards<1 OR p_shard<0 OR p_shard>=p_shards THEN RAISE EXCEPTION 'weekly_prep_shard_invalid'; END IF;
 e:=public.fn_union_week_start(n); due:=public.fn_union_accounting_run_at(e);
 -- Only between the week's close and twelve hours after its payout time.
 IF n<e OR n>=due+interval '12 hours' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.phase IN('draining','ready','paying')) THEN RETURN; END IF;
 plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN; END IF;
 INSERT INTO smarter_private.weekly_prep_shard_runs(shard,period_end) VALUES(p_shard,e) RETURNING smarter_private.weekly_prep_shard_runs.id INTO run_id;
 COMMIT;
 -- Scope club lists, resolved once under the coordinator's own key (shard 0).
 IF p_shard=0 THEN
  FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   k:=item->>'kind'; id:=(item->>'id')::uuid; ps:=(item->>'period_start')::timestamptz; pe:=(item->>'period_end')::timestamptz;
   IF NOT EXISTS(SELECT 1 FROM smarter_private.weekly_prep_scope_clubs q WHERE q.scope_kind=k AND q.scope_id=id AND q.period_start=ps AND q.period_end=pe) THEN
    BEGIN
     SET LOCAL lock_timeout='3s';
     INSERT INTO smarter_private.weekly_prep_scope_clubs(scope_kind,scope_id,period_start,period_end,club_ids)
     SELECT k,id,ps,pe,r.club_ids FROM public.fn_resolve_accounting_routing_scope(k,id,ps,pe) r ON CONFLICT DO NOTHING;
    EXCEPTION WHEN lock_not_available THEN NULL;
    END;
    COMMIT;
   END IF;
  END LOOP;
 END IF;
 -- Stage order: own-agent markers, earned plan, calculator parts, round windows.
 FOREACH step IN ARRAY ARRAY['clean','earned','players','tq','counts','check','write','r2','r3'] LOOP
  FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   k:=item->>'kind'; id:=(item->>'id')::uuid; ps:=(item->>'period_start')::timestamptz; pe:=(item->>'period_end')::timestamptz;
   IF step='earned' AND k<>'union' THEN CONTINUE; END IF;
   IF step IN('clean','earned','r2','r3') THEN
    SELECT count(*) INTO nw FROM public.fn_accounting_close_windows(ps,pe);
    FOR i IN 0..nw-1 LOOP
     CONTINUE WHEN i%p_shards<>p_shard;
     IF clock_timestamp()>began+interval '45 seconds' THEN EXIT; END IF;
     BEGIN
      lbl:=smarter_private.weekly_prep_unit(k,id,ps,pe,step,NULL,i);
     EXCEPTION WHEN OTHERS THEN
      UPDATE smarter_private.weekly_prep_shard_runs SET last_error=left(step||' '||i||': '||SQLERRM,500) WHERE smarter_private.weekly_prep_shard_runs.id=run_id; lbl:=NULL;
     END;
     IF lbl IS NOT NULL THEN units:=units+1; UPDATE smarter_private.weekly_prep_shard_runs SET units=units+1,last_unit=lbl WHERE smarter_private.weekly_prep_shard_runs.id=run_id; END IF;
     COMMIT;
    END LOOP;
   ELSE
    FOR c IN SELECT w.club_id FROM public.fn_accounting_week_clubs(CASE WHEN k='union' THEN id END,CASE WHEN k='club' THEN id END,ps,pe) w ORDER BY w.club_id LOOP
     d_from:=(ps AT TIME ZONE 'America/Los_Angeles')::date;
     nw:=CASE step WHEN 'players' THEN 1 WHEN 'tq' THEN 29 WHEN 'counts' THEN 86 ELSE
       COALESCE((SELECT jsonb_array_length(value->'pages') FROM public.accounting_recompute_split_parts WHERE club_id=c AND period_start=d_from AND kind='players' AND part=0),0) END;
     FOR i IN 0..nw-1 LOOP
      CONTINUE WHEN (i+abs(hashtext(c::text)))%p_shards<>p_shard;
      IF clock_timestamp()>began+interval '45 seconds' THEN EXIT; END IF;
      BEGIN
       lbl:=smarter_private.weekly_prep_unit(k,id,ps,pe,step,c,i);
      EXCEPTION WHEN OTHERS THEN
       UPDATE smarter_private.weekly_prep_shard_runs SET last_error=left(step||' '||c||' '||i||': '||SQLERRM,500) WHERE smarter_private.weekly_prep_shard_runs.id=run_id; lbl:=NULL;
      END;
      IF lbl IS NOT NULL THEN units:=units+1; UPDATE smarter_private.weekly_prep_shard_runs SET units=units+1,last_unit=lbl WHERE smarter_private.weekly_prep_shard_runs.id=run_id; END IF;
      COMMIT;
     END LOOP;
    END LOOP;
   END IF;
  END LOOP;
  EXIT WHEN clock_timestamp()>began+interval '45 seconds';
 END LOOP;
 UPDATE smarter_private.weekly_prep_shard_runs SET finished_at=clock_timestamp() WHERE smarter_private.weekly_prep_shard_runs.id=run_id;
 COMMIT;
END $p$;
REVOKE ALL ON PROCEDURE smarter_private.weekly_prep_shard(int,int) FROM PUBLIC, anon, authenticated, service_role;

-- READINESS AT HALF PAST THREE (owner, 2026-11-02): thirty minutes before the
-- original payout slot, a closed week that still owes scopes and has no
-- booked boundary for that slot is recorded for Production Alerts with what is
-- missing. Read-only; it never pays, prepares or retries.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_readiness_check()
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $f$
DECLARE n timestamptz:=clock_timestamp(); e timestamptz:=public.fn_union_week_start(clock_timestamp()); due timestamptz; plan jsonb; missing jsonb;
BEGIN
 due:=public.fn_union_accounting_run_at(e);
 IF n<due-interval '30 minutes' OR n>=due THEN RETURN NULL; END IF;
 plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.money_starts_at=due) THEN RETURN jsonb_build_object('ready',true); END IF;
 SELECT jsonb_build_object(
  'own_agent_windows_open',(SELECT jsonb_object_agg(x->>'id',(SELECT count(*) FROM public.fn_accounting_close_windows((x->>'period_start')::timestamptz,(x->>'period_end')::timestamptz) w
     WHERE NOT EXISTS(SELECT 1 FROM smarter_private.own_agent_clean_windows k WHERE k.scope_kind=x->>'kind' AND k.scope_id=(x->>'id')::uuid AND k.period_start=(x->>'period_start')::timestamptz AND k.period_end=(x->>'period_end')::timestamptz AND k.window_start=w.window_start)))
     FROM jsonb_array_elements(plan) x),
  'calculations_not_complete',(SELECT count(*) FROM jsonb_array_elements(plan) x CROSS JOIN LATERAL public.fn_accounting_week_clubs(CASE WHEN x->>'kind'='union' THEN (x->>'id')::uuid END,CASE WHEN x->>'kind'='club' THEN (x->>'id')::uuid END,(x->>'period_start')::timestamptz,(x->>'period_end')::timestamptz) c
     WHERE NOT EXISTS(SELECT 1 FROM public.accounting_period_recompute_requests q WHERE q.club_id=c.club_id AND q.period_start=((x->>'period_start')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date AND q.status='complete' AND q.attempted_at>=(x->>'period_end')::timestamptz)),
  'round_windows',(SELECT jsonb_object_agg(kind,cnt) FROM (SELECT p.kind,count(*) cnt FROM public.accounting_close_partials p WHERE p.period_end=e GROUP BY p.kind) z)) INTO missing;
 BEGIN
  PERFORM public.fn_record_operational_alert('weekly-payout','not-ready-at-0330:'||e::text,'WeeklyPayoutNotReadyHalfHourBefore','firing','critical',
   jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_end',e,'due',due,'owed',plan,'missing',missing,'observed_at',n));
 EXCEPTION WHEN OTHERS THEN NULL;
 END;
 RETURN jsonb_build_object('ready',false,'missing',missing);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_readiness_check() FROM PUBLIC, anon, authenticated, service_role;

-- The calculator's parts are shared with the shards: a part another writer
-- already made is kept, never a reason to refuse the attempt.
CREATE OR REPLACE FUNCTION public.fn_rakeback_recompute_split(p_club_id uuid, p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- PARTS SHARED WITH THE PREPARATION SHARDS (20261102).
-- A CLOSED WEEK'S RECOMPUTE IN PARTS (20261003). Inside a chunked close
-- attempt: the whole-period call of fn_rakeback_recompute_periods for this
-- club-week, made of parts kept across attempts (see the migration header).
-- Answers 'in_progress' while parts remain, or exactly what
-- fn_rakeback_recompute_periods returns, with the request row it records.
-- NULL outside a chunked close attempt, for an open or pre-cutover week and
-- for an unknown club: the caller then makes the whole-period call itself.
DECLARE v_from timestamptz; v_to timestamptz; cutover timestamptz; began timestamptz; did boolean:=false;
 oldest timestamptz; w record; v jsonb; pages jsonb; n_pages integer; i integer; ids uuid[];
 tq jsonb; ev bigint; inc bigint; dr bigint; issue_count bigint; receipt jsonb; result jsonb;
 request public.accounting_period_recompute_requests%ROWTYPE; request_state text;
BEGIN
 IF COALESCE(current_setting('app.weekly_accounting_chunked',true),'')<>'on'
  OR NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'') IS NULL
  OR p_club_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL
  OR NOT isfinite(p_period_start) OR NOT isfinite(p_period_end)
  OR extract(isodow FROM p_period_start)<>1 OR p_period_end<>p_period_start+6 THEN
  RETURN NULL;
 END IF;
 v_from:=p_period_start::timestamp AT TIME ZONE 'America/Los_Angeles';
 v_to:=(p_period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles';
 SELECT starts_at INTO cutover FROM public.accounting_cash_accrual_cutover WHERE singleton;
 IF v_to>clock_timestamp() OR cutover IS NULL OR v_from<cutover
  OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=p_club_id) THEN
  RETURN NULL;
 END IF;
 -- The calculator's own club-week lock, for every part and the receipt.
 PERFORM pg_advisory_xact_lock(hashtextextended('accounting_rakeback_period:'||p_club_id::text||':'||p_period_start::text,0));
 began:=NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz
  -COALESCE(NULLIF(current_setting('app.weekly_accounting_scope_budget',true),''),'8 minutes')::interval;
 -- At least one part per attempt (not per club): a union book asks for each
 -- of its clubs in one attempt.
 did:=COALESCE(current_setting('app.accounting_split_did',true),'')='on';
 -- Parts are kept only while no source of this club-week was recorded after
 -- the oldest of them (the preparation's reuse rule), for 12 hours, and only
 -- when made after the week closed.
 SELECT min(computed_at) INTO oldest FROM public.accounting_recompute_split_parts
  WHERE club_id=p_club_id AND period_start=p_period_start;
 IF oldest IS NOT NULL AND (oldest<v_to OR oldest<clock_timestamp()-interval '12 hours'
   OR EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND period_end<>p_period_end)
   OR EXISTS(SELECT 1 FROM (
     SELECT s.earned_at FROM public.accounting_cash_rake_sources s
     WHERE s.club_id=p_club_id AND s.recorded_at>oldest-interval '1 minute' OFFSET 0
    ) s WHERE s.earned_at>=v_from AND s.earned_at<v_to)
   OR EXISTS(SELECT 1 FROM (
     SELECT a.source_id FROM public.accounting_cash_atomic_contract_admissions a
     WHERE a.admitted_at>oldest-interval '1 minute' OFFSET 0
    ) a CROSS JOIN LATERAL (
     SELECT s.club_id,s.earned_at FROM public.accounting_cash_rake_sources s WHERE s.id=a.source_id OFFSET 0
    ) s WHERE s.club_id=p_club_id AND s.earned_at>=v_from AND s.earned_at<v_to)
   OR EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
     WHERE f.club_id=p_club_id AND f.charged_at<v_to AND f.recorded_at>oldest-interval '1 minute')) THEN
  DELETE FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start;
 END IF;
 -- 1. The player pages.
 IF NOT EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='players') THEN
  IF did AND clock_timestamp()>began+interval '90 seconds' THEN
   RETURN jsonb_build_object('status','in_progress','club_id',p_club_id,'period_start',p_period_start,'period_end',p_period_end,'stage','players');
  END IF;
  WITH p AS (SELECT s.player_id,count(*) AS n FROM public.accounting_payable_earning_sources s
    WHERE s.club_id=p_club_id AND s.earned_at>=v_from AND s.earned_at<v_to GROUP BY s.player_id),
  q AS (SELECT p.player_id,((sum(p.n) OVER(ORDER BY p.player_id)-p.n)/20000)::bigint AS pg FROM p)
  SELECT COALESCE(jsonb_agg(x.ids ORDER BY x.pg),'[]'::jsonb) INTO pages
   FROM (SELECT q.pg,jsonb_agg(q.player_id ORDER BY q.player_id) AS ids FROM q GROUP BY q.pg) x;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club_id,p_period_start,p_period_end,'players',0,jsonb_build_object('pages',pages)) ON CONFLICT DO NOTHING;
  did:=true; PERFORM set_config('app.accounting_split_did','on',true);
 END IF;
 SELECT value->'pages' INTO pages FROM public.accounting_recompute_split_parts
  WHERE club_id=p_club_id AND period_start=p_period_start AND kind='players' AND part=0;
 n_pages:=jsonb_array_length(pages);
 -- 2. The tournament gate, six hours at a time.
 FOR w IN SELECT (row_number() OVER(ORDER BY g)-1)::int AS idx,g AS ws,LEAST(g+interval '6 hours',v_to) AS we
   FROM generate_series(v_from,v_to-interval '1 microsecond',interval '6 hours') g ORDER BY 1 LOOP
  CONTINUE WHEN EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='tq' AND part=w.idx);
  IF did AND clock_timestamp()>began+interval '90 seconds' THEN EXIT; END IF;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club_id,p_period_start,p_period_end,'tq',w.idx,public.fn_accounting_tournament_week_quality(p_club_id,w.ws,w.we)) ON CONFLICT DO NOTHING;
  did:=true; PERFORM set_config('app.accounting_split_did','on',true);
 END LOOP;
 -- 3. The source-evidence counts, two hours at a time.
 FOR w IN SELECT (row_number() OVER(ORDER BY g)-1)::int AS idx,g AS ws,LEAST(g+interval '2 hours',v_to) AS we
   FROM generate_series(v_from,v_to-interval '1 microsecond',interval '2 hours') g ORDER BY 1 LOOP
  CONTINUE WHEN EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='counts' AND part=w.idx);
  IF did AND clock_timestamp()>began+interval '90 seconds' THEN EXIT; END IF;
  INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
  VALUES(p_club_id,p_period_start,p_period_end,'counts',w.idx,public.fn_rakeback_split_counts(p_club_id,v_from,v_to,w.ws,w.we)) ON CONFLICT DO NOTHING;
  did:=true; PERFORM set_config('app.accounting_split_did','on',true);
 END LOOP;
 IF (SELECT count(*) FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='tq')
    <>(SELECT count(*) FROM generate_series(v_from,v_to-interval '1 microsecond',interval '6 hours'))
  OR (SELECT count(*) FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='counts')
    <>(SELECT count(*) FROM generate_series(v_from,v_to-interval '1 microsecond',interval '2 hours')) THEN
  RETURN jsonb_build_object('status','in_progress','club_id',p_club_id,'period_start',p_period_start,'period_end',p_period_end,'stage','windows');
 END IF;
 -- The whole-period call's receipt and its tests, in its order.
 receipt:=jsonb_build_object('accounting_version',2,'club_id',p_club_id,'period_start',p_period_start,'period_end',p_period_end,'written',0,'status','blocked');
 SELECT p.value INTO tq FROM public.accounting_recompute_split_parts p
  WHERE p.club_id=p_club_id AND p.period_start=p_period_start AND p.kind='tq' AND p.value->>'status' IS DISTINCT FROM 'ready'
  ORDER BY (p.value->>'tournament_id')::uuid NULLS LAST,p.part LIMIT 1;
 IF tq IS NOT NULL THEN
  result:=receipt||tq||jsonb_build_object('written',0);
 ELSE
  SELECT sum((value->>'evidence')::bigint),sum((value->>'incomplete')::bigint),sum((value->>'drifted')::bigint) INTO ev,inc,dr
   FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='counts';
  IF ev>0 THEN result:=receipt||jsonb_build_object('reason','cash_earning_evidence_incomplete','source_count',ev); END IF;
  IF result IS NULL THEN
   SELECT count(*) INTO issue_count FROM public.rakeback_periods rp
    WHERE rp.club_id=p_club_id AND rp.period_start<=p_period_end AND rp.period_end>=p_period_start
      AND (rp.status<>'pending' OR rp.period_start<>p_period_start OR rp.period_end<>p_period_end
        OR NOT EXISTS(SELECT 1 FROM public.accounting_rakeback_period_calculations c WHERE c.period_id=rp.id));
   IF issue_count>0 THEN result:=receipt||jsonb_build_object('reason','legacy_or_paid_period_requires_reconciliation','period_count',issue_count);
   ELSIF inc>0 THEN result:=receipt||jsonb_build_object('reason','cash_source_receipts_incomplete','source_count',inc);
   ELSIF dr>0 THEN result:=receipt||jsonb_build_object('reason','cash_source_receipts_drifted','source_count',dr);
   END IF;
  END IF;
 END IF;
 -- 4. The check pass, then 5. the write pass, page by page.
 IF result IS NULL THEN
  FOR i IN 0..n_pages-1 LOOP
   CONTINUE WHEN EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='check' AND part=i);
   IF did AND clock_timestamp()>began+interval '90 seconds' THEN
    RETURN jsonb_build_object('status','in_progress','club_id',p_club_id,'period_start',p_period_start,'period_end',p_period_end,'stage','check');
   END IF;
   ids:=ARRAY(SELECT jsonb_array_elements_text(pages->i)::uuid);
   INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
   VALUES(p_club_id,p_period_start,p_period_end,'check',i,public.fn_rakeback_split_check(p_club_id,p_period_start,p_period_end,ids)) ON CONFLICT DO NOTHING;
   did:=true; PERFORM set_config('app.accounting_split_did','on',true);
  END LOOP;
  SELECT receipt||jsonb_build_object('reason',p.value->>'reason') INTO result FROM public.accounting_recompute_split_parts p
   WHERE p.club_id=p_club_id AND p.period_start=p_period_start AND p.kind='check' AND p.value ? 'reason' ORDER BY p.part LIMIT 1;
 END IF;
 IF result IS NULL THEN
  FOR i IN 0..n_pages-1 LOOP
   CONTINUE WHEN EXISTS(SELECT 1 FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='write' AND part=i);
   IF did AND clock_timestamp()>began+interval '90 seconds' THEN
    RETURN jsonb_build_object('status','in_progress','club_id',p_club_id,'period_start',p_period_start,'period_end',p_period_end,'stage','write');
   END IF;
   ids:=ARRAY(SELECT jsonb_array_elements_text(pages->i)::uuid);
   INSERT INTO public.accounting_recompute_split_parts(club_id,period_start,period_end,kind,part,value)
   VALUES(p_club_id,p_period_start,p_period_end,'write',i,public.fn_rakeback_split_write(p_club_id,p_period_start,p_period_end,ids)) ON CONFLICT DO NOTHING;
   did:=true; PERFORM set_config('app.accounting_split_did','on',true);
  END LOOP;
  SELECT receipt||jsonb_build_object('status','ready','written',COALESCE(sum((value->>'written')::integer),0),'confirmed_players',COALESCE(sum((value->>'confirmed')::integer),0))
   INTO result FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start AND kind='write';
 END IF;
 -- The request row, exactly as fn_rakeback_recompute_periods records a
 -- whole-period call.
 INSERT INTO public.accounting_period_recompute_requests(club_id,period_start,period_end)
  VALUES(p_club_id,p_period_start,p_period_end)
  ON CONFLICT(club_id,period_start,period_end) DO UPDATE SET last_requested_at=clock_timestamp(),status='pending',reason=NULL
  RETURNING * INTO request;
 request_state:=CASE WHEN result->>'status'='ready' THEN 'complete' ELSE 'blocked' END;
 UPDATE public.accounting_period_recompute_requests SET status=request_state,reason=result->>'reason',
  attempted_at=clock_timestamp(),attempts=attempts+1,last_result=result WHERE id=request.id;
 DELETE FROM public.accounting_recompute_split_parts WHERE club_id=p_club_id AND period_start=p_period_start;
 RETURN result||jsonb_build_object('request_id',request.id,'requested_at',request.requested_at,
  'request_state',request_state,'request_recorded',true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_rakeback_recompute_split(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rakeback_recompute_split(uuid,date,date) TO service_role;
DO $cron$ DECLARE j record; BEGIN
 FOR j IN SELECT jobid FROM cron.job WHERE jobname LIKE 'weekly-prep-shard-%' OR jobname='weekly-payout-readiness-0330' LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
 PERFORM cron.schedule('weekly-prep-shard-0','* * * * *','CALL smarter_private.weekly_prep_shard(0,4)');
 PERFORM cron.schedule('weekly-prep-shard-1','* * * * *','CALL smarter_private.weekly_prep_shard(1,4)');
 PERFORM cron.schedule('weekly-prep-shard-2','* * * * *','CALL smarter_private.weekly_prep_shard(2,4)');
 PERFORM cron.schedule('weekly-prep-shard-3','* * * * *','CALL smarter_private.weekly_prep_shard(3,4)');
 PERFORM cron.schedule('weekly-payout-readiness-0330','*/5 * * * *','SELECT smarter_private.weekly_payout_readiness_check()');
END $cron$;
DO $post$ BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname LIKE 'weekly-prep-shard-%' AND active)<>4 THEN RAISE EXCEPTION 'weekly_prep_shards_not_scheduled'; END IF;
END $post$;
COMMIT;

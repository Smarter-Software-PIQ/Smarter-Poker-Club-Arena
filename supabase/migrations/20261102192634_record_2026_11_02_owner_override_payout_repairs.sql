-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- RECORD OF THE 2026-11-02 OWNER-OVERRIDE DATABASE REPAIRS (owner, 2026-11-02).
-- During the 2026-11-02 weekly payout recovery the owner authorized direct
-- production repairs. This migration records their exact installed bodies so
-- the repository equals production: own-agent preparation reads week clubs
-- from the indexed reader; the promo's window loop variable no longer collides
-- with its wallet alias; the payout execution budget runs to its money
-- deadline (and the claim comparison records diagnostics); the paying
-- calculator gives agent/owner accounts 0% player rakeback and players under
-- agents a 10% floor for hands from 2026-11-02 17:30 UTC; the displayed rate
-- matches. Re-applying is a no-op on the installed database.
-- @live-proof: (SELECT count(*)=3 FROM pg_proc WHERE proname IN ('fn_calculate_cash_rakeback_periods','fn_rakeback_split_write','fn_rakeback_split_check') AND prosrc LIKE '%AGENTS KEEP THEIR OWN RAKE%') AND position('WEEK CLUBS FROM THE INDEXED READER' IN pg_get_functiondef('smarter_private.prepare_own_agent_interpretation(uuid,uuid,timestamptz,timestamptz,integer)'::regprocedure))>0
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='20s';
CREATE TABLE IF NOT EXISTS smarter_private.weekly_payout_claim_diagnostics(
 id bigserial PRIMARY KEY, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), run_id uuid, instance_id text, claims jsonb,
 unclaimed_cash jsonb, unclaimed_tournaments jsonb, claimed_without_lease jsonb, other_instances jsonb, strict_match boolean);
ALTER TABLE smarter_private.weekly_payout_claim_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_payout_claim_diagnostics FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS smarter_private.owner_override_round_receipts_20261102(round_no int, receipt jsonb, at timestamptz DEFAULT clock_timestamp());
REVOKE ALL ON TABLE smarter_private.owner_override_round_receipts_20261102 FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.union_weekly_horse_promo_recipients DROP CONSTRAINT IF EXISTS union_weekly_horse_promo_recipients_opening_balance_check;
ALTER TABLE public.union_weekly_horse_promo_recipients ADD CONSTRAINT union_weekly_horse_promo_recipients_opening_balance_check CHECK (opening_balance >= 0) NOT VALID;
-- The paying calculator carries text patches applied by replace() over its
-- live definition, like 20260927155651; it is recorded the same way: the two
-- exact replacements below, from its preimage to its installed postimage.
DO $calc$
DECLARE d text; pre CONSTANT text:='ced29c928d73b73be75d9e94604a2f7a'; post CONSTANT text:='15ec06cce006c02f7ca3b07e017ed668';
BEGIN
 d:=pg_get_functiondef('public.fn_calculate_cash_rakeback_periods(uuid,date,date,uuid[])'::regprocedure);
 IF md5(d)=post THEN RETURN; END IF;
 IF md5(d) IS DISTINCT FROM pre THEN RAISE EXCEPTION 'paying_calculator_preimage_changed'; END IF;
 IF (length(d)-length(replace(d,$old$CASE WHEN r.own_play THEN 0::numeric WHEN r.member_agent IS NULL AND r.deal=0.70 THEN r.deal WHEN r.cap_rate>0 THEN least(r.base_rate,greatest(r.cap_rate-0.10,0)) ELSE r.base_rate END AS applied_rate$old$,'')))<>length($old$CASE WHEN r.own_play THEN 0::numeric WHEN r.member_agent IS NULL AND r.deal=0.70 THEN r.deal WHEN r.cap_rate>0 THEN least(r.base_rate,greatest(r.cap_rate-0.10,0)) ELSE r.base_rate END AS applied_rate$old$) THEN RAISE EXCEPTION 'paying_calculator_rate_expression_not_single'; END IF;
 d:=replace(d,$old$CASE WHEN r.own_play THEN 0::numeric WHEN r.member_agent IS NULL AND r.deal=0.70 THEN r.deal WHEN r.cap_rate>0 THEN least(r.base_rate,greatest(r.cap_rate-0.10,0)) ELSE r.base_rate END AS applied_rate$old$,$new$CASE WHEN r.own_play THEN 0::numeric WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND COALESCE(r.member->>'role','') IN('super_agent','agent','sub_agent','owner','co_owner') THEN 0::numeric WHEN r.member_agent IS NULL AND r.deal=0.70 THEN r.deal WHEN r.cap_rate>0 THEN least(CASE WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND r.member_agent IS NOT NULL AND r.base_rate=0 THEN 0.10 ELSE r.base_rate END,greatest(r.cap_rate-0.10,0)) WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND r.member_agent IS NOT NULL AND r.base_rate=0 THEN 0.10 ELSE r.base_rate END AS applied_rate$new$);
 d:=replace(d,E'AS $function$\nDECLARE',$hdr$AS $function$
-- AGENTS KEEP THEIR OWN RAKE; TEN PERCENT FLOOR UNDER AGENTS (owner, 2026-11-02): hands earned from
-- 2026-11-02 17:30:00+00 on pay an agent, sub agent, super agent, owner or co-owner account 0% player
-- rakeback (the rake stays in their agent book), and a player under an agent whose
-- rakeback would be 0 receives 10%, inside the upline cap. Earlier hands keep their rates.
DECLARE$hdr$);
 IF md5(d) IS DISTINCT FROM post THEN RAISE EXCEPTION 'paying_calculator_postimage_mismatch'; END IF;
 EXECUTE d;
END $calc$;

CREATE OR REPLACE FUNCTION public.fn_midway_weekly_horse_promo(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 v_midway constant uuid := 'fade0000-0000-0000-0000-000000000001';
 v_open numeric; v_budget numeric; v_cents bigint; v_n integer; v_i integer:=0;
 v_each bigint; v_extra bigint; v_amount numeric; v_paid numeric:=0; v_paid_n integer:=0;
 v_run uuid; v_op uuid; v_wallets jsonb; v_wallet jsonb; v_result jsonb; v_prior jsonb;
 v_saved jsonb; v_key text; v_note text;
 v_users uuid[]; v_user uuid; v_covered boolean;
 v_raked text[]; rw record;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'midway_promo_service_required' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL
    OR p_from IS DISTINCT FROM public.fn_union_week_start(p_from)
    OR p_to IS DISTINCT FROM public.fn_union_week_start(p_from+interval '8 days')
    OR clock_timestamp()<public.fn_union_accounting_run_at(p_to)
    OR p_to<'2026-10-19 07:00:00+00'::timestamptz THEN
  RAISE EXCEPTION 'midway_promo_invalid_completed_week' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('midway-weekly-promo:'||extract(epoch FROM p_to)::text,0));
 SELECT result INTO v_prior FROM public.union_weekly_horse_promo_runs
  WHERE union_id=v_midway AND period_start=p_from AND period_end=p_to;
 IF FOUND THEN
  RETURN v_prior||jsonb_build_object('replayed',true);
 END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'midway_promo_platform_frozen'; END IF;
 -- RAKE-GENERATING HORSES ONLY (owner, 2026-11-02): "50% of all the surplus
 -- promo chips are sent to any and all horses that generated rake for that
 -- week". Each (club, horse) pair that has any payable earning source (cash
 -- rake or tournament fee) earned inside the week, read window by window.
 v_raked:=ARRAY[]::text[];
 FOR rw IN SELECT x.window_start,x.window_end FROM public.fn_accounting_close_windows(p_from,p_to)x ORDER BY 1 LOOP
  v_raked:=v_raked||ARRAY(SELECT DISTINCT s.club_id::text||':'||s.player_id::text
   FROM public.accounting_payable_earning_sources s JOIN public.profiles hp ON hp.id=s.player_id
   WHERE s.earned_at>=rw.window_start AND s.earned_at<rw.window_end AND hp.is_horse IS TRUE AND s.rake_credit>0);
 END LOOP;
 v_raked:=ARRAY(SELECT DISTINCT unnest(v_raked));
 -- Take the existing stats-user gates before the bank and row locks.
 -- This is only a candidate keyset; the fresh post-bank cohort must be covered.
 SELECT COALESCE(array_agg(k.user_id ORDER BY k.user_id),ARRAY[]::uuid[]) INTO v_users
 FROM (
  SELECT DISTINCT m.user_id
   FROM public.club_members m JOIN public.profiles p ON p.id=m.user_id
   JOIN public.clubs c ON c.id=m.club_id
   WHERE c.union_id=v_midway
    AND ((c.id=v_midway AND c.is_union IS TRUE) OR EXISTS(
      SELECT 1 FROM public.union_clubs uc WHERE uc.club_id=c.id AND uc.union_id=v_midway))
    AND p.is_horse IS TRUE
    AND p.horse_status IS DISTINCT FROM 'disabled'
    AND m.is_active IS TRUE AND m.status IN('active','approved')
    AND m.membership_lifecycle_status='active' AND (m.club_id::text||':'||m.user_id::text)=ANY(v_raked)
 ) k;
 FOREACH v_user IN ARRAY v_users LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('player-stats-user:'||v_user::text,0));
 END LOOP;
 SELECT promo_wallet INTO v_open FROM public.union_wallets WHERE union_id=v_midway FOR UPDATE;
 IF v_open IS NULL OR v_open<0 THEN RAISE EXCEPTION 'midway_promo_wallet_invalid'; END IF;
 v_budget:=trunc(v_open/2,2); v_cents:=(v_budget*100)::bigint;
 -- Lock and snapshot each eligible CLUB wallet before calculating shares.
 -- No union-wide balance aggregate and no duplicate membership expansion.
 -- Coverage and every row lock use the same fresh statement snapshot.
 -- An expanded cohort takes no club/member/profile row locks and refuses
 -- with a non-retryable state; PostgREST must not spin on this refusal.
 WITH eligible AS MATERIALIZED (
  SELECT m.club_id,m.user_id,m.chip_balance AS opening_balance
   FROM public.club_members m JOIN public.profiles p ON p.id=m.user_id
   JOIN public.clubs c ON c.id=m.club_id
   WHERE c.union_id=v_midway
    AND ((c.id=v_midway AND c.is_union IS TRUE) OR EXISTS(
      SELECT 1 FROM public.union_clubs uc WHERE uc.club_id=c.id AND uc.union_id=v_midway))
    AND p.is_horse IS TRUE
    AND p.horse_status IS DISTINCT FROM 'disabled'
    AND m.is_active IS TRUE AND m.status IN('active','approved')
    AND m.membership_lifecycle_status='active' AND (m.club_id::text||':'||m.user_id::text)=ANY(v_raked)
 ), coverage AS MATERIALIZED (
  SELECT COALESCE(bool_and(e.user_id=ANY(v_users)),true) AS covered FROM eligible e
 ), eligible_club_locks AS MATERIALIZED (
  SELECT c.id FROM public.clubs c
  JOIN (SELECT DISTINCT club_id FROM eligible) e ON e.club_id=c.id
  CROSS JOIN coverage k WHERE k.covered
  ORDER BY c.id FOR SHARE OF c
 ), club_barrier AS MATERIALIZED (
  SELECT k.covered,(SELECT count(*) FROM eligible_club_locks) AS locked_clubs FROM coverage k
 ), locked_wallets AS MATERIALIZED (
  SELECT m.club_id,m.user_id,m.chip_balance AS opening_balance
   FROM club_barrier b CROSS JOIN public.club_members m JOIN public.profiles p ON p.id=m.user_id
   JOIN public.clubs c ON c.id=m.club_id
   WHERE b.covered AND b.locked_clubs>=0
    AND EXISTS(SELECT 1 FROM eligible e WHERE e.club_id=m.club_id AND e.user_id=m.user_id)
    AND c.union_id=v_midway
    AND ((c.id=v_midway AND c.is_union IS TRUE) OR EXISTS(
      SELECT 1 FROM public.union_clubs uc WHERE uc.club_id=c.id AND uc.union_id=v_midway))
    AND p.is_horse IS TRUE
    AND p.horse_status IS DISTINCT FROM 'disabled'
    AND m.is_active IS TRUE AND m.status IN('active','approved')
    AND m.membership_lifecycle_status='active' AND (m.club_id::text||':'||m.user_id::text)=ANY(v_raked)
   ORDER BY m.user_id,m.club_id FOR UPDATE OF m FOR SHARE OF p,c
 )
 SELECT k.covered,COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.club_id,w.user_id)
  FROM locked_wallets w),'[]'::jsonb) INTO v_covered,v_wallets FROM coverage k;
 IF NOT v_covered THEN
  RAISE EXCEPTION 'midway_promo_eligible_cohort_changed' USING ERRCODE='55000';
 END IF;
 v_n:=jsonb_array_length(v_wallets); v_run:=gen_random_uuid();
 v_note:='Midway Weekly Promo Distribution: '||to_char(p_from AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD');
 INSERT INTO public.union_weekly_horse_promo_runs(id,union_id,period_start,period_end,opening_promo,budget,paid,eligible_wallets,paid_wallets,result)
 VALUES(v_run,v_midway,p_from,p_to,v_open,v_budget,0,v_n,0,'{}');
 -- Save/restore the caller's transaction-local ledger declaration.
 SELECT jsonb_object_agg(k,COALESCE(current_setting(k,true),'')) INTO v_saved FROM unnest(ARRAY[
  'app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity',
  'app.ledger_settlement','app.ledger_idempotency_key','app.ledger_counterparty_label',
  'app.ledger_correlation','app.ledger_autoskip_union_wallets','app.ledger_autoskip_clubs'])k;
 -- A promo run owns its settlement identity, not the preceding rakeback round.
 PERFORM set_config('app.ledger_settlement',v_run::text,true);
 IF v_n>0 AND v_cents>0 THEN
  v_each:=v_cents/v_n; v_extra:=v_cents%v_n;
  FOR v_wallet IN SELECT value FROM jsonb_array_elements(v_wallets) LOOP
   v_i:=v_i+1; v_amount:=(v_each+CASE WHEN v_i<=v_extra THEN 1 ELSE 0 END)::numeric/100;
   IF v_amount=0 THEN CONTINUE; END IF;
   v_op:=md5('midway-weekly-promo:'||extract(epoch FROM p_to)::text||':'||(v_wallet->>'club_id')||':'||(v_wallet->>'user_id'))::uuid;
   v_result:=public.fn_promo_disburse('union',v_midway,'player',(v_wallet->>'user_id')::uuid,
    v_amount,v_note,(v_wallet->>'club_id')::uuid,v_op);
   IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'replayed'='true' THEN
    RAISE EXCEPTION 'midway_promo_disbursement_not_confirmed' USING DETAIL=v_result::text;
   END IF;
   INSERT INTO public.union_weekly_horse_promo_recipients(run_id,club_id,user_id,opening_balance,amount,balance_after,operation_id,transaction_id)
   VALUES(v_run,(v_wallet->>'club_id')::uuid,(v_wallet->>'user_id')::uuid,(v_wallet->>'opening_balance')::numeric,
    v_amount,(v_result->>'recipient_after')::numeric,v_op,(v_result->>'transaction_id')::uuid);
   v_paid:=v_paid+v_amount; v_paid_n:=v_paid_n+1;
  END LOOP;
 END IF;
 FOR v_key IN SELECT jsonb_object_keys(v_saved) LOOP PERFORM set_config(v_key,v_saved->>v_key,true); END LOOP;
 IF v_paid<>(CASE WHEN v_n>0 THEN v_budget ELSE 0 END)
    OR (SELECT promo_wallet FROM public.union_wallets WHERE union_id=v_midway)<>v_open-v_paid THEN
  RAISE EXCEPTION 'midway_promo_conservation_failed';
 END IF;
 v_result:=jsonb_build_object('success',true,'run_id',v_run,'opening_promo',v_open,'budget',v_budget,
  'paid',v_paid,'eligible_wallets',v_n,'paid_wallets',v_paid_n,'remaining_promo',v_open-v_paid,
  'eligibility','horses_that_generated_rake_this_week','reason',CASE WHEN v_n=0 THEN 'no_eligible_wallets' WHEN v_cents=0 THEN 'no_distributable_chips' ELSE 'paid' END);
 UPDATE public.union_weekly_horse_promo_runs SET paid=v_paid,paid_wallets=v_paid_n,result=v_result WHERE id=v_run;
 RETURN v_result||jsonb_build_object('replayed',false);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_player_rakeback_rate(p_user_id uuid, p_club_id uuid, p_volume numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deal numeric; v_agent_default numeric; v_upline_rate numeric; v_rate numeric; v_cap numeric; v_has_agent boolean; v_explicit boolean;
BEGIN
  SELECT COALESCE(cm.player_rakeback_pct, 0),
         COALESCE(a.player_rakeback_rate, 0),
         COALESCE(a.commission_rate, 0),
         a.id IS NOT NULL, cm.player_rakeback_explicit
    INTO v_deal, v_agent_default, v_upline_rate, v_has_agent, v_explicit
    FROM club_members cm
    LEFT JOIN agents a ON a.user_id = cm.agent_id AND a.club_id = cm.club_id AND a.status = 'active'
     AND NOT (cm.player_rakeback_pct=0.70 AND EXISTS(SELECT 1 FROM public.clubs owner_club WHERE owner_club.id=cm.club_id AND owner_club.owner_id=cm.agent_id))
   WHERE cm.user_id = p_user_id AND cm.club_id = p_club_id
   LIMIT 1;

  -- AGENTS KEEP THEIR OWN RAKE (owner, 2026-11-02): an agent, sub agent,
  -- super agent, owner or co-owner account receives no player rakeback.
  IF EXISTS(SELECT 1 FROM agents a WHERE a.user_id=p_user_id AND a.club_id=p_club_id AND a.status='active')
     OR EXISTS(SELECT 1 FROM club_members m WHERE m.user_id=p_user_id AND m.club_id=p_club_id AND m.role IN('owner','co_owner')) THEN
    RETURN 0;
  END IF;
  -- 1. the player's own negotiated deal
  IF v_explicit OR COALESCE(v_deal,0) > 0 THEN
    v_rate := v_deal;
  -- 2. their agent's standing offer
  ELSIF v_has_agent THEN
    v_rate := v_agent_default;
  -- 3. legacy volume ladder (players with no agent)
  ELSE
    v_rate := CASE WHEN p_volume >= 10000 THEN 0.30
                   WHEN p_volume >=  2000 THEN 0.20
                   WHEN p_volume >=   500 THEN 0.15
                   WHEN p_volume >=   100 THEN 0.10
                   ELSE 0.05 END;
  END IF;

  -- TEN PERCENT AGENT DEFAULT (owner, 2026-11-02): every player under an
  -- agent or sub agent whose rakeback would otherwise be zero gets 10%,
  -- still inside the upline cap below.
  IF v_has_agent AND COALESCE(v_rate,0)=0 THEN
    v_rate := 0.10;
  END IF;

  -- Never more than the upline receives, less the ten-point gap.
  IF COALESCE(v_upline_rate,0) > 0 THEN
    v_cap := GREATEST(v_upline_rate - 0.10, 0);
    v_rate := LEAST(v_rate, v_cap);
  END IF;

  RETURN GREATEST(ROUND(COALESCE(v_rate,0), 4), 0);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_rakeback_split_check(p_club_id uuid, p_period_start date, p_period_end date, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- AGENTS KEEP THEIR OWN RAKE; TEN PERCENT FLOOR UNDER AGENTS (owner, 2026-11-02): hands earned from
-- 2026-11-02 17:30:00+00 on pay an agent, sub agent, super agent, owner or co-owner account 0% player
-- rakeback (the rake stays in their agent book), and a player under an agent whose
-- rakeback would be 0 receives 10%, inside the upline cap. Earlier hands keep their rates.
-- One page of fn_calculate_cash_rakeback_periods' loop, checked and not
-- written (20261003): its plan query for the page's players and every refusal
-- of its loop body, in its order, up to the certified-period test (both built
-- from its text by this migration). The first refusal is returned with its
-- player; otherwise the page's player count, how many already hold a
-- certificate of the same fingerprint, and a digest.
DECLARE
 v_from timestamptz; v_to timestamptz; existing public.rakeback_periods%ROWTYPE;
 certificate public.accounting_rakeback_period_calculations%ROWTYPE;
 player record; total_unrounded numeric; amount numeric; display_rate numeric;
 payer_kind text; payer_user uuid; coordinator_union uuid; allocations jsonb; plan jsonb;
 fingerprint text; period_id uuid; written integer:=0; confirmed integer:=0;
 n integer:=0; n_same integer:=0; dg text:='';
BEGIN
 v_from:=p_period_start::timestamp AT TIME ZONE 'America/Los_Angeles';
 v_to:=(p_period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles';
 BEGIN
 FOR player IN
  WITH receipts AS (
   SELECT s.source_type,s.source_id,s.rake_record_id,s.player_id,s.union_id,s.coordinator_union_id,s.earned_at,s.rake_credit,
    CASE WHEN s.source_type='tournament_fee_accrual' THEN public.fn_accounting_tournament_source_terms_at(fee.tournament_id,fee.charged_at,fee.contract) ELSE s.earned_at END AS agreement_at,
    s.contract AS source_contract,s.contract->'membership'->'terms' AS member,s.contract->'tiers'->0 AS direct,
    (s.contract->'membership'->>'history_id')::bigint AS member_history_ref,
    sum(s.rake_credit) OVER(PARTITION BY s.player_id) AS total_rake
   FROM public.accounting_payable_earning_sources s
   -- A cash row has no fee row, and a NULL join key never enters the index.
   LEFT JOIN public.accounting_tournament_fee_sources fee
     ON fee.id=CASE WHEN s.source_type='tournament_fee_accrual' THEN s.source_id END
   WHERE s.club_id=p_club_id AND s.earned_at>=v_from AND s.earned_at<v_to
     AND (p_user_ids IS NULL OR s.player_id=ANY(p_user_ids))
  ), parsed AS (
   SELECT r.*,COALESCE(r.member->>'role' IN('super_agent','agent','sub_agent') AND r.direct->>'user_id'=r.player_id::text,false) AS own_play,CASE WHEN ((r.member->>'player_rakeback_pct')::numeric=0.70 OR r.direct IS NULL) AND EXISTS(SELECT 1 FROM public.clubs owner_club WHERE owner_club.id=p_club_id AND owner_club.owner_id=NULLIF(r.member->>'agent_id','')::uuid) THEN NULL::uuid
     ELSE NULLIF(r.member->>'agent_id','')::uuid END AS member_agent,
    COALESCE((r.member->>'player_rakeback_pct')::numeric,0) AS deal,
    CASE WHEN NULLIF(r.member->>'agent_id','') IS NOT NULL
      THEN COALESCE((r.direct->'agreement'->'terms'->>'player_rakeback_rate')::numeric,0) ELSE 0 END AS offer,
    CASE WHEN NULLIF(r.member->>'agent_id','') IS NOT NULL OR COALESCE(r.member->>'role' IN('super_agent','agent','sub_agent') AND r.direct->>'user_id'=r.player_id::text,false) THEN (r.direct->>'rate')::numeric END AS cap_rate,
    mh.id AS member_history_id,ah.id AS agent_history_id,
    mh.after_terms AS recorded_member,ah.after_terms AS recorded_agent,smarter_private.own_agent_destination_contract(r.source_contract,p_club_id,r.player_id,r.agreement_at) AS destination_agreement
   FROM receipts r
   LEFT JOIN public.accounting_agreement_history mh ON mh.id=r.member_history_ref
    AND mh.entity_type='club_members' AND mh.entity_key=p_club_id::text||':'||r.player_id::text AND mh.observed_at<=r.agreement_at
   LEFT JOIN public.accounting_agreement_history ah ON ah.id=(r.direct->'agreement'->>'history_id')::bigint
    AND ah.entity_type='agents' AND ah.observed_at<=r.agreement_at
  ), rates AS (
   SELECT p.*,CASE WHEN COALESCE((p.member->>'player_rakeback_explicit')::boolean,false) OR p.deal>0 THEN p.deal WHEN p.member_agent IS NOT NULL THEN p.offer
    WHEN p.total_rake>=10000 THEN 0.30 WHEN p.total_rake>=2000 THEN 0.20
    WHEN p.total_rake>=500 THEN 0.15 WHEN p.total_rake>=100 THEN 0.10 ELSE 0.05 END AS base_rate
   FROM parsed p
  ), effective AS (
   SELECT r.*,CASE WHEN r.own_play THEN 0::numeric WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND COALESCE(r.member->>'role','') IN('super_agent','agent','sub_agent','owner','co_owner') THEN 0::numeric WHEN r.member_agent IS NULL AND r.deal=0.70 THEN r.deal WHEN r.cap_rate>0 THEN least(CASE WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND r.member_agent IS NOT NULL AND r.base_rate=0 THEN 0.10 ELSE r.base_rate END,greatest(r.cap_rate-0.10,0)) WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND r.member_agent IS NOT NULL AND r.base_rate=0 THEN 0.10 ELSE r.base_rate END AS applied_rate
   FROM rates r
  )
  SELECT e.player_id,max(e.total_rake) AS total_rake,sum(e.rake_credit*e.applied_rate) AS total_unrounded,
   count(*) FILTER(WHERE e.member_history_id IS NULL OR e.member IS DISTINCT FROM e.recorded_member
    OR e.member->>'club_id' IS DISTINCT FROM p_club_id::text OR e.member->>'user_id' IS DISTINCT FROM e.player_id::text
    OR COALESCE(e.member->>'status','') NOT IN('active','approved') OR e.member->>'is_active' IS DISTINCT FROM 'true') AS invalid_members,
   count(*) FILTER(WHERE (e.own_play OR e.member_agent IS NOT NULL) AND (e.direct IS NULL OR e.agent_history_id IS NULL
    OR e.direct->'agreement'->'terms' IS DISTINCT FROM e.recorded_agent
    OR e.direct->>'user_id' IS DISTINCT FROM CASE WHEN e.own_play THEN e.player_id::text ELSE e.member_agent::text END OR e.direct->>'depth' IS DISTINCT FROM '1'
    OR e.recorded_agent->>'club_id' IS DISTINCT FROM p_club_id::text OR e.recorded_agent->>'user_id' IS DISTINCT FROM CASE WHEN e.own_play THEN e.player_id::text ELSE e.member_agent::text END
    OR e.recorded_agent->>'status' IS DISTINCT FROM 'active'
    OR (e.own_play AND (e.direct->>'agent_id' IS DISTINCT FROM e.recorded_agent->>'id' OR COALESCE(e.recorded_agent->>'role','') NOT IN('super_agent','agent','sub_agent') OR e.direct->>'role' IS DISTINCT FROM e.recorded_agent->>'role'
      OR (e.direct->>'rate')::numeric IS DISTINCT FROM CASE WHEN (e.recorded_agent->>'commission_rate')::numeric>1 THEN (e.recorded_agent->>'commission_rate')::numeric/100 ELSE (e.recorded_agent->>'commission_rate')::numeric END
      OR (e.direct->>'rake_basis')::numeric IS DISTINCT FROM e.rake_credit OR (e.direct->>'remaining_basis')::numeric IS DISTINCT FROM e.rake_credit
      OR (e.direct->>'amount')::numeric IS DISTINCT FROM round(e.rake_credit*(e.direct->>'rate')::numeric,2))))) AS invalid_agents,
   count(*) FILTER(WHERE e.deal::text IN('NaN','Infinity','-Infinity') OR e.offer::text IN('NaN','Infinity','-Infinity')
    OR e.deal<0 OR e.deal>1 OR e.offer<0 OR e.offer>1
    OR ((e.own_play OR e.member_agent IS NOT NULL) AND (e.cap_rate IS NULL OR e.cap_rate<0 OR e.cap_rate>1 OR e.cap_rate::text IN('NaN','Infinity','-Infinity')))) AS invalid_rates,
   count(DISTINCT COALESCE(e.member_agent::text,'club')) AS payer_count,
   count(DISTINCT COALESCE(e.coordinator_union_id::text,'standalone')) AS coordinator_count,
   min(e.member_agent::text)::uuid AS payer_user,
   min(e.coordinator_union_id::text)::uuid AS coordinator_union,
   jsonb_agg(jsonb_build_object('source_type',e.source_type,'source_id',e.source_id,'rake_record_id',e.rake_record_id,'union_id',e.union_id,
    'coordinator_union_id',e.coordinator_union_id,'rake_credit',e.rake_credit,'rate',e.applied_rate,
    'unrounded_rakeback',e.rake_credit*e.applied_rate,'earned_at',e.earned_at,'agreement_at',e.agreement_at,'membership_history_id',e.member_history_id,
    'agent_history_id',e.agent_history_id,'payer_kind',CASE WHEN e.member_agent IS NULL THEN 'club' ELSE 'agent' END,
    'payer_user_id',e.member_agent)||CASE WHEN e.destination_agreement IS NOT NULL THEN jsonb_build_object('destination_kind','agent_wallet','destination_agreement',e.destination_agreement,'interpretation_version','own-agent-v1')ELSE '{}'::jsonb END ORDER BY e.earned_at,e.source_type,e.rake_record_id,e.source_id) AS allocations
  FROM effective e GROUP BY e.player_id ORDER BY e.player_id
 LOOP
  IF player.invalid_members>0 THEN RAISE EXCEPTION 'period_membership_contract_invalid' USING ERRCODE='55000'; END IF;
  IF player.invalid_agents>0 THEN RAISE EXCEPTION 'period_direct_agent_contract_invalid' USING ERRCODE='55000'; END IF;
  IF player.invalid_rates>0 THEN RAISE EXCEPTION 'period_observed_rate_invalid' USING ERRCODE='55000'; END IF;
  IF player.payer_count<1 THEN RAISE EXCEPTION 'historical_rakeback_payer_required' USING ERRCODE='55000'; END IF;
  IF player.coordinator_count<>1 THEN RAISE EXCEPTION 'multiple_recorded_coordinators_require_split_period' USING ERRCODE='55000'; END IF;
  total_unrounded:=player.total_unrounded;allocations:=player.allocations;payer_user:=CASE WHEN player.payer_count>1 THEN NULL ELSE player.payer_user END;coordinator_union:=player.coordinator_union;
  payer_kind:=CASE WHEN player.payer_count>1 THEN 'split' WHEN payer_user IS NULL THEN 'club' ELSE 'agent' END;
  amount:=round(total_unrounded,2);
  display_rate:=CASE WHEN player.total_rake>0 THEN round(total_unrounded/player.total_rake,4) ELSE 0 END;
  IF amount>player.total_rake OR amount<0 THEN RAISE EXCEPTION 'period_rakeback_not_conserved' USING ERRCODE='55000'; END IF;
  fingerprint:=md5(jsonb_build_object('allocations',allocations,'rake',player.total_rake,'amount',amount,'rate',display_rate)::text);
  plan:=jsonb_build_object('player_id',player.player_id,'rake_generated',player.total_rake,
   'rakeback_amount',amount,'display_rate',display_rate,'coordinator_union_id',coordinator_union,'payer_kind',payer_kind,'payer_user_id',payer_user,
   'source_fingerprint',fingerprint,'allocations',allocations);
  SELECT * INTO existing FROM public.rakeback_periods WHERE club_id=p_club_id AND user_id=(plan->>'player_id')::uuid
    AND period_start=p_period_start AND period_end=p_period_end FOR UPDATE;
  IF FOUND THEN
   SELECT * INTO certificate FROM public.accounting_rakeback_period_calculations cert WHERE cert.period_id=existing.id ORDER BY cert.id DESC LIMIT 1;
   IF NOT FOUND OR certificate.accounting_version<>2 OR certificate.club_id IS DISTINCT FROM p_club_id
    OR certificate.player_id IS DISTINCT FROM existing.user_id OR certificate.period_start IS DISTINCT FROM p_period_start
    OR certificate.period_end IS DISTINCT FROM p_period_end
    OR existing.status<>'pending' OR existing.rake_generated IS DISTINCT FROM certificate.rake_generated
    OR existing.total_rake_paid IS DISTINCT FROM certificate.rake_generated OR existing.rakeback_rate IS DISTINCT FROM certificate.display_rate
    OR existing.rakeback_earned IS DISTINCT FROM certificate.rakeback_amount OR existing.rakeback_amount IS DISTINCT FROM certificate.rakeback_amount
   THEN RAISE EXCEPTION 'certified_period_drift_requires_reconciliation' USING ERRCODE='55000'; END IF;
  END IF;
  n:=n+1;
  IF existing.id IS NOT NULL AND certificate.source_fingerprint=plan->>'source_fingerprint' THEN n_same:=n_same+1; END IF;
  dg:=md5(dg||player.player_id::text||':'||fingerprint);
 END LOOP;
 EXCEPTION WHEN SQLSTATE '55000' THEN
  RETURN jsonb_build_object('reason',SQLERRM,'player_id',player.player_id);
 END;
 RETURN jsonb_build_object('players',n,'same',n_same,'digest',dg);
END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_rakeback_split_write(p_club_id uuid, p_period_start date, p_period_end date, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- AGENTS KEEP THEIR OWN RAKE; TEN PERCENT FLOOR UNDER AGENTS (owner, 2026-11-02): hands earned from
-- 2026-11-02 17:30:00+00 on pay an agent, sub agent, super agent, owner or co-owner account 0% player
-- rakeback (the rake stays in their agent book), and a player under an agent whose
-- rakeback would be 0 receives 10%, inside the upline cap. Earlier hands keep their rates.
-- One page of fn_calculate_cash_rakeback_periods' loop (20261003): its plan
-- query for the page's players and its loop body, verbatim (built from its
-- text by this migration). Called only after every page passed
-- fn_rakeback_split_check.
DECLARE
 v_from timestamptz; v_to timestamptz; existing public.rakeback_periods%ROWTYPE;
 certificate public.accounting_rakeback_period_calculations%ROWTYPE;
 player record; total_unrounded numeric; amount numeric; display_rate numeric;
 payer_kind text; payer_user uuid; coordinator_union uuid; allocations jsonb; plan jsonb;
 fingerprint text; period_id uuid; written integer:=0; confirmed integer:=0;
BEGIN
 v_from:=p_period_start::timestamp AT TIME ZONE 'America/Los_Angeles';
 v_to:=(p_period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles';
 FOR player IN
  WITH receipts AS (
   SELECT s.source_type,s.source_id,s.rake_record_id,s.player_id,s.union_id,s.coordinator_union_id,s.earned_at,s.rake_credit,
    CASE WHEN s.source_type='tournament_fee_accrual' THEN public.fn_accounting_tournament_source_terms_at(fee.tournament_id,fee.charged_at,fee.contract) ELSE s.earned_at END AS agreement_at,
    s.contract AS source_contract,s.contract->'membership'->'terms' AS member,s.contract->'tiers'->0 AS direct,
    (s.contract->'membership'->>'history_id')::bigint AS member_history_ref,
    sum(s.rake_credit) OVER(PARTITION BY s.player_id) AS total_rake
   FROM public.accounting_payable_earning_sources s
   -- A cash row has no fee row, and a NULL join key never enters the index.
   LEFT JOIN public.accounting_tournament_fee_sources fee
     ON fee.id=CASE WHEN s.source_type='tournament_fee_accrual' THEN s.source_id END
   WHERE s.club_id=p_club_id AND s.earned_at>=v_from AND s.earned_at<v_to
     AND (p_user_ids IS NULL OR s.player_id=ANY(p_user_ids))
  ), parsed AS (
   SELECT r.*,COALESCE(r.member->>'role' IN('super_agent','agent','sub_agent') AND r.direct->>'user_id'=r.player_id::text,false) AS own_play,CASE WHEN ((r.member->>'player_rakeback_pct')::numeric=0.70 OR r.direct IS NULL) AND EXISTS(SELECT 1 FROM public.clubs owner_club WHERE owner_club.id=p_club_id AND owner_club.owner_id=NULLIF(r.member->>'agent_id','')::uuid) THEN NULL::uuid
     ELSE NULLIF(r.member->>'agent_id','')::uuid END AS member_agent,
    COALESCE((r.member->>'player_rakeback_pct')::numeric,0) AS deal,
    CASE WHEN NULLIF(r.member->>'agent_id','') IS NOT NULL
      THEN COALESCE((r.direct->'agreement'->'terms'->>'player_rakeback_rate')::numeric,0) ELSE 0 END AS offer,
    CASE WHEN NULLIF(r.member->>'agent_id','') IS NOT NULL OR COALESCE(r.member->>'role' IN('super_agent','agent','sub_agent') AND r.direct->>'user_id'=r.player_id::text,false) THEN (r.direct->>'rate')::numeric END AS cap_rate,
    mh.id AS member_history_id,ah.id AS agent_history_id,
    mh.after_terms AS recorded_member,ah.after_terms AS recorded_agent,smarter_private.own_agent_destination_contract(r.source_contract,p_club_id,r.player_id,r.agreement_at) AS destination_agreement
   FROM receipts r
   LEFT JOIN public.accounting_agreement_history mh ON mh.id=r.member_history_ref
    AND mh.entity_type='club_members' AND mh.entity_key=p_club_id::text||':'||r.player_id::text AND mh.observed_at<=r.agreement_at
   LEFT JOIN public.accounting_agreement_history ah ON ah.id=(r.direct->'agreement'->>'history_id')::bigint
    AND ah.entity_type='agents' AND ah.observed_at<=r.agreement_at
  ), rates AS (
   SELECT p.*,CASE WHEN COALESCE((p.member->>'player_rakeback_explicit')::boolean,false) OR p.deal>0 THEN p.deal WHEN p.member_agent IS NOT NULL THEN p.offer
    WHEN p.total_rake>=10000 THEN 0.30 WHEN p.total_rake>=2000 THEN 0.20
    WHEN p.total_rake>=500 THEN 0.15 WHEN p.total_rake>=100 THEN 0.10 ELSE 0.05 END AS base_rate
   FROM parsed p
  ), effective AS (
   SELECT r.*,CASE WHEN r.own_play THEN 0::numeric WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND COALESCE(r.member->>'role','') IN('super_agent','agent','sub_agent','owner','co_owner') THEN 0::numeric WHEN r.member_agent IS NULL AND r.deal=0.70 THEN r.deal WHEN r.cap_rate>0 THEN least(CASE WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND r.member_agent IS NOT NULL AND r.base_rate=0 THEN 0.10 ELSE r.base_rate END,greatest(r.cap_rate-0.10,0)) WHEN r.earned_at>='2026-11-02 17:30:00+00'::timestamptz AND r.member_agent IS NOT NULL AND r.base_rate=0 THEN 0.10 ELSE r.base_rate END AS applied_rate
   FROM rates r
  )
  SELECT e.player_id,max(e.total_rake) AS total_rake,sum(e.rake_credit*e.applied_rate) AS total_unrounded,
   count(*) FILTER(WHERE e.member_history_id IS NULL OR e.member IS DISTINCT FROM e.recorded_member
    OR e.member->>'club_id' IS DISTINCT FROM p_club_id::text OR e.member->>'user_id' IS DISTINCT FROM e.player_id::text
    OR COALESCE(e.member->>'status','') NOT IN('active','approved') OR e.member->>'is_active' IS DISTINCT FROM 'true') AS invalid_members,
   count(*) FILTER(WHERE (e.own_play OR e.member_agent IS NOT NULL) AND (e.direct IS NULL OR e.agent_history_id IS NULL
    OR e.direct->'agreement'->'terms' IS DISTINCT FROM e.recorded_agent
    OR e.direct->>'user_id' IS DISTINCT FROM CASE WHEN e.own_play THEN e.player_id::text ELSE e.member_agent::text END OR e.direct->>'depth' IS DISTINCT FROM '1'
    OR e.recorded_agent->>'club_id' IS DISTINCT FROM p_club_id::text OR e.recorded_agent->>'user_id' IS DISTINCT FROM CASE WHEN e.own_play THEN e.player_id::text ELSE e.member_agent::text END
    OR e.recorded_agent->>'status' IS DISTINCT FROM 'active'
    OR (e.own_play AND (e.direct->>'agent_id' IS DISTINCT FROM e.recorded_agent->>'id' OR COALESCE(e.recorded_agent->>'role','') NOT IN('super_agent','agent','sub_agent') OR e.direct->>'role' IS DISTINCT FROM e.recorded_agent->>'role'
      OR (e.direct->>'rate')::numeric IS DISTINCT FROM CASE WHEN (e.recorded_agent->>'commission_rate')::numeric>1 THEN (e.recorded_agent->>'commission_rate')::numeric/100 ELSE (e.recorded_agent->>'commission_rate')::numeric END
      OR (e.direct->>'rake_basis')::numeric IS DISTINCT FROM e.rake_credit OR (e.direct->>'remaining_basis')::numeric IS DISTINCT FROM e.rake_credit
      OR (e.direct->>'amount')::numeric IS DISTINCT FROM round(e.rake_credit*(e.direct->>'rate')::numeric,2))))) AS invalid_agents,
   count(*) FILTER(WHERE e.deal::text IN('NaN','Infinity','-Infinity') OR e.offer::text IN('NaN','Infinity','-Infinity')
    OR e.deal<0 OR e.deal>1 OR e.offer<0 OR e.offer>1
    OR ((e.own_play OR e.member_agent IS NOT NULL) AND (e.cap_rate IS NULL OR e.cap_rate<0 OR e.cap_rate>1 OR e.cap_rate::text IN('NaN','Infinity','-Infinity')))) AS invalid_rates,
   count(DISTINCT COALESCE(e.member_agent::text,'club')) AS payer_count,
   count(DISTINCT COALESCE(e.coordinator_union_id::text,'standalone')) AS coordinator_count,
   min(e.member_agent::text)::uuid AS payer_user,
   min(e.coordinator_union_id::text)::uuid AS coordinator_union,
   jsonb_agg(jsonb_build_object('source_type',e.source_type,'source_id',e.source_id,'rake_record_id',e.rake_record_id,'union_id',e.union_id,
    'coordinator_union_id',e.coordinator_union_id,'rake_credit',e.rake_credit,'rate',e.applied_rate,
    'unrounded_rakeback',e.rake_credit*e.applied_rate,'earned_at',e.earned_at,'agreement_at',e.agreement_at,'membership_history_id',e.member_history_id,
    'agent_history_id',e.agent_history_id,'payer_kind',CASE WHEN e.member_agent IS NULL THEN 'club' ELSE 'agent' END,
    'payer_user_id',e.member_agent)||CASE WHEN e.destination_agreement IS NOT NULL THEN jsonb_build_object('destination_kind','agent_wallet','destination_agreement',e.destination_agreement,'interpretation_version','own-agent-v1')ELSE '{}'::jsonb END ORDER BY e.earned_at,e.source_type,e.rake_record_id,e.source_id) AS allocations
  FROM effective e GROUP BY e.player_id ORDER BY e.player_id
 LOOP
  IF player.invalid_members>0 THEN RAISE EXCEPTION 'period_membership_contract_invalid' USING ERRCODE='55000'; END IF;
  IF player.invalid_agents>0 THEN RAISE EXCEPTION 'period_direct_agent_contract_invalid' USING ERRCODE='55000'; END IF;
  IF player.invalid_rates>0 THEN RAISE EXCEPTION 'period_observed_rate_invalid' USING ERRCODE='55000'; END IF;
  IF player.payer_count<1 THEN RAISE EXCEPTION 'historical_rakeback_payer_required' USING ERRCODE='55000'; END IF;
  IF player.coordinator_count<>1 THEN RAISE EXCEPTION 'multiple_recorded_coordinators_require_split_period' USING ERRCODE='55000'; END IF;
  total_unrounded:=player.total_unrounded;allocations:=player.allocations;payer_user:=CASE WHEN player.payer_count>1 THEN NULL ELSE player.payer_user END;coordinator_union:=player.coordinator_union;
  payer_kind:=CASE WHEN player.payer_count>1 THEN 'split' WHEN payer_user IS NULL THEN 'club' ELSE 'agent' END;
  amount:=round(total_unrounded,2);
  display_rate:=CASE WHEN player.total_rake>0 THEN round(total_unrounded/player.total_rake,4) ELSE 0 END;
  IF amount>player.total_rake OR amount<0 THEN RAISE EXCEPTION 'period_rakeback_not_conserved' USING ERRCODE='55000'; END IF;
  fingerprint:=md5(jsonb_build_object('allocations',allocations,'rake',player.total_rake,'amount',amount,'rate',display_rate)::text);
  plan:=jsonb_build_object('player_id',player.player_id,'rake_generated',player.total_rake,
   'rakeback_amount',amount,'display_rate',display_rate,'coordinator_union_id',coordinator_union,'payer_kind',payer_kind,'payer_user_id',payer_user,
   'source_fingerprint',fingerprint,'allocations',allocations);
  SELECT * INTO existing FROM public.rakeback_periods WHERE club_id=p_club_id AND user_id=(plan->>'player_id')::uuid
    AND period_start=p_period_start AND period_end=p_period_end FOR UPDATE;
  IF FOUND THEN
   SELECT * INTO certificate FROM public.accounting_rakeback_period_calculations cert WHERE cert.period_id=existing.id ORDER BY cert.id DESC LIMIT 1;
   IF NOT FOUND OR certificate.accounting_version<>2 OR certificate.club_id IS DISTINCT FROM p_club_id
    OR certificate.player_id IS DISTINCT FROM existing.user_id OR certificate.period_start IS DISTINCT FROM p_period_start
    OR certificate.period_end IS DISTINCT FROM p_period_end
    OR existing.status<>'pending' OR existing.rake_generated IS DISTINCT FROM certificate.rake_generated
    OR existing.total_rake_paid IS DISTINCT FROM certificate.rake_generated OR existing.rakeback_rate IS DISTINCT FROM certificate.display_rate
    OR existing.rakeback_earned IS DISTINCT FROM certificate.rakeback_amount OR existing.rakeback_amount IS DISTINCT FROM certificate.rakeback_amount
   THEN RAISE EXCEPTION 'certified_period_drift_requires_reconciliation' USING ERRCODE='55000'; END IF;
   period_id:=existing.id;
   IF certificate.source_fingerprint=plan->>'source_fingerprint' THEN PERFORM smarter_private.ensure_rakeback_payer_contracts(certificate.id); confirmed:=confirmed+1; CONTINUE; END IF;
   UPDATE public.rakeback_periods SET rake_generated=(plan->>'rake_generated')::numeric,total_rake_paid=(plan->>'rake_generated')::numeric,
    rakeback_rate=(plan->>'display_rate')::numeric,rakeback_earned=(plan->>'rakeback_amount')::numeric,rakeback_amount=(plan->>'rakeback_amount')::numeric
    WHERE id=period_id;
  ELSE
   INSERT INTO public.rakeback_periods(user_id,club_id,period_start,period_end,rake_generated,rakeback_rate,rakeback_earned,rakeback_amount,total_rake_paid,status)
    VALUES((plan->>'player_id')::uuid,p_club_id,p_period_start,p_period_end,(plan->>'rake_generated')::numeric,
     (plan->>'display_rate')::numeric,(plan->>'rakeback_amount')::numeric,(plan->>'rakeback_amount')::numeric,(plan->>'rake_generated')::numeric,'pending')
    RETURNING id INTO period_id;
  END IF;
  INSERT INTO public.accounting_rakeback_period_calculations(period_id,source_fingerprint,club_id,player_id,coordinator_union_id,period_start,period_end,
    rake_generated,rakeback_amount,display_rate,payer_kind,payer_user_id,source_allocations)
   VALUES(period_id,plan->>'source_fingerprint',p_club_id,(plan->>'player_id')::uuid,(plan->>'coordinator_union_id')::uuid,p_period_start,p_period_end,
    (plan->>'rake_generated')::numeric,(plan->>'rakeback_amount')::numeric,(plan->>'display_rate')::numeric,
    plan->>'payer_kind',(plan->>'payer_user_id')::uuid,plan->'allocations');
  written:=written+1;confirmed:=confirmed+1;
 END LOOP;
 RETURN jsonb_build_object('written',written,'confirmed',confirmed);
END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_weekly_accounting_payout_pause_ack(p_run_id uuid, p_ownership_token uuid, p_instance_id text, p_claims jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '1s'
AS $function$
DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 PERFORM smarter_private.weekly_payout_record_claims(p_run_id,p_instance_id,p_claims);
 IF NOT smarter_private.weekly_payout_claims_match(p_instance_id,p_claims) THEN
  RAISE EXCEPTION 'weekly_payout_complete_original_fleet_required' USING ERRCODE='55000';END IF;
 SELECT jsonb_agg(j ORDER BY j->>'scope',COALESCE(j->>'table_id',j->>'tournament_id'))
  INTO p_claims FROM jsonb_array_elements(p_claims)j;
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses p
  WHERE p.run_id=p_run_id AND p.ownership_token=p_ownership_token FOR UPDATE;
 IF r.phase='released' THEN RETURN smarter_private.weekly_payout_pause_json(r);END IF;
 IF smarter_private.weekly_payout_clock()<r.announced_at OR smarter_private.weekly_payout_clock()>=r.money_deadline_at THEN
  RAISE EXCEPTION 'weekly_payout_ack_outside_original_deadline' USING ERRCODE='55000';END IF;
 IF r.phase NOT IN('draining','ready') OR NOT smarter_private.weekly_payout_claims_match(p_instance_id,p_claims)
 THEN RAISE EXCEPTION 'weekly_payout_complete_original_fleet_required' USING ERRCODE='55000';END IF;
 IF r.phase='ready' AND (r.instance_id IS DISTINCT FROM p_instance_id OR r.lease_claims IS DISTINCT FROM p_claims)
 THEN RAISE EXCEPTION 'weekly_payout_acknowledged_owner_changed' USING ERRCODE='55000';END IF;
 UPDATE public.weekly_accounting_payout_pauses SET phase='ready',instance_id=p_instance_id,
  lease_claims=p_claims,acknowledged_at=smarter_private.weekly_payout_clock()
  WHERE run_id=r.run_id RETURNING * INTO r;
 RETURN smarter_private.weekly_payout_pause_json(r);
END $function$
;

CREATE OR REPLACE FUNCTION smarter_private.prepare_own_agent_interpretation(p_union uuid, p_club uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer DEFAULT 256)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE kind text;identity uuid;item record;seen int:=0;admitted int:=0;clubs uuid[];parts jsonb;certs jsonb;old_hash text;new_hash text;did_admit boolean;budget_exhausted boolean:=false;w record;win_first timestamptz;win_last timestamptz;win_n int;win_gaps int;by_window boolean:=false;win_seen int;win_exited boolean;work_deadline timestamptz:=LEAST(NULLIF(current_setting('app.weekly_accounting_preparation_deadline',true),'')::timestamptz,NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz);
BEGIN
 IF NOT public.fn_caller_is_engine()OR p_from IS NULL OR p_to IS NULL OR(p_union IS NULL)=(p_club IS NULL)OR p_limit IS NULL OR p_limit<1 OR p_limit>1024
 OR p_from IS DISTINCT FROM public.fn_union_week_start(p_from)OR p_to IS DISTINCT FROM public.fn_union_week_start(p_from+interval '8 days')OR p_to>now()THEN RAISE EXCEPTION 'own_agent_preparation_scope_invalid' USING ERRCODE='22023';END IF;
 kind:=CASE WHEN p_union IS NULL THEN'club'ELSE'union'END;identity:=coalesce(p_union,p_club);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(CASE WHEN p_union IS NULL THEN'club-accounting:'ELSE'union-accounting:'END||identity||':'||extract(epoch FROM p_from)||':'||extract(epoch FROM p_to),0))THEN RAISE EXCEPTION 'own_agent_interpretation_scope_busy' USING ERRCODE='55000';END IF;
 -- Original completed books remain authoritative, including manual correction
 -- receipts made later. Replaying them cannot create a v1 source or new delta.
 IF EXISTS(SELECT FROM public.accounting_routed_settlement_runs r WHERE r.scope_kind=kind AND r.scope_id=identity AND r.period_start=p_from AND r.period_end=p_to AND r.round_no=3)THEN RETURN jsonb_build_object('ready',true,'legacy_paid',true,'admitted',0);END IF;
 IF work_deadline IS NOT NULL AND(NOT isfinite(work_deadline)OR clock_timestamp()+interval '1 second'>=work_deadline)THEN RETURN jsonb_build_object('ready',false,'admitted',0,'reviewed',0,'budget_exhausted',true,'version','own-agent-v1');END IF;
 -- WEEK CLUBS FROM THE INDEXED READER (owner override, 2026-11-02): the whole-week
 -- view scan took over 45 s inside the payout's money window.
 SELECT coalesce(array_agg(c.club_id),'{}')INTO clubs FROM public.fn_accounting_week_clubs(p_union,p_club,p_from,p_to)c;
 IF NOT EXISTS(SELECT FROM public.accounting_own_agent_preparation_versions v WHERE v.scope_kind=kind AND v.scope_id=identity AND v.period_start=p_from AND v.period_end=p_to)THEN
  IF EXISTS(SELECT FROM public.accounting_routed_settlement_runs r WHERE r.scope_kind=kind AND r.scope_id=identity AND r.period_start=p_from AND r.period_end=p_to)
  OR EXISTS(SELECT FROM public.agent_commission_settlements a WHERE a.club_id=ANY(clubs)AND a.period_start=p_from AND a.period_end=p_to)
  OR EXISTS(SELECT FROM public.rakeback_periods r WHERE r.club_id=ANY(clubs)AND r.period_start=(p_from AT TIME ZONE'America/Los_Angeles')::date AND(r.status<>'pending'OR EXISTS(SELECT FROM public.rakeback_period_payouts pp WHERE pp.rakeback_period_id=r.id)))THEN RAISE EXCEPTION 'own_agent_interpretation_week_already_paid' USING ERRCODE='23514';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',p.kind,'window_start',p.window_start,'window_end',p.window_end,'full_row_md5',md5(to_jsonb(p)::text))ORDER BY p.kind,p.window_start),'[]')INTO parts FROM public.accounting_close_partials p WHERE p.union_id=identity AND p.period_start=p_from AND p.period_end=p_to;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',c.kind,'full_row_md5',md5(to_jsonb(c)::text))ORDER BY c.kind),'[]')INTO certs FROM public.accounting_close_certificates c WHERE c.union_id=identity AND c.period_start=p_from AND c.period_end=p_to;
  INSERT INTO public.accounting_own_agent_preparation_versions(scope_kind,scope_id,period_start,period_end,version,original_partials,original_certificates,owner_hashes)VALUES(kind,identity,p_from,p_to,'own-agent-v1',parts,certs,jsonb_build_object('producer',md5(pg_get_functiondef('public.fn_accounting_earning_contract(uuid,uuid,numeric,uuid,timestamptz)'::regprocedure)),'calculator',md5(pg_get_functiondef('public.fn_calculate_cash_rakeback_periods(uuid,date,date,uuid[])'::regprocedure)),'split_check',md5(pg_get_functiondef('public.fn_rakeback_split_check(uuid,date,date,uuid[])'::regprocedure)),'split_write',md5(pg_get_functiondef('public.fn_rakeback_split_write(uuid,date,date,uuid[])'::regprocedure))));
  DELETE FROM public.accounting_close_partials WHERE union_id=identity AND period_start=p_from AND period_end=p_to;
  DELETE FROM public.accounting_close_certificates WHERE union_id=identity AND period_start=p_from AND period_end=p_to;
  DELETE FROM public.accounting_recompute_split_parts WHERE club_id=ANY(clubs)AND period_start=(p_from AT TIME ZONE'America/Los_Angeles')::date AND period_end=(p_to AT TIME ZONE'America/Los_Angeles')::date-1;
  UPDATE public.accounting_period_recompute_requests SET status='pending',reason=NULL,last_result='{}',last_requested_at=clock_timestamp()WHERE club_id=ANY(clubs)AND period_start=(p_from AT TIME ZONE'America/Los_Angeles')::date AND period_end=(p_to AT TIME ZONE'America/Los_Angeles')::date-1;
 END IF;
 -- WINDOW BY WINDOW 20261102: the whole-week form of this query sorted every
 -- payable source of the week (millions of rows through the union view and
 -- their contract JSON) before returning one row, so it could not finish
 -- inside a 240s preparation tick and the 2026-11-02 payout never prepared.
 -- The same filters run per canonical close window (about 0.5s each); the
 -- reviewed set and every decision are identical, only the visiting order
 -- becomes window, then source. If the canonical windows do not tile the week
 -- exactly, the original whole-week query runs unchanged.
 SELECT min(x.window_start),max(x.window_end),count(*),
  count(*) FILTER(WHERE x.window_start IS DISTINCT FROM x.prev_end AND x.prev_end IS NOT NULL)
  INTO win_first,win_last,win_n,win_gaps
  FROM(SELECT c.window_start,c.window_end,lag(c.window_end)OVER(ORDER BY c.window_start)prev_end FROM public.fn_accounting_close_windows(p_from,p_to)c)x;
 by_window:=win_n>0 AND win_first=p_from AND win_last=p_to AND win_gaps=0;
 IF by_window THEN
 FOR w IN SELECT c.window_start,c.window_end FROM public.fn_accounting_close_windows(p_from,p_to)c ORDER BY c.window_start LOOP
  EXIT WHEN seen>=p_limit OR budget_exhausted;
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;EXIT;END IF;
  -- CLEAN WINDOWS ARE REMEMBERED 20261102: a window whose every candidate
  -- was reviewed stays clean until a source of this week's clubs is recorded
  -- or admitted after the window was checked (the recompute's reuse rule).
  CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.own_agent_clean_windows k
   WHERE k.scope_kind=kind AND k.scope_id=identity AND k.period_start=p_from AND k.period_end=p_to AND k.window_start=w.window_start
    AND NOT EXISTS(SELECT 1 FROM (SELECT s.earned_at FROM public.accounting_cash_rake_sources s
      WHERE s.club_id=ANY(clubs) AND s.recorded_at>k.checked_at-interval '1 minute' OFFSET 0) s WHERE s.earned_at>=w.window_start AND s.earned_at<w.window_end)
    AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f
      WHERE f.club_id=ANY(clubs) AND f.recorded_at>k.checked_at-interval '1 minute' AND f.charged_at>=w.window_start AND f.charged_at<w.window_end)
    AND NOT EXISTS(SELECT 1 FROM public.accounting_cash_atomic_contract_admissions a WHERE a.admitted_at>k.checked_at-interval '1 minute'));
  win_seen:=seen;win_exited:=false;
 FOR item IN SELECT s.source_type,s.source_id FROM public.accounting_payable_earning_sources s
 WHERE s.earned_at>=w.window_start AND s.earned_at<w.window_end AND((p_union IS NOT NULL AND s.coordinator_union_id=p_union)OR(p_club IS NOT NULL AND s.club_id=p_club AND s.coordinator_union_id IS NULL))
 AND coalesce(s.contract#>>'{membership,terms,role}','')IN('super_agent','agent','sub_agent')AND s.contract#>>'{tiers,0,user_id}'IS DISTINCT FROM s.player_id::text
 AND NOT(coalesce((s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=.70,false)AND EXISTS(SELECT FROM public.clubs c WHERE c.id=s.club_id AND c.owner_id=NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid))
 AND NOT EXISTS(SELECT FROM public.accounting_own_agent_source_reviews a WHERE a.source_type=s.source_type AND a.source_id=s.source_id)
 ORDER BY s.source_type,s.source_id LIMIT p_limit-seen LOOP
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;win_exited:=true;EXIT;END IF;
  seen:=seen+1;
  SELECT md5(s.contract::text)INTO STRICT old_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  did_admit:=smarter_private.admit_own_agent_source(item.source_type,item.source_id);
  IF did_admit THEN admitted:=admitted+1;END IF;
  SELECT md5(s.contract::text)INTO STRICT new_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  INSERT INTO public.accounting_own_agent_source_reviews(source_type,source_id,version,original_contract_md5,effective_contract_md5,outcome)VALUES(item.source_type,item.source_id,'own-agent-v1',old_hash,new_hash,CASE WHEN did_admit THEN'admitted'ELSE'unchanged'END);
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;win_exited:=true;EXIT;END IF;
 END LOOP;
  IF NOT win_exited AND NOT budget_exhausted AND seen-win_seen<p_limit-win_seen THEN
   INSERT INTO smarter_private.own_agent_clean_windows(scope_kind,scope_id,period_start,period_end,window_start,checked_at)
   VALUES(kind,identity,p_from,p_to,w.window_start,clock_timestamp())
   ON CONFLICT(scope_kind,scope_id,period_start,period_end,window_start) DO UPDATE SET checked_at=EXCLUDED.checked_at;
  END IF;
 END LOOP;
 ELSE
 FOR item IN SELECT s.source_type,s.source_id FROM public.accounting_payable_earning_sources s
 WHERE s.earned_at>=p_from AND s.earned_at<p_to AND((p_union IS NOT NULL AND s.coordinator_union_id=p_union)OR(p_club IS NOT NULL AND s.club_id=p_club AND s.coordinator_union_id IS NULL))
 AND coalesce(s.contract#>>'{membership,terms,role}','')IN('super_agent','agent','sub_agent')AND s.contract#>>'{tiers,0,user_id}'IS DISTINCT FROM s.player_id::text
 AND NOT(coalesce((s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=.70,false)AND EXISTS(SELECT FROM public.clubs c WHERE c.id=s.club_id AND c.owner_id=NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid))
 AND NOT EXISTS(SELECT FROM public.accounting_own_agent_source_reviews a WHERE a.source_type=s.source_type AND a.source_id=s.source_id)
 ORDER BY s.source_type,s.source_id LIMIT p_limit LOOP
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;EXIT;END IF;
  seen:=seen+1;
  SELECT md5(s.contract::text)INTO STRICT old_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  did_admit:=smarter_private.admit_own_agent_source(item.source_type,item.source_id);
  IF did_admit THEN admitted:=admitted+1;END IF;
  SELECT md5(s.contract::text)INTO STRICT new_hash FROM public.accounting_payable_earning_sources s WHERE s.source_type=item.source_type AND s.source_id=item.source_id;
  INSERT INTO public.accounting_own_agent_source_reviews(source_type,source_id,version,original_contract_md5,effective_contract_md5,outcome)VALUES(item.source_type,item.source_id,'own-agent-v1',old_hash,new_hash,CASE WHEN did_admit THEN'admitted'ELSE'unchanged'END);
  IF work_deadline IS NOT NULL AND clock_timestamp()+interval '1 second'>=work_deadline THEN budget_exhausted:=true;EXIT;END IF;
 END LOOP;
 END IF;
 RETURN jsonb_build_object('ready',NOT budget_exhausted AND seen<p_limit,'admitted',admitted,'reviewed',seen,'budget_exhausted',budget_exhausted,'version','own-agent-v1');
END $function$
;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_claims_match(p_instance text, p_claims jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- REPORTING ENGINE ADMITTED (owner override, 2026-11-02): three 2026-11-02
-- payout slots were refused by the claim comparison although the engine had
-- parked its tables at the money start. Until the claim builder is repaired
-- from the recorded diagnostics (weekly_payout_claim_diagnostics), admission
-- requires a named reporting instance and a claim array; the engine still
-- parks every table at the money start before it reports.
BEGIN
 RETURN NULLIF(btrim(p_instance),'') IS NOT NULL AND COALESCE(jsonb_typeof(p_claims),'array')='array';
END $function$
;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_execute(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '20s'
AS $function$
DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;item jsonb;res jsonb;prep jsonb;
 round integer;k text;id uuid;ws timestamptz;we timestamptz;receipts jsonb:='[]'::jsonb;
 kept jsonb:='[]'::jsonb;deferred jsonb:='[]'::jsonb;
 began timestamptz:=smarter_private.weekly_payout_clock();
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 IF current_setting('statement_timeout')::interval < interval '240 seconds'
  OR COALESCE(current_setting('app.weekly_accounting_chunked',true),'')<>'on'
 THEN RAISE EXCEPTION 'weekly_payout_original_240s_tick_required' USING ERRCODE='55000';END IF;
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses WHERE run_id=p_run;
 -- The original 04:00 invocation waits for its own physical fleet barrier.
 -- Do not lock the row before ACK: that would block the engine transaction
 -- needed to release this very wait. This bounded wait is part of the SAME
 -- original DUE statement, never a repair worker, new payer or renewed lease.
 WHILE r.phase='draining' AND smarter_private.weekly_payout_clock()>=r.money_starts_at
  AND smarter_private.weekly_payout_clock()+interval '45 seconds'<r.money_deadline_at LOOP
  PERFORM pg_sleep(0.05);
  SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses WHERE run_id=p_run;
 END LOOP;
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses WHERE run_id=p_run FOR UPDATE;
 began:=smarter_private.weekly_payout_clock();
 IF r.phase='released' THEN RETURN r.result||jsonb_build_object('duplicate',true);END IF;
 -- The original 180s scope must fit before the absolute money deadline and
 -- the original 240s statement must fit before the gameplay lease. Admission
 -- never renews either clock. Actual start time is retained rather than
 -- calling a late cron invocation an on-time four-o'clock payout.
 IF r.phase<>'ready' OR r.acknowledged_at>=r.money_deadline_at OR r.acknowledged_at IS NULL
  OR began<r.money_starts_at OR began+interval '45 seconds'>=r.money_deadline_at
  OR statement_timestamp()+interval '240 seconds'>=r.expires_at
  OR NOT smarter_private.weekly_payout_claims_match(r.instance_id,r.lease_claims)
 THEN RAISE EXCEPTION 'weekly_payout_not_prepared_and_parked_at_four' USING ERRCODE='55000';END IF;
 -- EVERY PREPARED SCOPE IS PAID (20261031190020): a boundary may own a subset
 -- of what this week still owes; every owned scope must still be owed, once.
 IF EXISTS(SELECT FROM jsonb_array_elements(r.scope_plan) j
   WHERE NOT j IN (SELECT value FROM jsonb_array_elements(smarter_private.weekly_payout_scope_plan(r.period_end,began))))
  OR (SELECT count(DISTINCT j) FROM jsonb_array_elements(r.scope_plan) j)<>jsonb_array_length(r.scope_plan)
 THEN RAISE EXCEPTION 'weekly_payout_prepared_scope_changed' USING ERRCODE='55000';END IF;
 PERFORM public.fn_weekly_accounting_attempt_begin(true);
 -- THE MONEY WINDOW IS THE BUDGET (owner override, 2026-11-02): the scope
 -- deadline runs to two seconds before the absolute money deadline instead of
 -- the statement start plus 180 seconds, which the engine's park acknowledgement
 -- (34 s on 2026-11-02) had already consumed.
 PERFORM set_config('app.weekly_accounting_scope_deadline',(r.money_deadline_at-interval '2 seconds')::text,true);
 -- Revalidate original prepared earning/certificate owners immediately before
 -- any financial capability exists. Changed applicable source evidence must
 -- refuse or be admitted by its original producer, never by a current-rate
 -- rewrite here. No old paid JSON, timestamps or fingerprints are retagged.
 FOR item IN SELECT value FROM jsonb_array_elements(r.scope_plan) LOOP
  PERFORM public.fn_weekly_accounting_deadline_check();
  -- A scope whose preparation changed is deferred to the next owned slot with
  -- nothing paid; it never refuses the scopes that are still prepared.
  BEGIN
   prep:=public.fn_prepare_accounting_week(CASE WHEN item->>'kind'='union' THEN (item->>'id')::uuid END,
    CASE WHEN item->>'kind'='club' THEN (item->>'id')::uuid END,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz);
  EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE='57014' THEN RAISE;END IF;
   prep:=jsonb_build_object('success',false,'error',SQLERRM,'sqlstate',SQLSTATE);
  END;
  IF prep->>'success'='true' THEN kept:=kept||jsonb_build_array(item);
  ELSE deferred:=deferred||jsonb_build_array(jsonb_build_object('scope',item,'preparation',prep));END IF;
 END LOOP;
 IF jsonb_array_length(kept)=0 THEN
  RAISE EXCEPTION 'weekly_payout_precommit_preparation_changed' USING ERRCODE='55000',DETAIL=deferred::text;END IF;
 IF kept IS DISTINCT FROM r.scope_plan THEN
  UPDATE public.weekly_accounting_payout_pauses SET scope_plan=kept WHERE run_id=r.run_id RETURNING * INTO r;
 END IF;
 UPDATE public.weekly_accounting_payout_pauses SET phase='paying' WHERE run_id=r.run_id;
 -- This outer order is deliberate: ALL club funding, then ALL agent gross
 -- pass-downs, and only then ANY player/horse secondary payment.
 FOR round IN 1..3 LOOP
  FOR item IN SELECT value FROM jsonb_array_elements(r.scope_plan) LOOP
   k:=item->>'kind';id:=(item->>'id')::uuid;ws:=(item->>'period_start')::timestamptz;we:=(item->>'period_end')::timestamptz;
   PERFORM public.fn_weekly_accounting_deadline_check();
   IF smarter_private.weekly_payout_clock()>=r.money_deadline_at THEN
    RAISE EXCEPTION 'weekly_payout_absolute_money_deadline' USING ERRCODE='57014';END IF;
   INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no)
   VALUES(pg_backend_pid(),txid_current(),r.run_id,k,id,ws,we,round)
   ON CONFLICT(backend_pid,transaction_id)DO UPDATE SET scope_kind=EXCLUDED.scope_kind,scope_id=EXCLUDED.scope_id,
    period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,round_no=EXCLUDED.round_no;
   IF round=1 THEN
    -- The original R1 closes and posts its own treasury debit; there is no
    -- transaction-local debit deferred until slow post-money documents.
    PERFORM set_config('app.union_close_defer_rake_debit','',true);
    IF k='union' THEN
     res:=public.fn_union_weekly_rakeback_close(id,ws,we);
     IF res->>'success' IS DISTINCT FROM 'true' AND res->>'error' IS DISTINCT FROM 'already_executed' THEN
      RAISE EXCEPTION 'weekly_payout_original_round1_refused' USING DETAIL=res::text;END IF;
    ELSE
     res:=public.fn_bank_standalone_week_rake(id,ws,we);
     IF res->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'weekly_payout_original_club_bank_refused' USING DETAIL=res::text;END IF;
    END IF;
   ELSIF round=2 THEN
    res:=public.fn_settle_accounting_commission_stage(k,id,ws,we);
   ELSE
    res:=public.fn_settle_accounting_rakeback_stage(k,id,ws,we);
   END IF;
   IF round IN(2,3) AND (res->>'success' IS DISTINCT FROM 'true' OR res->>'routing_version' IS DISTINCT FROM '3'
    OR res->>'source_version' IS DISTINCT FROM '2' OR COALESCE((res->>'shortfalls')::integer,0)<>0
    OR res->>'batch_committed'='true' OR NOT EXISTS(SELECT FROM public.accounting_routed_settlement_runs x
     WHERE x.scope_kind=k AND x.scope_id=id AND x.period_start=ws AND x.period_end=we AND x.round_no=round AND x.result=(res-'duplicate')))
   THEN RAISE EXCEPTION 'weekly_payout_original_financial_receipt_required' USING ERRCODE='23514',DETAIL=res::text;END IF;
   IF k='union' THEN
    INSERT INTO public.union_settlement_rounds(union_id,period_start,period_end,round_no,round_name,payers,payees,amount,shortfalls,detail)
    VALUES(id,ws,we,round,CASE round WHEN 1 THEN 'union_to_clubs' WHEN 2 THEN 'club_to_agents' ELSE 'agents_to_players' END,
     CASE WHEN round=1 THEN 1 ELSE 0 END,COALESCE((res->>'payees')::integer,(res->>'clubs_paid')::integer,0),
     COALESCE((res->>'amount')::numeric,(res->>'total_rakeback')::numeric,0),COALESCE((res->>'shortfalls')::integer,0),res)
    ON CONFLICT(union_id,period_start,period_end,round_no)DO NOTHING;
   END IF;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('scope',item,'round',round,'receipt',res));
  END LOOP;
 END LOOP;
 PERFORM public.fn_weekly_accounting_deadline_check();
 IF smarter_private.weekly_payout_clock()>=r.money_deadline_at THEN
  RAISE EXCEPTION 'weekly_payout_absolute_money_deadline' USING ERRCODE='57014';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(r.scope_plan) LOOP
  INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
  VALUES(item->>'kind',(item->>'id')::uuid,(item->>'period_start')::timestamptz,(item->>'period_end')::timestamptz,r.run_id,
   (SELECT jsonb_agg(j ORDER BY (j->>'round')::int) FROM jsonb_array_elements(receipts)j WHERE j->'scope'=item));
 END LOOP;
 DELETE FROM smarter_private.weekly_payout_owned_transactions WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 PERFORM public.fn_weekly_accounting_attempt_end();
 res:=jsonb_build_object('success',true,'owns_tick',true,'advanced',true,'stage','weekly_payout_financial_complete',
  'run_id',r.run_id,'scheduled_for',r.money_starts_at,'financial_started_at',began,
  'financial_finished_at',smarter_private.weekly_payout_clock(),'books_complete',false,'original_receipts',receipts,
  'attempt_no',r.attempt_no,'deferred_scopes',deferred);
 UPDATE public.weekly_accounting_payout_pauses SET phase='released',result=res WHERE run_id=r.run_id;
 RETURN res;
END $function$
;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_record_claims(p_run uuid, p_instance text, p_claims jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 INSERT INTO smarter_private.weekly_payout_claim_diagnostics(run_id,instance_id,claims,unclaimed_cash,unclaimed_tournaments,claimed_without_lease,other_instances,strict_match)
 SELECT p_run,p_instance,p_claims,
  (SELECT jsonb_agg(jsonb_build_object('table_id',l.table_id,'gen',l.lease_generation,'acquired',l.acquired_at)) FROM public.engine_table_leases l
    WHERE l.heartbeat_at>=clock_timestamp()-interval '30 seconds' AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_claims) j WHERE j->>'scope'='cash' AND (j->>'table_id')::uuid=l.table_id AND (j->>'lease_generation')::uuid=l.lease_generation)),
  (SELECT jsonb_agg(jsonb_build_object('tournament_id',l.tournament_id,'gen',l.lease_generation,'acquired',l.acquired_at)) FROM public.engine_tournament_leases l
    WHERE l.heartbeat_at>=clock_timestamp()-interval '30 seconds' AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_claims) j WHERE j->>'scope'='tournament' AND (j->>'tournament_id')::uuid=l.tournament_id AND (j->>'lease_generation')::uuid=l.lease_generation)),
  (SELECT jsonb_agg(j) FROM jsonb_array_elements(p_claims) j WHERE NOT EXISTS(SELECT FROM public.engine_table_leases l WHERE j->>'scope'='cash' AND l.table_id=(j->>'table_id')::uuid AND l.lease_generation=(j->>'lease_generation')::uuid AND l.heartbeat_at>=clock_timestamp()-interval '30 seconds')
     AND NOT EXISTS(SELECT FROM public.engine_tournament_leases l WHERE j->>'scope'='tournament' AND l.tournament_id=(j->>'tournament_id')::uuid AND l.lease_generation=(j->>'lease_generation')::uuid AND l.heartbeat_at>=clock_timestamp()-interval '30 seconds')),
  (SELECT jsonb_agg(DISTINCT x) FROM (SELECT instance_id||'/'||protocol_version x FROM public.engine_table_leases WHERE heartbeat_at>=clock_timestamp()-interval '30 seconds' UNION SELECT instance_id||'/'||protocol_version FROM public.engine_tournament_leases WHERE heartbeat_at>=clock_timestamp()-interval '30 seconds') z),
  smarter_private.weekly_payout_claims_match(p_instance,p_claims);
EXCEPTION WHEN OTHERS THEN NULL;
END $function$
;

REVOKE ALL ON FUNCTION public.fn_midway_weekly_horse_promo(timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_record_claims(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_weekly_accounting_payout_pause_ack(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_weekly_accounting_payout_pause_ack(uuid,uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_claims_match(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_rakeback_split_check(uuid,date,date,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rakeback_split_check(uuid,date,date,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.fn_calculate_cash_rakeback_periods(uuid,date,date,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_rakeback_split_write(uuid,date,date,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_rakeback_split_write(uuid,date,date,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.fn_player_rakeback_rate(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_player_rakeback_rate(uuid,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_player_rakeback_rate(uuid,uuid,numeric) TO service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_execute(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.prepare_own_agent_interpretation(uuid,uuid,timestamp with time zone,timestamp with time zone,integer) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

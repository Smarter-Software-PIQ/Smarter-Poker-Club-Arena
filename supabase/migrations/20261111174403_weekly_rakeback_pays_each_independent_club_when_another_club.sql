-- 20261111174403_weekly_rakeback_pays_each_independent_club_when_another_club.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WEEKLY RAKEBACK PAYS EVERY INDEPENDENTLY VALID, FULLY FUNDED CLUB WHEN
-- ANOTHER CLUB OF THE UNION REFUSES (owner decision, Dan, 2026-11-11)
--
-- CAUSE. The weekly runner (smarter_private.weekly_payout_next_round) pays a
-- union as ONE unit per round. Round 2 (fn_settle_accounting_commission_stage),
-- the funding step and round 3 (fn_settle_accounting_rakeback_stage) plan
-- every club of the union together and RAISE on the first club that refuses
-- (rakeback_cascade_club_cannot_afford_week, _club_bank_short,
-- _hierarchy_missing, _upline_deleted_after_funding, the round 3 agent and
-- bank shortfalls). The runner has no handler, so one club's refusal rolls
-- back every club's payment and is retried every minute for 24 hours, and its
-- only trace is cron.job_run_details.
--
-- WHAT IS SHARED AND WHAT IS NOT. Round 1 (union -> club banks) is the union's
-- rake pool and retained share: it stays one unit, and a round 1 refusal still
-- fails the whole union closed (nothing after it can be established). Round
-- 2's source proofs (the week's prepared earning sources, one fingerprint,
-- hierarchy and entitlement tests) are read as one prepared week: a refusal
-- there makes the shared allocation itself uncertain and still stops the
-- union. Everything a club's payment depends on after that is the club's own:
-- its certificates, its recorded hierarchy (an upline is refused if it is
-- recorded in another club), what round 1 credited its bank, its bank, its
-- agent wallets (one per club and user: an agent of two clubs is two nodes).
--
-- FIX. Inside the runner's owned union unit only (every other caller keeps the
-- whole-scope refusal), the club is the failure unit of rounds 2, the funding
-- step and 3:
--  * the cascade plan runs club by club (rakeback_cascade_plan(...,p_club), a
--    new overload of the unchanged plan); a club whose plan refuses is held,
--    and a refusal naming an upline recorded in a second club holds both;
--  * round 2 checks each remaining club on its own before anything moves (it
--    received enough for its week, its bank holds what round 2 sends now,
--    every wallet it credits exists) and runs unchanged on the rest;
--  * the funding step and round 3 leave out a club round 2 has not paid, and
--    hold a club whose own agent wallets or bank cannot pay its players;
--  * smarter_private.weekly_payout_club_rounds records each club per round as
--    paid (with its summary) or refused (code, message, amounts, attempts, and
--    one critical financial_alerts row, resolved when the club is paid);
--  * a pass that holds a club returns a partial receipt and writes no union
--    settlement run row, so the union round stays open; the runner leaves that
--    unit waiting while another unit can move, then retries one held unit per
--    tick (the one tried longest ago). The next pass pays only the held club:
--    a paid club is never planned again (round 2 by its paid row and source
--    fingerprint, round 3 by the paid periods' own evidence);
--  * finalize refuses while any club is held, and the union receipt is written
--    only when every club is paid, with the union totals of the whole round.
-- Exactly-once keys are unchanged (every leg key already names its club).
-- Union conservation holds pass by pass: each club leg comes from that club's
-- own round 1 credit, and the union round totals are the whole plan's.
-- Earning-time agreements and the latest certificate decide every amount as
-- before. Nothing is borrowed between clubs, invented, replayed or taken back.
-- No schedule, watcher or repair path is added: the runner's existing minute
-- cadence retries the held club. Horses are players: nothing reads is_horse.
--
-- Requires 20261111132447 installed (its postimages are pinned below).
-- Proof: scripts/ci/test-rakeback-cascade-real-runner-postgres.py (club
-- isolation cases) and the four other cascade harnesses (PostgreSQL 17).
-- @live-proof: md5(pg_get_functiondef('smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz,uuid)'::regprocedure))='f7fca69f443ae40af6339465c913a401'
-- @live-proof: md5(pg_get_functiondef('smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz)'::regprocedure))='189de81b3ce6632067714a2acef13dd8'
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure))='3ea177f7d282e2bc1e479e915301de2f'
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))='79c845fa37ea0a5fb3ac8d760c74e1e3'
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))='de1bb0529e631b1f230bc7670dc05e82'
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure))='79c53c2417257c9c5e269286801949eb'
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))='14078b0f07d739d79b292d62096e8d7d'
-- @live-proof: to_regclass('smarter_private.weekly_payout_club_rounds') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$BEGIN
 IF md5(pg_get_functiondef('smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'e90ddb3808272e0563c17b3f3d367528' THEN RAISE EXCEPTION 'club_isolation_plan4_preimage_changed';END IF;
 IF md5(pg_get_functiondef('smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '9c1b230443ff113dbb4049533578a09d' THEN RAISE EXCEPTION 'club_isolation_r2plan_preimage_changed';END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '255ebe71d6f04fa072a87798d20a7c56' THEN RAISE EXCEPTION 'club_isolation_fund_preimage_changed';END IF;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'a854bfbd9fcddb4143c6ead5f61c8141' THEN RAISE EXCEPTION 'club_isolation_r2_preimage_changed';END IF;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '471233c06fb2fe9cd2c0928756ba4b82' THEN RAISE EXCEPTION 'club_isolation_r3_preimage_changed';END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure)) IS DISTINCT FROM '5ec42349ea8afcff0697873cf317ff93' THEN RAISE EXCEPTION 'club_isolation_fin_preimage_changed';END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure)) IS DISTINCT FROM '332b762a004a779e32dc3fd2d1aef60d' THEN RAISE EXCEPTION 'club_isolation_run_preimage_changed';END IF;
 IF to_regclass('smarter_private.weekly_payout_club_rounds') IS NOT NULL THEN RAISE EXCEPTION 'club_isolation_table_exists';END IF;
END $pre$;
-- One row per club, round and union week: the club is the unit that is paid
-- or held inside a union run. No foreign key (a progress row never locks
-- clubs, unions or periods).
CREATE TABLE smarter_private.weekly_payout_club_rounds(
 scope_kind text NOT NULL CHECK(scope_kind='union'),
 scope_id uuid NOT NULL,
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 round_no int NOT NULL CHECK(round_no IN(2,3)),
 club_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('refused','paid')),
 code text,
 message text,
 detail jsonb,
 first_refused_at timestamptz,
 last_refused_at timestamptz,
 attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0),
 attempt_xid bigint,
 alert_id uuid,
 paid_at timestamptz,
 summary jsonb,
 CONSTRAINT weekly_payout_club_rounds_paid CHECK((status='paid')=(paid_at IS NOT NULL)),
 CONSTRAINT weekly_payout_club_rounds_refusal CHECK(status<>'refused' OR(code IS NOT NULL AND message IS NOT NULL AND last_refused_at IS NOT NULL AND attempts>0)),
 PRIMARY KEY(scope_kind,scope_id,period_start,period_end,round_no,club_id));
CREATE INDEX weekly_payout_club_rounds_held ON smarter_private.weekly_payout_club_rounds(scope_kind,scope_id,period_start,period_end,round_no) WHERE status='refused';
ALTER TABLE smarter_private.weekly_payout_club_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_payout_club_rounds FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE smarter_private.weekly_payout_club_rounds IS 'Per club, round (2 or 3) and union week inside the weekly payout runner: paid (with its summary) or refused (with the code, the message, the attempts and the financial alert). A refused club is retried by the runner; the union run is finalized only when no club is refused.';

-- True when this transaction is the weekly runner's owned unit for the round.
-- Club isolation applies only there; every other caller keeps the original
-- whole-scope refusal.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_club_isolated(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_round int)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT p_kind='union' AND smarter_private.weekly_payout_owns_round(p_kind,p_id,p_from,p_to,p_round)
$function$;

-- Records one club's refusal for the round. Outside the runner's owned unit
-- it raises the original refusal instead (the whole scope stops, as before).
-- The first refusal of a club in a round raises one financial alert; later
-- attempts update the row only.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_club_refuse(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_round int,p_club uuid,p_code text,p_message text,p_detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE w smarter_private.weekly_payout_club_rounds%ROWTYPE; alert uuid; club_name text;
BEGIN
 IF p_club IS NULL OR p_code IS NULL OR p_message IS NULL THEN RAISE EXCEPTION 'weekly_payout_club_refusal_incomplete' USING ERRCODE='22023'; END IF;
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,p_round) THEN
  RAISE EXCEPTION '%',p_message USING ERRCODE='23514';
 END IF;
 INSERT INTO smarter_private.weekly_payout_club_rounds AS x(scope_kind,scope_id,period_start,period_end,round_no,club_id,status,code,message,detail,first_refused_at,last_refused_at,attempts,attempt_xid)
 VALUES(p_kind,p_id,p_from,p_to,p_round,p_club,'refused',p_code,left(p_message,2000),p_detail,clock_timestamp(),clock_timestamp(),1,txid_current())
 ON CONFLICT(scope_kind,scope_id,period_start,period_end,round_no,club_id) DO UPDATE SET code=EXCLUDED.code,message=EXCLUDED.message,detail=EXCLUDED.detail,
  last_refused_at=EXCLUDED.last_refused_at,attempts=x.attempts+CASE WHEN x.attempt_xid IS NOT DISTINCT FROM EXCLUDED.attempt_xid THEN 0 ELSE 1 END,attempt_xid=EXCLUDED.attempt_xid
  WHERE x.status='refused'
 RETURNING * INTO w;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'weekly_payout_club_paid_then_refused: club % was already paid in round % of this week and is now refused (%)',p_club,p_round,p_code USING ERRCODE='23514';
 END IF;
 -- A club held in round 3 only because round 2 holds it is already alerted by round 2.
 IF w.alert_id IS NULL AND p_code<>'weekly_payout_club_round2_not_paid' THEN
  SELECT c.name INTO club_name FROM public.clubs c WHERE c.id=p_club;
  INSERT INTO public.financial_alerts(severity,source,message,context)
  VALUES('critical','weekly_payout_club_refused',
   'Weekly rakeback for '||COALESCE(club_name,p_club::text)||' (week starting '||to_char(p_from AT TIME ZONE 'America/Chicago','Mon DD')||') is held in round '||p_round
   ||': '||left(p_message,600)||'. Every other club of the union is paid independently. This club moves nothing until the cause is fixed; the runner retries it every minute and the union week is not finalized until it is paid.',
   jsonb_build_object('scope_kind',p_kind,'scope_id',p_id,'period_start',p_from,'period_end',p_to,'round',p_round,'club_id',p_club,'code',p_code,'detail',p_detail))
  RETURNING id INTO alert;
  UPDATE smarter_private.weekly_payout_club_rounds SET alert_id=alert
   WHERE scope_kind=p_kind AND scope_id=p_id AND period_start=p_from AND period_end=p_to AND round_no=p_round AND club_id=p_club;
 END IF;
END $function$;

-- The cascade plan, one club at a time, for the runner's union unit. A club
-- whose own plan refuses is recorded and left out; a refusal that names a
-- second club (an upline recorded in another club) holds both. Everything
-- else is the plan exactly as rakeback_cascade_plan writes it, for the clubs
-- that remain. Outside the runner's unit this is rakeback_cascade_plan.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_club_plan(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_round int)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date; c uuid; msg text; det text; hr record;
BEGIN
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,p_round) THEN
  RETURN smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to);
 END IF;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_edges(club_id uuid,payer_user uuid,payee_user uuid,amount numeric,route text,sort_order int,state text,carried numeric) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_nodes(club_id uuid,user_id uuid,sort_order int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_skipped(club_id uuid,user_id uuid,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_reserve(period_id uuid,club_id uuid,user_id uuid,amount numeric,PRIMARY KEY(period_id,club_id,user_id)) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_certs(calc_id bigint PRIMARY KEY,period_id uuid,club_id uuid,player_id uuid,owner_id uuid) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_legs(calc_id bigint,club_id uuid,player_id uuid,payer_kind text,payer_user uuid,owed numeric,route text,covered numeric DEFAULT 0,need numeric DEFAULT 0) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_acc_edges(LIKE pg_temp._rcf_edges) ON COMMIT DROP; TRUNCATE pg_temp._wpc_acc_edges;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_acc_nodes(LIKE pg_temp._rcf_nodes) ON COMMIT DROP; TRUNCATE pg_temp._wpc_acc_nodes;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_acc_skipped(LIKE pg_temp._rcf_skipped) ON COMMIT DROP; TRUNCATE pg_temp._wpc_acc_skipped;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_acc_reserve(LIKE pg_temp._rcf_reserve) ON COMMIT DROP; TRUNCATE pg_temp._wpc_acc_reserve;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_acc_certs(LIKE pg_temp._rcf_certs) ON COMMIT DROP; TRUNCATE pg_temp._wpc_acc_certs;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_acc_legs(LIKE pg_temp._rcf_legs) ON COMMIT DROP; TRUNCATE pg_temp._wpc_acc_legs;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_held(club_id uuid PRIMARY KEY,code text,message text,detail jsonb) ON COMMIT DROP; TRUNCATE pg_temp._wpc_held;
 FOR c IN SELECT DISTINCT x.club_id FROM public.rakeback_periods rp JOIN public.accounting_rakeback_period_calculations x ON x.period_id=rp.id
   WHERE rp.period_start=d_from AND rp.status='pending' AND x.coordinator_union_id=p_id AND x.club_id IS NOT NULL ORDER BY 1 LOOP
  -- Already paid in this round, or (round 3) not paid by round 2: not planned.
  CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.club_id=c
   AND((w.round_no=p_round AND w.status='paid') OR(p_round=3 AND w.round_no=2 AND w.status='refused')));
  CONTINUE WHEN EXISTS(SELECT 1 FROM pg_temp._wpc_held x WHERE x.club_id=c);
  BEGIN
   PERFORM smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to,c);
   INSERT INTO pg_temp._wpc_acc_edges SELECT * FROM pg_temp._rcf_edges;
   INSERT INTO pg_temp._wpc_acc_nodes SELECT * FROM pg_temp._rcf_nodes;
   INSERT INTO pg_temp._wpc_acc_skipped SELECT * FROM pg_temp._rcf_skipped;
   INSERT INTO pg_temp._wpc_acc_reserve SELECT * FROM pg_temp._rcf_reserve;
   INSERT INTO pg_temp._wpc_acc_certs SELECT * FROM pg_temp._rcf_certs;
   INSERT INTO pg_temp._wpc_acc_legs SELECT * FROM pg_temp._rcf_legs;
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT,det=PG_EXCEPTION_DETAIL;
   IF msg NOT LIKE 'rakeback_cascade_%' THEN RAISE; END IF;
   INSERT INTO pg_temp._wpc_held(club_id,code,message,detail)
   SELECT DISTINCT y.club,split_part(msg,':',1),msg,jsonb_build_object('planned_club',c,'clubs',CASE WHEN det LIKE '{%' THEN det::jsonb->'clubs' END)
    FROM(SELECT c AS club UNION SELECT (j#>>'{}')::uuid FROM jsonb_array_elements(CASE WHEN det LIKE '{%' THEN det::jsonb->'clubs' ELSE '[]'::jsonb END) j)y
    WHERE y.club IS NOT NULL ON CONFLICT(club_id) DO NOTHING;
  END;
 END LOOP;
 -- A club held by another club's refusal leaves the plan too.
 TRUNCATE pg_temp._rcf_edges,pg_temp._rcf_nodes,pg_temp._rcf_skipped,pg_temp._rcf_reserve,pg_temp._rcf_certs,pg_temp._rcf_legs;
 INSERT INTO pg_temp._rcf_edges SELECT * FROM pg_temp._wpc_acc_edges x WHERE NOT EXISTS(SELECT 1 FROM pg_temp._wpc_held h WHERE h.club_id=x.club_id);
 INSERT INTO pg_temp._rcf_nodes SELECT * FROM pg_temp._wpc_acc_nodes x WHERE NOT EXISTS(SELECT 1 FROM pg_temp._wpc_held h WHERE h.club_id=x.club_id);
 INSERT INTO pg_temp._rcf_skipped SELECT * FROM pg_temp._wpc_acc_skipped x WHERE NOT EXISTS(SELECT 1 FROM pg_temp._wpc_held h WHERE h.club_id=x.club_id);
 INSERT INTO pg_temp._rcf_reserve SELECT * FROM pg_temp._wpc_acc_reserve x WHERE NOT EXISTS(SELECT 1 FROM pg_temp._wpc_held h WHERE h.club_id=x.club_id);
 INSERT INTO pg_temp._rcf_certs SELECT * FROM pg_temp._wpc_acc_certs x WHERE NOT EXISTS(SELECT 1 FROM pg_temp._wpc_held h WHERE h.club_id=x.club_id);
 INSERT INTO pg_temp._rcf_legs SELECT * FROM pg_temp._wpc_acc_legs x WHERE NOT EXISTS(SELECT 1 FROM pg_temp._wpc_held h WHERE h.club_id=x.club_id);
 FOR hr IN SELECT * FROM pg_temp._wpc_held ORDER BY club_id LOOP
  PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,p_round,hr.club_id,hr.code,hr.message,hr.detail);
 END LOOP;
 RETURN EXISTS(SELECT 1 FROM pg_temp._rcf_legs);
END $function$;

-- ROUND 2, before any transfer and before any prior-transfer discharge: the
-- clubs of the union this pass pays. A club already paid by an earlier pass
-- is left out (its source fingerprint must be the same); each remaining club
-- is planned on its own and checked on its own (the week it received, its
-- bank, its wallets). A refused club is recorded and left out. Round 2 then
-- runs unchanged on the clubs that remain.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_round2_clubs(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_fingerprint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE scope record; sid uuid; d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date; x record;
BEGIN
 CREATE TEMP TABLE IF NOT EXISTS _wpc_round(club_id uuid PRIMARY KEY,state text NOT NULL) ON COMMIT DROP;
 TRUNCATE pg_temp._wpc_round;
 CREATE TEMP TABLE IF NOT EXISTS _wpc_r2(owner_nodes int,planned boolean) ON COMMIT DROP;
 TRUNCATE pg_temp._wpc_r2;
 INSERT INTO pg_temp._wpc_r2 SELECT count(*),NULL FROM pg_temp._routed_owner_nodes;
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,2) THEN RETURN; END IF;
 SELECT * INTO scope FROM public.fn_resolve_accounting_routing_scope(p_kind,p_id,p_from,p_to);
 INSERT INTO pg_temp._wpc_round SELECT DISTINCT y.club_id,'open' FROM(SELECT unnest(scope.club_ids) club_id UNION SELECT club_id FROM pg_temp._routed_clubs UNION SELECT club_id FROM pg_temp._routed_nodes)y WHERE y.club_id IS NOT NULL;
 IF EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=2
   AND w.status='paid' AND w.summary->>'source_fingerprint' IS DISTINCT FROM p_fingerprint)
 THEN RAISE EXCEPTION 'routed_commission_source_changed_after_payment' USING ERRCODE='55000'; END IF;
 UPDATE pg_temp._wpc_round o SET state='done' WHERE EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id
  AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=2 AND w.status='paid' AND w.club_id=o.club_id);
 -- The cascade plan, club by club (refusals recorded by weekly_payout_club_plan).
 UPDATE pg_temp._wpc_r2 SET planned=smarter_private.weekly_payout_club_plan(p_kind,p_id,p_from,p_to,2) WHERE true;
 INSERT INTO pg_temp._wpc_round SELECT DISTINCT club_id,'open' FROM pg_temp._rcf_legs ON CONFLICT DO NOTHING;
 INSERT INTO pg_temp._wpc_round SELECT club_id,'held' FROM pg_temp._wpc_held ON CONFLICT(club_id) DO UPDATE SET state='held';
 -- Each remaining club on its own: what it received for the week covers what
 -- leaves its bank this week (commission before any discharge, funding,
 -- players the bank pays), its bank holds what round 2 sends from it now, and
 -- every wallet round 2 credits exists.
 IF p_kind='union' THEN
  SELECT cs.id INTO sid FROM public.ca_settlements cs WHERE cs.settlement_type='union_rakeback_close'
   AND cs.external_ref=p_id::text||':'||to_char(p_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
 END IF;
 FOR x IN SELECT o.club_id,c.chip_treasury bank,
   COALESCE((SELECT l.amount FROM public.chip_ledger l WHERE l.idempotency_key='union_close:'||sid::text||':'||o.club_id::text AND l.to_type='club_treasury' AND l.to_entity_id=o.club_id),0) received,
   COALESCE((SELECT sum(e.amount) FROM pg_temp._routed_edges e WHERE e.club_id=o.club_id AND e.payer_user IS NULL),0) commission,
   COALESCE((SELECT sum(e.amount) FROM pg_temp._rcf_edges e WHERE e.club_id=o.club_id AND e.payer_user IS NULL),0) cascade,
   COALESCE((SELECT sum(e.amount) FROM pg_temp._rcf_edges e WHERE e.club_id=o.club_id AND e.payer_user IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(e.club_id,d_from,e.payer_user,e.payee_user))),0) cascade_unsent,
   COALESCE((SELECT sum(l.owed) FROM pg_temp._rcf_legs l WHERE l.club_id=o.club_id AND l.route='bank'),0) direct,
   (SELECT n.user_id FROM(SELECT r.user_id FROM pg_temp._routed_nodes r WHERE r.club_id=o.club_id AND NOT EXISTS(SELECT 1 FROM pg_temp._routed_owner_nodes w WHERE w.club_id=r.club_id AND w.user_id=r.user_id)
      UNION SELECT e.payee_user FROM pg_temp._rcf_edges e WHERE e.club_id=o.club_id AND e.route='hierarchy')n
     LEFT JOIN public.agents a ON a.club_id=o.club_id AND a.user_id=n.user_id
     WHERE a.id IS NULL OR a.agent_wallet_balance IS NULL OR a.agent_wallet_balance<0 OR a.agent_wallet_balance<>round(a.agent_wallet_balance,2) ORDER BY 1 LIMIT 1) bad_wallet
  FROM pg_temp._wpc_round o LEFT JOIN public.clubs c ON c.id=o.club_id WHERE o.state='open' ORDER BY o.club_id LOOP
  IF x.commission+x.cascade+x.direct>x.received AND EXISTS(SELECT 1 FROM pg_temp._rcf_legs l WHERE l.club_id=x.club_id) THEN
   PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,2,x.club_id,'rakeback_cascade_club_cannot_afford_week',
    format('rakeback_cascade_club_cannot_afford_week: club %s received %s for the week but owes %s (commission from the bank %s, agent and owner funding %s, players paid by the bank %s)',
     x.club_id,x.received,x.commission+x.cascade+x.direct,x.commission,x.cascade,x.direct),
    jsonb_build_object('received',x.received,'commission_from_bank',x.commission,'funding_from_bank',x.cascade,'players_paid_by_bank',x.direct));
  ELSIF x.bank IS NULL OR x.bank<>round(x.bank,2) OR x.bank<x.commission+x.cascade_unsent THEN
   PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,2,x.club_id,'routed_commission_club_funding_shortfall',
    format('routed_commission_club_funding_shortfall: club %s bank holds %s but round 2 sends %s from it (commission %s, rakeback funding %s)',x.club_id,x.bank,x.commission+x.cascade_unsent,x.commission,x.cascade_unsent),
    jsonb_build_object('bank',x.bank,'commission_from_bank',x.commission,'funding_from_bank',x.cascade_unsent));
  ELSIF x.bad_wallet IS NOT NULL THEN
   PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,2,x.club_id,'rakeback_cascade_agent_wallet_missing',
    format('rakeback_cascade_agent_wallet_missing: club %s agent %s has no valid agent wallet',x.club_id,x.bad_wallet),jsonb_build_object('agent_user_id',x.bad_wallet));
  ELSE CONTINUE;
  END IF;
  UPDATE pg_temp._wpc_round SET state='held' WHERE club_id=x.club_id;
 END LOOP;
 -- Round 2 runs on the clubs that remain.
 DELETE FROM pg_temp._routed_nodes t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._routed_edges t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._routed_owner_nodes t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._routed_clubs t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._rcf_edges t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._rcf_nodes t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._rcf_skipped t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._rcf_reserve t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._rcf_certs t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._rcf_legs t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 UPDATE pg_temp._wpc_r2 SET planned=EXISTS(SELECT 1 FROM pg_temp._rcf_legs) WHERE true;
END $function$;

-- Round 2 step A asks this first: the plan the club pass already made (true
-- or false), or NULL when no club pass ran in this transaction.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_round2_planned()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF to_regclass('pg_temp._wpc_r2') IS NULL THEN RETURN NULL; END IF;
 RETURN (SELECT planned FROM pg_temp._wpc_r2 LIMIT 1);
END $function$;

-- ROUND 3, once its items are read: clubs round 2 has not paid, and clubs the
-- funding step held in this same unit, are left out; a club this round paid
-- before is already done.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_round3_clubs(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE x record;
BEGIN
 CREATE TEMP TABLE IF NOT EXISTS _wpc_round(club_id uuid PRIMARY KEY,state text NOT NULL) ON COMMIT DROP;
 TRUNCATE pg_temp._wpc_round;
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,3) THEN RETURN; END IF;
 INSERT INTO pg_temp._wpc_round SELECT DISTINCT club_id,'open' FROM pg_temp._routed_player_items WHERE club_id IS NOT NULL;
 UPDATE pg_temp._wpc_round o SET state='done' WHERE EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id
  AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=3 AND w.status='paid' AND w.club_id=o.club_id);
 UPDATE pg_temp._wpc_round o SET state='held' WHERE o.state='open' AND EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id
  AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=3 AND w.status='refused' AND w.attempt_xid=txid_current() AND w.club_id=o.club_id);
 FOR x IN SELECT o.club_id,w.code FROM pg_temp._wpc_round o JOIN smarter_private.weekly_payout_club_rounds w ON w.scope_kind=p_kind AND w.scope_id=p_id
   AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=2 AND w.status='refused' AND w.club_id=o.club_id WHERE o.state='open' ORDER BY o.club_id LOOP
  PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,3,x.club_id,'weekly_payout_club_round2_not_paid',
   format('weekly_payout_club_round2_not_paid: club %s is held in round 2 (%s), so round 3 pays its players only after round 2 pays the club',x.club_id,x.code),jsonb_build_object('round2_code',x.code));
  UPDATE pg_temp._wpc_round SET state='held' WHERE club_id=x.club_id;
 END LOOP;
 DELETE FROM pg_temp._routed_player_todo t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
END $function$;

-- ROUND 3, before any wallet is locked or any player is paid: a club whose
-- agent wallets or bank cannot pay its own players is recorded and left out.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_round3_funding_holds(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE x record;
BEGIN
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,3) THEN RETURN; END IF;
 FOR x IN SELECT s.club_id,min(s.code) code,jsonb_agg(s.d ORDER BY s.code,s.d::text) d FROM(
   SELECT f.club_id,'routed_rakeback_agent_funding_shortfall' code,jsonb_build_object('agent_user_id',f.wallet_user,'owed',sum(f.owed),'holds',min(a.agent_wallet_balance)) d
    FROM pg_temp._routed_player_funding f LEFT JOIN public.agents a ON a.club_id=f.club_id AND a.user_id=f.wallet_user
    WHERE f.funded_from='agent_wallet' GROUP BY f.club_id,f.wallet_user HAVING min(a.agent_wallet_balance) IS NULL OR min(a.agent_wallet_balance)<sum(f.owed)
   UNION ALL
   SELECT f.club_id,'routed_rakeback_club_funding_shortfall',jsonb_build_object('owed',sum(f.owed),'bank',min(c.chip_treasury))
    FROM pg_temp._routed_player_funding f LEFT JOIN public.clubs c ON c.id=f.club_id
    WHERE f.funded_from='club_treasury' GROUP BY f.club_id HAVING min(c.chip_treasury) IS NULL OR min(c.chip_treasury)<sum(f.owed))s
  GROUP BY s.club_id ORDER BY s.club_id LOOP
  PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,3,x.club_id,x.code,format('%s: club %s cannot pay its players this week: %s',x.code,x.club_id,x.d::text),jsonb_build_object('shortfalls',x.d));
  INSERT INTO pg_temp._wpc_round VALUES(x.club_id,'held') ON CONFLICT(club_id) DO UPDATE SET state='held';
 END LOOP;
 DELETE FROM pg_temp._routed_player_todo t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._routed_player_funding t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._routed_player_wallets t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
 DELETE FROM pg_temp._routed_agent_wallets t USING pg_temp._wpc_round o WHERE o.club_id=t.club_id AND o.state<>'open';
END $function$;

-- THE FUNDING STEP (round 3 unit): a club that cannot afford its week, or
-- whose bank cannot send what it still owes, is recorded and left out.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_fund_club_holds(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE x record;
BEGIN
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,3) THEN RETURN; END IF;
 FOR x IN SELECT * FROM pg_temp._rcf_clubs ORDER BY club_id LOOP
  IF x.received IS NOT NULL AND x.commission+x.cascade+x.direct>x.received THEN
   PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,3,x.club_id,'rakeback_cascade_club_cannot_afford_week',
    format('rakeback_cascade_club_cannot_afford_week: club %s received %s for the week but owes %s (commission from the bank %s, agent and owner funding %s, players paid by the bank %s)',
     x.club_id,x.received,x.commission+x.cascade+x.direct,x.commission,x.cascade,x.direct),
    jsonb_build_object('received',x.received,'commission_from_bank',x.commission,'funding_from_bank',x.cascade,'players_paid_by_bank',x.direct));
  ELSIF x.bank IS NULL OR x.bank<>round(x.bank,2) OR x.cascade_unsent+x.direct>x.bank THEN
   PERFORM smarter_private.weekly_payout_club_refuse(p_kind,p_id,p_from,p_to,3,x.club_id,'rakeback_cascade_club_bank_short',
    format('rakeback_cascade_club_bank_short: club %s bank holds %s but the week still needs %s (agent and owner funding %s, players paid by the bank %s)',
     x.club_id,x.bank,x.cascade_unsent+x.direct,x.cascade_unsent,x.direct),
    jsonb_build_object('bank',x.bank,'funding_unsent',x.cascade_unsent,'players_paid_by_bank',x.direct));
  ELSE CONTINUE;
  END IF;
  DELETE FROM pg_temp._rcf_clubs WHERE club_id=x.club_id;
  DELETE FROM pg_temp._rcf_edges WHERE club_id=x.club_id;
  DELETE FROM pg_temp._rcf_nodes WHERE club_id=x.club_id;
  DELETE FROM pg_temp._rcf_skipped WHERE club_id=x.club_id;
  DELETE FROM pg_temp._rcf_reserve WHERE club_id=x.club_id;
  DELETE FROM pg_temp._rcf_certs WHERE club_id=x.club_id;
  DELETE FROM pg_temp._rcf_legs WHERE club_id=x.club_id;
 END LOOP;
END $function$;

-- The end of a round 2 or round 3 pass, before its union receipt: every club
-- this pass paid is recorded as paid (a refusal it had is resolved, with its
-- alert). If any club of the union is still refused in this round, the pass
-- returns its partial receipt and the union's round stays open (no settlement
-- run row, so the next pass pays only the refused clubs). NULL means every
-- club is paid and the round completes as before.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_club_round_close(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_round int,p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE o record; s jsonb; n int;
BEGIN
 IF NOT smarter_private.weekly_payout_club_isolated(p_kind,p_id,p_from,p_to,p_round) THEN RETURN NULL; END IF;
 FOR o IN SELECT club_id FROM pg_temp._wpc_round WHERE state='open' ORDER BY club_id LOOP
  IF p_round=2 THEN
   SELECT jsonb_build_object('source_fingerprint',p_fingerprint,
     'commission_amount',COALESCE(sum(g.commission),0),'commission_from_bank',COALESCE(sum(g.commission) FILTER(WHERE g.payer_user IS NULL),0),
     'funding_amount',COALESCE(sum(g.funding),0),'funding_from_bank',COALESCE(sum(g.funding) FILTER(WHERE g.payer_user IS NULL),0),
     'combined_legs',count(*) FILTER(WHERE g.commission>0 AND g.funding>0),'funding_only_legs',count(*) FILTER(WHERE g.commission=0),'commission_only_legs',count(*) FILTER(WHERE g.funding=0),
     'reserved',COALESCE((SELECT sum(w.remaining) FROM smarter_private.weekly_payout_wallet_reserves w JOIN pg_temp._rcf_reserve r ON r.period_id=w.period_id AND r.club_id=w.club_id AND r.user_id=w.user_id WHERE r.club_id=o.club_id),0),
     'reserve_rows_added',(SELECT count(*) FROM smarter_private.weekly_payout_wallet_reserves w WHERE w.club_id=o.club_id AND w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.set_by='round2'))
    INTO s FROM pg_temp._routed_gross g WHERE g.club_id=o.club_id;
  ELSE
   SELECT jsonb_build_object('source_fingerprint',p_fingerprint,'periods_paid',count(*),'amount',COALESCE(sum(t.owed),0))
    INTO s FROM pg_temp._routed_player_todo t JOIN pg_temp._routed_player_now w ON w.period_id=t.period_id WHERE t.club_id=o.club_id;
  END IF;
  INSERT INTO smarter_private.weekly_payout_club_rounds AS x(scope_kind,scope_id,period_start,period_end,round_no,club_id,status,paid_at,summary)
  VALUES(p_kind,p_id,p_from,p_to,p_round,o.club_id,'paid',clock_timestamp(),s)
  ON CONFLICT(scope_kind,scope_id,period_start,period_end,round_no,club_id) DO UPDATE SET status='paid',paid_at=EXCLUDED.paid_at,summary=EXCLUDED.summary WHERE x.status='refused';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'weekly_payout_club_paid_twice: club % was already paid in round % of this week',o.club_id,p_round USING ERRCODE='23514'; END IF;
  UPDATE public.financial_alerts a SET resolved=true,resolved_at=clock_timestamp(),
   resolution='Paid by the weekly payout runner in round '||p_round||' after '||w.attempts||' refused attempt(s); the cause no longer applies.'
  FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=p_round AND w.club_id=o.club_id
   AND a.id=w.alert_id AND NOT a.resolved;
 END LOOP;
 IF EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=p_round AND w.status='refused') THEN
  RETURN jsonb_build_object('success',true,'partial',true,'round',p_round,'routing_version',3,'source_version',2,'scope_kind',p_kind,'scope_id',p_id,'shortfalls',0,
   'held_clubs',(SELECT jsonb_agg(jsonb_build_object('club_id',w.club_id,'code',w.code,'message',w.message,'attempts',w.attempts,'first_refused_at',w.first_refused_at) ORDER BY w.club_id)
     FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=p_round AND w.status='refused'),
   'paid_clubs',(SELECT jsonb_agg(w.club_id ORDER BY w.club_id) FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=p_round AND w.status='paid'),
   'paid_now',(SELECT COALESCE(jsonb_agg(club_id ORDER BY club_id),'[]'::jsonb) FROM pg_temp._wpc_round WHERE state='open'));
 END IF;
 -- Every club is paid: round 2's union receipt carries the funding of every
 -- pass (a single pass sums to exactly what it sent).
 IF p_round=2 AND to_regclass('pg_temp._routed_cascade_summary') IS NOT NULL THEN
  TRUNCATE pg_temp._routed_cascade_summary;
  INSERT INTO pg_temp._routed_cascade_summary SELECT jsonb_build_object('version','rakeback-funding-v1','one_leg_per_edge',true,
   'funding_amount',COALESCE(sum((w.summary->>'funding_amount')::numeric),0),'funding_from_bank',COALESCE(sum((w.summary->>'funding_from_bank')::numeric),0),
   'combined_legs',COALESCE(sum((w.summary->>'combined_legs')::int),0),'funding_only_legs',COALESCE(sum((w.summary->>'funding_only_legs')::int),0),
   'commission_only_legs',COALESCE(sum((w.summary->>'commission_only_legs')::int),0),'reserved',COALESCE(sum((w.summary->>'reserved')::numeric),0),
   'reserve_rows_added',COALESCE(sum((w.summary->>'reserve_rows_added')::int),0))
  FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=2 AND w.status='paid';
 END IF;
 RETURN NULL;
END $function$;

-- THE RUNNER: a unit holding a refused club waits while any other unit of the
-- run can still move; when none can, exactly one held unit is retried per
-- tick, the one tried longest ago (round order on a tie). A round 3 unit
-- whose only holds are clubs round 2 has not paid is not retried while round
-- 2 still holds clubs.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_unit_waits(p_run uuid,p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_round int)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE pick record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=p_round AND w.status='refused') THEN
  RETURN false;
 END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses r CROSS JOIN LATERAL jsonb_array_elements(r.scope_plan) s CROSS JOIN generate_series(1,3) n
   WHERE r.run_id=p_run
    AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.scope_kind=s->>'kind' AND x.scope_id=(s->>'id')::uuid AND x.round_no=n)
    AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=s->>'kind' AND w.scope_id=(s->>'id')::uuid AND w.period_start=(s->>'period_start')::timestamptz
     AND w.period_end=(s->>'period_end')::timestamptz AND w.round_no=n AND w.status='refused')) THEN
  RETURN true;
 END IF;
 SELECT w.scope_kind,w.scope_id,w.period_start,w.period_end,w.round_no INTO pick
 FROM public.weekly_accounting_payout_pauses r CROSS JOIN LATERAL jsonb_array_elements(r.scope_plan) s
 JOIN smarter_private.weekly_payout_club_rounds w ON w.scope_kind=s->>'kind' AND w.scope_id=(s->>'id')::uuid AND w.period_start=(s->>'period_start')::timestamptz AND w.period_end=(s->>'period_end')::timestamptz AND w.status='refused'
 WHERE r.run_id=p_run
  AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.scope_kind=w.scope_kind AND x.scope_id=w.scope_id AND x.round_no=w.round_no)
  AND(w.round_no=2 OR NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds v WHERE v.scope_kind=w.scope_kind AND v.scope_id=w.scope_id AND v.period_start=w.period_start AND v.period_end=w.period_end AND v.round_no=2 AND v.status='refused')
   OR EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds v WHERE v.scope_kind=w.scope_kind AND v.scope_id=w.scope_id AND v.period_start=w.period_start AND v.period_end=w.period_end AND v.round_no=3 AND v.status='refused' AND v.code<>'weekly_payout_club_round2_not_paid'))
 GROUP BY w.scope_kind,w.scope_id,w.period_start,w.period_end,w.round_no
 ORDER BY max(w.last_refused_at),w.round_no,w.scope_id LIMIT 1;
 RETURN pick IS NULL OR(p_kind,p_id,p_from,p_to,p_round) IS DISTINCT FROM(pick.scope_kind,pick.scope_id,pick.period_start,pick.period_end,pick.round_no);
END $function$;

DO $patch_plan_one_club$
DECLARE src text:=pg_get_functiondef('smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM 'e90ddb3808272e0563c17b3f3d367528' THEN RAISE EXCEPTION 'club_isolation_plan_one_club_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$rakeback_cascade_plan(p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_plan_one_club_anchor_0_changed';END IF;
 src:=replace(src,$o$rakeback_cascade_plan(p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)$o$,$n$rakeback_cascade_plan(p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_club uuid)$n$);
 IF cardinality(string_to_array(src,$o$  WHERE(p_kind='union' AND x.coordinator_union_id=p_id) OR(p_kind='club' AND x.club_id=p_id AND x.coordinator_union_id IS NULL);$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_plan_one_club_anchor_1_changed';END IF;
 src:=replace(src,$o$  WHERE(p_kind='union' AND x.coordinator_union_id=p_id) OR(p_kind='club' AND x.club_id=p_id AND x.coordinator_union_id IS NULL);$o$,$n$  WHERE((p_kind='union' AND x.coordinator_union_id=p_id) OR(p_kind='club' AND x.club_id=p_id AND x.coordinator_union_id IS NULL)) AND x.club_id=p_club;$n$);
 IF cardinality(string_to_array(src,$o$ SELECT a.club_id,a.payer INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  JOIN pg_temp._rcf_chain c$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_plan_one_club_anchor_2_changed';END IF;
 src:=replace(src,$o$ SELECT a.club_id,a.payer INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  JOIN pg_temp._rcf_chain c$o$,$n$ SELECT a.club_id,a.payer,c.chain_club INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  JOIN pg_temp._rcf_chain c$n$);
 IF cardinality(string_to_array(src,$o$is not the agent its allocation agreement records',bad.club_id,bad.payer USING ERRCODE='23514'; END IF;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_plan_one_club_anchor_3_changed';END IF;
 src:=replace(src,$o$is not the agent its allocation agreement records',bad.club_id,bad.payer USING ERRCODE='23514'; END IF;$o$,$n$is not the agent its allocation agreement records',bad.club_id,bad.payer USING ERRCODE='23514',
  DETAIL=jsonb_build_object('clubs',jsonb_build_array(bad.club_id)||CASE WHEN bad.chain_club IS NOT NULL AND bad.chain_club<>bad.club_id THEN jsonb_build_array(bad.chain_club) ELSE '[]'::jsonb END)::text; END IF;$n$);
 IF cardinality(string_to_array(src,$o$recorded in club %',bad.club_id,bad.agent_id,bad.chain_club USING ERRCODE='23514'; END IF;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_plan_one_club_anchor_4_changed';END IF;
 src:=replace(src,$o$recorded in club %',bad.club_id,bad.agent_id,bad.chain_club USING ERRCODE='23514'; END IF;$o$,$n$recorded in club %',bad.club_id,bad.agent_id,bad.chain_club USING ERRCODE='23514',
  DETAIL=jsonb_build_object('clubs',jsonb_build_array(bad.club_id)||CASE WHEN bad.chain_club IS NOT NULL THEN jsonb_build_array(bad.chain_club) ELSE '[]'::jsonb END)::text; END IF;$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz,uuid)'::regprocedure)) IS DISTINCT FROM 'f7fca69f443ae40af6339465c913a401' THEN RAISE EXCEPTION 'club_isolation_plan_one_club_postimage_changed';END IF;
END $patch_plan_one_club$;
DO $patch_round2_plan$
DECLARE src text:=pg_get_functiondef('smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '9c1b230443ff113dbb4049533578a09d' THEN RAISE EXCEPTION 'club_isolation_round2_plan_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$planned:=smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to);$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_plan_anchor_0_changed';END IF;
 src:=replace(src,$o$planned:=smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to);$o$,$n$-- CLUB ISOLATION (20261111174403): in the runner's union unit the plan was
 -- made club by club before any transfer; the refused clubs are already out.
 planned:=COALESCE(smarter_private.weekly_payout_round2_planned(),smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to));$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '189de81b3ce6632067714a2acef13dd8' THEN RAISE EXCEPTION 'club_isolation_round2_plan_postimage_changed';END IF;
END $patch_round2_plan$;
DO $patch_funding$
DECLARE src text:=pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '255ebe71d6f04fa072a87798d20a7c56' THEN RAISE EXCEPTION 'club_isolation_funding_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$IF NOT smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to) THEN$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_funding_anchor_0_changed';END IF;
 src:=replace(src,$o$IF NOT smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to) THEN$o$,$n$-- CLUB ISOLATION (20261111174403): in the runner's union unit, club by club;
 -- clubs round 2 has not paid are not planned, and a refused club is held.
 IF NOT smarter_private.weekly_payout_club_plan(p_kind,p_id,p_from,p_to,3) THEN$n$);
 IF cardinality(string_to_array(src,$o$r.round_no=2 AND r.result ? 'rakeback_cascade');$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_funding_anchor_1_changed';END IF;
 src:=replace(src,$o$r.round_no=2 AND r.result ? 'rakeback_cascade');$o$,$n$r.round_no=2 AND r.result ? 'rakeback_cascade')
  OR EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_kind AND w.scope_id=p_id AND w.period_start=p_from AND w.period_end=p_to AND w.round_no=2 AND w.status='paid');$n$);
 IF cardinality(string_to_array(src,$o$ SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.received IS NOT NULL AND x.commission+x.cascade+x.direct>x.received ORDER BY x.club_id LIMIT 1;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_funding_anchor_2_changed';END IF;
 src:=replace(src,$o$ SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.received IS NOT NULL AND x.commission+x.cascade+x.direct>x.received ORDER BY x.club_id LIMIT 1;$o$,$n$ PERFORM smarter_private.weekly_payout_fund_club_holds(p_kind,p_id,p_from,p_to);
 SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.received IS NOT NULL AND x.commission+x.cascade+x.direct>x.received ORDER BY x.club_id LIMIT 1;$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '3ea177f7d282e2bc1e479e915301de2f' THEN RAISE EXCEPTION 'club_isolation_funding_postimage_changed';END IF;
END $patch_funding$;
DO $patch_round2$
DECLARE src text:=pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM 'a854bfbd9fcddb4143c6ead5f61c8141' THEN RAISE EXCEPTION 'club_isolation_round2_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$DECLARE foreign_legacy_deferred boolean:=false;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_0_changed';END IF;
 src:=replace(src,$o$DECLARE foreign_legacy_deferred boolean:=false;$o$,$n$DECLARE club_partial jsonb;foreign_legacy_deferred boolean:=false;$n$);
 IF cardinality(string_to_array(src,$o$    AND (cs.union_id=p_union_id OR cs.club_id=ANY(scope.club_ids)))$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_1_changed';END IF;
 src:=replace(src,$o$    AND (cs.union_id=p_union_id OR cs.club_id=ANY(scope.club_ids)))$o$,$n$    AND (cs.union_id=p_union_id OR cs.club_id=ANY(scope.club_ids))
    AND NOT(cs.settlement_ref=run_key AND EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_scope_kind AND w.scope_id=p_scope_id
     AND w.period_start=p_period_start AND w.period_end=p_period_end AND w.round_no=2 AND w.status='paid' AND w.club_id=cs.club_id)))$n$);
 IF cardinality(string_to_array(src,$o$   AND (cs.union_id=p_union_id OR cs.club_id=ANY(scope.club_ids)))$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_2_changed';END IF;
 src:=replace(src,$o$   AND (cs.union_id=p_union_id OR cs.club_id=ANY(scope.club_ids)))$o$,$n$   AND (cs.union_id=p_union_id OR cs.club_id=ANY(scope.club_ids))
   AND NOT(cs.settlement_ref=run_key AND EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=p_scope_kind AND w.scope_id=p_scope_id
    AND w.period_start=p_period_start AND w.period_end=p_period_end AND w.round_no=2 AND w.status='paid' AND w.club_id=cs.club_id)))$n$);
 IF cardinality(string_to_array(src,$o$ CREATE TEMP TABLE IF NOT EXISTS _routed_prior_discharge_context($o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_3_changed';END IF;
 src:=replace(src,$o$ CREATE TEMP TABLE IF NOT EXISTS _routed_prior_discharge_context($o$,$n$ -- CLUB ISOLATION (20261111174403): in the runner's union unit each club is
 -- planned and checked on its own before anything moves; a refused club is
 -- recorded and left out, and a club an earlier pass paid is not paid again.
 PERFORM smarter_private.weekly_payout_round2_clubs(p_scope_kind,p_scope_id,p_period_start,p_period_end,fingerprint);
 CREATE TEMP TABLE IF NOT EXISTS _routed_prior_discharge_context($n$);
 IF cardinality(string_to_array(src,$o$ IF node_count>0 THEN PERFORM public.fn_agent_commission_rollup_recompute($o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_4_changed';END IF;
 src:=replace(src,$o$ IF node_count>0 THEN PERFORM public.fn_agent_commission_rollup_recompute($o$,$n$ IF EXISTS(SELECT 1 FROM pg_temp._routed_nodes) THEN PERFORM public.fn_agent_commission_rollup_recompute($n$);
 IF cardinality(string_to_array(src,$o$'payees',node_count-(SELECT count(*)::int FROM pg_temp._routed_owner_nodes)$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_5_changed';END IF;
 src:=replace(src,$o$'payees',node_count-(SELECT count(*)::int FROM pg_temp._routed_owner_nodes)$o$,$n$'payees',node_count-(SELECT owner_nodes FROM pg_temp._wpc_r2)$n$);
 IF cardinality(string_to_array(src,$o$ result:=result||jsonb_build_object('rakeback_cascade',$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round2_anchor_6_changed';END IF;
 src:=replace(src,$o$ result:=result||jsonb_build_object('rakeback_cascade',$o$,$n$ club_partial:=smarter_private.weekly_payout_club_round_close(p_scope_kind,p_scope_id,p_period_start,p_period_end,2,fingerprint);
 IF club_partial IS NOT NULL THEN RETURN club_partial; END IF;
 result:=result||jsonb_build_object('rakeback_cascade',$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '79c845fa37ea0a5fb3ac8d760c74e1e3' THEN RAISE EXCEPTION 'club_isolation_round2_postimage_changed';END IF;
END $patch_round2$;
DO $patch_round3$
DECLARE src text:=pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '471233c06fb2fe9cd2c0928756ba4b82' THEN RAISE EXCEPTION 'club_isolation_round3_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$DECLARE prior_plan jsonb;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round3_anchor_0_changed';END IF;
 src:=replace(src,$o$DECLARE prior_plan jsonb;$o$,$n$DECLARE club_partial jsonb;prior_plan jsonb;$n$);
 IF cardinality(string_to_array(src,$o$ INSERT INTO pg_temp._routed_player_todo SELECT i.* FROM pg_temp._routed_player_items i
  WHERE NOT EXISTS(SELECT 1 FROM pg_temp._routed_player_done d WHERE d.period_id=i.period_id);$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round3_anchor_1_changed';END IF;
 src:=replace(src,$o$ INSERT INTO pg_temp._routed_player_todo SELECT i.* FROM pg_temp._routed_player_items i
  WHERE NOT EXISTS(SELECT 1 FROM pg_temp._routed_player_done d WHERE d.period_id=i.period_id);$o$,$n$ INSERT INTO pg_temp._routed_player_todo SELECT i.* FROM pg_temp._routed_player_items i
  WHERE NOT EXISTS(SELECT 1 FROM pg_temp._routed_player_done d WHERE d.period_id=i.period_id);
 -- CLUB ISOLATION (20261111174403): clubs round 2 has not paid, and clubs the
 -- funding step held in this unit, are left out of this pass.
 PERFORM smarter_private.weekly_payout_round3_clubs(p_scope_kind,p_scope_id,p_period_start,p_period_end);$n$);
 IF cardinality(string_to_array(src,$o$WHERE f.destination_kind='agent_wallet')x GROUP BY x.club_id,x.user_id;
 PERFORM id FROM public.clubs WHERE id IN(SELECT club_id FROM pg_temp._routed_player_todo) ORDER BY id FOR NO KEY UPDATE;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round3_anchor_2_changed';END IF;
 src:=replace(src,$o$WHERE f.destination_kind='agent_wallet')x GROUP BY x.club_id,x.user_id;
 PERFORM id FROM public.clubs WHERE id IN(SELECT club_id FROM pg_temp._routed_player_todo) ORDER BY id FOR NO KEY UPDATE;$o$,$n$WHERE f.destination_kind='agent_wallet')x GROUP BY x.club_id,x.user_id;
 -- CLUB ISOLATION (20261111174403): a club whose own agent wallets or bank
 -- cannot pay its players is recorded and left out before anything is locked.
 PERFORM smarter_private.weekly_payout_round3_funding_holds(p_scope_kind,p_scope_id,p_period_start,p_period_end);
 PERFORM id FROM public.clubs WHERE id IN(SELECT club_id FROM pg_temp._routed_player_todo) ORDER BY id FOR NO KEY UPDATE;$n$);
 IF cardinality(string_to_array(src,$o$ INSERT INTO public.accounting_routed_settlement_runs(union_id,standalone_club_id,period_start,period_end,round_no,source_fingerprint,result)
  VALUES(p_union_id,standalone_club,p_period_start,p_period_end,3,fingerprint,result);$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_round3_anchor_3_changed';END IF;
 src:=replace(src,$o$ INSERT INTO public.accounting_routed_settlement_runs(union_id,standalone_club_id,period_start,period_end,round_no,source_fingerprint,result)
  VALUES(p_union_id,standalone_club,p_period_start,p_period_end,3,fingerprint,result);$o$,$n$ club_partial:=smarter_private.weekly_payout_club_round_close(p_scope_kind,p_scope_id,p_period_start,p_period_end,3,fingerprint);
 IF club_partial IS NOT NULL THEN RETURN club_partial||jsonb_build_object('amount_paid_so_far',paid,'payees_so_far',payees); END IF;
 INSERT INTO public.accounting_routed_settlement_runs(union_id,standalone_club_id,period_start,period_end,round_no,source_fingerprint,result)
  VALUES(p_union_id,standalone_club,p_period_start,p_period_end,3,fingerprint,result);$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'de1bb0529e631b1f230bc7670dc05e82' THEN RAISE EXCEPTION 'club_isolation_round3_postimage_changed';END IF;
END $patch_round3$;
DO $patch_finalize$
DECLARE src text:=pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '5ec42349ea8afcff0697873cf317ff93' THEN RAISE EXCEPTION 'club_isolation_finalize_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$ -- RESERVED SHARE (20261111): every reserve this run's round 2 set was$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_finalize_anchor_0_changed';END IF;
 src:=replace(src,$o$ -- RESERVED SHARE (20261111): every reserve this run's round 2 set was$o$,$n$ -- CLUB ISOLATION (20261111174403): a union week is finished only when no club
 -- of it is held in any round.
 IF EXISTS(SELECT 1 FROM smarter_private.weekly_payout_club_rounds w JOIN jsonb_array_elements(r.scope_plan) s ON w.scope_kind=s->>'kind' AND w.scope_id=(s->>'id')::uuid
   AND w.period_start=(s->>'period_start')::timestamptz AND w.period_end=(s->>'period_end')::timestamptz WHERE w.status='refused')
 THEN RAISE EXCEPTION 'weekly_payout_club_still_held: run % has a club refused in round 2 or 3',r.run_id USING ERRCODE='23514'; END IF;
 -- RESERVED SHARE (20261111): every reserve this run's round 2 set was$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure)) IS DISTINCT FROM '79c53c2417257c9c5e269286801949eb' THEN RAISE EXCEPTION 'club_isolation_finalize_postimage_changed';END IF;
END $patch_finalize$;
DO $patch_runner$
DECLARE src text:=pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '332b762a004a779e32dc3fd2d1aef60d' THEN RAISE EXCEPTION 'club_isolation_runner_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$   funding:=NULL;
   IF rnd=3 THEN funding:=smarter_private.weekly_payout_fund_agent_shortfalls(r.run_id,k,id,ws,we); END IF;
$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_runner_anchor_0_changed';END IF;
 src:=replace(src,$o$   funding:=NULL;
   IF rnd=3 THEN funding:=smarter_private.weekly_payout_fund_agent_shortfalls(r.run_id,k,id,ws,we); END IF;
$o$,$n$   funding:=NULL;
$n$);
 IF cardinality(string_to_array(src,$o$round_no=EXCLUDED.round_no;
$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_runner_anchor_1_changed';END IF;
 src:=replace(src,$o$round_no=EXCLUDED.round_no;
$o$,$n$round_no=EXCLUDED.round_no;
   -- CLUB ISOLATION (20261111174403): the funding step runs inside the owned
   -- unit, so it holds a refusing club instead of stopping the union.
   IF rnd=3 THEN funding:=smarter_private.weekly_payout_fund_agent_shortfalls(r.run_id,k,id,ws,we); END IF;
$n$);
 IF cardinality(string_to_array(src,$o$   CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.scope_kind=k AND x.scope_id=id AND x.round_no=rnd);$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_runner_anchor_2_changed';END IF;
 src:=replace(src,$o$   CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.scope_kind=k AND x.scope_id=id AND x.round_no=rnd);$o$,$n$   CONTINUE WHEN EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.scope_kind=k AND x.scope_id=id AND x.round_no=rnd);
   -- CLUB ISOLATION (20261111174403): a unit with a refused club waits while
   -- another unit can move; then one held unit is retried per tick.
   CONTINUE WHEN smarter_private.weekly_payout_unit_waits(r.run_id,k,id,ws,we,rnd);$n$);
 IF cardinality(string_to_array(src,$o$   IF rnd IN(2,3) AND (res->>'success' IS DISTINCT FROM 'true'$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'club_isolation_runner_anchor_3_changed';END IF;
 src:=replace(src,$o$   IF rnd IN(2,3) AND (res->>'success' IS DISTINCT FROM 'true'$o$,$n$   -- A union pass that paid every club it could and holds the rest: the paid
   -- clubs stay paid, the round has no receipt yet, finalize stays closed.
   IF rnd IN(2,3) AND res->>'partial'='true' THEN
    IF k<>'union' OR res->>'success' IS DISTINCT FROM 'true' OR res->>'routing_version' IS DISTINCT FROM '3' OR res->>'source_version' IS DISTINCT FROM '2' OR res->>'batch_committed'='true'
     OR EXISTS(SELECT FROM public.accounting_routed_settlement_runs x WHERE x.scope_kind=k AND x.scope_id=id AND x.period_start=ws AND x.period_end=we AND x.round_no=rnd)
     OR NOT EXISTS(SELECT FROM smarter_private.weekly_payout_club_rounds w WHERE w.scope_kind=k AND w.scope_id=id AND w.period_start=ws AND w.period_end=we AND w.round_no=rnd AND w.status='refused')
    THEN RAISE EXCEPTION 'weekly_payout_round_receipt_required %',left(res::text,1000); END IF;
    DELETE FROM smarter_private.weekly_payout_owned_transactions WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
    PERFORM public.fn_weekly_accounting_attempt_end();
    RETURN jsonb_build_object('stage','round_clubs_held','run_id',r.run_id,'scope',item,'round',rnd,'receipt',res,'funding',funding);
   END IF;
   IF rnd IN(2,3) AND (res->>'success' IS DISTINCT FROM 'true'$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure)) IS DISTINCT FROM '14078b0f07d739d79b292d62096e8d7d' THEN RAISE EXCEPTION 'club_isolation_runner_postimage_changed';END IF;
END $patch_runner$;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_club_isolated(text,uuid,timestamptz,timestamptz,int) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_club_refuse(text,uuid,timestamptz,timestamptz,int,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_club_plan(text,uuid,timestamptz,timestamptz,int) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_round2_clubs(text,uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_round2_planned() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_round3_clubs(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_round3_funding_holds(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_fund_club_holds(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_club_round_close(text,uuid,timestamptz,timestamptz,int,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_unit_waits(uuid,text,uuid,timestamptz,timestamptz,int) FROM PUBLIC,anon,authenticated,service_role;
DO $post$BEGIN IF md5(pg_get_functiondef('smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'e90ddb3808272e0563c17b3f3d367528' THEN RAISE EXCEPTION 'club_isolation_whole_plan_changed';END IF;END $post$;
COMMIT;

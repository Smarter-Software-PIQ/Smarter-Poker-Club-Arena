-- 20261111132447_weekly_rakeback_sends_one_gross_transfer_per_edge_and_reserv.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WEEKLY RAKEBACK SENDS ONE TRANSFER PER EDGE, AND THE PLAYERS' SHARE IS
-- RESERVED UNTIL ROUND 3 PAYS IT (lead decision under the owner's money grant,
-- CLAUDE.md 10.9, 2026-11-11)
--
-- CAUSE 1. Round 2 (fn_settle_accounting_commission_stage) sends each agent its
-- commission down the recorded hierarchy; then, in the round 3 unit, the
-- funding cascade (20261109231855) sends the same edge a second leg carrying
-- what the agent passes down to its players. An earning agent above a payer
-- with a need therefore got two transfers on one edge (bank -> SA 84 and 50,
-- SA -> AG 30 and 50 in scripts/ci/test-rakeback-cascade-real-runner-postgres.py).
-- The legacy callers fn_process_weekly_accounting_scope and
-- weekly_payout_execute call round 2 then round 3 and never the funding step,
-- so on those paths nothing passed through at all.
--
-- FIX 1. Round 2 plans the week's cascade itself (the merged formula, now
-- smarter_private.rakeback_cascade_plan: latest certificate per period, need =
-- sum over players of max(0, owed - covered), deleted uplines routed around,
-- owner route, unassigned players unchanged) and sends ONE leg per (club,
-- payer, payee): commission plus funding. A leg that carries both is category
-- commission under its round 2 key and records the split in its metadata
-- (commission_amount, rakeback_funding, rakeback_funding_key,
-- rakeback_funding_version); agent_commission_settlements still records the
-- commission alone. An edge with no commission (a zero-rate agent, the owner
-- wallet) is sent once by round 2 under the cascade key, exactly as the
-- funding step would have sent it. The owner tier's own commission still
-- stays in the club bank (Dan 2026-10-22), so an owner edge carries funding
-- only. Affordability counts each chip once. The funding step then finds
-- every edge already carried and asserts that; it still sends for a scope
-- round 2 did not carry (a week round 2 paid before this file, or a v3
-- fallback week).
--
-- CAUSE 2. Moving the funding into round 2 opens the window between round 2 and
-- round 3 (3 h 48 m on 2026-11-09). Nothing stopped an agent spending the
-- chips its players are owed in that window, and one short wallet blocks
-- round 3 for the whole union every minute for 24 hours. That hole already
-- existed for the commission an agent's players are paid from.
--
-- FIX 2. smarter_private.weekly_payout_wallet_reserves holds, per pending
-- period and paying wallet, exactly what that wallet owes the player (owed,
-- not only the pass-through). Round 2 sets it after its transfers (the
-- funding step sets it for a scope round 2 did not carry). One BEFORE trigger
-- on public.agents (zzzzz_agent_wallet_keeps_weekly_reserve, after
-- sync_agent_wallet_columns so it judges the final row) refuses any update
-- that lowers agent_wallet_balance below what the wallet still reserves, and
-- any delete or identity change of a wallet that reserves anything, with
-- agent_wallet_weekly_rakeback_reserved naming the agent, the club, the
-- reserved amount and how much may still leave. Every debit path (sends,
-- self stake, cash-out, claim-back, deleted-wallet return, horse split,
-- adjustments, the rounds) reaches the wallet through that UPDATE, so all are
-- refused for the reserved part and work for the rest. Round 3 releases a
-- reserve by exactly what it pays, BEFORE it debits the wallet, and closes
-- the period's reserve when the period is paid or discharged by an existing
-- transfer; finalize asserts the run left none. There is no bypass setting:
-- the reserve itself is lowered, by the only functions that may (EXECUTE is
-- revoked from PUBLIC, anon, authenticated and service_role).
--
-- SETTLED HISTORY. Read on production 2026-11-11: 760 round 2 legs (7 weeks,
-- 2026-09-29 to 2026-11-09), 0 carrying any of the new keys, and no reserve
-- table. Every patched expression is gated on those keys, so every settled
-- week validates exactly as before. Nothing settled is replayed, no funding
-- is invented, no recipient changes, nothing is taken back. No schedule,
-- watcher or repair path is added. Horses are players: nothing reads is_horse.
--
-- Requires 20261109231325 and 20261109231855 installed (pinned below).
-- Proof: scripts/ci/test-rakeback-cascade-real-runner-postgres.py,
-- test-rakeback-cascade-real-guards-postgres.py,
-- test-rakeback-cascade-funding-postgres.py, test-owner-routing-wallet-postgres.py
-- (PostgreSQL 17). public.agents is not a hot relation; CREATE TRIGGER takes
-- SHARE ROW EXCLUSIVE on it once, under lock_timeout 1s.
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure))='255ebe71d6f04fa072a87798d20a7c56'
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))='a854bfbd9fcddb4143c6ead5f61c8141'
-- @live-proof: md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))='471233c06fb2fe9cd2c0928756ba4b82'
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure))='5ec42349ea8afcff0697873cf317ff93'
-- @live-proof: md5(pg_get_functiondef('smarter_private.zero_standalone_foreign_commissions_proven(uuid,timestamptz,timestamptz)'::regprocedure))='d787091c00ea6ec57b3b80c66e8394ea'
-- @live-proof: (SELECT count(*)=1 FROM pg_trigger WHERE tgrelid='public.agents'::regclass AND tgname='zzzzz_agent_wallet_keeps_weekly_reserve' AND NOT tgisinternal AND tgenabled='O')

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$BEGIN
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'dddb67b5024a01bb4f2dadc0ba1009f2' THEN RAISE EXCEPTION 'rakeback_gross_fund_preimage_changed';END IF;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'ce1a9dd4344c7987918dcf8a82427ef5' THEN RAISE EXCEPTION 'rakeback_gross_round2_preimage_changed';END IF;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'db6ba33eed8762b2534d349024e4219f' THEN RAISE EXCEPTION 'rakeback_gross_round3_preimage_changed';END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure)) IS DISTINCT FROM '5b83618b59f043376c87361c986adca8' THEN RAISE EXCEPTION 'rakeback_gross_finalize_preimage_changed';END IF;
 IF md5(pg_get_functiondef('smarter_private.zero_standalone_foreign_commissions_proven(uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '69099f3bac93cb29fad83cb82cb1fe4a' THEN RAISE EXCEPTION 'rakeback_gross_zero_standalone_preimage_changed';END IF;
 IF to_regclass('smarter_private.weekly_payout_wallet_reserves') IS NOT NULL THEN RAISE EXCEPTION 'rakeback_gross_reserve_table_exists';END IF;
END $pre$;
-- The players' share each paying wallet holds for a pending period. No
-- foreign key (a reserve row never locks agents, clubs or periods).
CREATE TABLE smarter_private.weekly_payout_wallet_reserves(
 period_id uuid NOT NULL,
 club_id uuid NOT NULL,
 user_id uuid NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN('union','club')),
 scope_id uuid NOT NULL,
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 reserved numeric NOT NULL CHECK(reserved>0 AND reserved=round(reserved,2)),
 remaining numeric NOT NULL CHECK(remaining>=0 AND remaining<=reserved AND remaining=round(remaining,2)),
 set_by text NOT NULL CHECK(set_by IN('round2','funding')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz,
 CONSTRAINT weekly_payout_wallet_reserves_released CHECK((remaining=0)=(released_at IS NOT NULL)),
 PRIMARY KEY(period_id,club_id,user_id));
CREATE INDEX weekly_payout_wallet_reserves_held ON smarter_private.weekly_payout_wallet_reserves(club_id,user_id) WHERE remaining>0;
CREATE INDEX weekly_payout_wallet_reserves_scope ON smarter_private.weekly_payout_wallet_reserves(scope_kind,scope_id,period_start,period_end) WHERE remaining>0;
ALTER TABLE smarter_private.weekly_payout_wallet_reserves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_payout_wallet_reserves FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE smarter_private.weekly_payout_wallet_reserves IS 'What each paying agent wallet owes a player for a pending weekly rakeback period. Set by round 2 (or the funding step), released by round 3 as it pays, refused from leaving the wallet by zzzzz_agent_wallet_keeps_weekly_reserve.';

-- The funding a round 2 leg carries, read from its recorded split: 0 for a leg
-- with no split (every leg settled before 20261111132447), the funding for a
-- complete and consistent split, NULL for anything else (so any equality
-- built on it fails).
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_leg_funding(p_metadata jsonb,p_amount numeric,p_club uuid,p_week date,p_payer uuid,p_payee uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN p_metadata IS NULL OR NOT(p_metadata ? 'rakeback_funding' OR p_metadata ? 'rakeback_funding_key' OR p_metadata ? 'commission_amount' OR p_metadata ? 'rakeback_funding_version') THEN 0::numeric
  WHEN p_metadata->>'rakeback_funding_version'='rakeback-funding-v1'
   AND p_metadata->>'rakeback_funding_key' IS NOT DISTINCT FROM smarter_private.rakeback_cascade_key(p_club,p_week,p_payer,p_payee)
   AND jsonb_typeof(p_metadata->'rakeback_funding')='number' AND jsonb_typeof(p_metadata->'commission_amount')='number'
   AND (p_metadata->>'rakeback_funding')::numeric>0 AND (p_metadata->>'rakeback_funding')::numeric=round((p_metadata->>'rakeback_funding')::numeric,2)
   AND (p_metadata->>'commission_amount')::numeric>0 AND (p_metadata->>'commission_amount')::numeric+(p_metadata->>'rakeback_funding')::numeric=p_amount
  THEN (p_metadata->>'rakeback_funding')::numeric END
$function$;

-- Round 3 lowers a reserve by what it pays from that wallet, before the debit.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_reserve_release(p_period uuid,p_club uuid,p_user uuid,p_amount numeric)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 UPDATE smarter_private.weekly_payout_wallet_reserves w SET remaining=w.remaining-least(w.remaining,p_amount),
  released_at=CASE WHEN w.remaining<=p_amount THEN clock_timestamp() END
 WHERE w.period_id=p_period AND w.club_id=p_club AND w.user_id=p_user AND w.remaining>0 AND p_amount>0;
$function$;

-- A period that is paid (or discharged by an existing transfer) owes nothing
-- more from any wallet.
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_reserve_close(p_period uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 UPDATE smarter_private.weekly_payout_wallet_reserves w SET remaining=0,released_at=clock_timestamp() WHERE w.period_id=p_period AND w.remaining>0;
$function$;

-- THE GUARD. Every debit of an agent wallet is an UPDATE of public.agents (or
-- a DELETE of the row). Named to run after every other BEFORE trigger, so the
-- balance judged is the one that will be written (sync_agent_wallet_columns
-- turns a business_balance write into an agent_wallet_balance write first).
CREATE OR REPLACE FUNCTION smarter_private.agent_wallet_keeps_weekly_reserve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE held numeric; week text; after numeric;
BEGIN
 IF TG_OP='UPDATE' AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
  AND COALESCE(NEW.agent_wallet_balance,0)>=COALESCE(OLD.agent_wallet_balance,0) THEN RETURN NEW; END IF;
 SELECT COALESCE(sum(w.remaining),0),min(to_char(w.period_start AT TIME ZONE 'America/Chicago','Mon DD')) INTO held,week
  FROM smarter_private.weekly_payout_wallet_reserves w WHERE w.club_id=OLD.club_id AND w.user_id=OLD.user_id AND w.remaining>0;
 after:=CASE WHEN TG_OP='UPDATE' AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN COALESCE(NEW.agent_wallet_balance,0) ELSE 0 END;
 IF held>0 AND after<held THEN
  RAISE EXCEPTION 'agent_wallet_weekly_rakeback_reserved: agent % in club % holds % in its agent wallet and % of it is owed to its players as weekly rakeback for the week starting %; at most % can leave this wallet until round 3 of the weekly payout pays those players',
   OLD.user_id,OLD.club_id,COALESCE(OLD.agent_wallet_balance,0),held,week,greatest(COALESCE(OLD.agent_wallet_balance,0)-held,0)
   USING ERRCODE='23514',HINT='Move at most the unreserved amount now, or wait until the weekly payout has paid this week''s rakeback to the players.';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $function$;

-- Records the players' share of every paying wallet in the plan (pg_temp._rcf_reserve).
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_reserve_players_share(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz,p_set_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE n int; amt numeric;
BEGIN
 INSERT INTO smarter_private.weekly_payout_wallet_reserves(period_id,club_id,user_id,scope_kind,scope_id,period_start,period_end,reserved,remaining,set_by)
 SELECT r.period_id,r.club_id,r.user_id,p_kind,p_id,p_from,p_to,r.amount,r.amount,p_set_by FROM pg_temp._rcf_reserve r WHERE r.amount>0
 ORDER BY r.club_id,r.user_id,r.period_id ON CONFLICT(period_id,club_id,user_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT COALESCE(sum(w.remaining),0) INTO amt FROM smarter_private.weekly_payout_wallet_reserves w JOIN pg_temp._rcf_reserve r ON r.period_id=w.period_id AND r.club_id=w.club_id AND r.user_id=w.user_id;
 RETURN jsonb_build_object('rows_added',n,'reserved_now',amt);
END $function$;

-- THE CASCADE PLAN (steps 1 to 5 of 20261109231855, unchanged apart from the
-- deleted-upline test also reading a funding leg that round 2 carried): writes
-- pg_temp._rcf_certs, _rcf_legs, _rcf_edges, _rcf_nodes, _rcf_skipped and
-- _rcf_reserve; false when nothing is owed.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_plan(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date;
 scope_key text:=CASE WHEN p_kind='union' THEN p_id::text ELSE 'club:'||p_id::text END;
 r2_key text; bad record; step int:=0; progress int; todo int; d int;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('union','club') OR p_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>=p_to
 THEN RAISE EXCEPTION 'rakeback_cascade_scope_invalid' USING ERRCODE='22023'; END IF;
 r2_key:='round2:v3:'||scope_key||':'||extract(epoch FROM p_from)::text||':'||extract(epoch FROM p_to)::text;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_edges(club_id uuid,payer_user uuid,payee_user uuid,amount numeric,route text,sort_order int,state text,carried numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_edges;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_nodes(club_id uuid,user_id uuid,sort_order int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_nodes;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_skipped(club_id uuid,user_id uuid,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_skipped;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_reserve(period_id uuid,club_id uuid,user_id uuid,amount numeric,PRIMARY KEY(period_id,club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_reserve;
 -- 1. LATEST CERTIFICATE ONLY (D5): one certificate per pending period, the
 --    one with the highest id. A superseded snapshot contributes nothing.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_certs(calc_id bigint PRIMARY KEY,period_id uuid,club_id uuid,player_id uuid,owner_id uuid) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_certs;
 INSERT INTO pg_temp._rcf_certs
 SELECT x.id,x.period_id,x.club_id,x.player_id,cl.owner_id FROM(
   SELECT DISTINCT ON(rp.id) c.id,c.period_id,c.club_id,c.player_id,c.coordinator_union_id
   FROM public.rakeback_periods rp JOIN public.accounting_rakeback_period_calculations c ON c.period_id=rp.id
   WHERE rp.period_start=d_from AND rp.status='pending' ORDER BY rp.id,c.id DESC)x
  JOIN public.clubs cl ON cl.id=x.club_id
  WHERE(p_kind='union' AND x.coordinator_union_id=p_id) OR(p_kind='club' AND x.club_id=p_id AND x.coordinator_union_id IS NULL);
 CREATE TEMP TABLE IF NOT EXISTS _rcf_legs(calc_id bigint,club_id uuid,player_id uuid,payer_kind text,payer_user uuid,owed numeric,route text,covered numeric DEFAULT 0,need numeric DEFAULT 0) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_legs;
 INSERT INTO pg_temp._rcf_legs(calc_id,club_id,player_id,payer_kind,payer_user,owed,route)
 SELECT x.calc_id,x.club_id,x.player_id,x.payer_kind,x.payer_user,sum(x.owed),x.route FROM(
  SELECT c.calc_id,c.club_id,c.player_id,fp.payer_kind,fp.payer_user,fp.owed,
   CASE WHEN fp.payer_kind<>'club' AND fp.payer_user IS NOT NULL AND fp.payer_user IS DISTINCT FROM c.owner_id THEN 'agent'
    WHEN fp.destination_kind='player_wallet' AND smarter_private.rakeback_cascade_owner_upline(c.calc_id,c.owner_id,fp.payer_user) THEN 'owner'
    ELSE 'bank' END route
  FROM pg_temp._rcf_certs c CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(c.calc_id)fp WHERE fp.owed>0)x
 GROUP BY x.calc_id,x.club_id,x.player_id,x.payer_kind,x.payer_user,x.route;
 IF NOT EXISTS(SELECT 1 FROM pg_temp._rcf_legs) THEN
  RETURN false;
 END IF;
 SELECT l.club_id INTO bad FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE c.owner_id IS NULL LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_owner_missing: club % has no owner, so its recorded upline cannot be told from an unassigned player',bad.club_id USING ERRCODE='23514'; END IF;
 -- 2. What each real agent must be handed: owed minus its own commission on
 --    exactly the sources this certificate allocates to it.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_alloc(calc_id bigint,club_id uuid,payer uuid,st text,sid uuid,ah bigint,at timestamptz,unr numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_alloc;
 INSERT INTO pg_temp._rcf_alloc
 SELECT c.calc_id,c.club_id,NULLIF(a->>'payer_user_id','')::uuid,a->>'source_type',(a->>'source_id')::uuid,(a->>'agent_history_id')::bigint,
  COALESCE((a->>'agreement_at')::timestamptz,(a->>'earned_at')::timestamptz),(a->>'rake_credit')::numeric*(a->>'rate')::numeric
 FROM pg_temp._rcf_certs c JOIN public.accounting_rakeback_period_calculations cc ON cc.id=c.calc_id
 CROSS JOIN LATERAL jsonb_array_elements(cc.source_allocations)a
 WHERE EXISTS(SELECT 1 FROM pg_temp._rcf_legs l WHERE l.calc_id=c.calc_id AND l.route='agent')
  AND a->>'payer_kind'='agent' AND NULLIF(a->>'payer_user_id','')::uuid IS DISTINCT FROM c.owner_id;
 ANALYZE pg_temp._rcf_alloc;
 UPDATE pg_temp._rcf_legs l SET covered=x.covered FROM(
  SELECT a.calc_id,a.payer,COALESCE(sum(ac.amount),0) covered FROM pg_temp._rcf_alloc a
  LEFT JOIN public.agent_commissions ac ON ac.source_id=a.sid AND ac.source_type=a.st AND ac.user_id=a.payer AND ac.club_id=a.club_id
  GROUP BY a.calc_id,a.payer)x WHERE l.route='agent' AND x.calc_id=l.calc_id AND x.payer=l.payer_user;
 UPDATE pg_temp._rcf_legs SET need=CASE route WHEN 'agent' THEN greatest(owed-covered,0) WHEN 'owner' THEN owed ELSE 0 END WHERE true;
 -- 3. The hierarchy in force at each allocation's agreement time. Only the
 --    allocations of a leg that needs funding are walked.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_chain(ah bigint,at timestamptz,club_id uuid,depth int,agent_id uuid,user_id uuid,parent_agent_id uuid,chain_club uuid,PRIMARY KEY(ah,at,depth)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_chain;
 SELECT a.club_id,a.payer INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  WHERE a.ah IS NULL OR a.at IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounting_agreement_history h WHERE h.id=a.ah AND h.entity_type='agents') LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_missing: club % payer % has an allocation with no recorded agent agreement',bad.club_id,bad.payer USING ERRCODE='23514'; END IF;
 INSERT INTO pg_temp._rcf_chain
 SELECT k.ah,k.at,k.club_id,0,(h.after_terms->>'id')::uuid,(h.after_terms->>'user_id')::uuid,NULLIF(h.after_terms->>'parent_agent_id','')::uuid,(h.after_terms->>'club_id')::uuid
 FROM(SELECT DISTINCT a.ah,a.at,a.club_id FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0)k
 JOIN public.accounting_agreement_history h ON h.id=k.ah AND h.entity_type='agents';
 SELECT a.club_id,a.payer INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  JOIN pg_temp._rcf_chain c ON c.ah=a.ah AND c.at=a.at AND c.depth=0 WHERE c.user_id IS DISTINCT FROM a.payer OR c.chain_club IS DISTINCT FROM a.club_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_missing: club % payer % is not the agent its allocation agreement records',bad.club_id,bad.payer USING ERRCODE='23514'; END IF;
 d:=0;
 LOOP
  d:=d+1;
  INSERT INTO pg_temp._rcf_chain
  SELECT x.ah,x.at,x.club_id,d,(h.after_terms->>'id')::uuid,(h.after_terms->>'user_id')::uuid,NULLIF(h.after_terms->>'parent_agent_id','')::uuid,(h.after_terms->>'club_id')::uuid
  FROM pg_temp._rcf_chain x JOIN public.clubs o ON o.id=x.club_id
  LEFT JOIN LATERAL(SELECT hist.id,hist.after_terms FROM public.accounting_agreement_history hist
    WHERE hist.entity_type='agents' AND hist.entity_key=x.parent_agent_id::text AND hist.observed_at<=x.at
     AND NOT EXISTS(SELECT 1 FROM public.accounting_agreement_history later WHERE later.transaction_id=hist.transaction_id AND later.observed_at>x.at)
    ORDER BY hist.observed_at DESC,hist.id DESC LIMIT 1)h ON true
  -- The owner is the club: what passes down through the owner comes straight
  -- from the club bank (round 2, Dan 2026-10-22), so the walk ends below it.
  WHERE x.depth=d-1 AND x.parent_agent_id IS NOT NULL AND x.user_id IS DISTINCT FROM o.owner_id;
  GET DIAGNOSTICS progress=ROW_COUNT;
  EXIT WHEN progress=0;
  SELECT x.club_id,x.parent_agent_id INTO bad FROM pg_temp._rcf_chain x JOIN pg_temp._rcf_chain p ON p.ah=x.ah AND p.at=x.at AND p.depth=d
   WHERE x.depth=d-1 AND p.agent_id IS NULL LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_missing: club % upline agent % has no agreement at the earning time',bad.club_id,bad.parent_agent_id USING ERRCODE='23514'; END IF;
  SELECT p.club_id,p.agent_id,p.chain_club INTO bad FROM pg_temp._rcf_chain p WHERE p.depth=d AND p.chain_club IS DISTINCT FROM p.club_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_parent_outside_club: club % has upline agent % recorded in club %',bad.club_id,bad.agent_id,bad.chain_club USING ERRCODE='23514'; END IF;
  SELECT p.club_id,p.user_id INTO bad FROM pg_temp._rcf_chain p JOIN pg_temp._rcf_chain q ON q.ah=p.ah AND q.at=p.at AND q.depth<p.depth AND q.user_id=p.user_id WHERE p.depth=d LIMIT 1;
  IF FOUND OR d>=64 THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_cycle: club % agent % is its own upline',COALESCE(bad.club_id::text,'?'),COALESCE(bad.user_id::text,'?') USING ERRCODE='23514'; END IF;
 END LOOP;
 DELETE FROM pg_temp._rcf_chain c USING public.clubs o WHERE o.id=c.club_id AND c.user_id=o.owner_id AND c.depth>0;
 -- A DELETED UPLINE IS ROUTED AROUND (owner decision 2026-11-09; proved under
 -- the live trigger stack, scripts/ci/test-rakeback-cascade-real-guards-postgres.py).
 -- zzzz_deleted_agent_credit returns any credit to a deleted account's agent
 -- wallet to the club bank inside the crediting statement, so chips sent
 -- through such an upline never reach the next hop. The path therefore skips
 -- it and continues to its nearest live upline, or to the club bank when
 -- there is none: the same collapse applied to the owner above. Nothing is
 -- credited to the deleted account. A deleted DIRECT payer (depth 0) stays:
 -- what it owes its players is held back for it
 -- (deleted_wallet_published_rakeback_reserve) and round 3 pays from it.
 -- The one shape that cannot be routed: the account already passed this
 -- week's funding down before it was deleted, so a new route would send the
 -- same chips to the same agent a second time. Refused, naming both.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_skipped(club_id uuid,user_id uuid,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_skipped;
 INSERT INTO pg_temp._rcf_skipped SELECT DISTINCT c.club_id,c.user_id FROM pg_temp._rcf_chain c JOIN public.profiles p ON p.id=c.user_id AND p.status='deleted' WHERE c.depth>0;
 SELECT c.club_id,c.user_id,lo.user_id AS payee INTO bad FROM pg_temp._rcf_chain c JOIN pg_temp._rcf_skipped s ON s.club_id=c.club_id AND s.user_id=c.user_id
  JOIN pg_temp._rcf_chain lo ON lo.ah=c.ah AND lo.at=c.at AND lo.depth<c.depth
  WHERE c.depth>0 AND(EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(c.club_id,d_from,c.user_id,lo.user_id))
   OR EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=r2_key||':'||c.club_id::text||':'||c.user_id::text||':'||lo.user_id::text AND l.metadata ? 'rakeback_funding')) ORDER BY 1,2,3 LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_upline_deleted_after_funding: club % upline agent % passed this week''s funding down to agent % and its account was deleted afterwards; a route around it would fund that agent twice',bad.club_id,bad.user_id,bad.payee USING ERRCODE='23514'; END IF;
 DELETE FROM pg_temp._rcf_chain c USING pg_temp._rcf_skipped s WHERE s.club_id=c.club_id AND s.user_id=c.user_id AND c.depth>0;
 -- 4. Each need is split over the paths its sources were earned under, in
 --    proportion to their unrounded rakeback, by running cents: nothing is
 --    lost or invented when an upline changed inside the week.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_flow(club_id uuid,path uuid[],amount numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_flow;
 INSERT INTO pg_temp._rcf_flow
 WITH paths AS(SELECT c.ah,c.at,array_agg(c.user_id ORDER BY c.depth) path FROM pg_temp._rcf_chain c GROUP BY c.ah,c.at),
 grp AS(SELECT a.calc_id,a.club_id,a.payer,p.path,sum(a.unr) w FROM pg_temp._rcf_alloc a JOIN paths p ON p.ah=a.ah AND p.at=a.at GROUP BY 1,2,3,4),
 run AS(SELECT g.*,l.need,sum(g.w) OVER(PARTITION BY g.calc_id,g.payer ORDER BY g.path::text) upto,sum(g.w) OVER(PARTITION BY g.calc_id,g.payer) total
  FROM grp g JOIN pg_temp._rcf_legs l ON l.calc_id=g.calc_id AND l.payer_user=g.payer AND l.route='agent' AND l.need>0)
 SELECT club_id,path,sum(round(need*upto/total,2)-round(need*(upto-w)/total,2)) FROM run WHERE total>0 GROUP BY club_id,path;
 IF (SELECT COALESCE(sum(amount),0) FROM pg_temp._rcf_flow) IS DISTINCT FROM (SELECT COALESCE(sum(need),0) FROM pg_temp._rcf_legs WHERE route='agent')
 THEN RAISE EXCEPTION 'rakeback_cascade_plan_does_not_conserve: paths carry % of % needed',(SELECT COALESCE(sum(amount),0) FROM pg_temp._rcf_flow),(SELECT COALESCE(sum(need),0) FROM pg_temp._rcf_legs WHERE route='agent') USING ERRCODE='23514'; END IF;
 -- 5. One edge per (club, payer, payee) for the week. payer NULL = club bank.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_edges(club_id uuid,payer_user uuid,payee_user uuid,amount numeric,route text,sort_order int,state text,carried numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_edges;
 INSERT INTO pg_temp._rcf_edges(club_id,payer_user,payee_user,amount,route)
 SELECT f.club_id,f.path[i+1],f.path[i],sum(f.amount),'hierarchy' FROM pg_temp._rcf_flow f CROSS JOIN LATERAL generate_subscripts(f.path,1)i
  WHERE f.amount>0 GROUP BY 1,2,3;
 INSERT INTO pg_temp._rcf_edges(club_id,payer_user,payee_user,amount,route)
 SELECT l.club_id,NULL,c.owner_id,sum(l.need),'owner_wallet' FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.route='owner' GROUP BY l.club_id,c.owner_id;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_nodes(club_id uuid,user_id uuid,sort_order int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_nodes;
 INSERT INTO pg_temp._rcf_nodes(club_id,user_id) SELECT DISTINCT club_id,payee_user FROM pg_temp._rcf_edges;
 SELECT count(*) INTO todo FROM pg_temp._rcf_nodes;
 WHILE todo>0 LOOP
  step:=step+1;
  UPDATE pg_temp._rcf_nodes n SET sort_order=step WHERE n.sort_order IS NULL AND NOT EXISTS(
   SELECT 1 FROM pg_temp._rcf_edges x JOIN pg_temp._rcf_nodes p ON p.club_id=x.club_id AND p.user_id=x.payer_user
   WHERE x.club_id=n.club_id AND x.payee_user=n.user_id AND(p.sort_order IS NULL OR p.sort_order=step));
  GET DIAGNOSTICS progress=ROW_COUNT;
  IF progress=0 THEN
   SELECT n.club_id,n.user_id INTO bad FROM pg_temp._rcf_nodes n WHERE n.sort_order IS NULL ORDER BY 1,2 LIMIT 1;
   RAISE EXCEPTION 'rakeback_cascade_hierarchy_cycle: club % agent % funds its own upline within the week',bad.club_id,bad.user_id USING ERRCODE='23514';
  END IF;
  todo:=todo-progress;
 END LOOP;
 UPDATE pg_temp._rcf_edges x SET sort_order=n.sort_order FROM pg_temp._rcf_nodes n WHERE n.club_id=x.club_id AND n.user_id=x.payee_user;
 -- 6. What each paying wallet owes each player (owed, not only the need):
 --    the agent's own wallet, or the owner's wallet on the owner route.
 INSERT INTO pg_temp._rcf_reserve(period_id,club_id,user_id,amount)
 SELECT c.period_id,l.club_id,CASE WHEN l.route='agent' THEN l.payer_user ELSE c.owner_id END,sum(l.owed)
 FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.route IN('agent','owner') AND l.owed>0 GROUP BY 1,2,3;
 RETURN true;
END $function$;

-- ROUND 2, step A: after round 2's own plan is proved, merge the cascade's
-- edges into one row per (club, payer, payee) and order every edge parents
-- first. Refuses before any transfer, with the cascade's own errors.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_round2_plan(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date; planned boolean; e record; bad record; sid uuid; step int:=0; todo int; progress int;
BEGIN
 CREATE TEMP TABLE IF NOT EXISTS _routed_gross(club_id uuid,payer_user uuid,payee_user uuid,commission numeric NOT NULL DEFAULT 0,funding numeric NOT NULL DEFAULT 0,
  role text,route text NOT NULL DEFAULT 'commission',cascade_key text,sort_order int) ON COMMIT DROP;
 TRUNCATE pg_temp._routed_gross;
 CREATE TEMP TABLE IF NOT EXISTS _routed_gross_nodes(club_id uuid,user_id uuid,commission_node boolean,opening numeric,sort_order int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._routed_gross_nodes;
 CREATE TEMP TABLE IF NOT EXISTS _routed_cascade_summary(summary jsonb) ON COMMIT DROP;
 TRUNCATE pg_temp._routed_cascade_summary;
 INSERT INTO pg_temp._routed_gross(club_id,payer_user,payee_user,commission,role)
  SELECT x.club_id,x.payer_user,x.payee_user,x.amount,x.role FROM pg_temp._routed_edges x WHERE x.amount>0;
 IF EXISTS(SELECT 1 FROM pg_temp._routed_gross GROUP BY club_id,payer_user,payee_user HAVING count(*)>1)
 THEN RAISE EXCEPTION 'rakeback_cascade_round2_edge_ambiguous' USING ERRCODE='23514'; END IF;
 planned:=smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to);
 IF planned THEN
  -- The owner's wallet exists before anything moves (lane A's door).
  FOR e IN SELECT DISTINCT x.club_id FROM pg_temp._rcf_edges x WHERE x.route='owner_wallet' AND x.amount>0 ORDER BY 1 LOOP
   IF smarter_private.ensure_owner_routing_wallet(e.club_id) IS NULL THEN RAISE EXCEPTION 'rakeback_cascade_club_owner_missing: club % owner has no routing wallet',e.club_id USING ERRCODE='23514'; END IF;
  END LOOP;
  -- An edge whose funding leg this week already exists is never carried again.
  UPDATE pg_temp._rcf_edges x SET state=CASE WHEN EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)) THEN 'already_funded' ELSE 'to_send' END WHERE true;
  UPDATE pg_temp._routed_gross g SET funding=x.amount,cascade_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)
   FROM pg_temp._rcf_edges x WHERE x.state='to_send' AND x.amount>0 AND x.club_id=g.club_id AND x.payer_user IS NOT DISTINCT FROM g.payer_user AND x.payee_user=g.payee_user;
  INSERT INTO pg_temp._routed_gross(club_id,payer_user,payee_user,funding,route,cascade_key)
  SELECT x.club_id,x.payer_user,x.payee_user,x.amount,x.route,smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)
   FROM pg_temp._rcf_edges x WHERE x.state='to_send' AND x.amount>0
    AND NOT EXISTS(SELECT 1 FROM pg_temp._routed_gross g WHERE g.club_id=x.club_id AND g.payer_user IS NOT DISTINCT FROM x.payer_user AND g.payee_user=x.payee_user);
 END IF;
 -- Parents before children over every leg this round sends.
 INSERT INTO pg_temp._routed_gross_nodes(club_id,user_id) SELECT DISTINCT club_id,payee_user FROM pg_temp._routed_gross;
 SELECT count(*) INTO todo FROM pg_temp._routed_gross_nodes;
 WHILE todo>0 LOOP
  step:=step+1;
  UPDATE pg_temp._routed_gross_nodes n SET sort_order=step WHERE n.sort_order IS NULL AND NOT EXISTS(
   SELECT 1 FROM pg_temp._routed_gross x JOIN pg_temp._routed_gross_nodes p ON p.club_id=x.club_id AND p.user_id=x.payer_user
   WHERE x.club_id=n.club_id AND x.payee_user=n.user_id AND(p.sort_order IS NULL OR p.sort_order=step));
  GET DIAGNOSTICS progress=ROW_COUNT;
  IF progress=0 THEN
   SELECT n.club_id,n.user_id INTO bad FROM pg_temp._routed_gross_nodes n WHERE n.sort_order IS NULL ORDER BY 1,2 LIMIT 1;
   RAISE EXCEPTION 'rakeback_cascade_round2_hierarchy_cycle: club % agent % is paid by its own downline within the week',bad.club_id,bad.user_id USING ERRCODE='23514';
  END IF;
  todo:=todo-progress;
 END LOOP;
 UPDATE pg_temp._routed_gross g SET sort_order=n.sort_order FROM pg_temp._routed_gross_nodes n WHERE n.club_id=g.club_id AND n.user_id=g.payee_user;
 -- AFFORDABILITY, each chip once, for the clubs the cascade plans (the same
 -- clubs and the same sum the funding step checks): commission and funding
 -- from the bank plus the players the bank pays must fit in what the club
 -- received for the week.
 IF planned AND p_kind='union' THEN
  SELECT cs.id INTO sid FROM public.ca_settlements cs WHERE cs.settlement_type='union_rakeback_close'
   AND cs.external_ref=p_id::text||':'||to_char(p_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  SELECT * INTO bad FROM(SELECT c.id club_id,
    COALESCE((SELECT l.amount FROM public.chip_ledger l WHERE l.idempotency_key='union_close:'||sid::text||':'||c.id::text AND l.to_type='club_treasury' AND l.to_entity_id=c.id),0) received,
    COALESCE((SELECT sum(g.commission) FROM pg_temp._routed_gross g WHERE g.club_id=c.id AND g.payer_user IS NULL),0) commission,
    COALESCE((SELECT sum(x.amount) FROM pg_temp._rcf_edges x WHERE x.club_id=c.id AND x.payer_user IS NULL),0) cascade,
    COALESCE((SELECT sum(l.owed) FROM pg_temp._rcf_legs l WHERE l.club_id=c.id AND l.route='bank'),0) direct
   FROM public.clubs c WHERE c.id IN(SELECT club_id FROM pg_temp._rcf_legs))x
  WHERE x.commission+x.cascade+x.direct>x.received ORDER BY x.club_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_cannot_afford_week: club % received % for the week but owes % (commission from the bank %, agent and owner funding %, players paid by the bank %)',
   bad.club_id,bad.received,bad.commission+bad.cascade+bad.direct,bad.commission,bad.cascade,bad.direct USING ERRCODE='23514'; END IF;
 END IF;
END $function$;

-- ROUND 2, step B (accounts already locked by round 2): the opening balance of
-- every wallet that carries funding but earns no commission this week.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_round2_open()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE bad record;
BEGIN
 UPDATE pg_temp._routed_gross_nodes g SET commission_node=EXISTS(SELECT 1 FROM pg_temp._routed_nodes n WHERE n.club_id=g.club_id AND n.user_id=g.user_id
  AND NOT EXISTS(SELECT 1 FROM pg_temp._routed_owner_nodes o WHERE o.club_id=n.club_id AND o.user_id=n.user_id)) WHERE true;
 UPDATE pg_temp._routed_gross_nodes g SET opening=a.agent_wallet_balance FROM public.agents a WHERE a.club_id=g.club_id AND a.user_id=g.user_id AND NOT g.commission_node;
 SELECT g.club_id,g.user_id INTO bad FROM pg_temp._routed_gross_nodes g WHERE NOT g.commission_node
  AND(g.opening IS NULL OR g.opening<0 OR g.opening<>round(g.opening,2) OR g.opening::text IN('NaN','Infinity','-Infinity')) ORDER BY 1,2 LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_agent_wallet_missing: club % agent % has no valid agent wallet',bad.club_id,bad.user_id USING ERRCODE='23514'; END IF;
END $function$;

-- ROUND 2, step C (after every transfer and round 2's own wallet checks): a
-- funding-only wallet holds exactly opening + in - out, then the players'
-- share of every paying wallet is reserved.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_round2_settle(p_kind text,p_id uuid,p_from timestamptz,p_to timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE bad record; res jsonb;
BEGIN
 SELECT g.club_id,g.user_id,g.opening,a.agent_wallet_balance INTO bad FROM pg_temp._routed_gross_nodes g LEFT JOIN public.agents a ON a.club_id=g.club_id AND a.user_id=g.user_id
  WHERE NOT g.commission_node AND a.agent_wallet_balance IS DISTINCT FROM g.opening
   +COALESCE((SELECT sum(x.commission+x.funding) FROM pg_temp._routed_gross x WHERE x.club_id=g.club_id AND x.payee_user=g.user_id),0)
   -COALESCE((SELECT sum(x.commission+x.funding) FROM pg_temp._routed_gross x WHERE x.club_id=g.club_id AND x.payer_user=g.user_id),0) ORDER BY 1,2 LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_round2_balance_incorrect: club % agent % opened at % and holds %',bad.club_id,bad.user_id,bad.opening,bad.agent_wallet_balance USING ERRCODE='23514'; END IF;
 res:=smarter_private.weekly_payout_reserve_players_share(p_kind,p_id,p_from,p_to,'round2');
 INSERT INTO pg_temp._routed_cascade_summary SELECT jsonb_build_object('version','rakeback-funding-v1','one_leg_per_edge',true,
  'funding_amount',COALESCE(sum(g.funding),0),'funding_from_bank',COALESCE(sum(g.funding) FILTER(WHERE g.payer_user IS NULL),0),
  'combined_legs',count(*) FILTER(WHERE g.commission>0 AND g.funding>0),'funding_only_legs',count(*) FILTER(WHERE g.commission=0),
  'commission_only_legs',count(*) FILTER(WHERE g.funding=0),'reserved',res->'reserved_now','reserve_rows_added',res->'rows_added') FROM pg_temp._routed_gross g;
END $function$;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_fund_agent_shortfalls(p_run uuid, p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date;
 scope_key text:=CASE WHEN p_kind='union' THEN p_id::text ELSE 'club:'||p_id::text END;
 r2_key text; sid uuid; bad record; e record; k text; carried_by_round2 boolean;
 payer_before numeric; payer_after numeric; payee_before numeric; payee_after numeric; ledger_id uuid; receipts int;
 club_skip text; agent_skip text; sent jsonb:='[]'::jsonb; reserve jsonb;
BEGIN
 IF p_run IS NULL OR p_kind IS NULL OR p_kind NOT IN('union','club') OR p_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>=p_to
 THEN RAISE EXCEPTION 'rakeback_cascade_scope_invalid' USING ERRCODE='22023'; END IF;
 r2_key:='round2:v3:'||scope_key||':'||extract(epoch FROM p_from)::text||':'||extract(epoch FROM p_to)::text;
 -- Steps 1 to 5: the plan (latest certificate only, need, hierarchy, paths, edges).
 IF NOT smarter_private.rakeback_cascade_plan(p_kind,p_id,p_from,p_to) THEN
  RETURN jsonb_build_object('version','rakeback-funding-v1','week_start',d_from,'edges','[]'::jsonb,'clubs','[]'::jsonb,'nodes','[]'::jsonb);
 END IF;
 FOR e IN SELECT DISTINCT club_id FROM pg_temp._rcf_edges WHERE route='owner_wallet' AND amount>0 ORDER BY 1 LOOP
  IF smarter_private.ensure_owner_routing_wallet(e.club_id) IS NULL THEN RAISE EXCEPTION 'rakeback_cascade_club_owner_missing: club % owner has no routing wallet',e.club_id USING ERRCODE='23514'; END IF;
 END LOOP;
 -- ONE TRANSFER PER EDGE (20261111132447): an edge is funded when its own
 -- funding leg exists, or when its round 2 leg carried the funding in its
 -- recorded split. carried is what was sent for the edge this week.
 UPDATE pg_temp._rcf_edges x SET carried=COALESCE(
   (SELECT l.amount FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)),
   (SELECT smarter_private.rakeback_cascade_leg_funding(l.metadata,l.amount,x.club_id,d_from,x.payer_user,x.payee_user) FROM public.chip_ledger l
     WHERE l.idempotency_key=r2_key||':'||x.club_id::text||':'||COALESCE(x.payer_user::text,'club')||':'||x.payee_user::text AND l.metadata ? 'rakeback_funding')),
  state=CASE WHEN EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user))
   OR EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=r2_key||':'||x.club_id::text||':'||COALESCE(x.payer_user::text,'club')||':'||x.payee_user::text AND l.metadata ? 'rakeback_funding')
   THEN 'already_funded' ELSE 'to_send' END WHERE true;
 carried_by_round2:=EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs r WHERE r.scope_kind=p_kind AND r.scope_id=p_id AND r.period_start=p_from AND r.period_end=p_to AND r.round_no=2 AND r.result ? 'rakeback_cascade');
 SELECT x.club_id,x.payee_user,x.amount INTO bad FROM pg_temp._rcf_edges x WHERE carried_by_round2 AND x.state='to_send' AND x.amount>0 ORDER BY x.club_id,x.sort_order,x.payee_user LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_round2_left_edge_unfunded: club % agent % needs % for the week and round 2, which carries this week''s funding, did not send it',bad.club_id,bad.payee_user,bad.amount USING ERRCODE='23514'; END IF;
 -- 6. AFFORDABILITY, before any transfer, per club; a chip carried by a round
 --    2 leg is counted once, as funding.
 PERFORM c.id FROM public.clubs c WHERE c.id IN(SELECT club_id FROM pg_temp._rcf_legs) ORDER BY c.id FOR NO KEY UPDATE;
 IF p_kind='union' THEN
  SELECT cs.id INTO sid FROM public.ca_settlements cs WHERE cs.settlement_type='union_rakeback_close'
   AND cs.external_ref=p_id::text||':'||to_char(p_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
 END IF;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_clubs(club_id uuid PRIMARY KEY,received numeric,commission numeric,cascade numeric,cascade_unsent numeric,direct numeric,bank numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_clubs;
 INSERT INTO pg_temp._rcf_clubs
 SELECT c.id,
  CASE WHEN p_kind='union' THEN COALESCE((SELECT l.amount FROM public.chip_ledger l WHERE l.idempotency_key='union_close:'||sid::text||':'||c.id::text AND l.to_type='club_treasury' AND l.to_entity_id=c.id),0) END,
  COALESCE((SELECT sum(l.amount-COALESCE(smarter_private.rakeback_cascade_leg_funding(l.metadata,l.amount,c.id,d_from,NULL,a.user_id),0)) FROM public.agents a JOIN public.chip_ledger l ON l.idempotency_key=r2_key||':'||c.id::text||':club:'||a.user_id::text WHERE a.club_id=c.id AND l.from_type='club_treasury'),0),
  COALESCE((SELECT sum(x.amount) FROM pg_temp._rcf_edges x WHERE x.club_id=c.id AND x.payer_user IS NULL),0),
  COALESCE((SELECT sum(x.amount) FROM pg_temp._rcf_edges x WHERE x.club_id=c.id AND x.payer_user IS NULL AND x.state='to_send'),0),
  COALESCE((SELECT sum(l.owed) FROM pg_temp._rcf_legs l WHERE l.club_id=c.id AND l.route='bank'),0),c.chip_treasury
 FROM public.clubs c WHERE c.id IN(SELECT club_id FROM pg_temp._rcf_legs);
 SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.received IS NOT NULL AND x.commission+x.cascade+x.direct>x.received ORDER BY x.club_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_cannot_afford_week: club % received % for the week but owes % (commission from the bank %, agent and owner funding %, players paid by the bank %)',
   bad.club_id,bad.received,bad.commission+bad.cascade+bad.direct,bad.commission,bad.cascade,bad.direct USING ERRCODE='23514'; END IF;
 SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.bank IS NULL OR x.bank<>round(x.bank,2) OR x.cascade_unsent+x.direct>x.bank ORDER BY x.club_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_bank_short: club % bank holds % but the week still needs % (agent and owner funding %, players paid by the bank %)',
   bad.club_id,bad.bank,bad.cascade_unsent+bad.direct,bad.cascade_unsent,bad.direct USING ERRCODE='23514'; END IF;
 -- 7. Transfers, parents before children. A leg already sent under this
 --    week's key, or carried by round 2, is never sent again; a larger plan
 --    than what was sent means the certificates changed after funding.
 SELECT x.club_id,x.payee_user,x.amount,x.carried AS funded INTO bad FROM pg_temp._rcf_edges x
  LEFT JOIN public.chip_ledger l ON l.idempotency_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)
  WHERE x.state='already_funded' AND(x.carried IS NULL OR x.carried<x.amount OR(l.id IS NOT NULL AND(l.club_id IS DISTINCT FROM x.club_id OR l.to_entity_id IS DISTINCT FROM x.payee_user
   OR l.to_type<>'agent_wallet' OR l.from_entity_id IS DISTINCT FROM COALESCE(x.payer_user,x.club_id)))) LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_funded_amount_changed: club % payee % was funded % for this week and the plan now needs %',bad.club_id,bad.payee_user,bad.funded,bad.amount USING ERRCODE='55000'; END IF;
 PERFORM a.id FROM public.agents a JOIN pg_temp._rcf_nodes n ON n.club_id=a.club_id AND n.user_id=a.user_id ORDER BY a.club_id,a.user_id FOR NO KEY UPDATE OF a;
 SELECT n.club_id,n.user_id INTO bad FROM pg_temp._rcf_nodes n LEFT JOIN public.agents a ON a.club_id=n.club_id AND a.user_id=n.user_id
  WHERE a.id IS NULL OR a.agent_wallet_balance IS NULL OR a.agent_wallet_balance<0 OR a.agent_wallet_balance<>round(a.agent_wallet_balance,2) ORDER BY 1,2 LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_agent_wallet_missing: club % agent % has no valid agent wallet',bad.club_id,bad.user_id USING ERRCODE='23514'; END IF;
 club_skip:=current_setting('app.ledger_autoskip_clubs',true);agent_skip:=current_setting('app.ledger_autoskip_agents',true);
 PERFORM set_config('app.ledger_autoskip_clubs','1',true);PERFORM set_config('app.ledger_autoskip_agents','1',true);
 FOR e IN SELECT * FROM pg_temp._rcf_edges WHERE state='to_send' AND amount>0 ORDER BY sort_order,club_id,payer_user NULLS FIRST,payee_user LOOP
  k:=smarter_private.rakeback_cascade_key(e.club_id,d_from,e.payer_user,e.payee_user);
  SELECT agent_wallet_balance INTO payee_before FROM public.agents WHERE club_id=e.club_id AND user_id=e.payee_user;
  payer_after:=NULL;
  IF e.payer_user IS NULL THEN
   SELECT chip_treasury INTO payer_before FROM public.clubs WHERE id=e.club_id;
   IF payer_before IS NULL OR payer_before<e.amount THEN RAISE EXCEPTION 'rakeback_cascade_club_bank_short: club % bank holds % and cannot fund agent % with %',e.club_id,payer_before,e.payee_user,e.amount USING ERRCODE='23514'; END IF;
   UPDATE public.clubs SET chip_treasury=chip_treasury-e.amount WHERE id=e.club_id AND chip_treasury>=e.amount RETURNING chip_treasury INTO payer_after;
  ELSE
   SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=e.club_id AND user_id=e.payer_user;
   IF payer_before IS NULL OR payer_before<e.amount THEN RAISE EXCEPTION 'rakeback_cascade_upstream_wallet_short: club % agent % holds % and cannot pass % down to agent %',e.club_id,e.payer_user,payer_before,e.amount,e.payee_user USING ERRCODE='23514'; END IF;
   UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-e.amount,updated_at=now() WHERE club_id=e.club_id AND user_id=e.payer_user AND agent_wallet_balance>=e.amount RETURNING agent_wallet_balance INTO payer_after;
  END IF;
  UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+e.amount,updated_at=now() WHERE club_id=e.club_id AND user_id=e.payee_user RETURNING agent_wallet_balance INTO payee_after;
  IF payer_after IS NULL OR payee_after IS NULL OR payer_before-payer_after<>e.amount OR payee_after-payee_before<>e.amount
  THEN RAISE EXCEPTION 'rakeback_cascade_transfer_not_conserved: club % payer % payee % amount %',e.club_id,COALESCE(e.payer_user::text,'club bank'),e.payee_user,e.amount USING ERRCODE='23514'; END IF;
  INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,union_id,description,idempotency_key,metadata,
    pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
   VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),CASE WHEN e.payer_user IS NULL THEN 'club_treasury' ELSE 'agent_wallet' END,
    COALESCE(e.payer_user,e.club_id),'agent_wallet',e.payee_user,e.amount,CASE WHEN e.payer_user IS NULL THEN 'club_bank_send' ELSE 'agent_send' END,e.club_id,
    CASE WHEN p_kind='union' THEN p_id END,'Weekly rakeback funding through the recorded hierarchy (week ending '||to_char(p_to AT TIME ZONE 'America/Chicago','Mon DD')||')',k,
    jsonb_build_object('cascade','rakeback-funding-v1','route',e.route,'run_id',p_run,'accounting_scope_kind',p_kind,'accounting_scope_id',p_id,'period_start',p_from,'period_end',p_to,
      'week_start',d_from,'pass_through',e.payer_user IS NOT NULL,'paid_to','agent_wallet'),payer_before,payer_after,payee_before,payee_after) RETURNING id INTO ledger_id;
  SELECT count(*) INTO receipts FROM public.settlement_invoices i WHERE i.source_ledger_id=ledger_id AND i.status='paid'
   AND i.chips_transferred AND i.message_sent AND i.net_amount=e.amount AND i.gross_amount=e.amount AND i.deductions=0;
  IF receipts<>1 THEN RAISE EXCEPTION 'rakeback_cascade_receipt_incomplete: club % payer % payee % amount % has % receipts',e.club_id,COALESCE(e.payer_user::text,'club bank'),e.payee_user,e.amount,receipts USING ERRCODE='23514'; END IF;
  sent:=sent||jsonb_build_array(ledger_id);
 END LOOP;
 PERFORM set_config('app.ledger_autoskip_clubs',COALESCE(club_skip,''),true);PERFORM set_config('app.ledger_autoskip_agents',COALESCE(agent_skip,''),true);
 -- 8. The players' share of every paying wallet, if round 2 did not reserve it.
 reserve:=smarter_private.weekly_payout_reserve_players_share(p_kind,p_id,p_from,p_to,'funding');
 RETURN jsonb_build_object('version','rakeback-funding-v1','week_start',d_from,'run_id',p_run,'ledger_ids',sent,'carried_by_round2',carried_by_round2,'reserve',reserve,
  'skipped_deleted_uplines',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',s.club_id,'user_id',s.user_id) ORDER BY s.club_id,s.user_id) FROM pg_temp._rcf_skipped s),'[]'::jsonb),
  'edges',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',x.club_id,'payer_user_id',x.payer_user,'payee_user_id',x.payee_user,'amount',x.amount,'route',x.route,'tier',x.sort_order,'state',x.state,
     'key',smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)) ORDER BY x.club_id,x.sort_order,x.payer_user NULLS FIRST,x.payee_user) FROM pg_temp._rcf_edges x),'[]'::jsonb),
  'nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',n.club_id,'user_id',n.user_id,'tier',n.sort_order,
     'inflow',(SELECT COALESCE(sum(x.amount),0) FROM pg_temp._rcf_edges x WHERE x.club_id=n.club_id AND x.payee_user=n.user_id),
     'to_children',(SELECT COALESCE(sum(x.amount),0) FROM pg_temp._rcf_edges x WHERE x.club_id=n.club_id AND x.payer_user=n.user_id),
     'players_need',(SELECT COALESCE(sum(l.need),0) FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.club_id=n.club_id AND((l.route='agent' AND l.payer_user=n.user_id) OR(l.route='owner' AND c.owner_id=n.user_id))),
     'players_owed',(SELECT COALESCE(sum(l.owed),0) FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.club_id=n.club_id AND((l.route='agent' AND l.payer_user=n.user_id) OR(l.route='owner' AND c.owner_id=n.user_id))),
     'covered_by_own_commission',(SELECT COALESCE(sum(l.covered),0) FROM pg_temp._rcf_legs l WHERE l.club_id=n.club_id AND l.route='agent' AND l.payer_user=n.user_id))
     ORDER BY n.club_id,n.sort_order,n.user_id) FROM pg_temp._rcf_nodes n),'[]'::jsonb),
  'clubs',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',x.club_id,'received_for_week',x.received,'commission_from_bank',x.commission,'funding_from_bank',x.cascade,
     'funding_sent_now',x.cascade_unsent,'players_paid_by_bank',x.direct,'bank_before',x.bank) ORDER BY x.club_id) FROM pg_temp._rcf_clubs x),'[]'::jsonb));
END $function$;

DO $patch_round2$
DECLARE src text:=pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM 'ce1a9dd4344c7987918dcf8a82427ef5' THEN RAISE EXCEPTION 'rakeback_gross_round2_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$THEN RAISE EXCEPTION 'existing_transfer_commission_adjusted_plan_not_conserved';END IF;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_0_changed';END IF;
 src:=replace(src,$o$THEN RAISE EXCEPTION 'existing_transfer_commission_adjusted_plan_not_conserved';END IF;$o$,$n$THEN RAISE EXCEPTION 'existing_transfer_commission_adjusted_plan_not_conserved';END IF;
 -- ONE TRANSFER PER EDGE (20261111): the week's rakeback funding joins this
 -- round. pg_temp._routed_gross holds one row per (club, payer, payee):
 -- commission (exactly the edge above) plus funding (the cascade's edge).
 PERFORM smarter_private.rakeback_cascade_round2_plan(p_scope_kind,p_scope_id,p_period_start,p_period_end);$n$);
 IF cardinality(string_to_array(src,$o$ PERFORM a.id FROM public.agents a JOIN pg_temp._routed_nodes n ON n.club_id=a.club_id AND n.user_id=a.user_id
  WHERE NOT EXISTS(SELECT 1 FROM pg_temp._routed_owner_nodes o WHERE o.club_id=n.club_id AND o.user_id=n.user_id) ORDER BY a.club_id,a.user_id FOR NO KEY UPDATE OF a;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_1_changed';END IF;
 src:=replace(src,$o$ PERFORM a.id FROM public.agents a JOIN pg_temp._routed_nodes n ON n.club_id=a.club_id AND n.user_id=a.user_id
  WHERE NOT EXISTS(SELECT 1 FROM pg_temp._routed_owner_nodes o WHERE o.club_id=n.club_id AND o.user_id=n.user_id) ORDER BY a.club_id,a.user_id FOR NO KEY UPDATE OF a;$o$,$n$ PERFORM a.id FROM public.agents a WHERE EXISTS(SELECT 1 FROM pg_temp._routed_nodes n WHERE n.club_id=a.club_id AND n.user_id=a.user_id
  AND NOT EXISTS(SELECT 1 FROM pg_temp._routed_owner_nodes o WHERE o.club_id=n.club_id AND o.user_id=n.user_id))
  OR EXISTS(SELECT 1 FROM pg_temp._routed_gross g WHERE g.club_id=a.club_id AND a.user_id IN(g.payer_user,g.payee_user)) ORDER BY a.club_id,a.user_id FOR NO KEY UPDATE OF a;$n$);
 IF cardinality(string_to_array(src,$o$FROM(SELECT club_id,sum(amount) owed FROM pg_temp._routed_edges WHERE payer_user IS NULL GROUP BY club_id) e$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_2_changed';END IF;
 src:=replace(src,$o$FROM(SELECT club_id,sum(amount) owed FROM pg_temp._routed_edges WHERE payer_user IS NULL GROUP BY club_id) e$o$,$n$FROM(SELECT club_id,sum(commission+funding) owed FROM pg_temp._routed_gross WHERE payer_user IS NULL GROUP BY club_id) e$n$);
 IF cardinality(string_to_array(src,$o$THEN RAISE EXCEPTION 'routed_commission_club_funding_shortfall' USING ERRCODE='23514'; END IF;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_3_changed';END IF;
 src:=replace(src,$o$THEN RAISE EXCEPTION 'routed_commission_club_funding_shortfall' USING ERRCODE='23514'; END IF;$o$,$n$THEN RAISE EXCEPTION 'routed_commission_club_funding_shortfall' USING ERRCODE='23514'; END IF;
 PERFORM smarter_private.rakeback_cascade_round2_open();$n$);
 IF cardinality(string_to_array(src,$o$FOR v_edge IN SELECT * FROM pg_temp._routed_edges ORDER BY sort_order,club_id,payer_user NULLS FIRST,payee_user LOOP$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_4_changed';END IF;
 src:=replace(src,$o$FOR v_edge IN SELECT * FROM pg_temp._routed_edges ORDER BY sort_order,club_id,payer_user NULLS FIRST,payee_user LOOP$o$,$n$FOR v_edge IN SELECT g.club_id,g.payer_user,g.payee_user,g.commission+g.funding AS amount,g.role,g.sort_order,g.commission,g.funding,g.route,g.cascade_key
  FROM pg_temp._routed_gross g ORDER BY g.sort_order,g.club_id,g.payer_user NULLS FIRST,g.payee_user LOOP$n$);
 IF cardinality(string_to_array(src,$o$v_edge.amount,'commission',v_edge.club_id,p_union_id,$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_5_changed';END IF;
 src:=replace(src,$o$v_edge.amount,'commission',v_edge.club_id,p_union_id,$o$,$n$v_edge.amount,CASE WHEN v_edge.commission>0 THEN 'commission' WHEN v_edge.payer_user IS NULL THEN 'club_bank_send' ELSE 'agent_send' END,v_edge.club_id,p_union_id,$n$);
 IF cardinality(string_to_array(src,$o$'Weekly commission through recorded earning hierarchy',run_key||':'||v_edge.club_id::text||':'||COALESCE(v_edge.payer_user::text,'club')||':'||v_edge.payee_user::text,$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_6_changed';END IF;
 src:=replace(src,$o$'Weekly commission through recorded earning hierarchy',run_key||':'||v_edge.club_id::text||':'||COALESCE(v_edge.payer_user::text,'club')||':'||v_edge.payee_user::text,$o$,$n$CASE WHEN v_edge.commission>0 THEN 'Weekly commission through recorded earning hierarchy' ELSE 'Weekly rakeback funding through the recorded hierarchy (week ending '||to_char(p_period_end AT TIME ZONE 'America/Chicago','Mon DD')||')' END,
    CASE WHEN v_edge.commission>0 THEN run_key||':'||v_edge.club_id::text||':'||COALESCE(v_edge.payer_user::text,'club')||':'||v_edge.payee_user::text ELSE v_edge.cascade_key END,$n$);
 IF cardinality(string_to_array(src,$o$    jsonb_build_object('routing_version',3,'accounting_scope_kind',p_scope_kind$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_7_changed';END IF;
 src:=replace(src,$o$    jsonb_build_object('routing_version',3,'accounting_scope_kind',p_scope_kind$o$,$n$    CASE WHEN v_edge.commission=0 THEN jsonb_build_object('cascade','rakeback-funding-v1','route',v_edge.route,'accounting_scope_kind',p_scope_kind,'accounting_scope_id',p_scope_id,'period_start',p_period_start,'period_end',p_period_end,
      'week_start',(p_period_start AT TIME ZONE 'America/Los_Angeles')::date,'pass_through',v_edge.payer_user IS NOT NULL,'paid_to','agent_wallet','sent_in_round',2) ELSE
    jsonb_build_object('routing_version',3,'accounting_scope_kind',p_scope_kind$n$);
 IF cardinality(string_to_array(src,$o$'pass_through',v_edge.payer_user IS NOT NULL,'paid_to','agent_wallet'),payer_before,payer_after,payee_before,payee_after) RETURNING id INTO ledger_id;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_8_changed';END IF;
 src:=replace(src,$o$'pass_through',v_edge.payer_user IS NOT NULL,'paid_to','agent_wallet'),payer_before,payer_after,payee_before,payee_after) RETURNING id INTO ledger_id;$o$,$n$'pass_through',v_edge.payer_user IS NOT NULL,'paid_to','agent_wallet')
      ||CASE WHEN v_edge.funding>0 THEN jsonb_build_object('commission_amount',v_edge.commission,'rakeback_funding',v_edge.funding,'rakeback_funding_key',v_edge.cascade_key,'rakeback_funding_version','rakeback-funding-v1') ELSE '{}'::jsonb END END,
    payer_before,payer_after,payee_before,payee_after) RETURNING id INTO ledger_id;$n$);
 IF cardinality(string_to_array(src,$o$AND a.agent_wallet_balance IS DISTINCT FROM n.opening_balance+n.own_amount-COALESCE($o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_9_changed';END IF;
 src:=replace(src,$o$AND a.agent_wallet_balance IS DISTINCT FROM n.opening_balance+n.own_amount-COALESCE($o$,$n$AND a.agent_wallet_balance IS DISTINCT FROM n.opening_balance
   +COALESCE((SELECT sum(g.funding) FROM pg_temp._routed_gross g WHERE g.club_id=n.club_id AND g.payee_user=n.user_id),0)-COALESCE((SELECT sum(g.funding) FROM pg_temp._routed_gross g WHERE g.club_id=n.club_id AND g.payer_user=n.user_id),0)
   +n.own_amount-COALESCE($n$);
 IF cardinality(string_to_array(src,$o$THEN RAISE EXCEPTION 'routed_commission_retained_balance_incorrect' USING ERRCODE='23514'; END IF;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_10_changed';END IF;
 src:=replace(src,$o$THEN RAISE EXCEPTION 'routed_commission_retained_balance_incorrect' USING ERRCODE='23514'; END IF;$o$,$n$THEN RAISE EXCEPTION 'routed_commission_retained_balance_incorrect' USING ERRCODE='23514'; END IF;
 -- Every wallet that carried only funding holds exactly what passed through
 -- it; then the players' share of every paying wallet is reserved until round 3.
 PERFORM smarter_private.rakeback_cascade_round2_settle(p_scope_kind,p_scope_id,p_period_start,p_period_end);$n$);
 IF cardinality(string_to_array(src,$o$WHERE EXISTS(SELECT FROM pg_temp._routed_edges e WHERE e.club_id=a.club_id AND e.payee_user=a.user_id AND e.amount>0)$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_11_changed';END IF;
 src:=replace(src,$o$WHERE EXISTS(SELECT FROM pg_temp._routed_edges e WHERE e.club_id=a.club_id AND e.payee_user=a.user_id AND e.amount>0)$o$,$n$WHERE EXISTS(SELECT FROM pg_temp._routed_gross e WHERE e.club_id=a.club_id AND e.payee_user=a.user_id AND e.commission+e.funding>0)$n$);
 IF cardinality(string_to_array(src,$o$ INSERT INTO public.accounting_routed_settlement_runs(union_id,standalone_club_id,period_start,period_end,round_no,source_fingerprint,result)$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round2_anchor_12_changed';END IF;
 src:=replace(src,$o$ INSERT INTO public.accounting_routed_settlement_runs(union_id,standalone_club_id,period_start,period_end,round_no,source_fingerprint,result)$o$,$n$ result:=result||jsonb_build_object('rakeback_cascade',(SELECT s.summary FROM pg_temp._routed_cascade_summary s));
 INSERT INTO public.accounting_routed_settlement_runs(union_id,standalone_club_id,period_start,period_end,round_no,source_fingerprint,result)$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'a854bfbd9fcddb4143c6ead5f61c8141' THEN RAISE EXCEPTION 'rakeback_gross_round2_postimage_changed';END IF;
END $patch_round2$;
DO $patch_round3$
DECLARE src text:=pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM 'db6ba33eed8762b2534d349024e4219f' THEN RAISE EXCEPTION 'rakeback_gross_round3_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$  INSERT INTO pg_temp._routed_player_done VALUES(prior_item.period_id)ON CONFLICT DO NOTHING;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round3_anchor_0_changed';END IF;
 src:=replace(src,$o$  INSERT INTO pg_temp._routed_player_done VALUES(prior_item.period_id)ON CONFLICT DO NOTHING;$o$,$n$  INSERT INTO pg_temp._routed_player_done VALUES(prior_item.period_id)ON CONFLICT DO NOTHING;
  PERFORM smarter_private.weekly_payout_reserve_close(prior_item.period_id);$n$);
 IF cardinality(string_to_array(src,$o$    SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.wallet_user;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round3_anchor_1_changed';END IF;
 src:=replace(src,$o$    SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.wallet_user;$o$,$n$    -- RESERVED SHARE (20261111): the reserve round 2 set for this player is
    -- released by exactly what is paid, before the wallet is debited.
    PERFORM smarter_private.weekly_payout_reserve_release(r.period_id,r.club_id,g.wallet_user,amount);
    SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.wallet_user;$n$);
 IF cardinality(string_to_array(src,$o$  UPDATE public.rakeback_periods SET status='paid',paid_at=now() WHERE id=r.period_id;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_round3_anchor_2_changed';END IF;
 src:=replace(src,$o$  UPDATE public.rakeback_periods SET status='paid',paid_at=now() WHERE id=r.period_id;$o$,$n$  UPDATE public.rakeback_periods SET status='paid',paid_at=now() WHERE id=r.period_id;
  PERFORM smarter_private.weekly_payout_reserve_close(r.period_id);$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '471233c06fb2fe9cd2c0928756ba4b82' THEN RAISE EXCEPTION 'rakeback_gross_round3_postimage_changed';END IF;
END $patch_round3$;
DO $patch_finalize$
DECLARE src text:=pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '5b83618b59f043376c87361c986adca8' THEN RAISE EXCEPTION 'rakeback_gross_finalize_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$ -- Credit lines: what an agent owes$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_finalize_anchor_0_changed';END IF;
 src:=replace(src,$o$ -- Credit lines: what an agent owes$o$,$n$ -- RESERVED SHARE (20261111): every reserve this run's round 2 set was
 -- released by round 3. One left means a player was not paid from it.
 SELECT w.club_id,w.user_id,w.remaining,w.period_id INTO left_reserve FROM smarter_private.weekly_payout_wallet_reserves w
  JOIN jsonb_array_elements(r.scope_plan) s ON w.scope_kind=s->>'kind' AND w.scope_id=(s->>'id')::uuid AND w.period_start=(s->>'period_start')::timestamptz AND w.period_end=(s->>'period_end')::timestamptz
  WHERE w.remaining>0 ORDER BY w.club_id,w.user_id,w.period_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'weekly_payout_reserve_not_released: club % agent % still reserves % for period % after round 3',left_reserve.club_id,left_reserve.user_id,left_reserve.remaining,left_reserve.period_id USING ERRCODE='23514'; END IF;
 -- Credit lines: what an agent owes$n$);
 IF cardinality(string_to_array(src,$o$DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_finalize_anchor_1_changed';END IF;
 src:=replace(src,$o$DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;$o$,$n$DECLARE left_reserve record; r public.weekly_accounting_payout_pauses%ROWTYPE;$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_finalize(uuid)'::regprocedure)) IS DISTINCT FROM '5ec42349ea8afcff0697873cf317ff93' THEN RAISE EXCEPTION 'rakeback_gross_finalize_postimage_changed';END IF;
END $patch_finalize$;
DO $patch_zero_standalone$
DECLARE src text:=pg_get_functiondef('smarter_private.zero_standalone_foreign_commissions_proven(uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '69099f3bac93cb29fad83cb82cb1fe4a' THEN RAISE EXCEPTION 'rakeback_gross_zero_standalone_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$AND l.to_type='agent_wallet'AND l.to_entity_id=e.payee_user AND l.amount=e.amount
    AND l.pre_from_balance-l.post_from_balance=e.amount AND l.post_to_balance-l.pre_to_balance=e.amount$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_gross_zero_standalone_anchor_0_changed';END IF;
 src:=replace(src,$o$AND l.to_type='agent_wallet'AND l.to_entity_id=e.payee_user AND l.amount=e.amount
    AND l.pre_from_balance-l.post_from_balance=e.amount AND l.post_to_balance-l.pre_to_balance=e.amount$o$,$n$AND l.to_type='agent_wallet'AND l.to_entity_id=e.payee_user
    -- ONE TRANSFER PER EDGE (20261111): a leg may also carry the edge's
    -- rakeback funding, recorded in its own split; settled legs carry none.
    AND l.amount=e.amount+smarter_private.rakeback_cascade_leg_funding(l.metadata,l.amount,e.club_id,(p_start AT TIME ZONE 'America/Los_Angeles')::date,e.payer_user,e.payee_user)
    AND l.pre_from_balance-l.post_from_balance=l.amount AND l.post_to_balance-l.pre_to_balance=l.amount$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.zero_standalone_foreign_commissions_proven(uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'd787091c00ea6ec57b3b80c66e8394ea' THEN RAISE EXCEPTION 'rakeback_gross_zero_standalone_postimage_changed';END IF;
END $patch_zero_standalone$;
CREATE TRIGGER zzzzz_agent_wallet_keeps_weekly_reserve BEFORE UPDATE OR DELETE ON public.agents FOR EACH ROW EXECUTE FUNCTION smarter_private.agent_wallet_keeps_weekly_reserve();
REVOKE ALL ON FUNCTION smarter_private.agent_wallet_keeps_weekly_reserve() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_leg_funding(jsonb,numeric,uuid,date,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_round2_open() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_round2_settle(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_reserve_players_share(text,uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_reserve_release(uuid,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_reserve_close(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $post$BEGIN IF md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '255ebe71d6f04fa072a87798d20a7c56' THEN RAISE EXCEPTION 'rakeback_gross_fund_postimage_changed';END IF;END $post$;
COMMIT;

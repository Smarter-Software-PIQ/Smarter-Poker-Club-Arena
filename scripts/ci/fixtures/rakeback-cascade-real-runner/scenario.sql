-- Scenario builders for test-rakeback-cascade-real-runner-postgres.py (fixture only, schema rr).
-- Nothing here sets session_replication_role, disables a trigger, or writes a
-- balance without its chip_ledger leg. The database clock is the fixture clock
-- (clock.sql): builders run at the instant the harness set, so the real
-- agreement capture stamps observed_at itself.
CREATE SCHEMA rr;
CREATE FUNCTION rr.u(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT md5('rr:'||$1)::uuid$$;
CREATE FUNCTION rr.ok(boolean,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1 IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %',$2; END IF;END$$;
-- The settled week: Monday 2026-11-09 00:00 to Monday 2026-11-16 00:00 America/Los_Angeles.
CREATE FUNCTION rr.ws() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT public.fn_union_week_start('2026-11-11 12:00+00'::timestamptz)$$;
CREATE FUNCTION rr.we() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT public.fn_union_week_start(rr.ws()+interval '8 days')$$;
CREATE FUNCTION rr.d1() RETURNS date LANGUAGE sql STABLE AS $$SELECT (rr.ws() AT TIME ZONE 'America/Los_Angeles')::date$$;
-- SEEDED: member baselines. Production takes ca_chip_baseline in a baseline job
-- that is not loaded; every fixture membership opens at 0 and records it, so the
-- real fn_chip_drift_since_baseline measures every member.
CREATE FUNCTION rr.baseline(p_club text,p_user text) RETURNS void LANGUAGE sql AS $$INSERT INTO public.ca_chip_baseline(club_id,user_id,opening_balance,ledger_at_baseline,unledgered_gap,taken_at) SELECT rr.u(p_club),rr.u(p_user),0,0,0,now() WHERE NOT EXISTS(SELECT 1 FROM public.ca_chip_baseline WHERE club_id=rr.u(p_club) AND user_id=rr.u(p_user))$$;
-- SEEDED: people (auth.users + profiles; profile triggers are not wired).
CREATE FUNCTION rr.person(p text) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO auth.users(id,email) VALUES(rr.u(p),p||'@fixture.invalid') ON CONFLICT DO NOTHING;
 INSERT INTO public.profiles(id,username,full_name) VALUES(rr.u(p),'u_'||replace(lower(p),'.','_'),p) ON CONFLICT DO NOTHING;
 RETURN rr.u(p);END$$;
-- SEEDED: the union and its wallet row (union triggers are not wired).
CREATE FUNCTION rr.onion(p text,p_min numeric DEFAULT 0.20) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM rr.person(p||'.boss');
 INSERT INTO public.unions(id,name,owner_id,slug,settings) VALUES(rr.u(p),'Union '||p,rr.u(p||'.boss'),'union-'||lower(p),jsonb_build_object('min_agent_commission',p_min,'max_agent_commission',1));
 INSERT INTO public.union_wallets(union_id) VALUES(rr.u(p));END$$;
-- SEEDED: a club that opens with an empty bank, its union membership at 0.90
-- (the real agreement capture on union_clubs records the terms the earning
-- contract and round 1 read), and its owner's membership. The owner gets NO
-- agents row here.
CREATE FUNCTION rr.club(p text,p_union text DEFAULT 'U') RETURNS void LANGUAGE plpgsql AS $$DECLARE o uuid:=rr.person(p||'.owner');BEGIN
 INSERT INTO public.clubs(id,name,owner_id,union_id,chip_treasury) VALUES(rr.u(p),'Club '||p,o,rr.u(p_union),0);
 INSERT INTO public.union_clubs(union_id,club_id,joined_at,club_commission_rate) VALUES(rr.u(p_union),rr.u(p),now(),0.90);
 INSERT INTO public.club_members(club_id,user_id,role,status) VALUES(rr.u(p),o,'owner','active'); PERFORM rr.baseline(p,p||'.owner');END$$;
-- SEEDED: an agent agreement (membership + agents row; the real 27-trigger agents stack and the real capture run).
CREATE FUNCTION rr.agent(p_club text,p_user text,p_parent text,p_rate numeric,p_role text DEFAULT 'agent') RETURNS void LANGUAGE plpgsql AS $$DECLARE par uuid;BEGIN
 PERFORM rr.person(p_user);
 SELECT id INTO par FROM public.agents WHERE club_id=rr.u(p_club) AND user_id=rr.u(p_parent);
 IF p_parent IS NOT NULL AND par IS NULL THEN RAISE EXCEPTION 'fixture: parent % has no agents row',p_parent; END IF;
 INSERT INTO public.club_members(club_id,user_id,role,status) VALUES(rr.u(p_club),rr.u(p_user),p_role,'active');
 INSERT INTO public.agents(user_id,club_id,role,status,parent_agent_id,commission_rate,player_rakeback_rate) VALUES(rr.u(p_user),rr.u(p_club),p_role,'active',par,p_rate,0);
 PERFORM rr.baseline(p_club,p_user);END$$;
-- SEEDED: the club owner's own agents row (membership already exists; the real agents stack and capture run).
CREATE FUNCTION rr.owner_agent(p_club text,p_rate numeric) RETURNS void LANGUAGE sql AS $$INSERT INTO public.agents(user_id,club_id,role,status,parent_agent_id,commission_rate,player_rakeback_rate) VALUES(rr.u(p_club||'.owner'),rr.u(p_club),'agent','active',NULL,p_rate,0)$$;
-- SEEDED: a player membership with its upline (NULL = unassigned) and explicit rakeback deal.
CREATE FUNCTION rr.member(p_club text,p_player text,p_upline text,p_pct numeric) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM rr.person(p_player);
 INSERT INTO public.club_members(club_id,user_id,role,status,agent_id,player_rakeback_pct,player_rakeback_explicit) VALUES(rr.u(p_club),rr.u(p_player),'player','active',rr.u(p_upline),p_pct,true);
 PERFORM rr.baseline(p_club,p_player);END$$;
-- ONE RAKED CASH HAND at p_at, earned by one player.
-- SEEDED (the engine writes these): the hand's rake_records and
-- rake_attributions rows, and the bank side of the rake: the union rake wallet
-- credit with its keyed chip_ledger mint leg and mint-register row (the fixture
-- is the mint door, as in lane C), its union_wallet_transactions row and its
-- accounting_cash_bank_receipts row.
-- REAL: public.fn_process_cash_accounting_source, i.e. the earning contract
-- from the recorded agreements, accounting_cash_rake_sources, agent_commissions,
-- the accrual batch, the source receipt and work rows, player stats, and the
-- week's recompute request.
CREATE FUNCTION rr.hand(p_club text,p_player text,p_rake numeric,p_at timestamptz,p_union text DEFAULT 'U') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rid uuid:=gen_random_uuid();hid uuid:=gen_random_uuid();tx uuid:=gen_random_uuid();b numeric;l uuid;res jsonb;BEGIN
 IF p_at>clock_timestamp() THEN RAISE EXCEPTION 'fixture: a hand cannot be earned after the fixture clock (%)',clock_timestamp(); END IF;
 INSERT INTO public.rake_records(id,hand_id,club_id,rake_amount,created_at,is_tournament,metadata) VALUES(rid,hid,rr.u(p_club),p_rake,p_at,false,jsonb_build_object('accounting_source_version','2','union_id',rr.u(p_union)));
 INSERT INTO public.rake_attributions(hand_id,player_id,rake_amount,created_at,rake_record_id,club_id,weighted_rake_credit) VALUES(hid,rr.u(p_player),p_rake,p_at,rid,rr.u(p_club),p_rake);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET rake_wallet=rake_wallet+p_rake WHERE union_id=rr.u(p_union) RETURNING rake_wallet INTO b;
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,union_id,description,idempotency_key,pre_to_balance,post_to_balance,to_label)
 VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','system_mint',NULL,'union_wallet',rr.u(p_union),p_rake,'mint',rr.u(p_union),'Fixture rake banked by the union','fixture-rake:'||rid,b-p_rake,b,'union_wallets.rake_wallet') RETURNING id INTO l;
 INSERT INTO public.ca_mint_ledger(op_id,action,asset,holder_type,holder_id,holder_label,amount,balance_before,balance_after,supply_after,reason,performed_by,chip_ledger_id)
 VALUES('fixture-rake:'||l,'mint','chips','union',rr.u(p_union),p_union,p_rake,b-p_rake,b,b,'Fixture rake banked by the union','2d1cd6c3-5700-4af9-a271-d4863fdab20d',l);
 PERFORM set_config('app.ledger_autoskip_union_wallets','',true);
 INSERT INTO public.union_wallet_transactions(id,union_id,wallet,direction,amount,balance_after,tx_type,club_id,notes,created_at) VALUES(tx,rr.u(p_union),'rake_wallet','credit',p_rake,b,'rake',rr.u(p_club),'Fixture cash rake',p_at);
 INSERT INTO public.accounting_cash_bank_receipts(rake_record_id,union_id,club_id,union_transaction_id,banked_at,amount) VALUES(rid,rr.u(p_union),rr.u(p_club),tx,p_at,p_rake);
 res:=public.fn_process_cash_accounting_source(rid);
 IF res->>'status' IS DISTINCT FROM 'accrued' THEN RAISE EXCEPTION 'fixture: the real earning producer refused hand %: %',rid,left(res::text,1500); END IF;
 RETURN res;END$$;
-- Readers used by the assertions.
CREATE FUNCTION rr.money() RETURNS numeric LANGUAGE sql AS $$SELECT(SELECT COALESCE(sum(chip_treasury),0) FROM public.clubs)+(SELECT COALESCE(sum(agent_wallet_balance),0) FROM public.agents)+(SELECT COALESCE(sum(chip_balance),0) FROM public.club_members)+(SELECT COALESCE(sum(rake_wallet)+sum(chip_balance),0) FROM public.union_wallets)$$;
CREATE FUNCTION rr.wallet(p_club text,p_user text) RETURNS numeric LANGUAGE sql AS $$SELECT agent_wallet_balance FROM public.agents WHERE club_id=rr.u(p_club) AND user_id=rr.u(p_user)$$;
CREATE FUNCTION rr.chips(p_club text,p_user text) RETURNS numeric LANGUAGE sql AS $$SELECT chip_balance FROM public.club_members WHERE club_id=rr.u(p_club) AND user_id=rr.u(p_user)$$;
CREATE FUNCTION rr.bank(p_club text) RETURNS numeric LANGUAGE sql AS $$SELECT chip_treasury FROM public.clubs WHERE id=rr.u(p_club)$$;
-- Every committed money movement of the weekly run, in commit order, classed by stage.
CREATE VIEW rr.legs AS SELECT l.id,l.created_at,l.chain_seq,l.amount,l.club_id,l.from_type,l.from_entity_id,l.to_type,l.to_entity_id,l.category,l.idempotency_key,l.metadata,
 CASE WHEN l.from_type='system_mint' THEN 'seed' WHEN l.from_type='union_wallet' AND l.to_type='club_treasury' AND l.category='rakeback' THEN 'r1'
  WHEN l.from_type='union_wallet' THEN 'r1_retained' WHEN l.category='commission' THEN 'r2' WHEN l.metadata->>'cascade'='rakeback-funding-v1' THEN 'fund'
  WHEN l.category='rakeback' AND l.to_type='player_wallet' THEN 'r3' ELSE 'other' END AS stage
 FROM public.chip_ledger l;
-- The planner's model, computed from what the run recorded: per agent node of the week, own commission, what it
-- owes its players, its pass-through need (never netted across players), what flowed in and what it holds.
CREATE VIEW rr.nodes AS
WITH paid AS (SELECT l.club_id,l.from_entity_id payer,l.to_entity_id player,sum(l.amount) owed FROM rr.legs l WHERE l.stage='r3' AND l.from_type='agent_wallet' GROUP BY 1,2,3),
 cover AS (SELECT p.club_id,p.payer,p.player,p.owed,COALESCE((SELECT sum(ac.amount) FROM public.agent_commissions ac JOIN public.accounting_cash_rake_sources s ON s.id=ac.source_id
     WHERE ac.club_id=p.club_id AND ac.user_id=p.payer AND s.player_id=p.player AND s.earned_at>=rr.ws() AND s.earned_at<rr.we()),0) covered FROM paid p)
SELECT a.club_id,a.user_id,a.id agent_id,a.parent_agent_id,a.status,a.agent_wallet_balance wallet,
 COALESCE((SELECT sum(ac.amount) FROM public.agent_commissions ac WHERE ac.club_id=a.club_id AND ac.user_id=a.user_id AND ac.created_at>=rr.ws() AND ac.created_at<rr.we()),0) own,
 COALESCE((SELECT sum(c.owed) FROM cover c WHERE c.club_id=a.club_id AND c.payer=a.user_id),0) owed,
 COALESCE((SELECT sum(GREATEST(0,c.owed-c.covered)) FROM cover c WHERE c.club_id=a.club_id AND c.payer=a.user_id),0) passthrough,
 COALESCE((SELECT sum(l.amount) FROM rr.legs l WHERE l.stage IN('r2','fund') AND l.to_type='agent_wallet' AND l.to_entity_id=a.user_id AND l.club_id=a.club_id),0) inflow,
 COALESCE((SELECT sum(l.amount) FROM rr.legs l WHERE l.stage IN('r2','fund') AND l.from_type='agent_wallet' AND l.from_entity_id=a.user_id AND l.club_id=a.club_id),0) passed_down
FROM public.agents a;
-- A digest of everything the run can change, for the "second pass changes nothing" case.
CREATE FUNCTION rr.digest() RETURNS text LANGUAGE sql AS $$SELECT md5(jsonb_build_object(
 'clubs',(SELECT jsonb_agg(jsonb_build_array(id,chip_treasury) ORDER BY id) FROM public.clubs),
 'agents',(SELECT jsonb_agg(jsonb_build_array(id,status,agent_wallet_balance,business_balance,commission_rate) ORDER BY id) FROM public.agents),
 'members',(SELECT jsonb_agg(jsonb_build_array(club_id,user_id,chip_balance) ORDER BY club_id,user_id) FROM public.club_members),
 'union',(SELECT jsonb_agg(jsonb_build_array(union_id,rake_wallet,chip_balance) ORDER BY union_id) FROM public.union_wallets),
 'ledger',(SELECT jsonb_build_array(count(*),sum(amount),max(chain_seq)) FROM public.chip_ledger),
 'receipts',(SELECT jsonb_build_array(count(*),sum(net_amount)) FROM public.settlement_invoices),
 'payouts',(SELECT jsonb_build_array(count(*),sum(payout_amount)) FROM public.rakeback_period_payouts),
 'periods',(SELECT jsonb_agg(jsonb_build_array(id,status,rakeback_amount) ORDER BY id) FROM public.rakeback_periods),
 'certs',(SELECT jsonb_build_array(count(*),max(id)) FROM public.accounting_rakeback_period_calculations),
 'commissions',(SELECT jsonb_build_array(count(*),sum(amount),count(*) FILTER(WHERE settled_at IS NOT NULL)) FROM public.agent_commissions),
 'settlements',(SELECT jsonb_build_array(count(*),sum(amount)) FROM public.agent_commission_settlements),
 'routed',(SELECT jsonb_agg(jsonb_build_array(scope_id,round_no,md5(result::text)) ORDER BY scope_id,round_no) FROM public.accounting_routed_settlement_runs),
 'runs',(SELECT jsonb_agg(jsonb_build_array(run_id,phase,attempt_no,md5(result::text)) ORDER BY run_id) FROM public.weekly_accounting_payout_pauses),
 'round_receipts',(SELECT count(*) FROM smarter_private.weekly_payout_round_receipts),
 'financial',(SELECT count(*) FROM smarter_private.weekly_payout_financial_receipts),
 'union_rounds',(SELECT count(*) FROM public.union_settlement_rounds),
 'notifications',(SELECT count(*) FROM public.notifications))::text)$$;

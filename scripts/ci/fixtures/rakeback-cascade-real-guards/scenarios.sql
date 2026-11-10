-- Scenario builders for test-rakeback-cascade-real-guards-postgres.py (fixture only).
-- Every balance below moves through the production trigger stack: nothing here
-- sets session_replication_role, disables a trigger or writes a balance without
-- its chip_ledger leg.
CREATE SCHEMA rg;
-- FIXTURE CLOCK (declared deviation): agreements must be observed before the
-- settled week, and production stamps observed_at with clock_timestamp(). The
-- column default reads rg.clock when a builder sets it; the capture trigger
-- (fn_accounting_agreement_capture) and the immutability triggers are real.
ALTER TABLE public.accounting_agreement_history ALTER COLUMN observed_at SET DEFAULT COALESCE(NULLIF(current_setting('rg.clock',true),'')::timestamptz,clock_timestamp());
CREATE FUNCTION rg.u(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT md5('rg:'||$1)::uuid$$;
CREATE FUNCTION rg.ok(boolean,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1 IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %',$2; END IF;END$$;
CREATE FUNCTION rg.ws() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT public.fn_union_week_start('2026-11-04 12:00+00')$$;
CREATE FUNCTION rg.we() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT public.fn_union_week_start(rg.ws()+interval '8 days')$$;
-- MEMBER BASELINE (declared): production takes ca_chip_baseline in a baseline
-- job that is not loaded; every fixture membership opens at 0 and records it,
-- so the real fn_chip_drift_since_baseline measures every member here.
CREATE FUNCTION rg.baseline(p_club text,p_user text) RETURNS void LANGUAGE sql AS $$INSERT INTO public.ca_chip_baseline(club_id,user_id,opening_balance,ledger_at_baseline,unledgered_gap,taken_at) SELECT rg.u(p_club),rg.u(p_user),0,0,0,'2026-10-01' WHERE NOT EXISTS(SELECT 1 FROM public.ca_chip_baseline WHERE club_id=rg.u(p_club) AND user_id=rg.u(p_user))$$;
CREATE FUNCTION rg.person(p text) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO auth.users(id,email) VALUES(rg.u(p),p||'@fixture.invalid') ON CONFLICT DO NOTHING;
 INSERT INTO public.profiles(id,username,full_name) VALUES(rg.u(p),'u_'||replace(p,'.','_'),p) ON CONFLICT DO NOTHING;
 RETURN rg.u(p);END$$;
CREATE FUNCTION rg.onion(p text,p_min numeric DEFAULT 0.20) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM rg.person(p||'.boss');
 INSERT INTO public.unions(id,name,owner_id,slug,settings) VALUES(rg.u(p),'Union '||p,rg.u(p||'.boss'),'union-'||lower(p),jsonb_build_object('min_agent_commission',p_min,'max_agent_commission',1));
 INSERT INTO public.union_wallets(union_id) VALUES(rg.u(p));END$$;
CREATE FUNCTION rg.club(p text,p_union text DEFAULT 'U',p_owner text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$DECLARE o uuid:=CASE WHEN p_owner='' THEN NULL ELSE rg.person(COALESCE(p_owner,p||'.owner')) END;BEGIN
 PERFORM set_config('rg.clock','2026-10-20 12:00+00',true);
 IF NOT EXISTS(SELECT 1 FROM public.unions WHERE id=rg.u(p_union)) THEN PERFORM rg.onion(p_union); END IF;
 -- A production club opens with a minted opening bank (INSERT-only triggers, not wired); this one opens empty.
 INSERT INTO public.clubs(id,name,owner_id,union_id,chip_treasury) VALUES(rg.u(p),'Club '||p,o,rg.u(p_union),0);
 INSERT INTO public.union_clubs(union_id,club_id,joined_at) VALUES(rg.u(p_union),rg.u(p),'2026-09-01');
 IF o IS NOT NULL THEN INSERT INTO public.club_members(club_id,user_id,role,status) VALUES(rg.u(p),o,'owner','active'); PERFORM rg.baseline(p,COALESCE(p_owner,p||'.owner')); END IF;
 PERFORM set_config('rg.clock','',true);END$$;
CREATE FUNCTION rg.agent(p_club text,p_user text,p_parent text,p_rate numeric,p_at timestamptz DEFAULT '2026-10-20 12:00+00',p_role text DEFAULT 'agent') RETURNS void LANGUAGE plpgsql AS $$DECLARE par uuid;BEGIN
 PERFORM rg.person(p_user); PERFORM set_config('rg.clock',p_at::text,true);
 SELECT id INTO par FROM public.agents WHERE club_id=rg.u(p_club) AND user_id=rg.u(p_parent);
 IF p_parent IS NOT NULL AND par IS NULL THEN RAISE EXCEPTION 'fixture: parent % has no agents row',p_parent; END IF;
 INSERT INTO public.club_members(club_id,user_id,role,status) VALUES(rg.u(p_club),rg.u(p_user),p_role,'active') ON CONFLICT(club_id,user_id) DO NOTHING;
 INSERT INTO public.agents(user_id,club_id,role,status,parent_agent_id,commission_rate,player_rakeback_rate) VALUES(rg.u(p_user),rg.u(p_club),p_role,'active',par,p_rate,0)
  ON CONFLICT(club_id,user_id) DO UPDATE SET parent_agent_id=EXCLUDED.parent_agent_id,commission_rate=EXCLUDED.commission_rate;
 PERFORM rg.baseline(p_club,p_user); PERFORM set_config('rg.clock','',true);END$$;
CREATE FUNCTION rg.member(p_club text,p_player text,p_upline text,p_pct numeric,p_at timestamptz DEFAULT '2026-10-20 12:00+00') RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM rg.person(p_player); PERFORM set_config('rg.clock',p_at::text,true);
 INSERT INTO public.club_members(club_id,user_id,role,status,agent_id,player_rakeback_pct,player_rakeback_explicit) VALUES(rg.u(p_club),rg.u(p_player),'player','active',rg.u(p_upline),p_pct,true)
  ON CONFLICT(club_id,user_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,player_rakeback_pct=EXCLUDED.player_rakeback_pct,player_rakeback_explicit=true;
 PERFORM rg.baseline(p_club,p_player); PERFORM set_config('rg.clock','',true);END$$;
-- One earning source with its contract as the earning-time agreements read
-- (chip standard P4), plus the commission rows round 2 settles for those tiers.
CREATE FUNCTION rg.source(p_club text,p_player text,p_rake numeric,p_at timestamptz DEFAULT '2026-11-03 12:00+00',p_union text DEFAULT 'U') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE m record;h record;tiers jsonb:='[]'::jsonb;rem numeric:=p_rake;amt numeric;sid uuid:=gen_random_uuid();k text;depth int:=0;BEGIN
 SELECT x.id,x.after_terms INTO m FROM public.accounting_agreement_history x WHERE x.entity_type='club_members' AND x.entity_key=rg.u(p_club)::text||':'||rg.u(p_player)::text AND x.observed_at<=p_at ORDER BY x.observed_at DESC,x.id DESC LIMIT 1;
 IF m.id IS NULL THEN RAISE EXCEPTION 'fixture: no membership agreement for %',p_player; END IF;
 SELECT a.id::text INTO k FROM public.agents a WHERE a.club_id=rg.u(p_club) AND a.user_id=NULLIF(m.after_terms->>'agent_id','')::uuid;
 WHILE k IS NOT NULL AND depth<70 LOOP
  SELECT x.id,x.after_terms INTO h FROM public.accounting_agreement_history x WHERE x.entity_type='agents' AND x.entity_key=k AND x.observed_at<=p_at ORDER BY x.observed_at DESC,x.id DESC LIMIT 1;
  EXIT WHEN h.id IS NULL OR h.after_terms->>'status'<>'active';
  depth:=depth+1;amt:=round(rem*(h.after_terms->>'commission_rate')::numeric,2);rem:=rem-amt;
  tiers:=tiers||jsonb_build_array(jsonb_build_object('agent_id',h.after_terms->>'id','user_id',h.after_terms->>'user_id','depth',depth,'role','agent','rate',h.after_terms->>'commission_rate','amount',amt,'agreement',jsonb_build_object('history_id',h.id,'terms',h.after_terms)));
  IF amt>0 THEN INSERT INTO public.agent_commissions(source_type,source_id,club_id,user_id,amount,commission_rate,created_at) VALUES('cash_rake_accrual',sid,rg.u(p_club),(h.after_terms->>'user_id')::uuid,amt,(h.after_terms->>'commission_rate')::numeric,p_at); END IF;
  k:=NULLIF(h.after_terms->>'parent_agent_id','');
 END LOOP;
 INSERT INTO public.accounting_cash_rake_sources(id,rake_record_id,player_id,club_id,union_id,coordinator_union_id,earned_at,rake_credit,contract)
 VALUES(sid,gen_random_uuid(),rg.u(p_player),rg.u(p_club),rg.u(p_union),rg.u(p_union),p_at,p_rake,jsonb_build_object('club_id',rg.u(p_club),'is_union_house',false,'membership',jsonb_build_object('history_id',m.id,'terms',m.after_terms),'tiers',tiers));
 RETURN sid;END$$;
-- The certificate the weekly calculator would record for this player-week.
CREATE FUNCTION rg.certify(p_club text,p_player text,p_tag text DEFAULT 'v1',p_union text DEFAULT 'U') RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE alloc jsonb;pid uuid;cid bigint;gen numeric;unr numeric;kinds int;pk text;pu uuid;fp text;owner uuid;d1 date:=(rg.ws() AT TIME ZONE 'America/Los_Angeles')::date;BEGIN
 SELECT owner_id INTO owner FROM public.clubs WHERE id=rg.u(p_club);
 SELECT jsonb_agg(jsonb_build_object('source_type','cash_rake_accrual','source_id',s.id,'rake_record_id',s.rake_record_id,'rake_credit',s.rake_credit,'rate',(s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric,
   'unrounded_rakeback',s.rake_credit*(s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric,'payer_kind',CASE WHEN x.payer IS NULL THEN 'club' ELSE 'agent' END,'payer_user_id',x.payer,
   'membership_history_id',(s.contract#>>'{membership,history_id}')::bigint,'agent_history_id',CASE WHEN x.payer IS NOT NULL THEN(s.contract#>>'{tiers,0,agreement,history_id}')::bigint END,'earned_at',s.earned_at,'agreement_at',s.earned_at,
   'coordinator_union_id',s.coordinator_union_id,'union_id',s.union_id)
   -- a source earned as an agent directly under the owner at 0.70 is an own-agent-v1 allocation: the production reader decides, and its answer is the agreement
   ||CASE WHEN smarter_private.own_agent_destination_contract(s.contract,s.club_id,s.player_id,s.earned_at) IS NOT NULL THEN jsonb_build_object('destination_kind','agent_wallet','interpretation_version','own-agent-v1',
       'destination_agreement',smarter_private.own_agent_destination_contract(s.contract,s.club_id,s.player_id,s.earned_at)) ELSE '{}'::jsonb END ORDER BY s.earned_at,s.id)
 INTO alloc FROM public.accounting_cash_rake_sources s CROSS JOIN LATERAL(SELECT CASE WHEN(((s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=0.70 OR s.contract->'tiers'->0 IS NULL)
   AND owner=NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid) THEN NULL::uuid ELSE NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid END payer)x
 WHERE s.club_id=rg.u(p_club) AND s.player_id=rg.u(p_player);
 SELECT sum((a->>'rake_credit')::numeric),sum((a->>'rake_credit')::numeric*(a->>'rate')::numeric),count(DISTINCT COALESCE(a->>'payer_user_id','club')),min(a->>'payer_kind'),min(a->>'payer_user_id')::uuid INTO gen,unr,kinds,pk,pu FROM jsonb_array_elements(alloc)a;
 fp:=md5(jsonb_build_object('allocations',alloc,'rake',gen,'amount',round(unr,2),'rate',round(unr/gen,4))::text); -- the fingerprint ensure_rakeback_payer_contracts requires
 INSERT INTO public.rakeback_periods(user_id,club_id,period_start,period_end,rake_generated,total_rake_paid,rakeback_amount,rakeback_earned,rakeback_rate)
 VALUES(rg.u(p_player),rg.u(p_club),d1,d1+6,gen,gen,round(unr,2),round(unr,2),round(unr/gen,4))
 ON CONFLICT(user_id,club_id,period_start,period_end) DO UPDATE SET rake_generated=EXCLUDED.rake_generated,total_rake_paid=EXCLUDED.total_rake_paid,rakeback_amount=EXCLUDED.rakeback_amount,rakeback_earned=EXCLUDED.rakeback_earned,rakeback_rate=EXCLUDED.rakeback_rate RETURNING id INTO pid;
 INSERT INTO public.accounting_rakeback_period_calculations(period_id,source_fingerprint,club_id,player_id,coordinator_union_id,period_start,period_end,rake_generated,rakeback_amount,display_rate,payer_kind,payer_user_id,source_allocations)
 VALUES(pid,fp,rg.u(p_club),rg.u(p_player),rg.u(p_union),d1,d1+6,gen,round(unr,2),round(unr/gen,4),CASE WHEN kinds>1 THEN 'split' ELSE pk END,CASE WHEN kinds>1 THEN NULL ELSE pu END,alloc) RETURNING id INTO cid;
 RETURN cid;END$$;
-- OPENING CHIPS: the fixture is the house mint door here (fn_ca_fund_club is
-- not loaded). It writes the balance, its keyed leg and its register row, as
-- the real issuance guard (fn_ca_issuance_leg_is_registered) requires.
CREATE FUNCTION rg.open_union(p_union text,p_amount numeric) RETURNS void LANGUAGE plpgsql AS $$DECLARE b numeric;l uuid;BEGIN
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET rake_wallet=rake_wallet+p_amount WHERE union_id=rg.u(p_union) RETURNING rake_wallet INTO b;
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,union_id,description,idempotency_key,pre_to_balance,post_to_balance,to_label)
 VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','system_mint',NULL,'union_wallet',rg.u(p_union),p_amount,'mint',rg.u(p_union),'Fixture opening rake held by the union','fixture-open:'||p_union||':'||gen_random_uuid(),b-p_amount,b,'union_wallets.rake_wallet') RETURNING id INTO l;
 INSERT INTO public.ca_mint_ledger(op_id,action,asset,holder_type,holder_id,holder_label,amount,balance_before,balance_after,supply_after,reason,performed_by,chip_ledger_id)
 VALUES('fixture-open:'||l,'mint','chips','union',rg.u(p_union),p_union,p_amount,b-p_amount,b,p_amount,'Fixture opening rake held by the union','2d1cd6c3-5700-4af9-a271-d4863fdab20d',l);
 PERFORM set_config('app.ledger_autoskip_union_wallets','',true);END$$;
-- ROUND 1 as fn_union_weekly_rakeback_close writes it (statements copied; the
-- stage itself is not loaded): union rake wallet -> club bank under the union
-- close key, one paid receipt from the real receipt trigger.
CREATE FUNCTION rg.round1(p_share numeric DEFAULT 0.90,p_union text DEFAULT 'U') RETURNS void LANGUAGE plpgsql AS $$
DECLARE ws timestamptz:=rg.ws();we timestamptz:=rg.we();sid uuid;c record;b numeric;tot numeric;BEGIN
 SELECT COALESCE(sum(round(x.r*p_share,2)),0) INTO tot FROM(SELECT sum(s.rake_credit) r FROM public.accounting_cash_rake_sources s WHERE s.coordinator_union_id=rg.u(p_union) GROUP BY s.club_id)x;
 PERFORM rg.open_union(p_union,tot);
 INSERT INTO public.ca_settlements(settlement_type,external_ref,state,union_id) VALUES('union_rakeback_close',rg.u(p_union)::text||':'||to_char(ws AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(we AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'open',rg.u(p_union)) RETURNING id INTO sid;
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);PERFORM set_config('app.ledger_autoskip_clubs','1',true);
 FOR c IN SELECT s.club_id,round(sum(s.rake_credit)*p_share,2) amt FROM public.accounting_cash_rake_sources s WHERE s.coordinator_union_id=rg.u(p_union) GROUP BY 1 ORDER BY 1 LOOP
  UPDATE public.union_wallets SET rake_wallet=rake_wallet-c.amt WHERE union_id=rg.u(p_union);
  UPDATE public.clubs SET chip_treasury=chip_treasury+c.amt WHERE id=c.club_id RETURNING chip_treasury INTO b;
  INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,union_id,description,idempotency_key,metadata,pre_to_balance,post_to_balance,from_label)
  VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','union_wallet',rg.u(p_union),'club_treasury',c.club_id,c.amt,'rakeback',c.club_id,rg.u(p_union),'Union weekly rakeback from recorded earnings','union_close:'||sid::text||':'||c.club_id::text,
   jsonb_build_object('settlement_id',sid,'period_start',ws,'period_end',we,'accounting_version',3),b-c.amt,b,'union_wallets.rake_wallet');
 END LOOP;
 PERFORM set_config('app.ledger_autoskip_union_wallets','',true);PERFORM set_config('app.ledger_autoskip_clubs','',true);END$$;
-- ROUND 2 as fn_settle_accounting_commission_stage writes its legs (statements
-- copied; the stage itself is not loaded): each non-owner tier's commission
-- moves club bank -> agent wallet under the round 2 key; the owner tier stays.
CREATE FUNCTION rg.round2(p_union text DEFAULT 'U') RETURNS void LANGUAGE plpgsql AS $$
DECLARE ws timestamptz:=rg.ws();we timestamptz:=rg.we();n record;b numeric;w numeric;ctx text:=rg.u(p_union)::text||':'||rg.ws()::text||':'||rg.we()::text;BEGIN
 PERFORM set_config('app.accounting_routing_context',ctx,true);
 PERFORM set_config('app.ledger_autoskip_clubs','1',true);PERFORM set_config('app.ledger_autoskip_agents','1',true);
 FOR n IN SELECT ac.club_id,ac.user_id,sum(ac.amount) amt,(SELECT a.role FROM public.agents a WHERE a.club_id=ac.club_id AND a.user_id=ac.user_id) role FROM public.agent_commissions ac JOIN public.clubs cl ON cl.id=ac.club_id WHERE ac.settled_at IS NULL AND ac.user_id IS DISTINCT FROM cl.owner_id
   AND EXISTS(SELECT 1 FROM public.accounting_cash_rake_sources s WHERE s.id=ac.source_id AND s.coordinator_union_id=rg.u(p_union)) GROUP BY 1,2 ORDER BY 1,2 LOOP
  UPDATE public.clubs SET chip_treasury=chip_treasury-n.amt WHERE id=n.club_id AND chip_treasury>=n.amt RETURNING chip_treasury INTO b;
  UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+n.amt,updated_at=now() WHERE club_id=n.club_id AND user_id=n.user_id RETURNING agent_wallet_balance INTO w;
  INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,union_id,description,idempotency_key,metadata,pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
  VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','club_treasury',n.club_id,'agent_wallet',n.user_id,n.amt,'commission',n.club_id,rg.u(p_union),'Weekly commission through recorded earning hierarchy',
   'round2:v3:'||rg.u(p_union)::text||':'||extract(epoch FROM ws)::text||':'||extract(epoch FROM we)::text||':'||n.club_id::text||':club:'||n.user_id::text,
   jsonb_build_object('routing_version',3,'accounting_scope_kind','union','accounting_scope_id',rg.u(p_union),'period_start',ws,'period_end',we,'payee_role_at_transfer',n.role,'own_commission',n.amt),b+n.amt,b,w-n.amt,w);
 END LOOP;
 PERFORM set_config('app.ledger_autoskip_clubs','',true);PERFORM set_config('app.ledger_autoskip_agents','',true);PERFORM set_config('app.accounting_routing_context','',true);END$$;
-- The weekly run the runner books (weekly_payout_next_round's INSERT, same columns).
CREATE FUNCTION rg.book_run(p_union text DEFAULT 'U') RETURNS uuid LANGUAGE plpgsql AS $$DECLARE n timestamptz:=clock_timestamp();r uuid;BEGIN
 INSERT INTO public.weekly_accounting_payout_pauses(period_start,period_end,attempt_no,announced_at,money_starts_at,money_deadline_at,expires_at,scope_plan,phase,acknowledged_at,instance_id,lease_claims)
 VALUES(rg.ws(),rg.we(),1,date_trunc('second',n)-interval '2 minutes',date_trunc('second',n),n+interval '20 hours',n+interval '20 hours 1 minute',
  jsonb_build_array(jsonb_build_object('kind','union','id',rg.u(p_union),'period_start',rg.ws(),'period_end',rg.we())),'paying',n,'weekly-payout-rounds','[]'::jsonb) RETURNING run_id INTO r;
 RETURN r;END$$;
-- ONE ROUND 3 UNIT, statement for statement as weekly_payout_next_round runs it
-- (that function is not run: it is gated on the Monday wall clock and on week
-- preparation). Funding first, then the owned-transaction row, then round 3.
CREATE FUNCTION rg.tick3(p_union text DEFAULT 'U') RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;funding jsonb;res jsonb;BEGIN
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=rg.we() AND p.instance_id='weekly-payout-rounds' AND p.phase<>'released' ORDER BY p.attempt_no DESC LIMIT 1;
 PERFORM set_config('app.weekly_accounting_chunked','on',true);
 funding:=smarter_private.weekly_payout_fund_agent_shortfalls(r.run_id,'union',rg.u(p_union),rg.ws(),rg.we());
 INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no)
 VALUES(pg_backend_pid(),txid_current(),r.run_id,'union',rg.u(p_union),rg.ws(),rg.we(),3)
 ON CONFLICT(backend_pid,transaction_id) DO UPDATE SET run_id=EXCLUDED.run_id,scope_kind=EXCLUDED.scope_kind,scope_id=EXCLUDED.scope_id,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,round_no=EXCLUDED.round_no;
 res:=public.fn_settle_accounting_rakeback_stage('union',rg.u(p_union),rg.ws(),rg.we());
 IF res->>'success' IS DISTINCT FROM 'true' OR res->>'routing_version' IS DISTINCT FROM '3' OR res->>'source_version' IS DISTINCT FROM '2' OR COALESCE((res->>'shortfalls')::integer,0)<>0 OR res->>'batch_committed'='true'
  OR NOT EXISTS(SELECT FROM public.accounting_routed_settlement_runs x WHERE x.scope_kind='union' AND x.scope_id=rg.u(p_union) AND x.period_start=rg.ws() AND x.period_end=rg.we() AND x.round_no=3 AND x.result=(res-'duplicate'))
 THEN RAISE EXCEPTION 'weekly_payout_round_receipt_required %',left(res::text,1000); END IF;
 DELETE FROM smarter_private.weekly_payout_owned_transactions WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN jsonb_build_object('receipt',res,'funding',funding);END$$;
CREATE FUNCTION rg.money() RETURNS numeric LANGUAGE sql AS $$SELECT(SELECT COALESCE(sum(chip_treasury),0) FROM public.clubs)+(SELECT COALESCE(sum(agent_wallet_balance),0) FROM public.agents)+(SELECT COALESCE(sum(chip_balance),0) FROM public.club_members)+(SELECT COALESCE(sum(rake_wallet),0) FROM public.union_wallets)$$;
CREATE FUNCTION rg.wallet(p_club text,p_user text) RETURNS numeric LANGUAGE sql AS $$SELECT agent_wallet_balance FROM public.agents WHERE club_id=rg.u(p_club) AND user_id=rg.u(p_user)$$;
CREATE FUNCTION rg.chips(p_club text,p_user text) RETURNS numeric LANGUAGE sql AS $$SELECT chip_balance FROM public.club_members WHERE club_id=rg.u(p_club) AND user_id=rg.u(p_user)$$;
CREATE FUNCTION rg.bank(p_club text) RETURNS numeric LANGUAGE sql AS $$SELECT chip_treasury FROM public.clubs WHERE id=rg.u(p_club)$$;
CREATE FUNCTION rg.leg(p_club text,p_payer text,p_payee text) RETURNS numeric LANGUAGE sql AS $$SELECT amount FROM public.chip_ledger WHERE idempotency_key=smarter_private.rakeback_cascade_key(rg.u(p_club),(rg.ws() AT TIME ZONE 'America/Los_Angeles')::date,rg.u(p_payer),rg.u(p_payee))$$;
-- Round 3 alone inside its owned transaction (the unit without its funding
-- call), for a week settled before the cascade migration exists.
CREATE FUNCTION rg.tick3_round3_only(p_union text DEFAULT 'U') RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE;res jsonb;BEGIN
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=rg.we() AND p.instance_id='weekly-payout-rounds' AND p.phase<>'released' ORDER BY p.attempt_no DESC LIMIT 1;
 PERFORM set_config('app.weekly_accounting_chunked','on',true);
 INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no)
 VALUES(pg_backend_pid(),txid_current(),r.run_id,'union',rg.u(p_union),rg.ws(),rg.we(),3);
 res:=public.fn_settle_accounting_rakeback_stage('union',rg.u(p_union),rg.ws(),rg.we());
 IF res->>'success' IS DISTINCT FROM 'true' OR COALESCE((res->>'shortfalls')::integer,0)<>0 THEN RAISE EXCEPTION 'fixture: round 3 refused %',left(res::text,800); END IF;
 DELETE FROM smarter_private.weekly_payout_owned_transactions WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN res;END$$;
-- A player becomes an agent directly under the owner on the own-agent 0.70 deal.
CREATE FUNCTION rg.promote(p_club text,p_user text,p_rate numeric,p_at timestamptz) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM set_config('rg.clock',p_at::text,true);
 UPDATE public.club_members SET role='agent',player_rakeback_pct=0.70,player_rakeback_explicit=true WHERE club_id=rg.u(p_club) AND user_id=rg.u(p_user);
 INSERT INTO public.agents(user_id,club_id,role,status,commission_rate,player_rakeback_rate) VALUES(rg.u(p_user),rg.u(p_club),'agent','active',p_rate,0);
 PERFORM set_config('rg.clock','',true);END$$;
-- SCALE BOARD (--scale): three clubs shaped like production week 2026-11-02
-- (owner upline with an owner row, owner upline with none, a zero-percent
-- agent), p_players player-weeks of p_allocs allocations each, written
-- set-based. Memberships and agents still pass the real trigger stack;
-- certificates still pass the real certificate triggers.
CREATE FUNCTION rg.bulk(p_players int,p_allocs int) RETURNS void LANGUAGE plpgsql AS $$DECLARE d1 date:=(rg.ws() AT TIME ZONE 'America/Los_Angeles')::date;BEGIN
 PERFORM rg.onion('U',0);PERFORM rg.club('BA');PERFORM rg.club('BB');PERFORM rg.club('BK');
 PERFORM rg.agent('BA','BA.owner',NULL,0.20,'2026-10-20 12:00+00','super_agent');PERFORM rg.agent('BK','BKA',NULL,0);
 CREATE TEMP TABLE _p ON COMMIT DROP AS SELECT i,'bp'||i AS name,rg.u('bp'||i) AS id,CASE WHEN i%5 IN(0,1) THEN 'BA' WHEN i%5 IN(2,3) THEN 'BB' ELSE 'BK' END AS club,
   CASE WHEN i%5 IN(0,1) THEN 0.70 WHEN i%5 IN(2,3) THEN 0.30 ELSE 0.30 END AS pct FROM generate_series(1,p_players)i;
 INSERT INTO auth.users(id,email) SELECT id,name||'@fixture.invalid' FROM _p;
 INSERT INTO public.profiles(id,username,full_name) SELECT id,'u_'||name,name FROM _p;
 PERFORM set_config('rg.clock','2026-10-20 12:00+00',true);
 INSERT INTO public.club_members(club_id,user_id,role,status,agent_id,player_rakeback_pct,player_rakeback_explicit)
  SELECT rg.u(club),id,'player','active',CASE club WHEN 'BK' THEN rg.u('BKA') ELSE rg.u(club||'.owner') END,pct,true FROM _p;
 PERFORM set_config('rg.clock','',true);
 INSERT INTO public.ca_chip_baseline(club_id,user_id,opening_balance,ledger_at_baseline,unledgered_gap,taken_at) SELECT rg.u(club),id,0,0,0,'2026-10-01' FROM _p;
 CREATE TEMP TABLE _s ON COMMIT DROP AS SELECT gen_random_uuid() sid,gen_random_uuid() rid,p.id player,p.club,p.pct,round(0.50+(n%7)*0.25,2) rake,'2026-11-02 09:00+00'::timestamptz+make_interval(secs=>(n*400)%590000) AS at,
   (SELECT h.id FROM public.accounting_agreement_history h WHERE h.entity_type='club_members' AND h.entity_key=rg.u(p.club)::text||':'||p.id::text ORDER BY h.id DESC LIMIT 1) AS mh
  FROM _p p CROSS JOIN generate_series(1,p_allocs)n;
 INSERT INTO public.accounting_cash_rake_sources(id,rake_record_id,player_id,club_id,union_id,coordinator_union_id,earned_at,rake_credit,contract)
  SELECT sid,rid,player,rg.u(club),rg.u('U'),rg.u('U'),at,rake,jsonb_build_object('club_id',rg.u(club),'is_union_house',false,
   'membership',jsonb_build_object('history_id',mh,'terms',jsonb_build_object('club_id',rg.u(club),'user_id',player,'agent_id',CASE club WHEN 'BK' THEN rg.u('BKA') ELSE rg.u(club||'.owner') END,'player_rakeback_pct',pct,'role','player','status','active')),
   'tiers',CASE club WHEN 'BK' THEN jsonb_build_array(jsonb_build_object('user_id',rg.u('BKA'),'depth',1,'rate',0,'amount',0)) ELSE '[]'::jsonb END) FROM _s;
 CREATE TEMP TABLE _c ON COMMIT DROP AS SELECT s.player,s.club,sum(s.rake) gen,sum(s.rake*s.pct) unr,
   jsonb_agg(jsonb_build_object('source_type','cash_rake_accrual','source_id',s.sid,'rake_record_id',s.rid,'rake_credit',s.rake,'rate',s.pct,'unrounded_rakeback',s.rake*s.pct,
    'payer_kind',CASE s.club WHEN 'BK' THEN 'agent' ELSE 'club' END,'payer_user_id',CASE s.club WHEN 'BK' THEN rg.u('BKA') END,'membership_history_id',s.mh,
    'agent_history_id',CASE s.club WHEN 'BK' THEN(SELECT h.id FROM public.accounting_agreement_history h WHERE h.entity_type='agents' AND h.subject_user_id=rg.u('BKA') ORDER BY h.id DESC LIMIT 1) END,
    'earned_at',s.at,'agreement_at',s.at,'coordinator_union_id',rg.u('U'),'union_id',rg.u('U')) ORDER BY s.at,s.sid) AS alloc FROM _s s GROUP BY s.player,s.club;
 INSERT INTO public.rakeback_periods(user_id,club_id,period_start,period_end,rake_generated,total_rake_paid,rakeback_amount,rakeback_earned,rakeback_rate)
  SELECT player,rg.u(club),d1,d1+6,gen,gen,round(unr,2),round(unr,2),round(unr/gen,4) FROM _c;
 INSERT INTO public.accounting_rakeback_period_calculations(period_id,source_fingerprint,club_id,player_id,coordinator_union_id,period_start,period_end,rake_generated,rakeback_amount,display_rate,payer_kind,payer_user_id,source_allocations)
  SELECT rp.id,md5(jsonb_build_object('allocations',c.alloc,'rake',c.gen,'amount',round(c.unr,2),'rate',round(c.unr/c.gen,4))::text),rg.u(c.club),c.player,rg.u('U'),d1,d1+6,c.gen,round(c.unr,2),round(c.unr/c.gen,4),
   CASE c.club WHEN 'BK' THEN 'agent' ELSE 'club' END,CASE c.club WHEN 'BK' THEN rg.u('BKA') END,c.alloc
  FROM _c c JOIN public.rakeback_periods rp ON rp.user_id=c.player AND rp.club_id=rg.u(c.club) AND rp.period_start=d1;
END$$;

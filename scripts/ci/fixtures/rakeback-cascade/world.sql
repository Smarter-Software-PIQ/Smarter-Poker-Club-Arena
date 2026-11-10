-- Fixture world for scripts/ci/test-rakeback-cascade-funding-postgres.py.
-- Tables carry only the columns the loaded production definitions read or
-- write. Everything in the "STAND-IN" section replaces a production object
-- this fixture does not load; the harness header lists each one.
SET check_function_bodies=off;
CREATE SCHEMA smarter_private; CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;
CREATE TABLE public.unions(id uuid PRIMARY KEY);
CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text,owner_id uuid,chip_treasury numeric NOT NULL DEFAULT 0 CHECK(chip_treasury>=0),updated_at timestamptz DEFAULT now());
CREATE TABLE public.profiles(id uuid PRIMARY KEY,status text DEFAULT 'active');
CREATE TABLE public.club_members(club_id uuid,user_id uuid,chip_balance numeric NOT NULL DEFAULT 0,held_chips numeric DEFAULT 0,locked_chips numeric DEFAULT 0,role text DEFAULT 'player',status text DEFAULT 'active',agent_id uuid,updated_at timestamptz DEFAULT now(),PRIMARY KEY(club_id,user_id));
CREATE TABLE public.agents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,club_id uuid NOT NULL,role text DEFAULT 'agent',status text NOT NULL DEFAULT 'active',parent_agent_id uuid,commission_rate numeric(5,4) DEFAULT 0,
 agent_wallet_balance numeric(18,2) NOT NULL DEFAULT 0 CHECK(agent_wallet_balance>=0),updated_at timestamptz DEFAULT now(),UNIQUE(club_id,user_id));
CREATE TABLE public.accounting_agreement_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity_type text,entity_key text,club_id uuid,subject_user_id uuid,observed_at timestamptz,transaction_id bigint DEFAULT txid_current(),after_terms jsonb);
CREATE INDEX ON public.accounting_agreement_history(entity_type,entity_key,observed_at,id);
CREATE TABLE public.accounting_cash_rake_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rake_record_id uuid DEFAULT gen_random_uuid(),player_id uuid,club_id uuid,union_id uuid,coordinator_union_id uuid,earned_at timestamptz,rake_credit numeric,contract jsonb);
CREATE TABLE public.accounting_tournament_fee_sources(id uuid PRIMARY KEY,club_id uuid,coordinator_union_id uuid);
CREATE TABLE public.union_clubs(union_id uuid,club_id uuid,joined_at timestamptz);
CREATE TABLE public.agent_commissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_type text,source_id uuid,club_id uuid,user_id uuid,amount numeric,commission_rate numeric,settled_at timestamptz,created_at timestamptz);
CREATE INDEX ON public.agent_commissions(source_id,source_type);
CREATE TABLE public.rakeback_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,club_id uuid,period_start date,period_end date,rake_generated numeric(15,2),rakeback_rate numeric(5,4),rakeback_amount numeric(15,2),status text DEFAULT 'pending',paid_at timestamptz,rakeback_earned numeric(15,2),total_rake_paid numeric(15,2),UNIQUE(user_id,club_id,period_start,period_end));
CREATE TABLE public.accounting_rakeback_period_calculations(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,period_id uuid,accounting_version int DEFAULT 2,source_fingerprint text,club_id uuid,player_id uuid,coordinator_union_id uuid,period_start date,period_end date,
 rake_generated numeric,rakeback_amount numeric,display_rate numeric,payer_kind text,payer_user_id uuid,source_allocations jsonb,recorded_at timestamptz DEFAULT now(),UNIQUE(period_id,source_fingerprint));
CREATE TABLE public.accounting_rakeback_payer_contracts(calculation_id bigint,payer_kind text,payer_entity_id uuid,payer_user_id uuid,amount numeric,unrounded numeric,rake numeric,source_count bigint,source_fingerprint text,PRIMARY KEY(calculation_id,payer_kind,payer_entity_id));
CREATE TABLE public.accounting_rakeback_wallet_contracts(calculation_id bigint,payer_kind text,payer_entity_id uuid,payer_user_id uuid,destination_kind text,amount numeric,unrounded numeric,rake numeric,source_count bigint,source_fingerprint text,PRIMARY KEY(calculation_id,payer_kind,payer_entity_id,destination_kind));
CREATE TABLE public.rakeback_period_payouts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rakeback_period_id uuid,club_id uuid,user_id uuid,user_rake_contribution numeric(20,4),rakeback_pct numeric(5,2),payout_amount numeric(20,4),wallet_transaction_id uuid,status text,paid_at timestamptz,UNIQUE(rakeback_period_id,user_id));
CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,wallet_type text,amount numeric(15,2),type text,category text,description text,related_entity_id uuid,balance_after numeric,created_at timestamptz DEFAULT now());
CREATE TABLE public.chip_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),performed_by uuid,from_type text,from_entity_id uuid,to_type text,to_entity_id uuid,amount numeric CHECK(amount>0 AND amount=round(amount,2)),category text,club_id uuid,union_id uuid,description text,
 idempotency_key text,metadata jsonb DEFAULT '{}',pre_from_balance numeric,post_from_balance numeric,pre_to_balance numeric,post_to_balance numeric,from_label text,to_label text,status text DEFAULT 'posted',created_at timestamptz DEFAULT clock_timestamp(),
 CONSTRAINT chip_ledger_category_check CHECK(category IN('commission','rakeback','club_bank_send','agent_send','union_settlement')));
CREATE UNIQUE INDEX ux_chip_ledger_idempotency_key ON public.chip_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE public.settlement_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,invoice_type text,gross_amount numeric(12,2),net_amount numeric(12,2),deductions numeric(12,2),status text,chips_transferred boolean,message_sent boolean,source_ledger_id uuid UNIQUE);
CREATE TABLE public.accounting_rakeback_wallet_transfers(payout_id uuid,calculation_id bigint,period_id uuid,payer_kind text,payer_entity_id uuid,destination_kind text,amount numeric,ledger_id uuid UNIQUE,wallet_transaction_id uuid UNIQUE,PRIMARY KEY(payout_id,payer_kind,payer_entity_id,destination_kind));
CREATE TABLE public.accounting_rakeback_payer_transfers(payout_id uuid,calculation_id bigint,period_id uuid,payer_kind text,payer_entity_id uuid,amount numeric,ledger_id uuid UNIQUE,wallet_transaction_id uuid UNIQUE,PRIMARY KEY(payout_id,payer_kind,payer_entity_id));
CREATE TABLE public.accounting_routed_settlement_runs(union_id uuid,period_start timestamptz,period_end timestamptz,round_no int,routing_version int DEFAULT 3,source_fingerprint text,result jsonb,completed_at timestamptz DEFAULT now(),standalone_club_id uuid,
 scope_kind text GENERATED ALWAYS AS(CASE WHEN union_id IS NOT NULL THEN 'union' ELSE 'club' END) STORED,scope_id uuid GENERATED ALWAYS AS(COALESCE(union_id,standalone_club_id)) STORED,UNIQUE(scope_kind,scope_id,period_start,period_end,round_no));
CREATE TABLE public.settlement_locks(lock_type text,is_active boolean);
CREATE TABLE public.union_settlement_floor(union_id uuid,earliest_period_start timestamptz);
CREATE TABLE public.accounting_cash_accrual_cutover(singleton boolean PRIMARY KEY,starts_at timestamptz);
INSERT INTO public.accounting_cash_accrual_cutover VALUES(true,'2026-09-01');
CREATE TABLE public.union_settlement_rounds(union_id uuid,period_start timestamptz,period_end timestamptz,round_no int,amount numeric,payees int,shortfalls int);
CREATE TABLE public.ca_settlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),settlement_type text,external_ref text,state text,union_id uuid);
CREATE TABLE public.ca_horse_club_split_late_returns(club_id uuid,horse_id uuid,amount numeric);
CREATE TABLE smarter_private.existing_rakeback_transfer_allocations(obligation_role text,obligation_id uuid,club_id uuid,beneficiary_id uuid,period_start timestamptz,period_end timestamptz,amount numeric,reimbursement_ledger_id uuid);
CREATE TABLE smarter_private.existing_rakeback_transfer_instructions(club_id uuid,beneficiary_id uuid,period_start timestamptz,period_end timestamptz,roles text[]);
-- STAND-IN: the production view over effective cash and tournament sources.
CREATE VIEW public.accounting_payable_earning_sources AS SELECT 'cash_rake_accrual'::text source_type,s.id source_id,s.rake_record_id,NULL::uuid tournament_id,s.player_id,s.club_id,s.union_id,s.coordinator_union_id,s.earned_at,s.rake_credit,s.contract FROM public.accounting_cash_rake_sources s;
-- STAND-IN: fn_invoice_accounting_ledger_transfer (one paid receipt per posted wallet leg).
CREATE FUNCTION public.rc_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('rc.no_receipt',true)='1' AND NEW.metadata->>'cascade'='rakeback-funding-v1' THEN RETURN NEW; END IF;
 INSERT INTO public.settlement_invoices(club_id,invoice_type,gross_amount,net_amount,deductions,status,chips_transferred,message_sent,source_ledger_id)
 VALUES(NEW.club_id,NEW.category,NEW.amount,NEW.amount,0,'paid',true,true,NEW.id);RETURN NEW;END$$;
CREATE TRIGGER accounting_transfer_document AFTER INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION public.rc_receipt();
-- STAND-INS: platform boundaries round 3 calls and this change does not touch.
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fn_ca_launch_accounting_waived(text,uuid,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.fn_accounting_union_earned_plan(uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION smarter_private.assert_own_agent_scope_interpreted(text,uuid,timestamptz,timestamptz,int) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.fn_lock_rakeback_payer_clubs(uuid[]) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.fn_settle_accounting_rakeback_plan_get(text,uuid,timestamptz,timestamptz,uuid[],uuid,uuid,boolean) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
CREATE FUNCTION public.fn_standalone_foreign_certificate_periods(text,uuid,date,date,timestamptz,timestamptz) RETURNS TABLE(period_id uuid) LANGUAGE sql AS $$SELECT NULL::uuid WHERE false$$;
CREATE FUNCTION smarter_private.existing_rakeback_transfer_complete(text,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION smarter_private.apply_existing_rakeback_transfer(text,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid,bigint) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
CREATE FUNCTION smarter_private.existing_rakeback_transfer_scope_economic_plan(text,uuid,timestamptz,timestamptz,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$;
CREATE FUNCTION smarter_private.existing_rakeback_transfer_scope_receipts(text,uuid,timestamptz,timestamptz,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$;
CREATE FUNCTION smarter_private.preserve_historical_rakeback_wallet(uuid,bigint,timestamptz,timestamptz) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture: departed member not modelled';END$$;
CREATE FUNCTION public.fn_ca_deleted_wallet_bank_return(uuid,uuid,text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture: deleted account not modelled';END$$;
CREATE FUNCTION smarter_private.weekly_payout_require_round(text,uuid,timestamptz,timestamptz,int) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION smarter_private.weekly_payout_owns_round(text,uuid,timestamptz,timestamptz,int) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION smarter_private.deleted_reserve_certificate_payers(p_calculation bigint) RETURNS TABLE(payer_kind text,payer_user uuid,payer_entity uuid,owed numeric) LANGUAGE sql STABLE AS $$SELECT * FROM smarter_private.rakeback_certificate_payers(p_calculation)$$;
-- STAND-IN for lane A's door (20261109231325): returns the owner's agents row,
-- creating a wallet_only row at rate 0 when the owner has none, never altering one.
CREATE FUNCTION smarter_private.ensure_owner_routing_wallet(p_club_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$DECLARE o uuid;a uuid;BEGIN
 SELECT owner_id INTO o FROM public.clubs WHERE id=p_club_id; IF o IS NULL THEN RETURN NULL; END IF;
 SELECT id INTO a FROM public.agents WHERE club_id=p_club_id AND user_id=o;
 IF a IS NULL THEN INSERT INTO public.agents(user_id,club_id,role,status,commission_rate) VALUES(o,p_club_id,'agent','wallet_only',0) RETURNING id INTO a; END IF;
 RETURN a;END$$;

-- ===== scenario builders (fixture only) =====
CREATE FUNCTION public.rc_u(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT md5('rc:'||$1)::uuid$$;
CREATE FUNCTION public.rc_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1 IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %',$2; END IF;END$$;
CREATE FUNCTION public.rc_club(p text,p_union text DEFAULT 'U',p_owner text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.unions VALUES(rc_u(p_union)) ON CONFLICT DO NOTHING;
 INSERT INTO public.clubs(id,name,owner_id) VALUES(rc_u(p),p,CASE WHEN p_owner='' THEN NULL ELSE rc_u(COALESCE(p_owner,p||'.owner')) END);
 INSERT INTO public.union_clubs VALUES(rc_u(p_union),rc_u(p),'2026-09-01');
 IF p_owner IS DISTINCT FROM '' THEN INSERT INTO public.club_members(club_id,user_id,role) VALUES(rc_u(p),rc_u(COALESCE(p_owner,p||'.owner')),'owner'); END IF;END$$;
-- An agents row (or a change to it) recorded in the agreement history at p_at.
CREATE FUNCTION public.rc_agent(p_club text,p_user text,p_parent text,p_rate numeric,p_at timestamptz DEFAULT '2026-09-15',p_status text DEFAULT 'active') RETURNS void LANGUAGE plpgsql AS $$DECLARE a public.agents%ROWTYPE;par uuid;BEGIN
 SELECT id INTO par FROM public.agents WHERE club_id=rc_u(p_club) AND user_id=rc_u(p_parent);
 IF p_parent IS NOT NULL AND par IS NULL THEN par:=rc_u('agentrow:'||p_club||':'||p_parent); END IF;
 INSERT INTO public.agents(id,user_id,club_id,parent_agent_id,commission_rate,status) VALUES(rc_u('agentrow:'||p_club||':'||p_user),rc_u(p_user),rc_u(p_club),par,p_rate,p_status)
  ON CONFLICT(club_id,user_id) DO UPDATE SET parent_agent_id=EXCLUDED.parent_agent_id,commission_rate=EXCLUDED.commission_rate,status=EXCLUDED.status RETURNING * INTO a;
 INSERT INTO public.club_members(club_id,user_id,role) VALUES(a.club_id,a.user_id,'agent') ON CONFLICT DO NOTHING;
 INSERT INTO public.accounting_agreement_history(entity_type,entity_key,club_id,subject_user_id,observed_at,transaction_id,after_terms)
 VALUES('agents',a.id::text,a.club_id,a.user_id,p_at,nextval('rc_tx'),jsonb_build_object('id',a.id,'user_id',a.user_id,'club_id',a.club_id,'parent_agent_id',a.parent_agent_id,'commission_rate',a.commission_rate,'status',a.status,'role',a.role));END$$;
CREATE SEQUENCE public.rc_tx START 1000;
CREATE FUNCTION public.rc_member(p_club text,p_player text,p_upline text,p_pct numeric,p_at timestamptz DEFAULT '2026-09-15') RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO public.club_members(club_id,user_id,agent_id) VALUES(rc_u(p_club),rc_u(p_player),rc_u(p_upline)) ON CONFLICT(club_id,user_id) DO UPDATE SET agent_id=EXCLUDED.agent_id;
 INSERT INTO public.accounting_agreement_history(entity_type,entity_key,club_id,subject_user_id,observed_at,transaction_id,after_terms)
 VALUES('club_members',rc_u(p_club)::text||':'||rc_u(p_player)::text,rc_u(p_club),rc_u(p_player),p_at,nextval('rc_tx'),jsonb_build_object('club_id',rc_u(p_club),'user_id',rc_u(p_player),'agent_id',rc_u(p_upline),'player_rakeback_pct',p_pct,'status','active'));END$$;
-- One earning source with its contract as the earning-time agreements read
-- (chip standard P4: a tier's rate applies to the rake left after the tiers
-- below it), plus the commission rows round 2 settles for those tiers.
CREATE FUNCTION public.rc_source(p_club text,p_player text,p_rake numeric,p_at timestamptz DEFAULT '2026-10-06 12:00+00',p_union text DEFAULT 'U') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE m record;h record;tiers jsonb:='[]'::jsonb;rem numeric:=p_rake;amt numeric;sid uuid:=gen_random_uuid();k text;depth int:=0;owner uuid;BEGIN
 SELECT owner_id INTO owner FROM public.clubs WHERE id=rc_u(p_club);
 SELECT x.id,x.after_terms INTO m FROM public.accounting_agreement_history x WHERE x.entity_type='club_members' AND x.entity_key=rc_u(p_club)::text||':'||rc_u(p_player)::text AND x.observed_at<=p_at ORDER BY x.observed_at DESC,x.id DESC LIMIT 1;
 SELECT a.id::text INTO k FROM public.agents a WHERE a.club_id=rc_u(p_club) AND a.user_id=NULLIF(m.after_terms->>'agent_id','')::uuid;
 WHILE k IS NOT NULL AND depth<70 LOOP
  SELECT x.id,x.after_terms INTO h FROM public.accounting_agreement_history x WHERE x.entity_type='agents' AND x.entity_key=k AND x.observed_at<=p_at ORDER BY x.observed_at DESC,x.id DESC LIMIT 1;
  EXIT WHEN h.id IS NULL OR h.after_terms->>'status'<>'active';
  depth:=depth+1;amt:=round(rem*(h.after_terms->>'commission_rate')::numeric,2);rem:=rem-amt;
  tiers:=tiers||jsonb_build_array(jsonb_build_object('agent_id',h.after_terms->>'id','user_id',h.after_terms->>'user_id','depth',depth,'role','agent','rate',h.after_terms->>'commission_rate','amount',amt,'agreement',jsonb_build_object('history_id',h.id,'terms',h.after_terms)));
  IF amt>0 THEN INSERT INTO public.agent_commissions(source_type,source_id,club_id,user_id,amount,commission_rate,created_at) VALUES('cash_rake_accrual',sid,rc_u(p_club),(h.after_terms->>'user_id')::uuid,amt,(h.after_terms->>'commission_rate')::numeric,p_at); END IF;
  k:=NULLIF(h.after_terms->>'parent_agent_id','');
 END LOOP;
 INSERT INTO public.accounting_cash_rake_sources(id,player_id,club_id,union_id,coordinator_union_id,earned_at,rake_credit,contract)
 VALUES(sid,rc_u(p_player),rc_u(p_club),rc_u(p_union),rc_u(p_union),p_at,p_rake,jsonb_build_object('club_id',rc_u(p_club),'is_union_house',false,'membership',jsonb_build_object('history_id',m.id,'terms',m.after_terms),'tiers',tiers));
 RETURN sid;END$$;
-- The certificate the weekly calculator would record for this player-week,
-- built from the sources by round 3's own payer rule.
CREATE FUNCTION public.rc_certify(p_club text,p_player text,p_tag text DEFAULT 'v1',p_union text DEFAULT 'U') RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE alloc jsonb;pid uuid;cid bigint;gen numeric;unr numeric;kinds int;pk text;pu uuid;plan jsonb;fp text;owner uuid;BEGIN
 SELECT owner_id INTO owner FROM public.clubs WHERE id=rc_u(p_club);
 SELECT jsonb_agg(jsonb_build_object('source_type','cash_rake_accrual','source_id',s.id,'rake_record_id',s.rake_record_id,'rake_credit',s.rake_credit,'rate',(s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric,
   'unrounded_rakeback',s.rake_credit*(s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric,'payer_kind',CASE WHEN x.payer IS NULL THEN 'club' ELSE 'agent' END,'payer_user_id',x.payer,
   'membership_history_id',(s.contract#>>'{membership,history_id}')::bigint,'agent_history_id',CASE WHEN x.payer IS NOT NULL THEN(s.contract#>>'{tiers,0,agreement,history_id}')::bigint END,'earned_at',s.earned_at,'agreement_at',s.earned_at,
   'coordinator_union_id',s.coordinator_union_id,'union_id',s.union_id) ORDER BY s.earned_at,s.id)
 INTO alloc FROM public.accounting_cash_rake_sources s CROSS JOIN LATERAL(SELECT CASE WHEN(((s.contract#>>'{membership,terms,player_rakeback_pct}')::numeric=0.70 OR s.contract->'tiers'->0 IS NULL)
   AND owner=NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid) THEN NULL::uuid ELSE NULLIF(s.contract#>>'{membership,terms,agent_id}','')::uuid END payer)x
 WHERE s.club_id=rc_u(p_club) AND s.player_id=rc_u(p_player);
 SELECT sum((a->>'rake_credit')::numeric),sum((a->>'rake_credit')::numeric*(a->>'rate')::numeric),count(DISTINCT COALESCE(a->>'payer_user_id','club')),min(a->>'payer_kind'),min(a->>'payer_user_id')::uuid INTO gen,unr,kinds,pk,pu FROM jsonb_array_elements(alloc)a;
 fp:=md5(alloc::text||p_tag);
 INSERT INTO public.rakeback_periods(user_id,club_id,period_start,period_end,rake_generated,total_rake_paid,rakeback_amount,rakeback_earned,rakeback_rate)
 VALUES(rc_u(p_player),rc_u(p_club),'2026-10-05','2026-10-11',gen,gen,round(unr,2),round(unr,2),round(unr/gen,4))
 ON CONFLICT(user_id,club_id,period_start,period_end) DO UPDATE SET rake_generated=EXCLUDED.rake_generated,total_rake_paid=EXCLUDED.total_rake_paid,rakeback_amount=EXCLUDED.rakeback_amount,rakeback_earned=EXCLUDED.rakeback_earned,rakeback_rate=EXCLUDED.rakeback_rate RETURNING id INTO pid;
 INSERT INTO public.accounting_rakeback_period_calculations(period_id,source_fingerprint,club_id,player_id,coordinator_union_id,period_start,period_end,rake_generated,rakeback_amount,display_rate,payer_kind,payer_user_id,source_allocations)
 VALUES(pid,fp,rc_u(p_club),rc_u(p_player),rc_u(p_union),'2026-10-05','2026-10-11',gen,round(unr,2),round(unr/gen,4),CASE WHEN kinds>1 THEN 'split' ELSE pk END,CASE WHEN kinds>1 THEN NULL ELSE pu END,alloc) RETURNING id INTO cid;
 IF kinds>1 THEN
  plan:=smarter_private.rakeback_payer_plan(alloc,round(unr,2));
  INSERT INTO public.accounting_rakeback_payer_contracts SELECT cid,p->>'payer_kind',COALESCE(NULLIF(p->>'payer_user_id','')::uuid,rc_u(p_club)),NULLIF(p->>'payer_user_id','')::uuid,(p->>'amount')::numeric,(p->>'unrounded')::numeric,(p->>'rake')::numeric,(p->>'source_count')::bigint,fp FROM jsonb_array_elements(plan)p;
 END IF;
 RETURN cid;END$$;
-- STAND-INS for rounds 1 and 2 (neither is changed or loaded here): the club
-- bank receives p_share of the week's rake under the union close key, and
-- each non-owner tier's commission moves bank -> agent wallet under the
-- round 2 key; the owner's tier stays in the bank (Dan 2026-10-22).
CREATE FUNCTION public.rc_rounds_1_2(p_share numeric DEFAULT 0.90,p_union text DEFAULT 'U') RETURNS void LANGUAGE plpgsql AS $$
DECLARE ws timestamptz:=public.fn_union_week_start('2026-10-06 12:00+00');we timestamptz;sid uuid;c record;n record;b numeric;w numeric;BEGIN
 we:=public.fn_union_week_start(ws+interval '8 days');
 INSERT INTO public.ca_settlements(settlement_type,external_ref,state,union_id) VALUES('union_rakeback_close',rc_u(p_union)::text||':'||to_char(ws AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(we AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'final',rc_u(p_union)) RETURNING id INTO sid;
 FOR c IN SELECT s.club_id,round(sum(s.rake_credit)*p_share,2) amt FROM public.accounting_cash_rake_sources s WHERE s.coordinator_union_id=rc_u(p_union) GROUP BY 1 LOOP
  UPDATE public.clubs SET chip_treasury=chip_treasury+c.amt WHERE id=c.club_id RETURNING chip_treasury INTO b;
  INSERT INTO public.chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,union_id,idempotency_key,pre_to_balance,post_to_balance)
  VALUES('union_wallet',rc_u(p_union),'club_treasury',c.club_id,c.amt,'rakeback',c.club_id,rc_u(p_union),'union_close:'||sid::text||':'||c.club_id::text,b-c.amt,b);
 END LOOP;
 FOR n IN SELECT ac.club_id,ac.user_id,sum(ac.amount) amt FROM public.agent_commissions ac JOIN public.clubs cl ON cl.id=ac.club_id WHERE ac.settled_at IS NULL AND ac.user_id IS DISTINCT FROM cl.owner_id
   AND EXISTS(SELECT 1 FROM public.accounting_cash_rake_sources s WHERE s.id=ac.source_id AND s.coordinator_union_id=rc_u(p_union)) GROUP BY 1,2 LOOP
  UPDATE public.clubs SET chip_treasury=chip_treasury-n.amt WHERE id=n.club_id RETURNING chip_treasury INTO b;
  UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+n.amt WHERE club_id=n.club_id AND user_id=n.user_id RETURNING agent_wallet_balance INTO w;
  INSERT INTO public.chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,union_id,idempotency_key,pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
  VALUES('club_treasury',n.club_id,'agent_wallet',n.user_id,n.amt,'commission',n.club_id,rc_u(p_union),'round2:v3:'||rc_u(p_union)::text||':'||extract(epoch FROM ws)::text||':'||extract(epoch FROM we)::text||':'||n.club_id::text||':club:'||n.user_id::text,b+n.amt,b,w-n.amt,w);
 END LOOP;
 UPDATE public.agent_commissions SET settled_at=now() WHERE settled_at IS NULL;END$$;
CREATE FUNCTION public.rc_money() RETURNS numeric LANGUAGE sql AS $$SELECT(SELECT COALESCE(sum(chip_treasury),0) FROM public.clubs)+(SELECT COALESCE(sum(agent_wallet_balance),0) FROM public.agents)+(SELECT COALESCE(sum(chip_balance),0) FROM public.club_members)$$;
CREATE FUNCTION public.rc_wallet(p_club text,p_user text) RETURNS numeric LANGUAGE sql AS $$SELECT agent_wallet_balance FROM public.agents WHERE club_id=rc_u(p_club) AND user_id=rc_u(p_user)$$;
CREATE FUNCTION public.rc_chips(p_club text,p_user text) RETURNS numeric LANGUAGE sql AS $$SELECT chip_balance FROM public.club_members WHERE club_id=rc_u(p_club) AND user_id=rc_u(p_user)$$;
CREATE FUNCTION public.rc_bank(p_club text) RETURNS numeric LANGUAGE sql AS $$SELECT chip_treasury FROM public.clubs WHERE id=rc_u(p_club)$$;
CREATE FUNCTION public.rc_leg(p_club text,p_payer text,p_payee text) RETURNS numeric LANGUAGE sql AS $$SELECT amount FROM public.chip_ledger WHERE idempotency_key=smarter_private.rakeback_cascade_key(rc_u(p_club),'2026-10-05',rc_u(p_payer),rc_u(p_payee))$$;
-- Case assertions read these: the committed pre-migration week (club L) is excluded.
CREATE VIEW public.rc_ledger AS SELECT * FROM public.chip_ledger WHERE club_id IS DISTINCT FROM rc_u('L');
CREATE VIEW public.rc_agents AS SELECT * FROM public.agents WHERE club_id IS DISTINCT FROM rc_u('L');

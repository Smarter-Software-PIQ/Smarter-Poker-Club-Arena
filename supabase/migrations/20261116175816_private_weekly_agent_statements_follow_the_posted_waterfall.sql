-- @live-proof: to_regclass('smarter_private.weekly_agent_statements') IS NOT NULL AND position('weekly_agent_statements_due' in pg_get_functiondef('smarter_private.weekly_credit_invoices(timestamptz,timestamptz)'::regprocedure))>0 AND position('weekly_credit_invoices' in pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

-- These documents have no debt, due date, credit line or wallet posting.
CREATE TABLE smarter_private.weekly_agent_statements(
  period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
  club_id uuid NOT NULL,agent_user_id uuid NOT NULL,message_id uuid NOT NULL UNIQUE REFERENCES public.social_messages(id),
  statement jsonb NOT NULL, PRIMARY KEY(period_end,club_id,agent_user_id)
);
CREATE TABLE smarter_private.weekly_agent_statement_runs(
  period_end timestamptz PRIMARY KEY,summaries integer NOT NULL, delivered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON smarter_private.weekly_agent_statements,smarter_private.weekly_agent_statement_runs FROM PUBLIC,anon,authenticated,service_role;

-- Reuse the invoice owner's original accounting conversation and its strict
-- participant check. A statement is ordinary Messenger text in that same
-- private thread. It cannot produce a new invoice or a chip movement.
DO $extract$
DECLARE invoice text:=pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure);
 a integer:=strpos(invoice,'   -- One private accounting conversation');
 z integer:=strpos(invoice,'   meta:=meta||jsonb_build_object(''conversation_id'',conv');
BEGIN
 IF a=0 OR z<a OR strpos(substr(invoice,a,z-a),'accounting_conversation_audience_changed')=0
 THEN RAISE EXCEPTION 'private_accounting_conversation_source_changed'; END IF;
 EXECUTE 'CREATE FUNCTION smarter_private.private_accounting_conversation(scope_id uuid,issuer_kind text,issuer_id uuid,sender uuid,person uuid,issuer_name text,page_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $conv$
 #variable_conflict use_variable
 DECLARE conv uuid;
 BEGIN '||substr(invoice,a,z-a)||' RETURN conv; END $conv$';
 EXECUTE substr(invoice,1,a-1)||'   conv:=smarter_private.private_accounting_conversation(scope_id,issuer_kind,issuer_id,sender,person,issuer_name,page_id);'||chr(10)||substr(invoice,z);
END $extract$;
REVOKE ALL ON FUNCTION smarter_private.private_accounting_conversation(uuid,text,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.weekly_agent_statement_rows(p_club uuid,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(agent_user_id uuid, person uuid,route uuid[],name text,role text,net numeric,fees numeric,
 player_rakeback numeric,agent_gross numeric,to_agents numeric,to_players numeric,commission_earned numeric,
 own_play_commission numeric,cash_entries bigint,cash_fees numeric,tournament_entries bigint,tournament_fees numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $rows$
 WITH RECURSIVE
 -- Read the last committed agreement at Sunday close. Changes after the
 -- cutoff must never grant the new upline access to the previous week.
 held AS MATERIALIZED (
   SELECT DISTINCT ON (h.entity_type,h.entity_key) h.entity_type,h.after_terms AS terms
   FROM public.accounting_agreement_history h
   WHERE h.club_id=p_club AND h.entity_type IN ('club_members','agents') AND h.observed_at<p_to
     AND NOT EXISTS(SELECT FROM public.accounting_agreement_history later
                    WHERE later.transaction_id=h.transaction_id AND later.observed_at>=p_to)
   ORDER BY h.entity_type,h.entity_key,h.observed_at DESC,h.id DESC
 ), members AS MATERIALIZED (
   SELECT (terms->>'user_id')::uuid uid,(terms->>'agent_id')::uuid parent_uid
   FROM held WHERE entity_type='club_members' AND terms->>'is_active'='true' AND terms->>'status' IN ('active','approved')
 ), agents AS MATERIALIZED (
   SELECT (terms->>'id')::uuid id,(terms->>'user_id')::uuid uid,(terms->>'parent_agent_id')::uuid parent_id,terms->>'role' role
   FROM held WHERE entity_type='agents' AND terms->>'status'='active' AND terms->>'role' IN ('super_agent','agent','sub_agent')
 ), people AS MATERIALIZED (
   SELECT m.uid, coalesce(parent.uid,m.parent_uid) AS parent_uid,coalesce(a.role,'player') role
   FROM members m LEFT JOIN agents a ON a.uid=m.uid LEFT JOIN agents parent ON parent.id=a.parent_id
   UNION ALL SELECT a.uid,parent.uid,a.role FROM agents a LEFT JOIN agents parent ON parent.id=a.parent_id
   WHERE NOT EXISTS(SELECT FROM members m WHERE m.uid=a.uid)
 ), tree(root,uid,path) AS (
   SELECT a.uid,a.uid,ARRAY[a.uid] FROM agents a
   UNION ALL
   SELECT t.root,p.uid,t.path||p.uid FROM tree t JOIN people p ON p.parent_uid=t.uid
   WHERE NOT p.uid=ANY(t.path)
 ), results AS (
   SELECT f.user_id,sum(f.winnings) AS net,sum(f.fee) AS fees
   FROM public.ca_club_acct_fact_ct f WHERE f.club_id=p_club
     AND f.stat_date BETWEEN public.fn_ca_accounting_day(p_from) AND public.fn_ca_accounting_day(p_to-interval '1 microsecond')
   GROUP BY f.user_id
 ), earned AS (
   SELECT r.user_id,sum(r.rake_generated) AS fees FROM public.rakeback_periods r WHERE r.club_id=p_club
     AND r.period_start=public.fn_ca_accounting_day(p_from) AND r.period_end=public.fn_ca_accounting_day(p_to-interval '1 microsecond')
     AND r.status='paid' GROUP BY r.user_id
 ), own_sources AS (
   -- Only agents' own playing records need this split. The last matching
   -- paid certificate gives the original earning IDs, including late sources.
   -- Accrual amounts were rounded by the original commission owner per source.
   SELECT p.user_id,src->>'source_type' kind,(src->>'rake_credit')::numeric fee,ac.amount
   FROM agents a JOIN public.rakeback_periods p ON p.club_id=p_club AND p.user_id=a.uid
     AND p.period_start=public.fn_ca_accounting_day(p_from) AND p.period_end=public.fn_ca_accounting_day(p_to-interval '1 microsecond')
     AND p.status='paid'
   CROSS JOIN LATERAL (SELECT c.source_allocations FROM public.accounting_rakeback_period_calculations c
     WHERE c.period_id=p.id AND c.rake_generated=p.rake_generated AND c.rakeback_amount=p.rakeback_amount ORDER BY c.id DESC LIMIT 1) cert
   CROSS JOIN LATERAL jsonb_array_elements(cert.source_allocations) src
   LEFT JOIN public.agent_commissions ac ON ac.user_id=a.uid AND ac.club_id=p_club
     AND ac.source_id=(src->>'source_id')::uuid AND ac.source_type=src->>'source_type'
 ), personal AS (
   SELECT user_id,sum(amount) own,count(*) FILTER(WHERE kind='cash_rake_accrual') cash_count,
     sum(fee) FILTER(WHERE kind='cash_rake_accrual') cash_fee,count(*) FILTER(WHERE kind='tournament_fee_accrual') tournament_count,
     sum(fee) FILTER(WHERE kind='tournament_fee_accrual') tournament_fee FROM own_sources GROUP BY user_id
 ), commissions AS (
   SELECT a.user_id,sum(a.amount) amount FROM public.agent_commission_settlements a
   WHERE a.club_id=p_club AND a.period_start=p_from AND a.period_end=p_to GROUP BY a.user_id
 ), legs AS MATERIALIZED (
   SELECT l.from_type,l.from_entity_id,l.to_type,l.to_entity_id,l.amount FROM public.chip_ledger l
   WHERE l.club_id=p_club AND l.status='posted' AND l.created_at>=p_to
     AND (l.metadata->>'period_start')::timestamptz=p_from AND (l.metadata->>'period_end')::timestamptz=p_to
     AND (l.category IN ('commission','rakeback') OR l.metadata->>'cascade'='rakeback-funding-v1')
 ), entries AS (
   SELECT l.to_entity_id uid,l.amount,
     CASE l.to_type WHEN 'player_wallet' THEN 'player' WHEN 'agent_wallet' THEN 'gross' END kind FROM legs l
   UNION ALL SELECT l.from_entity_id,l.amount,
     CASE l.to_type WHEN 'player_wallet' THEN 'to_players' WHEN 'agent_wallet' THEN 'to_agents' END FROM legs l WHERE l.from_type='agent_wallet'
 ), wallets AS (
   SELECT e.uid,sum(e.amount) FILTER(WHERE kind='player') player,
     sum(e.amount) FILTER(WHERE kind='gross') gross,sum(e.amount) FILTER(WHERE kind='to_agents') agents,
     sum(e.amount) FILTER(WHERE kind='to_players') players FROM entries e GROUP BY e.uid
 )
 SELECT t.root,p.uid,t.path,coalesce(nullif(btrim(pr.username),''),nullif(btrim(pr.display_name),''),p.uid::text),
   p.role,round(coalesce(r.net,0),2),round(coalesce(e.fees,r.fees,0),2),
   coalesce(w.player,0),coalesce(w.gross,0),coalesce(w.agents,0),coalesce(w.players,0),
   coalesce(c.amount,0),coalesce(ps.own,0),coalesce(ps.cash_count,0),round(coalesce(ps.cash_fee,0),2),
   coalesce(ps.tournament_count,0),round(coalesce(ps.tournament_fee,0),2)
 FROM tree t JOIN people p ON p.uid=t.uid LEFT JOIN public.profiles pr ON pr.id=p.uid
 LEFT JOIN commissions c ON c.user_id=p.uid LEFT JOIN personal ps ON ps.user_id=p.uid
 LEFT JOIN results r ON r.user_id=p.uid LEFT JOIN earned e ON e.user_id=p.uid LEFT JOIN wallets w ON w.uid=p.uid
$rows$;
REVOKE ALL ON FUNCTION smarter_private.weekly_agent_statement_rows(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- Rows carry one personal net amount and one net agent amount. A hierarchy
-- subtotal sums each person's own figures once. Gross inflows and outgoing
-- legs are shown only in that person's wallet reconciliation.
CREATE FUNCTION smarter_private.weekly_agent_statements_due(p_from timestamptz,p_to timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $due$
DECLARE
 midway constant uuid:='fade0000-0000-0000-0000-000000000001';
 book jsonb; club record; doc record; sender uuid; club_name text; page_id uuid; conv uuid; msg uuid;
 n integer:=0; body text; title text; stmt jsonb;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_from IS DISTINCT FROM public.fn_union_prev_week_start(p_to) OR p_to IS DISTINCT FROM public.fn_union_week_start(p_to)
    OR p_from IS NULL OR p_to IS NULL OR p_to<'2026-11-16 08:00Z' OR p_to>clock_timestamp()
 THEN RAISE EXCEPTION 'closed_agent_statement_week_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('weekly-agent-summaries:'||extract(epoch FROM p_to)::text,0));
 IF EXISTS(SELECT FROM smarter_private.weekly_agent_statement_runs WHERE period_end=p_to) THEN RETURN false; END IF;
 SELECT r.result->'round4_invoices' INTO book FROM public.union_accounting_runs r WHERE r.scope_kind='union' AND r.scope_id=midway
   AND r.period_start=p_from AND r.period_end=p_to AND r.status='complete';
 IF book->>'success' IS DISTINCT FROM 'true' OR jsonb_typeof(book->'detail') IS DISTINCT FROM 'array'
   OR NOT EXISTS(SELECT FROM smarter_private.weekly_payout_financial_receipts WHERE scope_kind='union' AND scope_id=midway AND period_start=p_from AND period_end=p_to)
   OR EXISTS(SELECT FROM public.weekly_accounting_payout_pauses WHERE period_end=p_to AND phase<>'released')
 THEN RAISE EXCEPTION 'completed_weekly_agent_statement_book_required'; END IF;
 -- Club membership comes from each closed union's own statement set. A paid
 -- standalone club has a financial scope of its own even without a union bill.
 FOR club IN
   SELECT DISTINCT (entry->>'club_id')::uuid id FROM public.union_accounting_runs u
   CROSS JOIN LATERAL jsonb_array_elements(u.result->'round4_invoices'->'detail') entry
   WHERE u.scope_kind='union' AND u.period_start=p_from AND u.period_end=p_to AND u.status='complete'
     AND u.result->'round4_invoices'->>'success'='true'
   UNION SELECT r.scope_id FROM smarter_private.weekly_payout_financial_receipts r
     WHERE r.scope_kind='club' AND r.period_start=p_from AND r.period_end=p_to
   UNION SELECT r.scope_id FROM smarter_private.weekly_payout_financial_receipts r
     JOIN public.clubs hub ON hub.id=r.scope_id
     WHERE r.scope_kind='union' AND r.period_start=p_from AND r.period_end=p_to
   UNION SELECT DISTINCT (closed.terms->>'club_id')::uuid FROM (
     SELECT DISTINCT ON (h.entity_key) h.after_terms terms
     FROM public.accounting_agreement_history h WHERE h.entity_type='union_clubs' AND h.observed_at<p_to
       AND NOT EXISTS(SELECT FROM public.accounting_agreement_history later WHERE later.transaction_id=h.transaction_id AND later.observed_at>=p_to)
     ORDER BY h.entity_key,h.observed_at DESC,h.id DESC
   ) closed JOIN smarter_private.weekly_payout_financial_receipts r ON r.scope_kind='union'
     AND r.scope_id=(closed.terms->>'union_id')::uuid AND r.period_start=p_from AND r.period_end=p_to
 LOOP
   SELECT c.owner_id,c.name INTO STRICT sender,club_name FROM public.clubs c WHERE c.id=club.id;
   SELECT p.id INTO page_id FROM public.social_pages p WHERE p.linked_entity_type='club' AND p.linked_entity_id=club.id::text ORDER BY p.id LIMIT 1;
   FOR doc IN
     WITH rows AS MATERIALIZED (
       SELECT r.*,r.agent_gross-r.to_agents-r.to_players AS agent_net,
         jsonb_build_object('user_id',r.person,'name',r.name,'role',r.role,'path',r.route,
           'poker_net',r.net,'fees',r.fees,'player_rakeback',r.player_rakeback,'agent_gross',r.agent_gross,
           'agent_commission',r.commission_earned,'own_play_commission',r.own_play_commission,
           'downline_commission',r.commission_earned-r.own_play_commission,'cash_fee_entries',r.cash_entries,'cash_fees',r.cash_fees,
           'tournament_fee_entries',r.tournament_entries,'tournament_fees',r.tournament_fees,'sent_to_agents',r.to_agents,'sent_to_players',r.to_players,'agent_net',r.agent_gross-r.to_agents-r.to_players) item
       FROM smarter_private.weekly_agent_statement_rows(club.id,p_from,p_to) r
     ), branches AS (
       SELECT r.agent_user_id,path.branch,sum(net) net,sum(fees) fees,sum(player_rakeback) player_rb,sum(agent_net) agent_net,count(*) people
       FROM rows r CROSS JOIN LATERAL unnest(r.route[2:cardinality(r.route)]) path(branch)
       GROUP BY r.agent_user_id,path.branch
     ), summaries AS (
       SELECT agent_user_id,jsonb_agg(item ORDER BY route) items,
         count(*) people,sum(net) net,sum(fees) fees,sum(player_rakeback) player_rb,sum(agent_net) agent_net,
         string_agg(
          repeat('  ',cardinality(route)-1)||CASE WHEN cardinality(route)=1 THEN 'You · ' ELSE '' END
          ||replace(replace(name,chr(10),' '),chr(13),' ')||' ('||replace(role,'_',' ')||')'
          ||' | Poker net '||net||' | Fees '||fees||' | Player Rakeback '||player_rakeback
          ||CASE WHEN role<>'player' OR agent_gross<>0 OR to_agents<>0 OR to_players<>0
            THEN ' | Cash fees '||cash_fees||' ('||cash_entries||' accruals) | Tournament fees '||tournament_fees||' ('||tournament_entries||' accruals)'
              ||' | Agent commission earned '||commission_earned||' (own play '||own_play_commission||', downline play '||(commission_earned-own_play_commission)||')'
              ||' | Agent Rakeback gross '||agent_gross||' | Sent to agents '||to_agents
              ||' | Sent to players '||to_players||' | Agent net '||agent_net ELSE '' END,chr(10) ORDER BY route) lines
       FROM rows GROUP BY agent_user_id
     )
     SELECT s.*,
       (SELECT string_agg(r.name||' · '||b.people||' people | Poker net '||b.net||' | Fees '||b.fees
         ||' | Player Rakeback '||b.player_rb||' | Agent net '||b.agent_net,chr(10) ORDER BY r.name,r.person)
        FROM branches b JOIN rows r ON r.agent_user_id=b.agent_user_id AND r.person=b.branch
        WHERE b.agent_user_id=s.agent_user_id AND b.people>1) AS subtotals
     FROM summaries s ORDER BY s.agent_user_id
   LOOP
     title:='Weekly agent transaction summary · '||club_name;
     body:=title||chr(10)||to_char(p_from AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD')||' through '||
       to_char((p_to-interval '1 microsecond') AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD')||' (Pacific)'||chr(10)||
       'Amounts in chips. Positive poker net means a win. Agent net is gross wallet receipts less payouts to agents and players.'||chr(10)||chr(10)
       ||doc.lines||CASE WHEN doc.subtotals IS NULL THEN '' ELSE chr(10)||chr(10)||'Downline subtotals'||chr(10)||doc.subtotals END
       ||chr(10)||chr(10)||'You and your downline · '||doc.people||' people | Poker net '||doc.net||' | Fees '||doc.fees
       ||' | Player Rakeback '||doc.player_rb||' | Agent net '||doc.agent_net;
     stmt:=jsonb_build_object('kind','weekly_agent_transaction_summary','period_start',p_from,'period_end',p_to,'club_id',club.id,
       'agent_user_id',doc.agent_user_id,'people',doc.items,'totals',jsonb_build_object('people',doc.people,'poker_net',doc.net,
       'fees',doc.fees,'player_rakeback',doc.player_rb,'agent_net',doc.agent_net));
     conv:=smarter_private.private_accounting_conversation(club.id,'club',club.id,sender,doc.agent_user_id,club_name,page_id);
     INSERT INTO public.social_messages(conversation_id,sender_id,content,message_type,media_metadata)
     VALUES(conv,sender,body,'text',jsonb_build_object('kind','weekly_agent_transaction_summary','period_start',p_from,
       'period_end',p_to,'club_id',club.id,'recipient_id',doc.agent_user_id)) RETURNING id INTO msg;
     UPDATE public.social_conversations SET last_message_at=now(),last_message_preview=left(body,100),updated_at=now() WHERE id=conv;
     INSERT INTO smarter_private.weekly_agent_statements VALUES(p_from,p_to,club.id,doc.agent_user_id,msg,stmt);
     n:=n+1;
   END LOOP;
 END LOOP;
 INSERT INTO smarter_private.weekly_agent_statement_runs(period_end,summaries) VALUES(p_to,n);
 RETURN n>0;
END $due$;
REVOKE ALL ON FUNCTION smarter_private.weekly_agent_statements_due(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

DO $wire$
DECLARE s text; mark text;
BEGIN
 s:=pg_get_functiondef('smarter_private.weekly_credit_invoices(timestamptz,timestamptz)'::regprocedure);
 mark:='  RETURN CASE WHEN sent THEN ''invoices_delivered'' ELSE ''ready'' END;';
 IF strpos(s,mark)=0 THEN RAISE EXCEPTION 'credit_statement_owner_changed'; END IF;
 EXECUTE replace(s,mark,'  IF NOT sent AND p_to >= ''2026-11-16 08:00Z'' THEN sent:=smarter_private.weekly_agent_statements_due(p_from,p_to); END IF;'||chr(10)||mark);
 s:=pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure);
 mark:='  due := public.fn_union_accounting_run_at(e);';
 IF strpos(s,'  v_tick jsonb;')=0 THEN RAISE EXCEPTION 'weekly_books_declaration_changed'; END IF;
 s:=replace(s,'  v_tick jsonb;','  v_tick jsonb; pending_statement_week timestamptz;');
 IF strpos(s,mark)=0 THEN RAISE EXCEPTION 'weekly_books_owner_changed'; END IF;
 -- Installation can follow this week's promo. Reuse the same verified, private
 -- credit/statement phase and its delivery receipts, without replaying money.
 EXECUTE replace(s,mark,mark||$catch$
  SELECT h.period_end INTO pending_statement_week FROM public.union_weekly_horse_promo_runs h
   WHERE h.union_id='fade0000-0000-0000-0000-000000000001' AND h.period_end>='2026-11-16 08:00Z'
     AND NOT EXISTS(SELECT FROM smarter_private.weekly_agent_statement_runs s WHERE s.period_end=h.period_end)
     AND EXISTS(SELECT FROM public.union_accounting_runs r WHERE r.scope_kind='union' AND r.scope_id=h.union_id
                AND r.period_end=h.period_end AND r.status='complete')
   ORDER BY h.period_end LIMIT 1;
  IF pending_statement_week IS NOT NULL AND NOT public.fn_platform_frozen() THEN
    RETURN jsonb_build_object('stage',smarter_private.weekly_credit_invoices(public.fn_union_prev_week_start(pending_statement_week),pending_statement_week));
  END IF;$catch$);
END $wire$;
COMMIT;

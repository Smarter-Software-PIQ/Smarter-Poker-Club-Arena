CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_finalize(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.weekly_accounting_payout_pauses%ROWTYPE; item jsonb; d_from date; summary jsonb; cfg smarter_private.weekly_payout_rounds_config%ROWTYPE; notes int; label text;
BEGIN
 SELECT * INTO STRICT r FROM public.weekly_accounting_payout_pauses WHERE run_id=p_run FOR UPDATE;
 IF r.phase='released' THEN RETURN r.result; END IF;
 d_from:=(r.period_start AT TIME ZONE 'America/Los_Angeles')::date;
 label:=to_char(r.period_start AT TIME ZONE 'America/Chicago','Mon DD')||' - '||to_char((r.period_end-interval '1 second') AT TIME ZONE 'America/Chicago','Mon DD');
 FOR item IN SELECT value FROM jsonb_array_elements(r.scope_plan) LOOP
  INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
  SELECT item->>'kind',(item->>'id')::uuid,r.period_start,r.period_end,r.run_id,
   (SELECT jsonb_agg(jsonb_build_object('scope',item,'round',x.round_no,'receipt',x.receipt) ORDER BY x.round_no) FROM smarter_private.weekly_payout_round_receipts x
     WHERE x.run_id=r.run_id AND x.scope_kind=item->>'kind' AND x.scope_id=(item->>'id')::uuid)
  WHERE NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_financial_receipts f WHERE f.scope_kind=item->>'kind' AND f.scope_id=(item->>'id')::uuid AND f.period_end=r.period_end);
 END LOOP;
 -- Credit lines: what an agent owes is its credit line minus the chips in its agent wallet after rakeback.
 UPDATE public.credit_invoices ci SET debt_owed=round(a.credit_limit-a.agent_wallet_balance,2),amount_remaining=round(a.credit_limit-a.agent_wallet_balance,2)
 FROM public.agents a WHERE a.id=ci.agent_id AND ci.period_end=r.period_end AND ci.status='pending' AND ci.amount_paid=0 AND a.credit_limit-a.agent_wallet_balance>0;
 UPDATE public.credit_invoices ci SET status='void',void_reason='Agent wallet covers the credit line after weekly rakeback',debt_owed=0,amount_remaining=0
 FROM public.agents a WHERE a.id=ci.agent_id AND ci.period_end=r.period_end AND ci.status='pending' AND ci.amount_paid=0 AND a.credit_limit-a.agent_wallet_balance<=0;
 -- Rakeback Received: every player, agent and club owner that was paid.
 WITH players AS (SELECT pp.user_id,pp.club_id,round(sum(pp.payout_amount),2) amt FROM public.rakeback_periods rp JOIN public.rakeback_period_payouts pp ON pp.rakeback_period_id=rp.id
   WHERE rp.period_start=d_from AND pp.payout_amount>0 AND pp.paid_at>=r.money_starts_at GROUP BY 1,2),
 agents AS (SELECT a.user_id,a.club_id,round(sum(a.amount),2) amt FROM public.agent_commission_settlements a WHERE a.period_start=r.period_start GROUP BY 1,2 HAVING sum(a.amount)>0),
 owners AS (SELECT c.owner_id user_id,c.id club_id,si.gross_amount amt FROM public.settlement_invoices si JOIN public.clubs c ON c.id::text=si.to_entity_id::text
   WHERE si.invoice_type='union_to_club' AND si.created_at>=r.money_starts_at AND si.gross_amount>0),
 allrows AS (SELECT user_id,club_id,amt,'player' k FROM players UNION ALL SELECT user_id,club_id,amt,'agent' FROM agents UNION ALL SELECT user_id,club_id,amt,'club' FROM owners)
 INSERT INTO public.notifications(user_id,type,title,message,data,link)
 SELECT x.user_id,'rakeback_received',
  CASE x.k WHEN 'player' THEN 'Weekly Rakeback Received' WHEN 'agent' THEN 'Weekly Agent Rakeback Received' ELSE 'Weekly Club Rakeback Received' END,
  CASE x.k WHEN 'player' THEN 'Your weekly rakeback of '||to_char(x.amt,'FM999,999,990.00')||' chips from '||c.name||' ('||label||') was added to your wallet.'
   WHEN 'agent' THEN 'Your weekly agent rakeback of '||to_char(x.amt,'FM999,999,990.00')||' chips from '||c.name||' ('||label||') was added to your agent wallet.'
   ELSE c.name||' received its weekly rakeback of '||to_char(x.amt,'FM999,999,990.00')||' chips from the union ('||label||') in the club bank.' END,
  jsonb_build_object('club_id',x.club_id,'amount',x.amt,'kind',x.k,'period_start',d_from::text,'run_id',r.run_id),'/club/'||x.club_id
 FROM allrows x JOIN public.clubs c ON c.id=x.club_id
 WHERE x.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.user_id=x.user_id AND n.type='rakeback_received' AND n.data->>'club_id'=x.club_id::text AND n.data->>'kind'=x.k AND n.data->>'period_start'=d_from::text);
 GET DIAGNOSTICS notes=ROW_COUNT;
 SELECT jsonb_build_object('rounds',(SELECT jsonb_agg(jsonb_build_object('scope_kind',x.scope_kind,'scope_id',x.scope_id,'round',x.round_no,
   'amount',COALESCE((x.receipt->>'amount')::numeric,(x.receipt->>'total_rakeback')::numeric,0),'payees',COALESCE((x.receipt->>'payees')::int,(x.receipt->>'clubs_paid')::int,0),'funding',x.funding) ORDER BY x.round_no,x.scope_kind)
   FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id),'notifications',notes) INTO summary;
 UPDATE public.weekly_accounting_payout_pauses SET phase='released',result=jsonb_build_object('success',true,'paid',true,'stage','weekly_payout_financial_complete','run_id',r.run_id,
  'attempt_no',r.attempt_no,'financial_finished_at',clock_timestamp(),'books_complete',false,'round_runner',true)||summary WHERE run_id=r.run_id;
 SELECT * INTO cfg FROM smarter_private.weekly_payout_rounds_config WHERE singleton;
 IF cfg.report_user_id IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,type,title,message,data,link)
  VALUES(cfg.report_user_id,'weekly_payout_report','Weekly Rakeback Completed',
   'Weekly rakeback for '||label||' is paid: clubs '||to_char(COALESCE((SELECT sum((x.receipt->>'total_rakeback')::numeric) FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.round_no=1),0),'FM999,999,990.00')
   ||', agents '||to_char(COALESCE((SELECT sum((x.receipt->>'amount')::numeric) FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.round_no=2),0),'FM999,999,990.00')
   ||', players '||to_char(COALESCE((SELECT sum((x.receipt->>'amount')::numeric) FROM smarter_private.weekly_payout_round_receipts x WHERE x.run_id=r.run_id AND x.round_no=3),0),'FM999,999,990.00')||'.',
   summary||jsonb_build_object('run_id',r.run_id,'period_start',d_from::text),'/hub');
 END IF;
 RETURN jsonb_build_object('stage','weekly_payout_finalized','run_id',r.run_id)||summary;
END $function$

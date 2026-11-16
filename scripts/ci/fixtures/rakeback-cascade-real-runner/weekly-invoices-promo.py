# Install on the close fixture with the actual current statement and promo
# functions. This board has money receipts but no issued club statements.
migration = next((R/'supabase/migrations').glob('20261116152204_*.sql'))
q(migration.read_text())
gate = "SELECT smarter_private.weekly_credit_invoices(rr.ws(),rr.we())"
assert one(gate)=='awaiting_rakeback', 'Midway has no financial receipt on the other union board'
assert one("SELECT count(*) FROM public.accounting_invoice_deliveries")=='0'
# Seed the closed Midway receipt on this local board, then bill one agent with
# a 100 line and 40 wallet. The other fixture agents must receive nothing.
q("""
 INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
 SELECT 'union','fade0000-0000-0000-0000-000000000001',period_start,period_end,run_id,original_round_receipts
 FROM smarter_private.weekly_payout_financial_receipts WHERE scope_id=rr.u('U');
""")
assert one(gate)=='awaiting_club_invoices'
q("""
 INSERT INTO public.union_accounting_runs(union_id,period_start,period_end,scheduled_at,status,result)
 VALUES('fade0000-0000-0000-0000-000000000001',rr.ws(),rr.we(),rr.we(),'complete',
 '{"success":true,"round4_invoices":{"success":true,"detail":[{"club_id":"fade0000-0000-0000-0000-000000000001"}]}}');
 INSERT INTO public.agent_credit_weekly_basis(agent_id,club_id,period_start,period_end,credit_line,agent_wallet_before_rakeback)
 SELECT id,club_id,rr.ws(),rr.we(),100,40 FROM public.agents WHERE user_id=rr.u('SUB');
 INSERT INTO public.credit_invoices(id,agent_id,period_start,period_end,debt_owed,amount_paid,amount_remaining,status,due_date)
 SELECT rr.u('credit-bill'),id,rr.ws(),rr.we(),60,0,60,'pending',rr.we()+interval '2 days' FROM public.agents WHERE user_id=rr.u('SUB');
 INSERT INTO public.settlement_invoices(club_id,invoice_type,from_entity_type,from_entity_id,to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,chips_transferred,source_credit_invoice_id)
 VALUES(rr.u('T'),'transaction_receipt','club',rr.u('T')::text,'agent',rr.u('SUB')::text,60,60,0,'{"kind":"credit_invoice"}','generated',false,rr.u('credit-bill'));
""")
assert one(gate)=='invoices_delivered'
assert one(gate)=='ready'
assert one("SELECT count(*)=1 AND bool_and(d.recipient_id=rr.u('SUB')) FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id JOIN public.settlement_invoices i ON i.id=d.invoice_id WHERE i.source_credit_invoice_id=rr.u('credit-bill')")=='t'

# Exercise the real promo owner directly on a subsequent disposable week. No
# horse has played in Midway; both have active club memberships.
mid = 'fade0000-0000-0000-0000-000000000001'
q(f"""
 INSERT INTO public.clubs(id,name,owner_id,union_id,is_union,chip_treasury) VALUES('{mid}','Midway fixture',rr.u('U.boss'),'{mid}',true,0);
 UPDATE public.profiles SET is_horse=true WHERE id IN (rr.u('TP'),rr.u('TN'));
 INSERT INTO public.club_members(club_id,user_id,is_active,status,membership_lifecycle_status,chip_balance)
 VALUES('{mid}',rr.u('TP'),true,'active','active',0),('{mid}',rr.u('TN'),true,'active','active',0);
""")
at_week = "public.fn_midway_weekly_horse_promo(rr.we(),public.fn_union_week_start(rr.we()+interval '8 days'))"
clock('2026-11-23 12:00:00+00')
result=json.loads(one('SELECT '+at_week))
assert result['eligible_wallets']==2 and result['eligibility']=='all_active_midway_horses',result
assert json.loads(one('SELECT '+at_week))['replayed'] is True
case('post-rakeback documents: an unpaid union cannot issue agent bills or release promo; all active horses qualify even without rake and a promo replay returns the original receipt')

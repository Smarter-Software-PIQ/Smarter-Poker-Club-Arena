# Use the real Club Data projection schema and its Pacific-day reader.
fixture_model=next(migrations.glob('20261115020010_*.sql')).read_text()
for table in ['ca_club_acct_fact','ca_club_acct_fact_journal']:
    ddl=fixture_model.split('CREATE TABLE public.'+table+' (',1)[1].split(');',1)[0]
    q('CREATE TABLE public.'+table+' ('+ddl+');')
views=next(migrations.glob('20261115034141_*.sql')).read_text()
q('CREATE VIEW public.ca_club_acct_fact_ct AS'+views.split('CREATE VIEW public.ca_club_acct_fact_ct AS',1)[1].split(';',1)[0])
pacific=next(migrations.glob('20261116141640_*.sql')).read_text()
q(pacific[pacific.index('CREATE OR REPLACE FUNCTION public.fn_ca_accounting_day('):pacific.index('COMMENT ON FUNCTION public.fn_ca_accounting_day(')])
q(next(migrations.glob('20261116175816_*.sql')).read_text())
# Reuse the existing completed, genuinely settled test union and its untouched
# original wallet legs. Its real hierarchy is SA -> AG -> SUB -> TP.
q("""
INSERT INTO public.ca_club_acct_fact(club_id,acct_day,kind,game_id,user_id,result,src,last_at)
VALUES(rr.u('T'),rr.d1(),'CASH',rr.u('hand'),rr.u('TP'),-12.5,1,rr.ws()+interval '1 hour'),
      (rr.u('T'),rr.d1()+6,'TOURNAMENT',rr.u('mtt'),rr.u('TP'),20,1,rr.we()-interval '1 hour'),
      (rr.u('T'),rr.d1()+7,'CASH',rr.u('next'),rr.u('TP'),81,1,rr.we());
INSERT INTO public.ca_club_acct_fact_journal(club_id,acct_day,kind,game_id,user_id,result,last_at)
VALUES(rr.u('T'),rr.d1(),'CASH',rr.u('hand'),rr.u('TP'),1.25,rr.ws()+interval '1 hour');
""")
rows="smarter_private.weekly_agent_statement_rows(rr.u('T'),rr.ws(),rr.we())"
assert one(f"SELECT count(*)=1 AND bool_and(net=8.75 AND fees>0 AND player_rakeback>0 AND cardinality(route)=4) FROM {rows} WHERE agent_user_id=rr.u('SA') AND person=rr.u('TP')")=='t'
assert one(f"SELECT count(*)=0 FROM {rows} WHERE agent_user_id=rr.u('SUB') AND person=rr.u('SA')")=='t'
assert one(f"SELECT agent_gross>0 AND to_agents>0 AND commission_earned>0 AND own_play_commission=0 FROM {rows} WHERE agent_user_id=rr.u('SA') AND person=rr.u('SA')")=='t'
clock('2026-11-16 16:59:00Z')
q("SELECT rr.agent('T','new_agent_after_cutoff',NULL,0.2); UPDATE public.club_members SET agent_id=rr.u('new_agent_after_cutoff') WHERE club_id=rr.u('T') AND user_id=rr.u('TP');")
assert one(f"SELECT count(*)=0 FROM {rows} WHERE agent_user_id=rr.u('new_agent_after_cutoff')")=='t'
assert one(f"SELECT count(*) FROM {rows} WHERE agent_user_id=rr.u('SA') AND person=rr.u('TP')")=='1'
# This Midway book has only the actual hub line. Seed two genuine earning roles
# before the cutoff in that club. One is prepaid, with zero activity and credit.
clock('2026-11-14 18:00:00Z')
q(f"""
 SELECT rr.person(n) FROM unnest(ARRAY['zero_agent','nested_agent']) n;
 INSERT INTO public.club_members(club_id,user_id,role,status,is_active)
 SELECT '{mid}',rr.u(n),'agent','active',true FROM unnest(ARRAY['zero_agent','nested_agent']) n;
 INSERT INTO public.agents(club_id,user_id,role,status,commission_rate,player_rakeback_rate,credit_limit)
 SELECT '{mid}',rr.u(n),'agent','active',0.25,0,0 FROM unnest(ARRAY['zero_agent','nested_agent']) n;
 """)
clock('2026-11-16 18:00:00Z')
before_invoices=one('SELECT count(*) FROM public.accounting_invoice_deliveries')
result=json.loads(one('SELECT smarter_private.weekly_union_books_due()'))
assert result['stage']=='invoices_delivered',result
assert one(f"""SELECT count(*)=2 AND bool_and(m.message_type='text'
 AND m.media_metadata->>'kind'='weekly_agent_transaction_summary'
 AND (s.statement#>>'{{totals,people}}')::int=1 AND (s.statement#>>'{{totals,fees}}')::numeric=0
 AND position('Player Rakeback' in m.content)>0 AND position('Agent net' in m.content)>0
 AND position('Agent commission earned' in m.content)>0 AND position('own play' in m.content)>0
 AND EXISTS(SELECT FROM public.social_conversation_participants p WHERE p.conversation_id=m.conversation_id AND p.user_id=s.agent_user_id)
 AND NOT EXISTS(SELECT FROM public.social_conversation_participants p WHERE p.conversation_id=m.conversation_id AND p.user_id<>ALL(ARRAY[m.sender_id,s.agent_user_id])))
 FROM smarter_private.weekly_agent_statements s JOIN public.social_messages m ON s.message_id=m.id WHERE s.club_id='{mid}'""")=='t'
assert one("SELECT count(*)=1 AND bool_and(m.content LIKE '%Downline subtotals%' AND m.content LIKE '%u_tp%') FROM smarter_private.weekly_agent_statements d JOIN public.social_messages m ON m.id=d.message_id WHERE d.club_id=rr.u('T') AND d.agent_user_id=rr.u('SA')")=='t'
delivered=one('SELECT count(*) FROM smarter_private.weekly_agent_statements')
assert int(delivered)>2
assert one("SELECT smarter_private.weekly_credit_invoices(rr.ws(),rr.we())")=='ready'
assert one('SELECT count(*) FROM smarter_private.weekly_agent_statements')==delivered
assert one('SELECT count(*) FROM public.accounting_invoice_deliveries')==before_invoices
assert one("SELECT NOT has_function_privilege('authenticated','smarter_private.weekly_agent_statement_rows(uuid,timestamptz,timestamptz)','EXECUTE')")=='t'
case('weekly private agent summaries include zero-credit/zero-activity agents once, the Pacific play and posted waterfall per person, and only the original nested downline')
# The ordinary next-week promo entry must first commit the statements, then
# pay the horses on a later call. No separate dispatcher or accounting replay.
clock('2026-11-30 18:00:00Z')
second_from="'2026-11-23 08:00Z'::timestamptz"
second_to="'2026-11-30 08:00Z'::timestamptz"
q(f"""
 INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
 SELECT scope_kind,scope_id,{second_from},{second_to},run_id,original_round_receipts
 FROM smarter_private.weekly_payout_financial_receipts WHERE scope_kind='union' AND scope_id='{mid}' AND period_end=rr.we();
 INSERT INTO public.union_accounting_runs(union_id,period_start,period_end,scheduled_at,status,result)
 SELECT union_id,{second_from},{second_to},{second_to},status,result FROM public.union_accounting_runs WHERE scope_kind='union' AND scope_id='{mid}' AND period_end=rr.we();
""")
promo=f"SELECT public.fn_midway_weekly_horse_promo_due({second_to})"
first=json.loads(one(promo))
assert first['stage']=='invoices_delivered' and first['owns_tick'],first
assert one(f"SELECT count(*) FROM public.union_weekly_horse_promo_runs WHERE period_end={second_to}")=='0'
assert one(f"SELECT count(*) FROM smarter_private.weekly_agent_statements WHERE period_end={second_to} AND club_id='{mid}'")=='2'
second=json.loads(one(promo))
assert second['weekly_horse_promo']['success'],second
assert json.loads(one(promo))['reason']=='already_paid'
case('the weekly promo owner commits all agent summaries before distributing promo, then replays neither statements nor money')

# Early document release uses the same cron entry even with an open P&L and
# the main scheduler busy. A finalized bill can be published while another
# cutoff basis is still awaiting its matching document.
# Production's in-flight club P&L owns an AccessShareLock on the existing
# horse run relation for its entire transaction. Installation must finish
# inside the normal budget while this read is still in progress.
reader=subprocess.Popen([str(A.pg_bin/'psql'),'-XqAt','-h','127.0.0.1','-p',port,'-U','postgres','-d',DB,'-c',
 "BEGIN; SELECT count(*) FROM public.union_weekly_horse_promo_runs; SET application_name='rr_original_promo_reader'; SELECT pg_sleep(8); COMMIT;"],
 env=E,stdout=subprocess.DEVNULL)
try:
    for _ in range(100):
        if one("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rr_original_promo_reader' AND wait_event='PgSleep')")=='t':break
        time.sleep(.02)
    else: raise AssertionError('existing horse run reader was not holding its snapshot')
    q("SET lock_timeout='750ms';"+next(migrations.glob('20261116205150_*.sql')).read_text())
    assert reader.poll() is None
finally:
    reader.wait(timeout=15)
case('weekly document installation finishes while a genuine read holds the original horse promo table')
payment_schema=next(migrations.glob('20260721132851_*.sql')).read_text()
q(payment_schema[payment_schema.index('CREATE TABLE IF NOT EXISTS public.credit_payments'):payment_schema.index('ALTER TABLE public.credit_invoices ENABLE ROW LEVEL SECURITY')])
q(next(migrations.glob('20261116221012_*.sql')).read_text())
clock('2026-12-08 18:00:00Z')
early_from="'2026-11-30 08:00Z'::timestamptz"
early_to="'2026-12-07 08:00Z'::timestamptz"
early_gate=f"smarter_private.weekly_agent_documents_released({early_from},{early_to})"
q(f"""
 INSERT INTO public.weekly_accounting_payout_pauses(period_start,period_end,announced_at,money_starts_at,money_deadline_at,expires_at,
   scope_plan,phase,instance_id) VALUES({early_from},{early_to},{early_to},{early_to}+interval '2 minutes',{early_to}+interval '30 minutes',
   {early_to}+interval '30 minutes',jsonb_build_array(jsonb_build_object('kind','union','id','{mid}'),jsonb_build_object('kind','union','id',rr.u('U'))),
   'released','weekly-payout-rounds');
 INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
 SELECT scope_kind,scope_id,{early_from},{early_to},run_id,original_round_receipts FROM smarter_private.weekly_payout_financial_receipts
   WHERE scope_id='{mid}' AND period_end=rr.we();
 INSERT INTO public.agent_credit_weekly_basis(agent_id,club_id,period_start,period_end,credit_line,agent_wallet_before_rakeback)
 SELECT id,club_id,{early_from},{early_to},100,40 FROM public.agents WHERE user_id IN (rr.u('SUB'),rr.u('AG'));
 INSERT INTO public.credit_invoices(id,agent_id,period_start,period_end,debt_owed,amount_paid,amount_remaining,status,due_date)
 SELECT rr.u('early-credit-bill'),id,{early_from},{early_to},60,0,60,'pending',{early_to}+interval '2 days' FROM public.agents WHERE user_id=rr.u('SUB');
 INSERT INTO public.settlement_invoices(club_id,invoice_type,from_entity_type,from_entity_id,to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,chips_transferred,source_credit_invoice_id)
 VALUES(rr.u('T'),'transaction_receipt','club',rr.u('T')::text,'agent',rr.u('SUB')::text,60,60,0,'{{"kind":"credit_invoice"}}','generated',false,rr.u('early-credit-bill'));
 SELECT public.fn_reduce_unsent_weekly_credit_bill((SELECT id FROM public.settlement_invoices WHERE source_credit_invoice_id=rr.u('early-credit-bill')),60,48,'Approved closing reduction',rr.u('early-bill-reduction'));
""")
assert one(f"SELECT {early_gate}")=='f'
one('SELECT smarter_private.weekly_union_books_due()')
assert one(f"SELECT count(*) FROM smarter_private.weekly_agent_statements WHERE period_end={early_to}")=='0'
q(f"""INSERT INTO smarter_private.weekly_payout_financial_receipts(scope_kind,scope_id,period_start,period_end,run_id,original_round_receipts)
 SELECT scope_kind,scope_id,{early_from},{early_to},run_id,original_round_receipts FROM smarter_private.weekly_payout_financial_receipts
 WHERE scope_id=rr.u('U') AND period_end=rr.we();""")
assert one(f"SELECT {early_gate}")=='t'
q(f"""UPDATE public.weekly_accounting_payout_pauses SET phase='paying' WHERE period_end={early_to};
 SELECT smarter_private.weekly_payout_finalize(run_id) FROM public.weekly_accounting_payout_pauses WHERE period_end={early_to};""")
assert one("SELECT status='pending' AND debt_owed=48 AND amount_remaining=48 FROM public.credit_invoices WHERE id=rr.u('early-credit-bill')")=='t'
# Reproduce the old release writer's pending shape, after the owner already
# approved the original 60 less 12 document.
q("UPDATE public.credit_invoices SET debt_owed=12.34,amount_remaining=12.34 WHERE id=rr.u('early-credit-bill')")
early_payment=q(f"SELECT public.fn_midway_weekly_horse_promo({early_from},{early_to})",check=False)
assert early_payment.returncode and 'midway_promo_requires_posted_weekly_documents' in early_payment.stderr
# This synthetic board has no real Midway R1 settlement. Its separate native
# producer test qualifies the club publisher; expose that producer's receipt
# boundary to the owner here only after the missing-publisher case.
assert one(f"SELECT smarter_private.weekly_rakeback_documents({early_from},{early_to})")=='awaiting_club_rakeback_statements'
q("""CREATE FUNCTION smarter_private.weekly_club_rakeback_statements(uuid,timestamptz) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('success',true,'clubs',4,'newly_delivered',0)
$$;""")
q(f"""SELECT rr.person('new_late_player');
 UPDATE auth.users SET email='lateperson@fixture.org' WHERE id=rr.u('new_late_player');
 INSERT INTO public.club_members(club_id,user_id,role,status,is_active,membership_lifecycle_status,joined_at)
 VALUES('{kings}',rr.u('new_late_player'),'player','active',true,'active',{early_from});
 BEGIN;
 SELECT public.fn_ca_declare_ledger('promo','club_treasury',rr.u('O'),NULL,'late-week-fixture-funding',ARRAY['clubs']);
 UPDATE public.clubs SET chip_treasury=chip_treasury-(100-(SELECT promo_wallet FROM public.union_wallets WHERE union_id='{mid}')) WHERE id=rr.u('O');
 UPDATE public.union_wallets SET promo_wallet=100 WHERE union_id='{mid}';
 COMMIT;""")
n_before=one('SELECT count(*) FROM public.chip_ledger')
holds=subprocess.Popen([str(A.pg_bin/'psql'),'-XqAt','-h','127.0.0.1','-p',port,'-U','postgres','-d',DB,'-c',
 "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('union-accounting-scheduler',0)); SET application_name='rr_weekly_club_busy'; SELECT pg_sleep(10); COMMIT;"],env=E,stdout=subprocess.DEVNULL)
try:
    for _ in range(100):
        if one("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='rr_weekly_club_busy' AND wait_event='PgSleep')")=='t':break
        time.sleep(.02)
    else: raise AssertionError('club scheduler lock not held')
    assert json.loads(one('SELECT smarter_private.weekly_union_books_due()'))['stage']=='invoices_delivered'
    assert holds.poll() is None
    blocked=json.loads(one('SELECT smarter_private.weekly_union_books_due()'))
    assert blocked['stage'] in ('weekly_union_books_scheduler_busy','weekly_union_books_waiting_for_owed_scopes'),blocked
finally:
    holds.wait(timeout=20)
early_sent=one(f"SELECT count(*) FROM smarter_private.weekly_agent_statements WHERE period_end={early_to}")
assert int(early_sent)>2
assert one("SELECT debt_owed=48 AND amount_remaining=48 AND amount_paid=0 FROM public.credit_invoices WHERE id=rr.u('early-credit-bill')")=='t'
assert one("""SELECT count(*)=1 AND bool_and(d.recipient_id=rr.u('SUB') AND position('48.00' in m.content)>0)
 FROM public.accounting_invoice_deliveries d JOIN public.social_messages m ON m.id=d.message_id
 JOIN public.settlement_invoices i ON i.id=d.invoice_id WHERE i.source_credit_invoice_id=rr.u('early-credit-bill')""")=='t'
assert one(f"SELECT count(*) FROM public.union_accounting_runs WHERE scope_id='{mid}' AND period_end={early_to} AND status='complete'")=='0'
assert one(f"SELECT smarter_private.weekly_rakeback_documents({early_from},{early_to})")=='awaiting_agent_credit_document'
assert one(f"SELECT count(*) FROM smarter_private.weekly_agent_statements WHERE period_end={early_to}")==early_sent
assert one(f"SELECT count(*) FROM public.union_weekly_horse_promo_runs WHERE period_end={early_to}")=='0'
assert one('SELECT count(*) FROM public.chip_ledger')==n_before
assert one("SELECT NOT has_function_privilege('authenticated','smarter_private.weekly_final_credit_documents(timestamptz,timestamptz,boolean)','EXECUTE')")=='t'
case('the released weekly scheduler delivers private summaries and adjusted credit bills once, before an open club P&L, with every booked payout receipt and without holding the club scheduler or releasing promo')
# The second original bill arrives later. The automatic outside-hours owner
# commits it, then releases the actual equal promo and the welcome separately.
q(f"""INSERT INTO public.credit_invoices(id,agent_id,period_start,period_end,debt_owed,amount_paid,amount_remaining,status,due_date)
 SELECT rr.u('late-agent-bill'),id,{early_from},{early_to},60,0,60,'pending',{early_to}+interval '2 days' FROM public.agents WHERE user_id=rr.u('AG');
 INSERT INTO public.settlement_invoices(club_id,invoice_type,from_entity_type,from_entity_id,to_entity_type,to_entity_id,gross_amount,net_amount,deductions,breakdown,status,chips_transferred,source_credit_invoice_id)
 VALUES(rr.u('T'),'transaction_receipt','club',rr.u('T')::text,'agent',rr.u('AG')::text,60,60,0,'{{"kind":"credit_invoice"}}','generated',false,rr.u('late-agent-bill'));
 UPDATE public.credit_invoices SET status='void',debt_owed=0,amount_remaining=0,void_reason='Agent wallet covers the credit line after weekly rakeback' WHERE id=rr.u('late-agent-bill');""")
assert json.loads(one('SELECT smarter_private.weekly_union_books_due()'))['stage']=='invoices_delivered'
assert one("SELECT status='pending' AND debt_owed=60 AND amount_remaining=60 AND void_reason IS NULL FROM public.credit_invoices WHERE id=rr.u('late-agent-bill')")=='t'
assert one(f"SELECT count(*) FROM public.union_weekly_horse_promo_runs WHERE period_end={early_to}")=='0'
assert one(f"SELECT count(*) FROM smarter_private.weekly_rakeback_document_runs WHERE period_end={early_to} AND club_receipt->>'clubs'='4'")=='1'
assert one("SELECT count(*) FROM public.sp_signup_welcome_back_awards WHERE user_id=rr.u('new_late_player')")=='0'
later_promo=json.loads(one('SELECT smarter_private.weekly_union_books_due()'))['weekly_horse_promo']
assert later_promo['success'] and later_promo['paid']==50 and later_promo['paid_wallets']>=2,later_promo
later_welcome=json.loads(one('SELECT smarter_private.weekly_union_books_due()'))
assert later_welcome['paid_players']==1 and later_welcome['paid']==25,later_welcome
assert one(f"SELECT (kings_welcome_receipt->>'paid')::numeric=25 FROM smarter_private.weekly_rakeback_document_runs WHERE period_end={early_to}")=='t'
assert not one(welcome)
credit_check=f"SELECT smarter_private.weekly_final_credit_documents({early_from},{early_to},true);"
assert one(f"""BEGIN;
 INSERT INTO public.credit_payments(invoice_id,amount,payment_method) VALUES(rr.u('early-credit-bill'),7,'external');
 UPDATE public.credit_invoices SET status='partial',debt_owed=26,amount_paid=7,amount_remaining=19 WHERE id=rr.u('early-credit-bill');
 UPDATE public.credit_invoices SET status='void',debt_owed=0,amount_remaining=0,void_reason='Owner waiver' WHERE id=rr.u('late-agent-bill');
 {credit_check}
 SELECT (SELECT status='partial' AND amount_paid=7 AND amount_remaining=19 AND debt_owed=26 FROM public.credit_invoices WHERE id=rr.u('early-credit-bill'))
 AND (SELECT count(*)=1 AND sum(amount)=7 FROM public.credit_payments WHERE invoice_id=rr.u('early-credit-bill'))
 AND (SELECT status='void' AND void_reason='Owner waiver' FROM public.credit_invoices WHERE id=rr.u('late-agent-bill'))
 AND (SELECT count(*)=2 FROM public.accounting_invoice_deliveries d JOIN public.settlement_invoices i ON i.id=d.invoice_id WHERE i.source_credit_invoice_id IN(rr.u('early-credit-bill'),rr.u('late-agent-bill')));
 ROLLBACK;""")=='t'
case('the actual payout finalizer preserves the approved Pacific bill. Historical post-rakeback changes recover from its original document, leaving payments, waivers and delivered copies alone')
assert one(f"SELECT count(*) FROM public.union_accounting_runs WHERE scope_id='{mid}' AND period_end={early_to} AND status='complete'")=='0'
assert one(f"SELECT count(*) FROM smarter_private.weekly_agent_statements WHERE period_end={early_to}")==early_sent
case('after the twelve-hour intake window, real paid and documented wallets receive one equal promo and one eligible KINGS welcome, with an unfinished independent club book')
q('DROP FUNCTION smarter_private.weekly_club_rakeback_statements(uuid,timestamptz)')

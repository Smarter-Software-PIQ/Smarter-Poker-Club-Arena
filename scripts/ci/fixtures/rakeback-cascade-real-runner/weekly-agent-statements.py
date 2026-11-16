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

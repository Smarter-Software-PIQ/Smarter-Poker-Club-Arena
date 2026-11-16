#!/usr/bin/env python3
"""PG17 ticket cashability and direct-entry principal through actual money owners.

The actual promo ticket money door refuses new purchases; the original ticket
owner accepts explicit cashable player/agent sources. The native fixture runs
original cancellation, debit and Free Buy owners with documented journal,
registration and original-source-return intent adapters. The actual fee
migration prefix captures immutable direct and earned-entry funding.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse,hashlib,importlib.util,json,os,subprocess,tempfile,uuid,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def module(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
base=module(ROOT/'scripts/ci/test-promo-play-through.py','ticket_promo_base')
C,A,B=base.CLUB,base.ALICE,base.BOB
T='71000000-0000-0000-0000-000000000001';F='71000000-0000-0000-0000-000000000002'
MIGRATION=ROOT/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_direct_entries_retain_principal.sql'

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--custody-migration',type=Path,default=ROOT/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql');p.add_argument('--fee-migration',type=Path,default=ROOT/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql');args=p.parse_args()
 if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
 args.output.mkdir(parents=True,exist_ok=False);tmp=Path(tempfile.mkdtemp(prefix='ptp-'));pg=Path(base.pg_bin());db=base.Db(str(tmp),54429,'promo_tickets');started=False;checks=[];passed=False
 def check(label,actual,expected):
  ok=actual==expected;checks.append(dict(check=label,ok=ok,actual=actual,expected=expected));print(('PASS ' if ok else 'FAIL ')+label,flush=True)
  if not ok:raise AssertionError((label,actual,expected))
 def one(sql):return db.one(sql)
 def call(who,expression,prefix=''):
  output=one(prefix+f"SET test.uid='{who}';SELECT {expression};")
  return json.loads(next(line for line in output.splitlines() if line.startswith('{')))
 def reset():
  db.run("TRUNCATE ca_promo_event_principal_lots,ca_promo_event_realization_slices,ca_promo_event_realization_receipts,ca_promo_principal_custody,ca_promo_play_through_grants,chip_ledger,chip_transactions,tournament_tickets,tournament_ticket_entry_targets,tournament_players,rake_attributions,fixture_principal_returns,smarter_private.free_buy_ticket_redemptions,smarter_private.free_buy_ticket_days;SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=100;UPDATE agents SET agent_wallet_balance=100,promo_wallet_balance=1000;UPDATE tournaments SET status='REGISTERING';UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';SET fixture.skip_journal='0';")
 def held(kind='player_wallet',entity=A,who=A):return one(f"SELECT fn_ca_promo_locked_at('{C}','{who}','{kind}','{entity}')")
 def payout(event,value,category='tournament_prize',who=A,entitlement=None):
  context='' if entitlement is None else f"SET LOCAL app.ca_promo_refund_entitlement='{entitlement}';"
  return db.run(f"""BEGIN;{context}SET LOCAL app.ledger_category='{category}';SET LOCAL app.ledger_counterparty='prize_liability';SET LOCAL app.ledger_counterparty_entity='{event}';UPDATE club_members SET chip_balance=chip_balance+{value} WHERE club_id='{C}' AND user_id='{who}';COMMIT;""")
 try:
  subprocess.run([pg/'initdb','-D',tmp/'data','-U','postgres','-A','trust'],check=True,capture_output=True)
  subprocess.run([pg/'pg_ctl','-D',tmp/'data','-w','-o',f"-p 54429 -k {tmp} -c listen_addresses=''",'-l',tmp/'log','start'],check=True,capture_output=True);started=True
  db.run('CREATE DATABASE promo_tickets',db='postgres');db.run(base.STUB)
  for f in base.MIGRATIONS:db.run(Path(f).read_text())
  db.run((ROOT/'scripts/ci/fixtures/promo-ticket-play-through/setup.sql').read_text())
  db.run(f"INSERT INTO clubs VALUES('{C}','chips',NULL);INSERT INTO agents(club_id,user_id,agent_wallet_balance) VALUES('{C}','{A}',100),('{C}','{B}',100);UPDATE club_members SET role='owner' WHERE user_id='{A}';INSERT INTO profiles VALUES('{A}',false),('{B}',false);INSERT INTO tournaments(id,club_id) VALUES('{T}','{C}'),('{F}','{C}');UPDATE tournaments SET is_free_buy=true,buy_in_amount=0,buy_in_fee=0 WHERE id='{F}';")
  cash=(ROOT/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql').read_text()
  db.run(cash[cash.index('CREATE TABLE public.cash_participant_funding_receipts'):cash.index('-- Invoked only by the original private funding cores')])
  db.run(cash[cash.index('CREATE FUNCTION public.fn_cash_record_original_funding'):cash.index('-- This is a prospective game/roster snapshot')])
  captures=json.loads((ROOT/'tests/fixtures/ev-cashout-lifecycle/captured-authorities.json').read_text())['functions']
  db.run(next(r['definition'] for r in captures if r['signature'].split('(')[0]=='fn_ca_commit_hand_settlement'))
  db.run(args.custody_migration.read_text())
  owners=json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/current-owners.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/additional-owners.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/restricted-owner.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/batch-owner.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/promo-batch-owner.json').read_text())
  for r in owners:
   db.run(r['definition'])
   sig=r['signature'] if '.' in r['signature'].split('(')[0] else 'public.'+r['signature']
   check('captured actual owner '+r['proname'],one(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))"),r['md5'])
  fee=args.fee_migration.read_text();db.run(fee[:fee.index('DO $owners$')]+'COMMIT;')
  db.run(MIGRATION.read_text())
  check('private ticket owner is not browser callable',one("SELECT NOT has_function_privilege('authenticated','fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text)','EXECUTE')"),'t')
  reset()
  result=call(A,f"fn_cashier_promo_ticket_send('{C}','{B}',20,'new-promo-ticket')")
  check('original promo ticket door refuses new purchases',result.get('error_code'),'promo_ticket_purchase_forbidden')
  check('refused promo purchase moves no balance or ticket',one('SELECT count(*) FROM tournament_tickets'),'0')
  check('refused promo purchase preserves promo wallet',one(f"SELECT promo_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{A}'"),'1000')
  items=json.dumps([{'user_id':B,'amount':20,'idempotency_key':'new-promo-batch-ticket'}]);batch=str(uuid.uuid4())
  result=call(A,f"fn_cashier_promo_ticket_batch('{C}','{items}'::jsonb,'{batch}')")
  check('original promo batch cannot bypass its restricted money door',result['results'][0].get('error_code'),'promo_ticket_purchase_forbidden')
  db.run(f"INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,metadata) VALUES('{C}','{A}','{B}',20,'promo_wallet_send',jsonb_build_object('idempotency_key','historical-ticket','destination','tournament_ticket','ticket_id',gen_random_uuid(),'sender_promo_after',980))")
  result=call(A,f"fn_cashier_promo_ticket_send('{C}','{B}',20,'historical-ticket')")
  check('historical committed promo ticket answers exact receipt replay',result.get('replayed'),True)
  check('historical replay never creates a new entitlement',one('SELECT count(*) FROM tournament_tickets'),'0')
  historical=str(uuid.uuid4())
  db.run(f"INSERT INTO tournament_tickets(id,club_id,issued_by,holder_id,value,note) VALUES('{historical}','{C}','{B}','{A}',20,'Promo Cashier Ticket');INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,metadata) VALUES('{C}','{B}','{A}',20,'promo_wallet_send',jsonb_build_object('ticket_id','{historical}','destination','tournament_ticket','escrow_entity_id','{historical}'))")
  result=call(A,f"fn_redeem_tournament_ticket('{historical}')")
  check('historical promo-funded ticket remains redeemable by its original holder',result.get('success'),True)
  check('historical ticket redemption creates no retroactive grant',one('SELECT count(*) FROM ca_promo_play_through_grants'),'0')
  check('historical ticket redemption preserves original face value',one(f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'"),'120')
  reset()
  # Old player clients keep their original cashable payment owner.
  db.run(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',50,'club_promo','player-cashability')")
  result=call(A,f"fn_issue_tournament_ticket_phase2_core_20260831('{C}','{B}',60,NULL,'locked-player-ticket')")
  check('locked promo inside player wallet cannot purchase a ticket',result.get('success'),False)
  result=call(A,f"fn_issue_tournament_ticket_phase2_core_20260831('{C}','{B}',40,NULL,'cash-player-ticket')")
  check('unrestricted player chips can purchase a ticket',result.get('success'),True)
  check('player ticket keeps locked original promo in sender wallet',held(),'50')
  reset()
  batch=str(uuid.uuid4());items=json.dumps([{'user_id':B,'amount':40,'source':'agent_wallet','idempotency_key':'agent-ticket-40'}])
  result=call(A,f"fn_cashier_agent_ticket_batch('{C}','ticket','{items}'::jsonb,'{batch}')")
  check('existing batch accepts cashable agent wallet ticket',result['results'][0].get('success'),True)
  tid=result['results'][0]['ticket_id']
  check('agent ticket debits original agent wallet only',one(f"SELECT agent_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{A}'"),'60')
  check('agent ticket preserves player wallet',one(f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'"),'100')
  check('agent ticket journals exact original funding leg',one("SELECT from_type||':'||to_type||':'||amount FROM chip_ledger WHERE category='ticket_issue'"),'agent_wallet:escrow:40')
  result=call(A,f"fn_issue_tournament_ticket_agent('{C}','{B}',40,NULL,'agent-ticket-40')")
  check('agent ticket lost-response retry replays once',result.get('replayed'),True)
  result=call(A,f"fn_issue_tournament_ticket_phase2_core_20260831('{C}','{B}',40,NULL,'agent-ticket-40')")
  check('same retry key cannot silently change source wallet',result.get('success'),False)
  result=call(A,f"fn_cancel_tournament_ticket('{tid}')")
  check('original cancellation returns agent-funded escrow to agent wallet',result.get('refund_wallet'),'agent_wallet')
  check('agent cancellation conserves original source balance',one(f"SELECT agent_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{A}'"),'100')
  result=call(A,f"fn_cancel_tournament_ticket('{tid}')")
  check('agent cancellation replay is idempotent',result.get('replayed'),True)
  reset();db.run(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',80,'club_promo','agent-cashability');UPDATE ca_promo_principal_custody SET kind='agent_wallet';")
  result=call(A,f"fn_issue_tournament_ticket_agent('{C}','{B}',30,NULL,'agent-locked')")
  check('locked promo inside agent wallet cannot purchase a ticket',result.get('success'),False)
  # Actual direct entry spends promo after available unrestricted cash.
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','direct-entry');SET fixture.skip_journal='0';")
  result=call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  check('promo can enter a tournament directly',result.get('ok'),True)
  check('direct entry moves original principal to its event',held('event',T),'20')
  check('direct entry locks no unrelated wallet money',held(),'0')
  check('direct promo fee handoff preserves original amount',one('SELECT f.promo_amount FROM ca_promo_entry_fee_funding f JOIN chip_ledger l ON l.id=f.charge_ledger_id'),'20')
  original_charge=one('SELECT charge_ledger_id FROM ca_promo_event_principal_lots')
  payout(T,7);payout(T,30)
  check('partial prizes retain only original principal',held(),'20')
  check('prize profit stays cashable',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'17')
  check('prizes create no second grant or target',one("SELECT count(*)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'1:80.0000')
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','lost-entry');SET fixture.skip_journal='0';")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{T}'")
  check('full event loss permanently closes its original grant',one('SELECT close_reason FROM ca_promo_play_through_grants'),'spent')
  db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=25 WHERE club_id='{C}' AND user_id='{A}';")
  check('later real or rakeback credit never revives lost promo',held(),'0')
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','refund-entry');SET fixture.skip_journal='0';")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  original_charge=one('SELECT charge_ledger_id FROM ca_promo_event_principal_lots');ent=str(uuid.uuid4());other_charge=str(uuid.uuid4())
  db.run(f"INSERT INTO tournament_refund_entitlements VALUES('{ent}','{T}','{A}','{C}',10,'{other_charge}')")
  payout(T,10,'refund',entitlement=ent)
  check('real-entry refund cannot realize another entry promo',held(),'0')
  check('real-entry refund preserves original event lot',held('event',T),'20')
  ent=str(uuid.uuid4());db.run(f"INSERT INTO tournament_refund_entitlements VALUES('{ent}','{T}','{A}','{C}',8,'{original_charge}')")
  payout(T,8,'refund',entitlement=ent)
  check('partial exact-entry refund realizes its own principal',held(),'8')
  check('partial exact-entry refund leaves original remainder',held('event',T),'12')
  target=str(uuid.uuid4());db.run(f"INSERT INTO tournaments(id,club_id) VALUES('{target}','{C}');INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('prize_liability','{T}','prize_liability','{target}',30,'tournament_buyin','{C}',jsonb_build_object('user_id','{A}'))")
  check('earned satellite entry retains surviving original principal',held('event',target),'12')
  check('earned satellite entry creates no new target',one("SELECT count(*)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'1:80.0000')
  earned=str(uuid.uuid4());next_event=str(uuid.uuid4())
  db.run(f"INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('prize_liability','{target}','escrow','{earned}',30,'ticket_issue','{C}',jsonb_build_object('user_id','{A}'));INSERT INTO tournament_tickets(id,club_id,issued_by,holder_id,value,redemption_mode,source_tournament_id) VALUES('{earned}','{C}','{B}','{A}',30,'tournament_entry_only','{target}');")
  check('earned noncash award holds surviving original principal',held('ticket',earned),'12')
  db.run(f"INSERT INTO tournaments(id,club_id) VALUES('{next_event}','{C}');INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('escrow','{earned}','prize_liability','{next_event}',30,'ticket_redeem','{C}',jsonb_build_object('user_id','{A}'))")
  check('earned satellite award can enter with its original principal',held('event',next_event),'12')
  check('earned award redemption does not create another target',one("SELECT count(*)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'1:80.0000')
  check('actual fee owner captures earned ticket original principal',one("SELECT f.promo_amount FROM ca_promo_entry_fee_funding f JOIN chip_ledger l ON l.id=f.charge_ledger_id WHERE l.from_type='escrow'"),'12')
  check('actual fee owner captures satellite carried original principal',one("SELECT f.promo_amount FROM ca_promo_entry_fee_funding f JOIN chip_ledger l ON l.id=f.charge_ledger_id WHERE l.from_type='prize_liability'"),'12')
  refused=db.run(f"SELECT fn_ca_promo_leave_events('{C}','{A}')",check=False)
  check('club departure cannot discard active event or earned entry principal',refused.returncode!=0 and 'promo_event_still_active' in refused.stderr,True)
  reset();registrations=[];events=[]
  for index in range(5):
   event=str(uuid.uuid4());registration=str(uuid.uuid4());events.append(event);registrations.append(registration)
   db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy,buy_in_amount,buy_in_fee) VALUES('{event}','{C}',true,0,0);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{registration}','{event}','{A}','registered');SELECT smarter_private.free_buy_ticket_redeem('{event}','{registration}');")
  check('all five daily Free Buy redemptions create their original grants',one('SELECT count(*) FROM ca_promo_play_through_grants'),'5')
  check('each Free Buy records one face value and four fees',one('SELECT sum(amount)||\':\'||sum(fee_target) FROM ca_promo_play_through_grants'),'5:20.0000')
  check('Free Buy coupons do not lock unrelated real cash',held(),'0')
  event=str(uuid.uuid4());registration=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy) VALUES('{event}','{C}',true);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{registration}','{event}','{A}','registered');")
  refused=db.run(f"SELECT smarter_private.free_buy_ticket_redeem('{event}','{registration}')",check=False)
  check('original five-per-day limit still refuses sixth coupon',refused.returncode!=0 and 'FREE_BUY_TICKETS_USED_TODAY' in refused.stderr,True)
  check('refused sixth coupon creates no grant',one('SELECT count(*) FROM ca_promo_play_through_grants'),'5')
  db.run(f"SELECT smarter_private.free_buy_ticket_restore('{registrations[0]}')")
  check('original unplayed Free Buy return closes its own principal',one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE source_ref='free_buy_ticket:{registrations[0]}'"),'returned')
  check('original unplayed return restores coupon allowance',one('SELECT used FROM smarter_private.free_buy_ticket_days'),'4')
  db.run(f"SELECT smarter_private.free_buy_ticket_redeem('{events[1]}','{registrations[1]}')")
  check('Free Buy book replay creates no duplicate target',one('SELECT count(*) FROM ca_promo_play_through_grants'),'5')
  payout(events[1],5)
  check('a Free Buy locks at most its original one-chip value',held(),'1')
  check('Free Buy profit remains cashable',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'104')
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{events[2]}'")
  check('a lost Free Buy coupon closes at terminal without touching other coupons',one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE source_ref='free_buy_ticket:{registrations[2]}'"),'spent')
  reset()
  with ThreadPoolExecutor(max_workers=2) as pool:
   replies=list(pool.map(lambda _:call(A,f"fn_issue_tournament_ticket_agent('{C}','{B}',40,NULL,'concurrent-agent-ticket')"),range(2)))
  check('concurrent agent ticket has one original financial result',sum(x.get('replayed') is False for x in replies),1)
  check('concurrent agent ticket has one replay',sum(x.get('replayed') is True for x in replies),1)
  check('concurrent agent ticket debits once',one(f"SELECT agent_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{A}'"),'60')
  check('concurrent agent ticket creates one escrow entitlement',one('SELECT count(*) FROM tournament_tickets'),'1')
  passed=True
 finally:
  report={'status':'passed' if passed else 'failed','checks':checks,'production_mutations':False,'source_sha256':{str(MIGRATION.relative_to(ROOT)):hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),str(args.custody_migration):hashlib.sha256(args.custody_migration.read_bytes()).hexdigest(),str(args.fee_migration):hashlib.sha256(args.fee_migration.read_bytes()).hexdigest()}}
  (args.output/'RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
  if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','-w','stop'],capture_output=True)
  shutil.rmtree(tmp)
 print(str(len(checks))+' checks passed')
if __name__=='__main__':main()

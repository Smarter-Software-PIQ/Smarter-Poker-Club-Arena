#!/usr/bin/env python3
"""PG17 promo ticket custody through actual captured ticket and debit owners.

A minimal journal/registration adapter exposes original declared legs; this is
not production tally or full registration/accounting qualification. Actual
redemption, cancellation, forced-entry wrapper, debit primitive, Free Buy book,
new custody/lots and fee handoff run unchanged from maintained source.
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
MIGRATION=ROOT/'supabase/migrations/20261116154719_promo_tickets_retain_one_original_lock_through_redemption_an.sql'

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--custody-migration',type=Path,default=ROOT/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql');args=p.parse_args()
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
  db.run("TRUNCATE ca_promo_ticket_entry_bridges,ca_promo_event_principal_lots,ca_promo_event_realization_slices,ca_promo_event_realization_receipts,ca_promo_principal_custody,ca_promo_play_through_grants,chip_ledger,chip_transactions,tournament_tickets,tournament_ticket_entry_targets,tournament_players,rake_attributions,fixture_fee_funding,fixture_principal_returns,smarter_private.free_buy_ticket_redemptions,smarter_private.free_buy_ticket_days;SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=100;UPDATE agents SET agent_wallet_balance=100,promo_wallet_balance=1000;UPDATE tournaments SET status='REGISTERING';UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';")
 def issue(value=20,holder=A,key=None):
  key=key or str(uuid.uuid4())
  db.run(f"""BEGIN;SET fixture.skip_journal='1';UPDATE agents SET promo_wallet_balance=promo_wallet_balance-{value} WHERE club_id='{C}' AND user_id='{B}';SET fixture.skip_journal='0';
   INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('promo_wallet','{B}','escrow','{key}',{value},'ticket_issue','{C}');
   INSERT INTO tournament_tickets(id,club_id,issued_by,holder_id,value) VALUES('{key}','{C}','{B}','{holder}',{value});
   INSERT INTO chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,metadata)
    VALUES('{C}','{B}','{holder}',{value},'promo_wallet_send',jsonb_build_object('ticket_id','{key}','destination','tournament_ticket','escrow_entity_id','{key}'));
   COMMIT;""")
  return key
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
  owners=json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/current-owners.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/additional-owners.json').read_text())
  for r in owners:
   db.run(r['definition'])
   sig=r['signature'] if '.' in r['signature'].split('(')[0] else 'public.'+r['signature']
   check('captured actual owner '+r['proname'],one(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))"),r['md5'])
  db.run(MIGRATION.read_text())
  check('private helpers cannot be invoked by a browser',one("SELECT NOT has_function_privilege('authenticated','fn_ca_promo_ticket_entry_funding(uuid)','EXECUTE')"),'t')
  reset();tid=issue()
  check('ticket issue creates one original grant',one('SELECT count(*) FROM ca_promo_play_through_grants'),'1')
  check('ticket value is pending custody',held('ticket',tid),'20')
  check('pending ticket does not lock unrelated cash',held(),'0')
  check('pending ticket original target is four times face value',one('SELECT fee_target FROM ca_promo_play_through_grants'),'80.0000')
  result=call(A,f"fn_redeem_tournament_ticket('{tid}')")
  check('actual direct redemption succeeds',result.get('success'),True)
  check('redemption moves only original principal into wallet',held(),'20')
  check('redemption creates no second grant',one('SELECT count(*) FROM ca_promo_play_through_grants'),'1')
  check('redemption leaves own cash cashable',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'100')
  result=call(A,f"fn_redeem_tournament_ticket('{tid}')")
  check('actual redemption response-loss replay is idempotent',result.get('replayed'),True)
  check('redemption replay does not duplicate principal',held(),'20')
  reset();tid=issue();result=call(B,f"fn_cancel_tournament_ticket('{tid}')")
  check('actual original issuer cancellation succeeds',result.get('success'),True)
  check('original cancellation returns its own promo source',one(f"SELECT promo_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{B}'"),'1000')
  check('cancellation closes the original ticket grant',one('SELECT close_reason FROM ca_promo_play_through_grants'),'returned')
  reset();tid=issue();result=call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')")
  check('actual forced-entry wrapper succeeds',result.get('ok'),True)
  check('forced entry keeps ticket principal against its event',held('event',T),'20')
  check('forced entry never reserves unrelated real wallet',held(),'0')
  check('forced entry retains one original target',one('SELECT count(*)||\':\'||sum(fee_target) FROM ca_promo_play_through_grants'),'1:80.0000')
  check('fee handoff receives original promo-funded full charge',one('SELECT promo FROM fixture_fee_funding'),'20')
  check('entry restores scoped ticket context',one("SELECT COALESCE(current_setting('app.ca_promo_ticket_entry',true),'')=''"),'t')
  payout(T,7);check('partial event winnings realize original principal once',held(),'7')
  check('partial event win retains unreturned event principal',held('event',T),'13')
  payout(T,30);check('event profit never creates additional principal',held(),'20')
  check('event cashable profit remains unrestricted',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'117')
  reset();tid=issue();result=call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')",prefix="SET fixture.refuse_entry='1';")
  check('original refused registration remains refused',result.get('ok'),False)
  check('failed entry restores original ticket',one(f"SELECT status FROM tournament_tickets WHERE id='{tid}'"),'issued')
  check('failed entry restores pending principal',held('ticket',tid),'20')
  check('failed entry leaves no bridge or realized cash',one('SELECT count(*) FROM ca_promo_ticket_entry_bridges'),'0')
  check('failed entry restores original own balance',one(f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'"),'100')
  reset();tid=issue();call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')")
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{T}'")
  check('a ticket with no winnings closes spent at actual terminal transition',one('SELECT close_reason FROM ca_promo_play_through_grants'),'spent')
  check('terminal loss removes the pending obligation',held('event',T),'0')
  db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=chip_balance+25 WHERE club_id='{C}' AND user_id='{A}';")
  check('a later real credit never revives a busted ticket',held(),'0')
  reset();tid=issue();call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')");payout(T,7)
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{T}'")
  check('terminal loss removes only unrealized principal',one('SELECT remaining FROM ca_promo_play_through_grants'),'7')
  check('already won principal remains one original lock',held(),'7')
  reset();db.run(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',50,'club_promo','gift-guard')")
  result=call(A,f"fn_issue_tournament_ticket_phase2_core_20260831('{C}','{B}',60,NULL,'guarded-gift')")
  check('actual ordinary ticket gift cannot carry locked principal',result.get('success'),False)
  check('refused gift moves no wallet or ticket',one('SELECT count(*) FROM tournament_tickets'),'0')
  result=call(A,f"fn_issue_tournament_ticket_phase2_core_20260831('{C}','{B}',40,NULL,'cash-gift')")
  check('actual ordinary gift can spend unrestricted cash',result.get('success'),True)
  check('cash gift leaves original promo in original wallet',held(),'50')
  reset();tid=issue();db.run("UPDATE ca_promo_play_through_grants SET expires_at=clock_timestamp()-interval '1 second';")
  check('unused cash ticket expiry uses original cancellation owner',one('SELECT fn_ca_promo_expire_tickets(100)'),'1')
  check('unused ticket expiry returns original source balance',one(f"SELECT promo_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{B}'"),'1000')
  check('unused ticket expiry closes principal as expired',one('SELECT close_reason FROM ca_promo_play_through_grants'),'expired')
  check('expiry replay cannot return funds twice',one('SELECT fn_ca_promo_expire_tickets(100)'),'0')
  reset();tid=issue();db.run(f"SELECT fn_ca_promo_leave_tickets('{C}','{A}')")
  check('club departure cancels unused original promo ticket',one(f"SELECT status FROM tournament_tickets WHERE id='{tid}'"),'cancelled')
  reset();tid=issue();call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')")
  refused=db.run(f"SELECT fn_ca_promo_leave_tickets('{C}','{A}')",check=False)
  check('club departure cannot discard active event principal',refused.returncode!=0 and 'promo_event_still_active' in refused.stderr,True)
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
  reset();tid=issue();db.run(f"INSERT INTO rake_attributions(player_id,club_id,rake_amount) VALUES('{A}','{C}',80)")
  call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')")
  check('a fully met original ticket creates no new lock on redemption',held('event',T),'0')
  check('already earned ticket unlock captures explicit zero promo fee basis',one('SELECT promo FROM fixture_fee_funding'),'0')
  # Two independent actual requests must serialize the original entitlement.
  reset();tid=issue()
  with ThreadPoolExecutor(max_workers=2) as pool:
   replies=list(pool.map(lambda _:call(A,f"fn_redeem_tournament_ticket('{tid}')"),range(2)))
  check('concurrent actual redemption has one first result',sum(x.get('replayed') is False for x in replies),1)
  check('concurrent redemption credits principal once',held(),'20')
  check('concurrent redemption books one immutable receipt',one("SELECT count(*) FROM chip_transactions WHERE transaction_type='tournament_ticket_redeem'"),'1')
  # Exact refund lots must never take another purchase's principal.
  reset();tid=issue();call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')")
  original_charge=one('SELECT charge_ledger_id FROM ca_promo_ticket_entry_bridges')
  real_charge=str(uuid.uuid4());ent=str(uuid.uuid4())
  db.run(f"INSERT INTO tournament_refund_entitlements VALUES('{ent}','{T}','{A}','{C}',10,'{real_charge}')")
  payout(T,10,'refund',entitlement=ent)
  check('unrelated real-entry refund realizes no promo principal',held(),'0')
  check('unrelated refund preserves original promo entry lot',held('event',T),'20')
  ent=str(uuid.uuid4());db.run(f"INSERT INTO tournament_refund_entitlements VALUES('{ent}','{T}','{A}','{C}',8,'{original_charge}')")
  payout(T,8,'refund',entitlement=ent)
  check('partial exact-entry refund realizes only its original slice',held(),'8')
  check('partial exact-entry refund leaves remaining original slice',held('event',T),'12')
  # A satellite rollover changes custody, never the original grant/fee target.
  reset();tid=issue();call(A,f"fn_ca_use_cashier_entry_ticket('{T}','{tid}','{A}')")
  target=str(uuid.uuid4());db.run(f"INSERT INTO tournaments(id,club_id) VALUES('{target}','{C}');INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('prize_liability','{T}','prize_liability','{target}',30,'tournament_buyin','{C}',jsonb_build_object('user_id','{A}'))")
  check('satellite rollover retains just original principal',held('event',target),'20')
  check('satellite rollover leaves no duplicate source position',held('event',T),'0')
  check('satellite rollover retains one original four-times target',one("SELECT count(*)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'1:80.0000')
  check('satellite fee handoff excludes winnings above original principal',one("SELECT promo FROM fixture_fee_funding JOIN chip_ledger l ON l.id=ledger_id WHERE l.from_type='prize_liability'"),'20')
  passed=True
 finally:
  report={'status':'passed' if passed else 'failed','checks':checks,'production_mutations':False,'source_sha256':{str(MIGRATION.relative_to(ROOT)):hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),str(args.custody_migration):hashlib.sha256(args.custody_migration.read_bytes()).hexdigest()}}
  (args.output/'RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
  if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','-w','stop'],capture_output=True)
  shutil.rmtree(tmp)
 print(str(len(checks))+' checks passed')
if __name__=='__main__':main()

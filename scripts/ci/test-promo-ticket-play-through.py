#!/usr/bin/env python3
"""PG17 ticket cashability and direct-entry principal through actual money owners.

The actual promo ticket money door refuses new purchases; the original ticket
owner accepts explicit cashable player/agent sources. The native fixture runs
original cancellation, debit and Free Buy owners with documented journal,
registration and original-source-return intent adapters. The actual fee
migration prefix captures immutable direct and earned-entry funding.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse,hashlib,importlib.util,json,os,subprocess,tempfile,time,uuid,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def module(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
base=module(ROOT/'scripts/ci/test-promo-play-through.py','ticket_promo_base')
C,A,B=base.CLUB,base.ALICE,base.BOB
T='71000000-0000-0000-0000-000000000001';F='71000000-0000-0000-0000-000000000002'
MIGRATION=ROOT/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_keep_entry_source.sql'
CUTOFF_ORDER=ROOT/'supabase/migrations/20261118031947_free_buy_cutoff_funding_takes_the_union_wallet_last.sql'
U='fade0000-0000-0000-0000-000000000001'

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--require-resolution-guard',action='store_true');p.add_argument('--output',type=Path,required=True);p.add_argument('--custody-migration',type=Path,default=ROOT/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql');p.add_argument('--fee-migration',type=Path,default=ROOT/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql');args=p.parse_args()
 if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
 inventory_capture=args.custody_migration.parents[2]/'tests/fixtures/promo-custody-inventory-pin.json'
 args.output.mkdir(parents=True,exist_ok=False);tmp=Path(tempfile.mkdtemp(prefix='ptp-'));pg=Path(base.pg_bin());db=base.Db(str(tmp),54429,'promo_tickets');started=False;checks=[];passed=False
 def check(label,actual,expected):
  ok=actual==expected;checks.append(dict(check=label,ok=ok,actual=actual,expected=expected));print(('PASS ' if ok else 'FAIL ')+label,flush=True)
  if not ok:raise AssertionError((label,actual,expected))
 def one(sql):return db.one(sql)
 def call(who,expression,prefix=''):
  output=one(prefix+f"SET test.uid='{who}';SELECT {expression};")
  return json.loads(next(line for line in output.splitlines() if line.startswith('{')))
 def reset():
  db.run("SET session_replication_role=replica;TRUNCATE ca_promo_free_buy_exhaustions,ca_promo_event_entry_loss_slices,ca_promo_event_entry_loss_receipts,tournament_refund_tranches,ca_promo_event_fee_source_links,ca_promo_event_fee_consumption_slices,ca_promo_event_fee_consumption_receipts,ca_promo_free_buy_funding_slices,ca_promo_event_principal_lots,ca_promo_event_realization_slices,ca_promo_event_realization_receipts,ca_promo_principal_custody,ca_promo_play_through_grants,chip_ledger,chip_transactions,tournament_tickets,tournament_ticket_entry_targets,tournament_players,rake_attributions,fixture_principal_returns,smarter_private.free_buy_ticket_redemptions,smarter_private.free_buy_ticket_days;SET session_replication_role=origin;SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=100;UPDATE agents SET agent_wallet_balance=100,promo_wallet_balance=1000;UPDATE tournaments SET status='REGISTERING';UPDATE tournaments SET buy_in_amount=18,buy_in_fee=2 WHERE id='71000000-0000-0000-0000-000000000001';UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';SET fixture.skip_journal='0';")
 def held(kind='player_wallet',entity=A,who=A):return one(f"SELECT fn_ca_promo_locked_at('{C}','{who}','{kind}','{entity}')")
 def payout(event,value,category='tournament_prize',who=A,entitlement=None,club=C):
  context='' if entitlement is None else f"SET LOCAL app.ca_promo_refund_entitlement='{entitlement}';"
  return db.run(f"""BEGIN;{context}SET LOCAL app.ledger_category='{category}';SET LOCAL app.ledger_counterparty='prize_liability';SET LOCAL app.ledger_counterparty_entity='{event}';UPDATE club_members SET chip_balance=chip_balance+{value} WHERE club_id='{club}' AND user_id='{who}';COMMIT;""")
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
  inventory=json.loads(inventory_capture.read_text())
  for r in inventory['funding_owners']:
   db.run(r['definition']+';REVOKE ALL ON FUNCTION public.'+r['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
   check('actual custody prerequisite '+r['signature'],one(f"SELECT md5(pg_get_functiondef('public.{r['signature']}'::regprocedure))"),r['md5'])
  db.run('CREATE SCHEMA IF NOT EXISTS smarter_private;'+inventory['definition']+';REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;')
  db.run(args.custody_migration.read_text())
  owners=json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/current-owners.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/additional-owners.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/restricted-owner.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/batch-owner.json').read_text())+json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/promo-batch-owner.json').read_text())
  for r in owners:
   db.run(r['definition'])
   sig=r['signature'] if '.' in r['signature'].split('(')[0] else 'public.'+r['signature']
   check('captured actual owner '+r['proname'],one(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))"),r['md5'])
  purchase=json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/purchase-owner.json').read_text())
  purchase_price=json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/purchase-price-owner.json').read_text())
  priority={'fn_ca_unit_floor_cents':0,'fn_ca_tournament_fee_ratio':0,'fn_ca_recovery_fee_cents':1,'fn_ca_tournament_purchase_fee_ratio':1}
  for r in sorted(purchase+purchase_price,key=lambda r:priority.get(r['signature'].split('(')[0],2)):
   db.run(r['definition'])
   if 'guard_mtt' in r['signature'] or 'process_tournament' in r['signature']:db.run('REVOKE ALL ON FUNCTION public.'+r['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
   check('actual purchase owner '+r['signature'],one(f"SELECT md5(pg_get_functiondef('public.{r['signature']}'::regprocedure))"),r['md5'])
  for r in json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/bust-owner.json').read_text()):
   db.run('SET check_function_bodies=off;'+r['definition']+';SET check_function_bodies=on;REVOKE ALL ON FUNCTION public.'+r['signature']+' FROM PUBLIC,anon,authenticated,service_role;')
   check('actual original bust owner '+r['signature'],one(f"SELECT md5(pg_get_functiondef('public.{r['signature']}'::regprocedure))"),r['md5'])
  for r in json.loads((ROOT/'tests/fixtures/promo-ticket-play-through/free-buy-funding-owners.json').read_text()):
   db.run(r['definition']);check('actual Free Buy funding owner '+r['signature'],one(f"SELECT md5(pg_get_functiondef('{r['signature']}'::regprocedure))"),r['definition_md5'])
  # The captured production owner above is the preimage this migration guards.
  db.run(CUTOFF_ORDER.read_text())
  db.run("INSERT INTO union_wallets VALUES('fade0000-0000-0000-0000-000000000001',10000,NULL)")
  fee=args.fee_migration.read_text();db.run(fee[:fee.index('DO $owners$')]+'COMMIT;')
  db.run(MIGRATION.read_text())
  if args.require_resolution_guard:
   guard=ROOT/'supabase/migrations/20261115020406_a_function_that_calls_a_missing_signature_is_refused_at_comm.sql'
   db.run(guard.read_text())
   check('genuine production function checker is installed',one("SELECT extname='plpgsql_check' AND extversion IS NOT NULL FROM pg_extension WHERE extname='plpgsql_check'"),'t')
   # The financial fixture intentionally omits unrelated original manager and
   # seat readers. Qualify this exact failing source owner under the complete
   # genuine deferred DDL guard after its actual relation closure exists.
   current=one("SELECT pg_get_functiondef('public.fn_ca_promo_record_event_charge(uuid)'::regprocedure)")
   callback="THEN EXECUTE 'SELECT public.fn_ca_promo_integrity_consume_entry_fee($1::uuid)' USING l.id; END IF;"
   assert current.count(callback)==1
   before=current.replace(callback,'THEN PERFORM public.fn_ca_promo_integrity_consume_entry_fee(l.id); END IF;',1)
   refused=db.run('BEGIN;'+before+';COMMIT;',check=False)
   check('actual deferred production guard refuses the original missing H callback',refused.returncode!=0 and 'calls a function that does not exist' in refused.stderr and 'fn_ca_promo_integrity_consume_entry_fee' in refused.stderr,True)
   check('actual resolution refusal preserves the installed source owner atomically',one("SELECT pg_get_functiondef('public.fn_ca_promo_record_event_charge(uuid)'::regprocedure)"),current)
   db.run('BEGIN;'+current+';COMMIT;')
  postimages={signature:one("SELECT md5(pg_get_functiondef('"+signature+"'::regprocedure))") for signature in ['public.fn_ca_promo_record_event_charge(uuid)','public.fn_ca_promo_return_refunded_principal(uuid)','public.fn_settle_tournament_refund_exact(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,text)','public.fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text)','public.fn_cashier_batch_transfer(uuid,text,jsonb,uuid)','public.fn_cancel_tournament_ticket(uuid)']}
  (args.output/'POSTIMAGES.json').write_text(json.dumps(postimages,indent=2)+'\n')
  purchase_hash=one("SELECT md5(pg_get_functiondef('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure))")
  original_guard=next(r['definition'] for r in purchase if 'guard_mtt' in r['signature'])
  check('original admission guard changes only the exact purchase owner pin',one("SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)").strip(),original_guard.replace('9ff346ac60f760311d884c6d63d9001d',purchase_hash).strip())
  check('private ticket owner is not browser callable',one("SELECT NOT has_function_privilege('authenticated','fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text)','EXECUTE')"),'t')
  reset();db.run('UPDATE ca_promo_play_through_settings SET enforced_from=NULL')
  return_defs=[one("SELECT pg_get_functiondef('"+signature+"'::regprocedure)") for signature in ['public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)','public.fn_ca_promo_lock_grant_funds(uuid[])']]
  db.run('DROP FUNCTION public.fn_ca_promo_return_principal(uuid,text,text,numeric,text);DROP FUNCTION public.fn_ca_promo_lock_grant_funds(uuid[])')
  check('cold ticket admission has no later H or return owners',one("SELECT to_regprocedure('public.fn_ca_promo_integrity_locked_at(uuid,uuid,text,uuid)') IS NULL AND to_regprocedure('public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)') IS NULL"),'t')
  result=call(A,f"fn_issue_tournament_ticket_phase2_core_20260831('{C}','{B}',10,NULL,'cold-player-ticket')")
  check('ordinary cold player ticket works before H and return installation',result.get('success'),True)
  result=call(A,f"fn_issue_tournament_ticket_agent('{C}','{B}',10,NULL,'cold-agent-ticket')")
  check('ordinary cold agent ticket works before H and return installation',result.get('success'),True)
  for definition in return_defs:db.run(definition)
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
  # The original financial receipt clock, not transaction-start or delayed
  # agreement recognition, determines which gift earned an actual entry fee.
  reset();db.run(f"""BEGIN;SET LOCAL fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','same-transaction-gift');SET LOCAL fixture.skip_journal='0';SET LOCAL test.uid='{A}';SELECT fn_register_for_tournament_before_terminal_seat_gate('{T}',false);INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) SELECT gen_random_uuid(),'{T}','{A}','{C}',20,id,2 FROM chip_ledger WHERE category='tournament_buyin';COMMIT;""")
  check('gift then entry in the same original transaction earns immediate gross fees',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=2"),'t')
  reset();db.run(f"""BEGIN;SET LOCAL fixture.skip_journal='1';UPDATE club_members SET chip_balance=40 WHERE club_id='{C}' AND user_id='{A}';SET LOCAL fixture.skip_journal='0';SET LOCAL test.uid='{A}';SELECT fn_register_for_tournament_before_terminal_seat_gate('{T}',false);INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) SELECT gen_random_uuid(),'{T}','{A}','{C}',20,id,2 FROM chip_ledger WHERE category='tournament_buyin';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','after-original-entry');COMMIT;""")
  check('true zero promo entry freezes its original paid fee receipt',one('SELECT original_promo=0 AND principal=0 FROM ca_promo_event_fee_consumption_receipts'),'t')
  check('entry before gift in the same transaction cannot retroactively fund its target',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=0"),'t')
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',0.5,'club_promo','exact-target-entry');SET fixture.skip_journal='0';")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) SELECT gen_random_uuid(),'{T}','{A}','{C}',20,id,2 FROM chip_ledger WHERE category='tournament_buyin'")
  check('fee that exactly completes four times first consumes its actual promo expense',one('SELECT principal=0.05 AND original_promo=0.5 FROM ca_promo_event_fee_consumption_receipts'),'t')
  db.run(f"SELECT fn_ca_promo_play_through_settle('{C}','{A}')")
  check('exact target closes remaining principal permanently with original target unchanged',one("SELECT close_reason='met' AND fee_target=2 AND remaining=0 FROM ca_promo_play_through_grants"),'t')
  # Actual direct entry spends promo after available unrestricted cash.
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','direct-entry');SET fixture.skip_journal='0';")
  result=call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  check('promo can enter a tournament directly',result.get('ok'),True)
  original_charge=one('SELECT charge_ledger_id FROM ca_promo_event_principal_lots')
  fee_source=str(uuid.uuid4());entitlement=str(uuid.uuid4())
  db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) VALUES('{entitlement}','{T}','{A}','{C}',20,'{original_charge}',2)")
  check('gross paid fee progresses before earning agreements qualify',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=2"),'t')
  check('direct entry retains surviving prize principal after actual fee spend',one(f"SELECT fn_ca_promo_locked_at('{C}','{A}','event','{T}')=18"),'t')
  check('actual recognized promo fee is spent principal',one('SELECT principal=2 FROM ca_promo_event_fee_consumption_receipts'),'t')
  check('fee spend preserves original gross funding and target',one("SELECT original_promo||':'||charge_amount||':'||(SELECT fee_target FROM ca_promo_play_through_grants) FROM ca_promo_event_fee_consumption_receipts"),'20:20:80.0000')
  check('exact entitlement fee replay cannot consume principal twice',one(f"SELECT fn_ca_promo_consume_entry_fee('{original_charge}')=2"),'t')
  check('direct entry locks no unrelated wallet money',held(),'0')
  check('direct promo fee handoff preserves original amount',one('SELECT f.promo_amount FROM ca_promo_entry_fee_funding f JOIN chip_ledger l ON l.id=f.charge_ledger_id'),'20')
  original_charge=one('SELECT charge_ledger_id FROM ca_promo_event_principal_lots')
  payout(T,7);payout(T,30)
  check('partial prizes cannot reclaim already-spent promo fees',one(f"SELECT fn_ca_promo_locked_at('{C}','{A}','player_wallet','{A}')=18"),'t')
  check('prize profit stays cashable',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable')::numeric=19"),'t')
  db.run(f"INSERT INTO accounting_tournament_fee_sources(id,tournament_id,player_id,club_id,source_charge_ledger_id,source_entitlement_id,rake_credit) VALUES('{fee_source}','{T}','{A}','{C}','{original_charge}','{entitlement}',2)")
  check('late canonical source after prizes neither reconsumes nor double counts',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=2 AND fn_ca_promo_locked_at('{C}','{A}','player_wallet','{A}')=18"),'t')
  db.run(f"INSERT INTO tournament_refund_tranches(entitlement_id,tournament_id,user_id,source_wallet_club_id,refund_fee) VALUES('{entitlement}','{T}','{A}','{C}',0.5)")
  check('partial exact canonical fee refund nets only its original charge',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=1.5"),'t')
  db.run(f"INSERT INTO tournament_refund_tranches(entitlement_id,tournament_id,user_id,source_wallet_club_id,refund_fee) VALUES('{entitlement}','{T}','{A}','{C}',1.5)")
  check('full exact canonical fee refund removes its own original gross fee',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=0"),'t')
  check('prizes create no second grant or target',one("SELECT count(*)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'1:80.0000')
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','lost-entry');SET fixture.skip_journal='0';")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{T}'")
  check('full event loss permanently closes its original grant',one('SELECT close_reason FROM ca_promo_play_through_grants'),'spent')
  db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=25 WHERE club_id='{C}' AND user_id='{A}';")
  check('later real or rakeback credit never revives lost promo',held(),'0')
  new_event=str(uuid.uuid4())
  db.run(f"SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',1,'club_promo','new-gift-after-terminal-bust');INSERT INTO tournaments(id,club_id,buy_in_amount,buy_in_fee,status) VALUES('{new_event}','{C}',18,2,'REGISTERING');")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{new_event}',false)")
  db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id,refund_fee) SELECT gen_random_uuid(),'{new_event}','{A}','{C}',20,id,2 FROM chip_ledger WHERE to_entity_id='{new_event}' AND category='tournament_buyin'")
  check('final no-rebuy bust cannot consume later fees ahead of a new gift',one(f"SELECT (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_progress')::numeric=2 AND (fn_ca_promo_play_through_summary('{C}','{A}')->>'fee_target')::numeric=4"),'t')
  check('later gift never reopens original terminal spent entry',one("SELECT close_reason='spent' AND remaining=0 FROM ca_promo_play_through_grants WHERE source_ref='lost-entry'"),'t')
  reset();db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';SELECT fn_ca_promo_play_through_record_grant('{C}','{A}',20,'club_promo','refund-entry');UPDATE tournaments SET buy_in_amount=8,buy_in_fee=0 WHERE id='{T}';SET fixture.skip_journal='0';")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  original_charge=one('SELECT charge_ledger_id FROM ca_promo_event_principal_lots')
  db.run(f"UPDATE tournaments SET buy_in_amount=12 WHERE id='{T}'")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  db.run(f"SET fixture.skip_journal='1';UPDATE club_members SET chip_balance=10 WHERE club_id='{C}' AND user_id='{A}';UPDATE tournaments SET buy_in_amount=10 WHERE id='{T}';SET fixture.skip_journal='0';")
  call(A,f"fn_register_for_tournament_before_terminal_seat_gate('{T}',false)")
  other_charge=one("SELECT id FROM chip_ledger WHERE from_type='player_wallet' AND to_type='prize_liability' AND amount=10")
  ent=str(uuid.uuid4());db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id) VALUES('{ent}','{T}','{A}','{C}',10,'{other_charge}')")
  payout(T,10,'refund',entitlement=ent)
  check('real-entry refund cannot realize another entry promo',held(),'0')
  check('real-entry refund preserves original event lot',held('event',T),'20')
  check('genuine zero-P fee receipt uses original zero funding',one(f"SELECT original_promo=0 AND principal=0 FROM ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id='{other_charge}'"),'t')
  ent=str(uuid.uuid4());db.run(f"INSERT INTO tournament_refund_entitlements(id,tournament_id,user_id,refund_wallet_club_id,gross,source_ledger_id) VALUES('{ent}','{T}','{A}','{C}',8,'{original_charge}')")
  payout(T,8,'refund',entitlement=ent)
  check('partial exact-entry refund realizes its own principal',held(),'8')
  check('partial exact-entry refund leaves original remainder',held('event',T),'12')
  target=str(uuid.uuid4());target_reg=str(uuid.uuid4());db.run(f"INSERT INTO tournaments(id,club_id,buy_in_amount,buy_in_fee) VALUES('{target}','{C}',30,0);INSERT INTO tournament_players(id,tournament_id,user_id,club_id) VALUES('{target_reg}','{target}','{A}','{C}');INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('prize_liability','{T}','prize_liability','{target}',30,'tournament_buyin','{C}',jsonb_build_object('user_id','{A}','registration_id','{target_reg}'))")
  check('earned satellite entry retains surviving original principal',held('event',target),'12')
  check('earned satellite entry creates no new target',one("SELECT count(*)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'1:80.0000')
  earned=str(uuid.uuid4());next_event=str(uuid.uuid4())
  db.run(f"INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('prize_liability','{target}','escrow','{earned}',30,'ticket_issue','{C}',jsonb_build_object('user_id','{A}'));INSERT INTO tournament_tickets(id,club_id,issued_by,holder_id,value,redemption_mode,source_tournament_id) VALUES('{earned}','{C}','{B}','{A}',30,'tournament_entry_only','{target}');")
  check('earned noncash award holds surviving original principal',held('ticket',earned),'12')
  next_reg=str(uuid.uuid4());db.run(f"INSERT INTO tournaments(id,club_id,buy_in_amount,buy_in_fee) VALUES('{next_event}','{C}',30,0);INSERT INTO tournament_players(id,tournament_id,user_id,club_id) VALUES('{next_reg}','{next_event}','{A}','{C}');INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,metadata) VALUES('escrow','{earned}','prize_liability','{next_event}',30,'ticket_redeem','{C}',jsonb_build_object('user_id','{A}','registration_id','{next_reg}'))")
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
  check('five original coupon redemptions move no promo principal',one('SELECT count(*) FROM ca_promo_play_through_grants'),'0')
  for event in events:db.run(f"SELECT fn_ca_fund_free_buy_at_cutoff_locked('{event}')")
  check('actual cutoff funds all five original coupon face values',one('SELECT count(*) FROM ca_promo_play_through_grants'),'5')
  check('each Free Buy records one face value and four fees',one('SELECT sum(amount)||\':\'||sum(fee_target) FROM ca_promo_play_through_grants'),'5:20.0000')
  check('Free Buy coupons do not lock unrelated real cash',held(),'0')
  event=str(uuid.uuid4());registration=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy) VALUES('{event}','{C}',true);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{registration}','{event}','{A}','registered');")
  refused=db.run(f"SELECT smarter_private.free_buy_ticket_redeem('{event}','{registration}')",check=False)
  check('original five-per-day limit still refuses sixth coupon',refused.returncode!=0 and 'FREE_BUY_TICKETS_USED_TODAY' in refused.stderr,True)
  check('refused sixth coupon creates no grant',one('SELECT count(*) FROM ca_promo_play_through_grants'),'5')
  db.run(f"SELECT smarter_private.free_buy_ticket_restore('{registrations[0]}')")
  check('original unplayed Free Buy return closes its own principal',one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id IN(SELECT grant_id FROM ca_promo_free_buy_funding_slices WHERE registration_id='{registrations[0]}')"),'returned')
  check('original unplayed return restores coupon allowance',one('SELECT used FROM smarter_private.free_buy_ticket_days'),'4')
  db.run(f"SELECT smarter_private.free_buy_ticket_redeem('{events[1]}','{registrations[1]}')")
  check('Free Buy book replay creates no duplicate target',one('SELECT count(*) FROM ca_promo_play_through_grants'),'5')
  payout(events[1],5)
  check('a Free Buy locks at most its original one-chip value',held(),'1')
  check('Free Buy profit remains cashable',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'104')
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{events[2]}'")
  check('a lost Free Buy coupon closes at terminal without touching other coupons',one(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id IN(SELECT grant_id FROM ca_promo_free_buy_funding_slices WHERE registration_id='{registrations[2]}')"),'spent')
  reset()
  guaranteed=str(uuid.uuid4());reg=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy,guaranteed_prize,prize_pool) VALUES('{guaranteed}','{C}',true,100,120);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{reg}','{guaranteed}','{A}','registered');SELECT smarter_private.free_buy_ticket_redeem('{guaranteed}','{reg}');SELECT fn_ca_fund_free_buy_at_cutoff_locked('{guaranteed}')")
  check('covered guarantee U zero creates no coupon debt',one('SELECT count(*) FROM ca_promo_play_through_grants'),'0')
  db.run(f"UPDATE tournaments SET prize_pool=99.75 WHERE id='{guaranteed}';SELECT fn_ca_fund_free_buy_at_cutoff_locked('{guaranteed}')")
  check('actual fractional guarantee subsidy creates only funded face',one("SELECT sum(amount)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'0.25:1.0000')
  db.run(f"SELECT fn_ca_fund_free_buy_at_cutoff_locked('{guaranteed}')")
  check('actual cutoff replay cannot mint another target',one('SELECT count(*) FROM ca_promo_play_through_grants'),'1')
  reset();guaranteed=str(uuid.uuid4());ra=str(uuid.uuid4());rb=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy,guaranteed_prize,prize_pool) VALUES('{guaranteed}','{C}',true,100,99.99);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{ra}','{guaranteed}','{A}','registered'),('{rb}','{guaranteed}','{B}','registered');SELECT smarter_private.free_buy_ticket_redeem('{guaranteed}','{ra}');SELECT smarter_private.free_buy_ticket_redeem('{guaranteed}','{rb}');SELECT fn_ca_fund_free_buy_at_cutoff_locked('{guaranteed}')")
  check('aggregate subsidy cent allocation conserves exact original cent',one('SELECT sum(amount)=0.01 AND count(*)=1 FROM ca_promo_free_buy_funding_slices'),'t')
  check('aggregate subsidy cent allocation uses canonical registration order',one(f"SELECT registration_id='{max(ra,rb)}'::uuid FROM ca_promo_free_buy_funding_slices"),'t')
  check('original guarantee funding leaves max G C pool',one(f"SELECT prize_pool=100 FROM tournaments WHERE id='{guaranteed}'"),'t')
  reset();home=str(uuid.uuid4());event=str(uuid.uuid4());reg=str(uuid.uuid4())
  db.run(f"INSERT INTO clubs VALUES('{home}','chips',NULL);INSERT INTO club_members(club_id,user_id,chip_balance,status) VALUES('{home}','{A}',0,'active');INSERT INTO tournaments(id,club_id,is_free_buy) VALUES('{event}','{C}',true);INSERT INTO tournament_players(id,tournament_id,user_id,status,club_id) VALUES('{reg}','{event}','{A}','registered','{home}');SELECT smarter_private.free_buy_ticket_redeem('{event}','{reg}');SELECT fn_ca_fund_free_buy_at_cutoff_locked('{event}')")
  check('union coupon principal uses its original registration wallet club',one(f"SELECT club_id='{home}'::uuid FROM ca_promo_play_through_grants"),'t')
  payout(event,5,club=home)
  check('union coupon prize locks original face only in its paying wallet',one(f"SELECT fn_ca_promo_locked_at('{home}','{A}','player_wallet','{A}')"),'1')
  check('union coupon prize leaves profit cashable in its paying wallet',one(f"SELECT fn_ca_promo_play_through_summary('{home}','{A}')->>'cashable'"),'4')
  check('union coupon grant never locks host-club real funds',held(),'0')
  reset();guaranteed=str(uuid.uuid4());reg=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy,guaranteed_prize) VALUES('{guaranteed}','{C}',true,100);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{reg}','{guaranteed}','{A}','registered');SELECT smarter_private.free_buy_ticket_redeem('{guaranteed}','{reg}');SELECT fn_ca_fund_free_buy_at_cutoff_locked('{guaranteed}')")
  check('large guarantee subsidy never creates guarantee-sized player debt',one('SELECT sum(amount)=1 AND sum(fee_target)=4 FROM ca_promo_play_through_grants'),'t')
  check('capped face does not reduce original guarantee pool',one(f"SELECT prize_pool=100 FROM tournaments WHERE id='{guaranteed}'"),'t')
  reset();mystery=str(uuid.uuid4());reg=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy,is_mystery_bounty) VALUES('{mystery}','{C}',true,true);INSERT INTO tournament_players(id,tournament_id,user_id,status,current_bounty) VALUES('{reg}','{mystery}','{A}','registered',0.5);SELECT smarter_private.free_buy_ticket_redeem('{mystery}','{reg}');SELECT fn_ca_midway_free_buy_promo_head('{mystery}','{reg}')")
  check('actual mystery bounty creates only first funded half',one('SELECT sum(amount)=0.5 FROM ca_promo_play_through_grants'),'t')
  db.run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{mystery}'")
  check('busted first mystery half closes permanently',one('SELECT close_reason FROM ca_promo_play_through_grants'),'spent')
  db.run(f"SELECT fn_ca_fund_free_buy_at_cutoff_locked('{mystery}')")
  check('later actual mystery cutoff creates second distinct gift',one("SELECT count(*)||':'||sum(amount)||':'||sum(fee_target) FROM ca_promo_play_through_grants"),'2:1.00:4.0000')
  check('late mystery funding never attaches a new target to an already lost final registration',one("SELECT count(*) FROM ca_promo_play_through_grants WHERE close_reason='spent'"),'2')
  reset();pko=str(uuid.uuid4());reg=str(uuid.uuid4())
  db.run(f"INSERT INTO tournaments(id,club_id,is_free_buy,is_pko) VALUES('{pko}','{C}',true,true);INSERT INTO tournament_players(id,tournament_id,user_id,status,current_bounty) VALUES('{reg}','{pko}','{A}','registered',1);SELECT smarter_private.free_buy_ticket_redeem('{pko}','{reg}');SELECT fn_ca_midway_free_buy_promo_head('{pko}','{reg}');SELECT fn_ca_midway_free_buy_promo_head('{pko}','{reg}')")
  check('actual PKO bounty funds one original chip exactly once',one("SELECT count(*)=1 AND sum(amount)=1 FROM ca_promo_play_through_grants"),'t')
  db.run(f"UPDATE tournaments SET bounty_pool=1 WHERE id='{pko}';SELECT fn_ca_midway_free_buy_promo_head('{pko}','{reg}',true)")
  check('original unplayed funded PKO return closes its grant',one('SELECT close_reason FROM ca_promo_play_through_grants'),'returned')
  db.run(f"DELETE FROM tournament_players WHERE id='{reg}'")
  check('lawful unregister can delete its original registration after funded return',one(f"SELECT count(*) FROM tournament_players WHERE id='{reg}'"),'0')
  check('original funding receipt survives lawful registration deletion',one(f"SELECT count(*) FROM ca_promo_free_buy_funding_slices WHERE registration_id='{reg}'"),'1')
  # The cutoff's grants take each entrant's member row. While another session
  # holds that row the funding call is parked inside its grant loop, and the
  # union wallet row every raked cash hand writes must still be free.
  refusal='Midway promo funds cannot fund this Free Buy at its cutoff'
  left_behind=lambda event:one(f"SELECT (SELECT count(*) FROM chip_ledger WHERE tournament_id='{event}' AND category='promo_send')||':'||(SELECT count(*) FROM ca_promo_play_through_grants)||':'||(SELECT count(*) FROM ca_promo_event_principal_lots)||':'||(SELECT count(*) FROM ca_promo_free_buy_funding_slices)||':'||(SELECT round(promo_wallet,2) FROM union_wallets WHERE union_id='{U}')")
  def wait_for(sql):
   for _ in range(1200):
    if one(sql)=='t':return
    time.sleep(0.1)
   raise AssertionError('timed out waiting for '+sql)
  def cutoff_entry(balance):
   event=str(uuid.uuid4());registration=str(uuid.uuid4());reset()
   db.run(f"UPDATE union_wallets SET promo_wallet={balance} WHERE union_id='{U}';INSERT INTO tournaments(id,club_id,is_free_buy,buy_in_amount,buy_in_fee) VALUES('{event}','{C}',true,0,0);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{registration}','{event}','{A}','registered');SELECT smarter_private.free_buy_ticket_redeem('{event}','{registration}');")
   return event
  def cutoff_while_grants_wait(other):
   event=cutoff_entry(10000)
   with ThreadPoolExecutor(max_workers=2) as pool:
    holder=pool.submit(db.run,f"BEGIN;SELECT 1 FROM club_members WHERE user_id='{A}' FOR UPDATE;SELECT pg_sleep(600);",None,False)
    try:
     wait_for("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE state='active' AND query LIKE '%pg_sleep(600)%' AND pid<>pg_backend_pid())")
     funding=pool.submit(db.run,f"SELECT fn_ca_fund_free_buy_at_cutoff_locked('{event}')",None,False)
     wait_for("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%fn_ca_fund_free_buy_at_cutoff_locked%' AND pid<>pg_backend_pid())")
     free=db.run(f"SET lock_timeout='2s';{other}",check=False)
    finally:
     db.run("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(600)%' AND pid<>pg_backend_pid()")
    funded=funding.result();holder.result()
   return event,free,funded
  wallet=one(f"SELECT promo_wallet FROM union_wallets WHERE union_id='{U}'")
  event,free,funded=cutoff_while_grants_wait(f"UPDATE union_wallets SET updated_at=now() WHERE union_id='{U}'")
  check('another session writes the union wallet without waiting while cutoff funding posts its grants',[free.returncode,funded.returncode,left_behind(event)],[0,0,'1:1:1:1:9999.00'])
  event,free,funded=cutoff_while_grants_wait(f"UPDATE union_wallets SET promo_wallet=0 WHERE union_id='{U}'")
  check('a wallet emptied during the grants refuses the cutoff with its original error and leaves nothing behind',[free.returncode,funded.returncode!=0 and refusal in funded.stderr,left_behind(event)],[0,True,'0:0:0:0:0.00'])
  event=cutoff_entry(0);refused=db.run(f"SELECT fn_ca_fund_free_buy_at_cutoff_locked('{event}')",check=False)
  check('an unfunded cutoff still refuses with its original error and leaves nothing behind',[refused.returncode!=0 and refusal in refused.stderr,left_behind(event)],[True,'0:0:0:0:0.00'])
  # Every other writer takes the union wallet before a member row: a cash hand
  # credits its rake and then locks each player's member row. Such a hand,
  # holding the wallet and waiting on an entrant the cutoff already granted,
  # must end on its own timeout and never end the finish as a deadlock victim.
  reset();event=str(uuid.uuid4());first,second=sorted([str(uuid.uuid4()),str(uuid.uuid4())])
  db.run(f"UPDATE union_wallets SET promo_wallet=10000 WHERE union_id='{U}';INSERT INTO tournaments(id,club_id,is_free_buy,buy_in_amount,buy_in_fee) VALUES('{event}','{C}',true,0,0);INSERT INTO tournament_players(id,tournament_id,user_id,status) VALUES('{first}','{event}','{A}','registered'),('{second}','{event}','{B}','registered');SELECT smarter_private.free_buy_ticket_redeem('{event}','{first}');SELECT smarter_private.free_buy_ticket_redeem('{event}','{second}');")
  with ThreadPoolExecutor(max_workers=3) as pool:
   holder=pool.submit(db.run,f"BEGIN;SELECT 1 FROM club_members WHERE user_id='{B}' FOR UPDATE;SELECT pg_sleep(600);",None,False)
   try:
    wait_for("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE state='active' AND query LIKE '%pg_sleep(600)%' AND pid<>pg_backend_pid())")
    funding=pool.submit(db.run,f"SELECT fn_ca_fund_free_buy_at_cutoff_locked('{event}')",None,False)
    wait_for("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%fn_ca_fund_free_buy_at_cutoff_locked%' AND pid<>pg_backend_pid())")
    hand=pool.submit(db.run,f"SET statement_timeout='5s';BEGIN;UPDATE union_wallets SET updated_at=now() WHERE union_id='{U}';SELECT 1 FROM club_members WHERE user_id='{A}' FOR UPDATE;COMMIT;",None,False)
    wait_for("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%club_members%FOR UPDATE%' AND pid<>pg_backend_pid())")
    time.sleep(1.5)
   finally:
    db.run("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(600)%' AND pid<>pg_backend_pid()")
   funded=funding.result();played=hand.result();holder.result()
  check('a wallet-then-member writer waiting on a granted entrant ends on its own timeout and the cutoff still funds',[funded.returncode,'deadlock detected' in funded.stderr,played.returncode!=0,left_behind(event)],[0,False,True,'1:2:2:2:9998.00'])
  db.run(f"UPDATE union_wallets SET promo_wallet={wallet} WHERE union_id='{U}'")
  reset()
  with ThreadPoolExecutor(max_workers=2) as pool:
   replies=list(pool.map(lambda _:call(A,f"fn_issue_tournament_ticket_agent('{C}','{B}',40,NULL,'concurrent-agent-ticket')"),range(2)))
  check('concurrent agent ticket has one original financial result',sum(x.get('replayed') is False for x in replies),1)
  check('concurrent agent ticket has one replay',sum(x.get('replayed') is True for x in replies),1)
  check('concurrent agent ticket debits once',one(f"SELECT agent_wallet_balance FROM agents WHERE club_id='{C}' AND user_id='{A}'"),'60')
  check('concurrent agent ticket creates one escrow entitlement',one('SELECT count(*) FROM tournament_tickets'),'1')
  passed=True
 finally:
  report={'status':'passed' if passed else 'failed','checks':checks,'production_mutations':False,'source_sha256':{str(MIGRATION.relative_to(ROOT)):hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),str(args.custody_migration):hashlib.sha256(args.custody_migration.read_bytes()).hexdigest(),str(args.fee_migration):hashlib.sha256(args.fee_migration.read_bytes()).hexdigest(),str(inventory_capture):hashlib.sha256(inventory_capture.read_bytes()).hexdigest(),**{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [Path(__file__),CUTOFF_ORDER,ROOT/'scripts/ci/fixtures/promo-ticket-play-through/setup.sql',ROOT/'supabase/migrations/20261115020406_a_function_that_calls_a_missing_signature_is_refused_at_comm.sql',*sorted((ROOT/'tests/fixtures/promo-ticket-play-through').glob('*.json'))]}}}
  (args.output/'RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
  if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','-w','stop'],capture_output=True)
  shutil.rmtree(tmp)
 print(str(len(checks))+' checks passed')
if __name__=='__main__':main()

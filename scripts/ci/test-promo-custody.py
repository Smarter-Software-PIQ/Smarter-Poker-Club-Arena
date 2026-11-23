#!/usr/bin/env python3
"""Native promo principal accounting, using actual migrations and ledger triggers.

No production endpoint, credentials or money. Minimal balance/journal relations
isolate custody; the captured actual accepted-hand owner is compiled and patched.
The full accepted-hand qualification remains a separate required integration.
"""
import argparse, importlib.util, json, os, subprocess, tempfile, uuid, time, hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('promo_base',ROOT/'scripts/ci/test-promo-play-through.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
C,A,B=base.CLUB,base.ALICE,base.BOB
T='60000000-0000-0000-0000-000000000001'
H='60000000-0000-0000-0000-000000000002'
T2='60000000-0000-0000-0000-000000000022'
MIGRATION=ROOT/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql'

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
  raise SystemExit('external TMPDIR required')
 args.output.mkdir(parents=True,exist_ok=False)
 checks=[];tmp=Path(tempfile.mkdtemp(prefix='pc-'));pg=Path(base.pg_bin());port=54419
 db=base.Db(str(tmp),port,'promo_custody');started=False
 def check(label,actual,expected):
  ok=actual==expected;checks.append(dict(check=label,ok=ok,actual=actual,expected=expected))
  print(('PASS ' if ok else 'FAIL ')+label,flush=True)
  if not ok:raise AssertionError((label,actual,expected))
 def one(q):return db.one(q)
 def reset():
  global H
  H=str(uuid.uuid4())
  db.run('TRUNCATE public.ca_promo_principal_custody,public.ca_promo_play_through_grants,public.ca_promo_cash_hand_funding,public.ca_promo_funding_custody_receipts,public.ca_promo_pending_custody_receipts,public.chip_ledger,public.rake_attributions,public.accounting_tournament_fee_sources,public.rake_records,public.tournament_unregistration_receipts,public.tournament_cancellation_receipts;'
         f"UPDATE public.club_members SET chip_balance=50; UPDATE public.agents SET agent_wallet_balance=100; UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';")
 def ledger(fr,to,amount,category,who=A,dest=None):
  return f"INSERT INTO public.chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id) VALUES('{fr}','{who}','{to}','{dest or who}',{amount},'{category}','{C}');"
 def grant(amount=50,who=A,kind='player_wallet'):
  db.run(ledger('promo_wallet',kind,amount,'promo_send',who))
 def held(kind='player_wallet',who=A,entity=None):
  return one(f"SELECT public.fn_ca_promo_locked_at('{C}','{who}','{kind}','{entity or who}')")
 def accepted(h,table=T,at='clock_timestamp()'):
  return f"INSERT INTO hand_atomic_commits(hand_id,table_id,hand_number,committed_at) VALUES('{h}','{table}',{1000000+uuid.UUID(h).int%1000000000},{at}) ON CONFLICT(hand_id) DO NOTHING;"
 def hand(before,after,contribution=50,returned=0,h=None,table=T):
  h=h or H
  return accepted(h,table)+f"SELECT public.fn_ca_promo_accept_cash_hand('{h}','{table}','"+json.dumps([dict(user_id=A,stack_before=before,stack=after)])+"'::jsonb,'"+json.dumps(dict(contributions={A:contribution},returned_uncalled={A:returned}))+"'::jsonb);"
 def metric(key):return db.json(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')")[key]
 def fee(amount,tour=None):
  if tour is None:
   h=str(uuid.uuid4());db.run(accepted(h)+f"SELECT fn_ca_promo_capture_cash_hand_clock('{h}','{T}');INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES('{h}','{A}','{C}',{amount},clock_timestamp())")
  else:db.run(f"""DO $$DECLARE rid uuid;BEGIN
   INSERT INTO rake_records(tournament_id,is_tournament,rake_amount,metadata,created_at,source)
    VALUES('{tour}',true,{amount},'{{"user_id":"{A}"}}',clock_timestamp(),'registration') RETURNING id INTO rid;
   INSERT INTO accounting_tournament_fee_sources(tournament_id,player_id,club_id,rake_credit,charged_at,rake_record_id)
    VALUES('{tour}','{A}','{C}',{amount},clock_timestamp(),rid);END$$;""")
 def refund(amount,tour):
  db.run(f"""DO $$DECLARE pos uuid;neg uuid;BEGIN
   SELECT r.id INTO STRICT pos FROM rake_records r WHERE r.tournament_id='{tour}' AND r.rake_amount={amount}
    AND NOT EXISTS(SELECT 1 FROM tournament_unregistration_receipts u WHERE r.id=ANY(u.fee_source_rake_record_ids)) ORDER BY r.created_at LIMIT 1;
   INSERT INTO rake_records(tournament_id,is_tournament,rake_amount,metadata,created_at,source)
    VALUES('{tour}',true,{-amount},jsonb_build_object('user_id','{A}','original_rake_record_id',pos),clock_timestamp(),'fn_unregister_from_tournament') RETURNING id INTO neg;
   INSERT INTO tournament_unregistration_receipts(tournament_id,user_id,fees_reversed,fee_reversal_ids,fee_source_rake_record_ids)
    VALUES('{tour}','{A}',{amount},ARRAY[neg],ARRAY[pos]);END$$;""")
 def fund(amount,before=50,table=T,who=A,pending=None):
  op=str(uuid.uuid4());pnd='NULL' if pending is None else f"'{pending}'::uuid"
  kind='buyin' if pending is None else 'addon'
  return f"""DO $fund$ DECLARE lid uuid;wid uuid; BEGIN
   UPDATE club_members SET chip_balance={before-amount} WHERE club_id='{C}' AND user_id='{who}';
   INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
    VALUES('player_wallet','{who}','table_stack','{table}',{amount},'{kind}','{C}') RETURNING id INTO lid;
   INSERT INTO wallet_transactions(user_id,table_id,type,category,amount,balance_after)
    VALUES('{who}','{table}','debit','{kind}',{amount},{before-amount}) RETURNING id INTO wid;
   PERFORM fn_cash_record_original_funding('{kind}','{op}','{who}','{table}',lid,wid,'{C}',{amount},{before-amount},{pnd});
  END $fund$;"""
 try:
  subprocess.run([pg/'initdb','-D',tmp/'data','-U','postgres','-A','trust'],check=True,capture_output=True)
  subprocess.run([pg/'pg_ctl','-D',tmp/'data','-w','-o',f"-p {port} -k {tmp} -c listen_addresses=''",'-l',tmp/'log','start'],check=True,capture_output=True);started=True
  db.run('CREATE DATABASE promo_custody',db='postgres');db.run(base.STUB)
  db.run(f"ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS club_id uuid;CREATE TABLE public.agents(club_id uuid,user_id uuid,agent_wallet_balance numeric,PRIMARY KEY(club_id,user_id));INSERT INTO public.agents VALUES('{C}','{A}',100);INSERT INTO public.tables(id,tournament_id,club_id) VALUES('{T}',NULL,'{C}');")
  db.run(f"""CREATE TABLE clubs(id uuid PRIMARY KEY,asset text,union_id uuid);
   INSERT INTO clubs VALUES('{C}','chips',NULL);
   ALTER TABLE table_seats ADD COLUMN occupancy_id uuid DEFAULT gen_random_uuid(),ADD COLUMN joined_at timestamptz DEFAULT clock_timestamp();
   INSERT INTO table_seats(table_id,user_id,stack) VALUES('{T}','{A}',0);
   INSERT INTO tables(id,tournament_id,club_id) VALUES('{T2}',NULL,'{C}');
   INSERT INTO table_seats(table_id,user_id,stack) VALUES('{T2}','{A}',0);
   CREATE TABLE wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,table_id uuid,type text,category text,amount numeric,balance_after numeric);
  """)
  cash=(ROOT/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql').read_text()
  db.run(cash[cash.index('CREATE TABLE public.cash_participant_funding_receipts'):cash.index('-- Invoked only by the original private funding cores')])
  db.run(cash[cash.index('CREATE FUNCTION public.fn_cash_record_original_funding'):cash.index('-- This is a prospective game/roster snapshot')])
  for f in base.MIGRATIONS:db.run(Path(f).read_text())
  db.run("""ALTER TABLE accounting_tournament_fee_sources ADD COLUMN rake_record_id uuid;
   ALTER TABLE rake_records ADD COLUMN source text;
   ALTER TABLE rake_attributions ADD COLUMN hand_id uuid;
   CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,committed_at timestamptz DEFAULT clock_timestamp());
   CREATE TABLE tournament_unregistration_receipts(registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
   CREATE TABLE tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,total_rake_before numeric,total_rake_after numeric,fees_reversed numeric,fee_reversal_ids uuid[]);
  """)
  captures=json.loads((ROOT/'tests/fixtures/ev-cashout-lifecycle/captured-authorities.json').read_text())['functions']
  owner=next(r for r in captures if r['signature'].split('(')[0]=='fn_ca_commit_hand_settlement')
  db.run(owner['definition'])
  db.run("UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';")
  grant();db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','table_stack',50,'buyin',dest=T))
  check('baseline reproduces real wallet locked while promo is on table',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'0')
  db.run('TRUNCATE ca_promo_play_through_grants,chip_ledger;UPDATE ca_promo_play_through_settings SET enforced_from=NULL;')
  inventory=json.loads((ROOT/'tests/fixtures/promo-custody-inventory-pin.json').read_text())
  for source in inventory['funding_owners']:
   db.run(source['definition']+';')
   check('actual funding owner preimage '+source['signature'],one("SELECT md5(pg_get_functiondef('public."+source['signature']+"'::regprocedure))"),source['md5'])
  db.run('CREATE SCHEMA IF NOT EXISTS smarter_private;'+inventory['definition']+';REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;')
  check('actual original inventory guard preimage',one("SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))"),inventory['md5'])
  def guarded(sql):
   script="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
   return subprocess.run(['node','--input-type=module','-e',script,str(MIGRATION)],input=sql,text=True,capture_output=True,check=True,cwd=ROOT).stdout
  migration=MIGRATION.read_text();pin_start=migration.index('DO $inventory_pin$');pin_end=migration.index('END $inventory_pin$;',pin_start)+len('END $inventory_pin$;')
  old_guard_migration=migration.replace("IF md5(def)<>'"+inventory['md5']+"' THEN RAISE EXCEPTION 'promo_original_inventory_guard_changed'", "IF md5(def)<>'2115cc50e91b586e152baa0ba6395b58' THEN RAISE EXCEPTION 'promo_original_inventory_guard_changed'")
  if old_guard_migration==migration:raise RuntimeError('original inventory precondition regression anchor changed')
  old_guard_refused=db.run(guarded(old_guard_migration),check=False)
  (args.output/'current-inventory-before.stderr').write_text(old_guard_refused.stderr)
  check('former guard precondition refuses the actual current original inventory owner',old_guard_refused.returncode!=0 and 'promo_original_inventory_guard_changed' in old_guard_refused.stderr,True)
  check('former guard precondition refusal rolls back custody and funding hook',one("SELECT to_regclass('public.ca_promo_principal_custody') IS NULL AND md5(pg_get_functiondef('public.fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid)'::regprocedure))='d01404c53405fd1826de26e58b04f4b1'"),'t')
  refused=db.run(guarded(migration[:pin_start]+migration[pin_end:]),check=False)
  (args.output/'stale-pin-before.stderr').write_text(refused.stderr)
  check('real applier refuses the former stale funding pin',refused.returncode!=0 and 'migration_left_a_stale_pin' in refused.stderr,True)
  check('refused stale funding pin rolls back custody DDL',one("SELECT to_regclass('public.ca_promo_principal_custody') IS NULL"),'t')
  db.run(guarded(migration))
  next_hash=one("SELECT md5(pg_get_functiondef('public.fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid)'::regprocedure))")
  expected=inventory['definition'].replace('d01404c53405fd1826de26e58b04f4b1',next_hash)
  check('inventory guard changes only the original funding fingerprint',one("SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))"),hashlib.md5(expected.encode()).hexdigest())
  check('inventory guard retains its original private owner and ACL',one("SELECT pg_get_userbyid(proowner)||':'||proacl::text FROM pg_proc WHERE oid='smarter_private.original_inventory_proof_sources_match()'::regprocedure"),'postgres:{postgres=X/postgres}')
  db.run(fund(20,before=50))
  check('disabled programme preserves original cash admission',one('SELECT principal_before||\':\'||principal_moved FROM ca_promo_funding_custody_receipts'),'0:0')
  # Ticket/fee owners have their own native integration. These isolated
  # adapters keep this test about the real custody transition, not its callers.
  db.run("""CREATE FUNCTION fn_ca_promo_ticket_entry_funding(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"covered_amount":0,"promo_amount":0}'::jsonb$$;
   CREATE FUNCTION fn_ca_promo_record_event_charge(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
   CREATE FUNCTION fn_ca_promo_capture_entry_funding(uuid,numeric) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
   CREATE FUNCTION fn_ca_promo_realize_event_principal(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE l chip_ledger%ROWTYPE;BEGIN
    SELECT * INTO STRICT l FROM chip_ledger WHERE id=p_id;
    PERFORM fn_ca_promo_move_custody(l.club_id,l.to_entity_id,'event',l.from_entity_id,'player_wallet',l.to_entity_id,l.amount);
   END$$;
  """)
  check('actual accepted owner calls custody before its envelope is stored',one("SELECT position('fn_ca_promo_accept_cash_hand' in pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure)) < position('SET post_commit_payload =' in pg_get_functiondef('public.fn_ca_commit_hand_settlement(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid,jsonb)'::regprocedure))"),'t')
  reset();grant();check('player grant starts in its wallet',held(),'50')
  db.run(fund(50)+f"UPDATE club_members SET chip_balance=50 WHERE club_id='{C}' AND user_id='{A}';"+ledger('club_treasury','player_wallet',50,'club_bank_send',who=B,dest=A))
  check('buyin moves principal to the table',held('table_stack',entity=T),'50')
  check('buyin leaves no wallet principal',held(),'0')
  check('real wallet remains cashable while promo is on table',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'50')
  db.run(hand(50,10));check('accepted loss retires exactly forty principal',held('table_stack',entity=T),'10')
  check('lost principal retains original full grant target',one('SELECT amount||\':\'||remaining||\':\'||fee_target FROM ca_promo_play_through_grants'),'50:10:200.0000')
  db.run(hand(50,10));check('response-loss replay never retires principal twice',held('table_stack',entity=T),'10')
  check('fee provenance retains gross and promo contribution',one('SELECT contribution||\':\'||promo_contribution FROM ca_promo_cash_hand_funding'),'50:50')
  db.run(f"UPDATE club_members SET chip_balance=chip_balance+100 WHERE club_id='{C}' AND user_id='{A}';"+ledger('club_treasury','player_wallet',100,'club_bank_send',who=B,dest=A))
  check('real deposit never takes custody of table promo',held(),'0')
  db.run(f"UPDATE club_members SET chip_balance=chip_balance+30 WHERE club_id='{C}' AND user_id='{A}';"+ledger('table_stack','player_wallet',30,'table_cashout',who=T,dest=A))
  check('table profit returns only remaining promo principal',held(),'10')
  check('table return creates no second grant',one('SELECT count(*) FROM ca_promo_play_through_grants'),'1')
  check('profit and deposits remain free after table exit',one(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')->>'cashable'"),'170')
  bad=db.run('BEGIN;'+f"UPDATE club_members SET chip_balance=0 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','escrow',180,'escrow_hold')+'COMMIT;',check=False)
  check('cashout cannot spend remaining promo',bad.returncode!=0 and 'promo_play_through_locked' in bad.stderr,True)
  check('refusal restores original wallet',one(f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'"),'180')
  reset();grant(kind='agent_wallet');check('agent grant is locked in agent wallet',held('agent_wallet'),'50')
  db.run(f"""DO $$DECLARE lid uuid;BEGIN UPDATE agents SET agent_wallet_balance=0 WHERE club_id='{C}' AND user_id='{A}';
   INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
    VALUES('agent_wallet','{A}','player_wallet','{A}',50,'transfer','{C}') RETURNING id INTO lid;
   PERFORM fn_ca_promo_move_owned_wallet(lid,50);END$$;
   UPDATE agents SET agent_wallet_balance=50 WHERE club_id='{C}' AND user_id='{A}';""")
  check('same-person move keeps the same principal in playing wallet',held(),'50')
  check('same-person move retains one fee target',one('SELECT count(*)||\':\'||sum(fee_target) FROM ca_promo_play_through_grants'),'1:200.0000')
  bad=db.run('BEGIN;UPDATE agents SET agent_wallet_balance=0;'+ledger('agent_wallet','player_wallet',50,'agent_send',dest=B)+'COMMIT;',check=False)
  # No principal remains in the agent wallet, so its own real 50 can be sent.
  check('agent can send its remaining own chips',bad.returncode,0)
  reset();grant(kind='agent_wallet')
  bad=db.run('BEGIN;UPDATE agents SET agent_wallet_balance=0;'+ledger('agent_wallet','player_wallet',100,'agent_send',dest=B)+'COMMIT;',check=False)
  check('agent cannot send locked principal to another player',bad.returncode!=0,True)
  reset();grant();db.run(fund(50));db.run(hand(50,0))
  check('busted principal closes grant in accepted hand',one("SELECT close_reason||':'||remaining FROM ca_promo_play_through_grants"),'spent:0')
  check('busted grant creates no future cash lock',held(),'0')
  reset();grant();bad=db.run('BEGIN;UPDATE ca_promo_principal_custody SET amount=1;COMMIT;',check=False)
  check('conservation constraint refuses a mismatched principal total',bad.returncode!=0 and 'promo_principal_custody_not_conserved' in bad.stderr,True)
  for role in ['anon','authenticated','service_role']:
   bad=db.run(f"SET ROLE {role}; SELECT fn_ca_promo_move_custody('{C}','{A}','player_wallet','{A}',NULL,NULL,50,'spent');",check=False)
   check(role+' cannot forge a custody movement',bad.returncode!=0,True)
  fee(200)
  check('full fee target releases every place',held(),'0')
  db.run(f"SELECT fn_ca_promo_play_through_settle('{C}','{A}')")
  check('settlement removes principal custody',one('SELECT sum(amount) FROM ca_promo_principal_custody'),'0')
  reset();grant();db.run(fund(50))
  alternate='60000000-0000-0000-0000-000000000003'
  stacks=json.dumps([dict(user_id=A,stack_before=50,stack=30)])
  facts=json.dumps(dict(contributions={A:40},returned_uncalled={A:10}))
  places=json.dumps({A:T})
  db.run(accepted(H,alternate)+f"SELECT fn_ca_promo_accept_cash_hand('{H}','{alternate}','{stacks}','{facts}','{places}')")
  check('Lightning retires principal at its original physical seat',held('table_stack',entity=T),'30')
  check('uncalled chips do not inflate promo fee exposure',one('SELECT contribution FROM ca_promo_cash_hand_funding'),'30')
  reset();grant();db.run(fund(50))
  fee(200)
  db.run(hand(50,0))
  check('already earned unlock never becomes promo-funded play',one('SELECT count(*) FROM ca_promo_cash_hand_funding'),'0')
  reset();grant(30);grant(20)
  db.run(fund(40))
  check('several original grants split without duplication',one('SELECT count(*)||\':\'||sum(fee_target) FROM ca_promo_play_through_grants'),'2:200.0000')
  fee(119)
  check('partial fees release no part of the oldest original grant',held('table_stack',entity=T),'40')
  fee(1)
  check('oldest whole original grant unlocks across every place',held('table_stack',entity=T),'10')
  check('newer grant wallet principal stays locked',held(),'10')
  reset();grant();db.run(f"UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','club_treasury',80,'club_bank_claim'))
  check('club bank pullback releases only actual returned principal',held(),'20')
  reset();grant();context=json.dumps(dict(user_id=A,club_id=C,amount=50,balance_before=50,category='tournament_buyin',tournament_id=T,operation_key='native-event'))
  db.run(f"BEGIN;SELECT set_config('app.ca_promo_wallet_debit','{context}',true);"+ledger('player_wallet','prize_liability',50,'tournament_buyin',dest=T)+'COMMIT;')
  check('event custody cannot lock unrelated wallet cash',held(),'0')
  check('event custody preserves the original grant target',held('event',entity=T),'50')
  db.run(f"UPDATE club_members SET chip_balance=150 WHERE club_id='{C}' AND user_id='{A}';"+ledger('prize_liability','player_wallet',75,'tournament_prize',who=T,dest=A))
  check('event prize realizes principal only once',held(),'50')
  db.run(ledger('prize_liability','player_wallet',25,'tournament_prize',who=T,dest=A))
  check('later prizes cannot duplicate principal',held(),'50')
  reset();grant();db.run(fund(50))
  db.run(hand(50,100,h='60000000-0000-0000-0000-000000000011'))
  db.run(hand(100,50,h='60000000-0000-0000-0000-000000000012'))
  check('winning fifty then losing fifty retains the original fifty principal',held('table_stack',entity=T),'50')
  reset();grant();db.run(fund(50))
  db.run(hand(50,80,contribution=10,h=str(uuid.uuid4())))
  check('fifty promo winning thirty keeps fifty locked',held('table_stack',entity=T),'50')
  db.run(hand(80,60,contribution=20,h=str(uuid.uuid4())))
  check('twenty loss consumes earlier profit before principal',held('table_stack',entity=T),'50')
  db.run(hand(60,20,contribution=40,h=str(uuid.uuid4())))
  check('loss below principal leaves only twenty promo',held('table_stack',entity=T),'20')
  db.run(f"UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';"+ledger('table_stack','player_wallet',20,'table_cashout',who=T,dest=A))
  db.run(f"UPDATE club_members SET chip_balance=35 WHERE club_id='{C}' AND user_id='{A}';"+ledger('club_treasury','player_wallet',15,'rakeback',who=B,dest=A))
  check('low balance then fifteen rakeback keeps only twenty locked',held(),'20')
  check('all fifteen rakeback stays cashable',metric('cashable'),15)
  check('surviving principal still needs original two hundred fees',metric('fee_target'),200)
  db.run(fund(35,before=35));db.run(hand(35,0,contribution=35,h=str(uuid.uuid4())))
  check('complete bust permanently closes original grant',one("SELECT close_reason FROM ca_promo_play_through_grants"),'spent')
  db.run(f"UPDATE club_members SET chip_balance=40 WHERE club_id='{C}' AND user_id='{A}';"+ledger('club_treasury','player_wallet',40,'rakeback',who=B,dest=A))
  check('rakeback after bust cannot revive principal',held(),'0')
  check('every post-bust rakeback chip is cashable',metric('cashable'),40)
  revived=db.run('UPDATE ca_promo_play_through_grants SET closed_at=NULL,close_reason=NULL,remaining=amount',check=False)
  check('the schema refuses to revive a busted grant',revived.returncode!=0 and 'promo_closed_grant_is_terminal' in revived.stderr,True)

  reset();grant();db.run(fund(50));db.run(hand(50,70,h=str(uuid.uuid4())))
  db.run(f"UPDATE club_members SET chip_balance=70 WHERE club_id='{C}' AND user_id='{A}';"+ledger('table_stack','player_wallet',70,'table_cashout',who=T,dest=A))
  db.run(fund(20,before=70))
  check('cashout then rebuy uses free winnings before promo',held('table_stack',entity=T),'0')
  db.run(hand(20,0,contribution=20,h=str(uuid.uuid4())))
  check('cashout rebuy losing earlier profit preserves the same fifty promo',held(),'50')
  check('cashout rebuy creates no grant or extra fee target',metric('fee_target'),200)

  reset();grant();db.run(fund(50));db.run(hand(50,100,h=str(uuid.uuid4())))
  db.run(hand(100,90,contribution=10,h=str(uuid.uuid4())))
  check('ten-chip contribution entirely covered by free winnings',one('SELECT promo_contribution FROM ca_promo_cash_hand_funding WHERE contribution=10'),'0')
  db.run(hand(90,30,contribution=60,h=str(uuid.uuid4())))
  check('mixed contribution spends forty free chips then twenty promo',one('SELECT promo_contribution FROM ca_promo_cash_hand_funding WHERE contribution=60'),'20')

  reset();grant();grant();db.run(fund(50,before=100));fee(125,base.TOUR_A);fee(25,base.TOUR_A)
  db.run(hand(50,0,h=str(uuid.uuid4())))
  check('spent older grant cannot lend its already consumed fees to newer grant',metric('fee_progress'),0)
  check('newer grant keeps only its own original target',metric('fee_target'),200)
  fee(40,base.TOUR_B);fee(10,base.TOUR_B)
  check('new fee pays surviving grant exactly once',metric('fee_progress'),50)
  refund(25,base.TOUR_A)
  check('late refund of spent grant does not become surviving grant debt',metric('fee_progress'),50)
  refund(10,base.TOUR_B)
  check('refund of surviving grant fee reduces its own unfinished progress',metric('fee_progress'),40)

  reset();grant();grant();db.run(f"UPDATE club_members SET chip_balance=100 WHERE club_id='{C}' AND user_id='{A}'");fee(100,base.TOUR_A);fee(100,base.TOUR_A)
  db.run(f"SELECT fn_ca_promo_play_through_settle('{C}','{A}')")
  db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','escrow',50,'escrow_hold'))
  refund(100,base.TOUR_A)
  check('refund after completed unlock does not increase next grant requirement',metric('fee_remaining'),200)
  check('completed unlock retains original target and terminal evidence',one("SELECT fee_target||':'||remaining||':'||close_reason FROM ca_promo_play_through_grants WHERE close_reason='met'"),'200.0000:0:met')
  db.run(f"UPDATE club_members SET chip_balance=70 WHERE club_id='{C}' AND user_id='{A}';"+ledger('club_treasury','player_wallet',20,'rakeback',who=B,dest=A))
  check('late refund cannot relock later rakeback',metric('cashable'),20)
  fee(100,base.TOUR_B)
  check('new grant receives only its new valid fees',metric('fee_remaining'),100)

  reset();grant();db.run(fund(30,before=50));db.run(fund(20,before=20,table=T2))
  with ThreadPoolExecutor(max_workers=2) as pool:
   futures=[pool.submit(db.run,hand(30,0,contribution=30,h=str(uuid.uuid4()))),
    pool.submit(db.run,hand(20,0,contribution=20,h=str(uuid.uuid4()),table=T2))]
   for f in futures:f.result()
  check('concurrent losses in two positions consume principal once',one('SELECT remaining FROM ca_promo_play_through_grants'),'0')
  check('concurrent recorded losses conserve fifty principal',one('SELECT sum(principal_lost) FROM ca_promo_cash_hand_funding'),'50')
  reset();grant();db.run(fund(50))
  retry=hand(50,10,contribution=40,h=str(uuid.uuid4()))
  with ThreadPoolExecutor(max_workers=2) as pool:
   futures=[pool.submit(db.run,retry),pool.submit(db.run,retry)]
   for f in futures:f.result()
  check('concurrent duplicate hand only consumes forty principal once',held('table_stack',entity=T),'10')
  check('concurrent duplicate hand has one funding receipt',one('SELECT count(*) FROM ca_promo_cash_hand_funding'),'1')

  reset();grant(70);db.run(fund(50,before=70))
  pending=str(uuid.uuid4());db.run(fund(20,before=20,pending=pending))
  check('pending addon principal is not yet on the felt',held('pending_addon',entity=pending),'20')
  check('only delivered principal belongs to the active position',held('table_stack',entity=T),'50')
  db.run(hand(50,40,contribution=10,h=str(uuid.uuid4())))
  check('a hand cannot consume the still-pending addon',held('pending_addon',entity=pending),'20')
  db.run(f"UPDATE club_members SET chip_balance=10 WHERE club_id='{C}' AND user_id='{A}';"+ledger('table_stack','player_wallet',10,'player_funding',who=T,dest=A))
  check('mapped addon refund does not drain unrelated on-felt principal',held('table_stack',entity=T),'40')
  occupancy=one(f"SELECT occupancy_id FROM table_seats WHERE table_id='{T}' AND user_id='{A}'")
  db.run(f"SELECT fn_cash_record_funding_application('{pending}',10,10,'{occupancy}')")
  check('applied addon principal joins its exact original position',held('table_stack',entity=T),'50')
  check('refunded addon principal returns to its own wallet',held(),'10')
  check('pending principal resolves exactly once',held('pending_addon',entity=pending),'0')
  db.run(f"SELECT fn_ca_promo_apply_pending_cash_funding('{pending}')")
  check('pending response-loss replay cannot duplicate principal',held('table_stack',entity=T),'50')
  check('pending receipt retains before/applied/refunded proof',one('SELECT principal_before||\':\'||principal_applied||\':\'||principal_refunded FROM ca_promo_pending_custody_receipts'),'20:10:10')

  # Full cash-table pending add-on refund (table closes before add-on lands)
  # and full closed-table cash-out both return 100% of promo principal to the
  # member wallet under the open grant, never closing it or sending to a fund.
  reset();grant(70);db.run(fund(50,before=70))
  full_refund_pending=str(uuid.uuid4());db.run(fund(20,before=20,pending=full_refund_pending))
  occupancy=one(f"SELECT occupancy_id FROM table_seats WHERE table_id='{T}' AND user_id='{A}'")
  db.run(f"UPDATE club_members SET chip_balance=20 WHERE club_id='{C}' AND user_id='{A}';"+ledger('table_stack','player_wallet',20,'addon_refund',who=T,dest=A))
  db.run(f"SELECT fn_cash_record_funding_application('{full_refund_pending}',0,20,'{occupancy}')")
  check('full pending addon refund returns all promo to player wallet',held(),'20')
  check('full pending addon refund leaves zero pending custody',held('pending_addon',entity=full_refund_pending),'0')
  check('full pending addon refund leaves grant open and intact',one("SELECT closed_at IS NULL AND remaining=70 FROM ca_promo_play_through_grants"),'t')
  db.run(f"UPDATE club_members SET chip_balance=70 WHERE club_id='{C}' AND user_id='{A}';"+ledger('table_stack','player_wallet',50,'table_cashout',who=T,dest=A))
  check('closed table full cashout returns all on-felt promo to player wallet',held(),'70')
  check('closed table full cashout leaves zero table custody',held('table_stack',entity=T),'0')
  check('closed table full cashout keeps grant open with full remaining',one("SELECT closed_at IS NULL AND remaining=70 FROM ca_promo_play_through_grants"),'t')

  reset();grant();fee(25,base.TOUR_A);db.run(fund(50));db.run(hand(50,0,h=str(uuid.uuid4())))
  grant();fee(50,base.TOUR_A);refund(25,base.TOUR_A)
  check('an old-cycle refund cannot reduce a later entry fee in the same event',metric('fee_progress'),50)

  reset();grant();grant();db.run(f"UPDATE club_members SET chip_balance=100 WHERE club_id='{C}' AND user_id='{A}'");fee(150)
  db.run(f"UPDATE club_members SET chip_balance=60 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','club_treasury',40,'club_bank_claim'))
  check('partial principal return retains original full target until closure',metric('fee_target'),400)
  db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','club_treasury',10,'club_bank_claim'))
  check('closed returned grant cannot recycle its progress to surviving grant',metric('fee_progress'),0)
  check('closing returned grant leaves surviving original target',metric('fee_remaining'),200)

  reset();grant();db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','credit_facility',50,'credit_repayment'))
  check('unrestricted credit repayment remains available',held(),'50')
  refused=db.run('BEGIN;'+f"UPDATE club_members SET chip_balance=49 WHERE club_id='{C}' AND user_id='{A}';"+ledger('player_wallet','credit_facility',1,'credit_repayment')+'COMMIT;',check=False)
  check('credit repayment cannot consume locked principal',refused.returncode!=0,True)
  reset();grant(kind='agent_wallet')
  refused=db.run('BEGIN;'+f"UPDATE agents SET agent_wallet_balance=49 WHERE club_id='{C}' AND user_id='{A}';"+ledger('agent_wallet','credit_facility',51,'credit_repayment')+'COMMIT;',check=False)
  check('agent credit repayment cannot consume locked principal',refused.returncode!=0,True)
  reset();grant(kind='agent_wallet')
  db.run(f"""DO $$DECLARE lid uuid;BEGIN
   UPDATE agents SET agent_wallet_balance=70 WHERE club_id='{C}' AND user_id='{A}';
   INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
    VALUES('agent_wallet','{A}','agent_wallet','{A}',70,'claim','{C}') RETURNING id INTO lid;
   PERFORM fn_ca_promo_move_owned_wallet(lid,70);END$$;""")
  check('same physical wallet remains unchanged by its own claim leg',held('agent_wallet'),'50')

  reset();grant();grant();db.run(fund(50,before=100))
  # Real private-backend barriers force the wallet owner to hold its member
  # row while waiting for the hand's grant row. The hand has no later wallet
  # mutation, so it commits and the original bank return then completes.
  key_a,key_b=947201,947202
  control=subprocess.Popen([str(pg/'psql'),'-X','-qAt','-h',str(tmp),'-p',str(port),'-U','postgres','-d','promo_custody',
    '-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  try:
   control.stdin.write(f"SELECT pg_advisory_lock({key_a}); SELECT pg_advisory_lock({key_b});\n\\echo BARRIERS_READY\n");control.stdin.flush()
   while control.stdout.readline().strip()!='BARRIERS_READY':
    if control.poll() is not None:raise RuntimeError('native barrier session ended')
   with ThreadPoolExecutor(max_workers=2) as pool:
    a=pool.submit(db.run,"BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL application_name='promo_native_hand';"+
     hand(50,40,contribution=10,h=str(uuid.uuid4()))+f"SELECT pg_advisory_xact_lock({key_a});COMMIT;")
    b=pool.submit(db.run,"BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL application_name='promo_native_bank';"+
     f"UPDATE club_members SET chip_balance=25 WHERE club_id='{C}' AND user_id='{A}';SELECT pg_advisory_xact_lock({key_b});"+
     ledger('player_wallet','club_treasury',25,'club_bank_claim')+'SET CONSTRAINTS ALL IMMEDIATE;COMMIT;')
    deadline=time.monotonic()+5
    while one(f"SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid IN({key_a},{key_b}) AND NOT granted")!='2':
     if time.monotonic()>deadline:raise RuntimeError('native hand/wallet barriers not reached')
     time.sleep(.01)
    control.stdin.write(f"SELECT pg_advisory_unlock({key_b});\n");control.stdin.flush()
    deadline=time.monotonic()+5
    graph="SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_stat_activity b ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE a.application_name='promo_native_hand' AND b.application_name='promo_native_bank')"
    while one(graph)!='t':
     if time.monotonic()>deadline:raise RuntimeError('native bank did not wait for actual hand grant lock')
     time.sleep(.01)
    control.stdin.write(f"SELECT pg_advisory_unlock({key_a});\n");control.stdin.flush()
    a.result();b.result()
   check('hand versus original wallet return has no lock-order cycle',one('SELECT sum(remaining) FROM ca_promo_play_through_grants'),'65')
   check('hand versus wallet return conserves both positions',one('SELECT sum(amount) FROM ca_promo_principal_custody'),'65')
  finally:
   if control.poll() is None:
    control.stdin.write('SELECT pg_advisory_unlock_all();\n');control.stdin.flush()
   control.communicate(timeout=10)

  # A pre-bust hand may arrive through the outbox after another gift. Its
  # original accepted clock survives history pruning and cannot pay that gift.
  reset();grant();db.run(fund(50));old_hand=str(uuid.uuid4());db.run(hand(50,0,h=old_hand))
  grant();db.run(f"INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES('{old_hand}','{A}','{C}',100,clock_timestamp())")
  check('delayed pre-bust cash fee cannot qualify a new grant',metric('fee_progress'),0)
  fee(25);check('new grant receives only fees earned after its original clock',metric('fee_progress'),25)
  db.run(f"DELETE FROM hand_atomic_commits WHERE hand_id='{old_hand}'")
  check('retention pruning cannot move old earned fees into a later grant',metric('fee_progress'),25)
  check('canonical clock survives original atomic commit pruning',one(f"SELECT count(*) FROM ca_promo_cash_hand_clocks WHERE hand_id='{old_hand}'"),'1')
  bad=db.run(f"UPDATE ca_promo_cash_hand_clocks SET accepted_at=clock_timestamp() WHERE hand_id='{old_hand}'",check=False)
  check('original accepted fee clock is immutable',bad.returncode!=0 and 'original_promo_cash_hand_clock_is_immutable' in bad.stderr,True)
  missing=str(uuid.uuid4());db.run(f"INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES('{missing}','{A}','{C}',10,clock_timestamp())")
  bad=db.run(f"SELECT fn_ca_promo_play_through_summary('{C}','{A}')",check=False)
  check('post-live missing original cash clock refuses unfinished progress',bad.returncode!=0 and 'promo_cash_fee_original_hand_clock_missing' in bad.stderr,True)
  reset();grant();db.run(f"INSERT INTO rake_attributions(player_id,club_id,rake_amount,created_at) VALUES('{A}','{C}',10,timestamptz '2020-01-01')")
  check('pre-live historical cash fees need no retrospective accepted receipt',metric('fee_progress'),0)
  check('historical fee window preserves its original pre-live credit',one(f"SELECT fn_ca_promo_play_through_fees_between('{C}','{A}',timestamptz '2019-01-01',timestamptz '2021-01-01')"),'10')
  reset();no_p_hand=str(uuid.uuid4());db.run(hand(100,90,h=no_p_hand));grant()
  db.run(f"INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES('{no_p_hand}','{A}','{C}',25,clock_timestamp())")
  check('pre-grant hand clock is captured even without promo on the table',metric('fee_progress'),0)
  reset();pre_enable=str(uuid.uuid4());db.run('UPDATE ca_promo_play_through_settings SET enforced_from=NULL;'+hand(100,90,h=pre_enable))
  db.run('UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp();');grant()
  db.run(f"INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at) VALUES('{pre_enable}','{A}','{C}',100,clock_timestamp())")
  check('pre-enable accepted hand posted after enable uses its original live commit clock',metric('fee_progress'),0)
  check('reading a pre-enable hand clock does not invent a retrospective cold receipt',one(f"SELECT count(*) FROM ca_promo_cash_hand_clocks WHERE hand_id='{pre_enable}'"),'0')
  fee(25);check('activation boundary preserves original producer and new earned fees',metric('fee_progress'),25)
  reset();grant();db.run(fund(50));fee(25,base.TOUR_A)
  db.run("UPDATE ca_promo_play_through_grants SET expires_at=clock_timestamp() WHERE closed_at IS NULL")
  db.run(f"UPDATE club_members SET chip_balance=50 WHERE club_id='{C}' AND user_id='{A}'");grant();fee(50)
  check('expired on-felt principal does not lend unearned target debt to new gift',metric('fee_progress'),50)
  check('only the surviving new gift target remains payable',metric('fee_remaining'),150)
  check('expired principal remains locked on felt pending original return',held('table_stack',entity=T),'50')
  check('expired grant remains a returnable custody row',one("SELECT count(*) FROM fn_ca_promo_play_through_state('"+C+"','"+A+"') WHERE state='expired_pending'"),'1')
  check('the wallet figure explains expired principal separately from active targets',metric('expired_locked'),50)
  refund(25,base.TOUR_A)
  check('refund of an expired consumed fee does not create new gift debt',metric('fee_progress'),50)

  reset();grant();db.run("UPDATE ca_promo_play_through_grants SET expires_at=clock_timestamp() WHERE closed_at IS NULL")
  refused=db.run(fund(1),check=False)
  check('expired wallet principal cannot renew itself through a new table buy-in',refused.returncode!=0 and 'expired_promo_cannot_fund_new_play' in refused.stderr,True)
  check('an expired funding refusal rolls back its original wallet debit',one(f"SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{A}'"),'50')
  db.run(f"UPDATE club_members SET chip_balance=70 WHERE club_id='{C}' AND user_id='{A}'")
  db.run(fund(20,before=70))
  check('an expired promo balance does not block a new entry with own chips',held(),'50')
  check('own-chip entry never takes expired promo onto the table',held('table_stack',entity=T),'0')
  reset();grant();db.run("UPDATE ca_promo_play_through_grants SET expires_at=clock_timestamp() WHERE closed_at IS NULL")
  db.run(f"UPDATE club_members SET chip_balance=100 WHERE club_id='{C}' AND user_id='{A}'");grant();db.run(fund(40,before=100))
  check('a new unexpired gift can fund entry beside expired principal',held('table_stack',entity=T),'40')
  check('new entry leaves the full expired grant awaiting return',metric('expired_locked'),50)

  reset();grant();db.run(fund(50))
  db.run("SELECT pg_stat_reset_single_function_counters('public.fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure)")
  db.run("SET track_functions='all';"+hand(50,40,contribution=10,h=str(uuid.uuid4())))
  check('each hand evaluates the member fee meter once',one("SELECT calls FROM pg_stat_user_functions WHERE funcid='public.fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure"),'1')
  reset();grant(1000000);db.run(fund(1000000,before=1000000))
  # The same player/time index is already installed in production. This is
  # an isolated workload measurement, not a new index or a timing gate.
  db.run(f"""CREATE INDEX IF NOT EXISTS idx_rake_attributions_player_id ON rake_attributions(player_id,created_at DESC);
   WITH h AS (INSERT INTO hand_atomic_commits(hand_id,table_id,hand_number,committed_at)
    SELECT gen_random_uuid(),'{T}',9000000000+g,clock_timestamp() FROM generate_series(1,30000) g RETURNING *),
   clocks AS (INSERT INTO ca_promo_cash_hand_clocks SELECT hand_id,table_id,hand_number,committed_at FROM h RETURNING *)
   INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount,created_at)
    SELECT hand_id,'{A}','{C}',0.01,clock_timestamp() FROM clocks;ANALYZE rake_attributions;""")
  db.run("SELECT pg_stat_reset_single_function_counters('public.fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure)")
  db.run("SET track_functions='all';"+hand(1000000,999999,contribution=1,h=str(uuid.uuid4())))
  timing=db.json("SELECT jsonb_build_object('calls',calls,'total_ms',total_time,'self_ms',self_time,'fee_source_rows',30000,'index','(player_id, created_at DESC)') FROM pg_stat_user_functions WHERE funcid='public.fn_ca_promo_play_through_state(uuid,uuid)'::regprocedure")
  (args.output/'PERFORMANCE.json').write_text(json.dumps(timing,indent=2)+'\n')
  check('thirty-thousand-row fee window is still evaluated once per hand',timing['calls'],1)
  reset()
  for bad_amount in ['NaN','Infinity']:
   refused=db.run(ledger('promo_wallet','player_wallet',f"'{bad_amount}'::numeric",'promo_send'),check=False)
   check(bad_amount+' cannot become promo principal',refused.returncode!=0 and 'ca_promo_principal_is_finite' in refused.stderr,True)
 finally:
  sources=[Path(__file__),MIGRATION,ROOT/'tests/fixtures/promo-custody-inventory-pin.json',ROOT/'scripts/ci/migration-stale-pins.mjs']
  (args.output/'INPUTS.json').write_text(json.dumps({str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},indent=2)+'\n')
  (args.output/'RESULTS.json').write_text(json.dumps(checks,indent=2)+'\n')
  if started:subprocess.run([pg/'pg_ctl','-D',tmp/'data','-m','immediate','-w','stop'],capture_output=True)
  import shutil;shutil.rmtree(tmp)
 print(str(len(checks))+' checks passed')
if __name__=='__main__':main()

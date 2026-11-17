#!/usr/bin/env python3
"""Original tournament earning generations and exact weighted source slices.

This finite PG17 metadata proof compiles captured actual money owners and
qualifies their source-only patch composition. Monetary rows are explicit typed
openings; it does not replace the full HS financial-journal/actual-entry proof.
"""
import argparse,os,json,subprocess,tempfile,hashlib,uuid
from pathlib import Path
R=Path(__file__).resolve().parents[2]
MIGRATION=R/'supabase/migrations/20261116200638_tournament_winnings_retain_original_earning_generation_and_c.sql'
SATELLITE_FIX=R/'supabase/migrations/20261117172824_satellite_remainder_keeps_original_promo_earning_source.sql'
REBASE_FIX=R/'supabase/migrations/20261117164841_promo_tournament_hand_capture_accepts_the_commits_own_rebase.sql'
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--migration',type=Path,default=MIGRATION);p.add_argument('--financial-root',type=Path,default=R);p.add_argument('--profit-root',type=Path,default=R);p.add_argument('--custody-migration',type=Path);p.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')));args=p.parse_args();MIGRATION=args.migration.resolve()
if os.uname().sysname=='Darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
PG=args.pg_bin;out=args.output;out.mkdir(parents=True,exist_ok=False);tmp=Path(tempfile.mkdtemp(prefix='peg-'));checks=[]
inputs=[R/'scripts/ci/migration-stale-pins.mjs',MIGRATION,R/'tests/fixtures/promo-ticket-play-through/generation-owners.json',R/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json',R/'tests/fixtures/promo-ticket-play-through/generation-admission-guard.json',REBASE_FIX,SATELLITE_FIX,Path(__file__)]
(out/'INPUTS.json').write_text(json.dumps({str(x.relative_to(R)):{'sha256':hashlib.sha256(x.read_bytes()).hexdigest()} for x in inputs},indent=2)+'\n')

def run(sql,ok=True):
 p=subprocess.run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',tmp,'-p','54437','-U','postgres','postgres'],input=sql,text=True,capture_output=True)
 if ok and p.returncode:raise RuntimeError(p.stderr+'\n'+sql[:200])
 return p
def one(sql):return run(sql).stdout.strip()
def check(name,actual,expected):
 good=actual==expected;checks.append({'check':name,'ok':good,'actual':actual,'expected':expected});print(('PASS 'if good else'FAIL ')+name,flush=True)
 if not good:raise AssertionError((actual,expected))
def uid(n):return f'10000000-0000-0000-0000-{n:012}'
C,U,T,REG,CH,H,TB,BO,OB,CAND,CH2,OB2=[uid(n) for n in range(1,13)]
started=False
try:
 subprocess.run([PG/'initdb','-D',tmp/'data','-U','postgres','-A','trust'],check=True,capture_output=True)
 subprocess.run([PG/'pg_ctl','-D',tmp/'data','-w','-o',f'-p 54437 -k {tmp} -c listen_addresses=','-l',tmp/'log','start'],check=True,capture_output=True);started=True
 run('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY,enforced_from timestamptz);
 CREATE TABLE tournament_players(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,club_id uuid,chips numeric,prize numeric,registered_at timestamptz,current_bounty numeric,source_satellite_id uuid,is_satellite_qualifier boolean);
 CREATE TABLE tournament_knockout_candidates(id uuid PRIMARY KEY,tournament_id uuid,eliminated_user_id uuid,stack_after numeric,state text);
 CREATE TABLE tournament_refund_entitlements(id uuid PRIMARY KEY,source_ledger_id uuid,registration_id uuid,tournament_id uuid,user_id uuid,refund_bounty numeric);
 CREATE TABLE ca_promo_event_fee_consumption_receipts(charge_ledger_id uuid,entitlement_id uuid,club_id uuid,earned_at timestamptz);
 CREATE TABLE ca_promo_free_buy_funding_slices(ledger_id uuid,registration_id uuid,amount numeric);
 CREATE TABLE tables(id uuid PRIMARY KEY,tournament_id uuid);
 CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,committed_at timestamptz,stack_result jsonb);
 CREATE TABLE ca_promo_play_through_grants(id uuid PRIMARY KEY,user_id uuid);
 CREATE TABLE ca_promo_event_principal_lots(grant_id uuid,tournament_id uuid,charge_ledger_id uuid,remaining numeric,original_amount numeric);
 CREATE TABLE tournament_obligations(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,kind text,amount_paid numeric,amount_owed numeric,created_at timestamptz DEFAULT clock_timestamp());
 CREATE TABLE tournament_bounty_obligations(id uuid PRIMARY KEY,tournament_id uuid,knocker_user_id uuid,claimants jsonb,hand_id uuid,table_id uuid,eliminated_user_id uuid,head_amount numeric,created_at timestamptz DEFAULT clock_timestamp());
 CREATE TABLE chip_ledger(id uuid PRIMARY KEY,from_type text,to_type text,from_entity_id uuid,to_entity_id uuid,amount numeric,category text,tournament_id uuid,status text,club_id uuid,metadata jsonb,idempotency_key text);
 CREATE TABLE tournament_tickets(id uuid PRIMARY KEY,holder_id uuid,value numeric,source_satellite_id uuid,redemption_mode text);
 CREATE TABLE tournament_payouts(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,amount numeric,source text,metadata jsonb);
 CREATE TABLE tournament_participant_funding_receipts(registration_id uuid,ledger_id uuid,entitlement_id uuid,tournament_id uuid,user_id uuid,asset text,amount numeric,registration_snapshot jsonb);
 CREATE TABLE tournament_obligation_events(obligation_id uuid,registration_snapshot jsonb,event_id bigint);
 CREATE TABLE wallet_credit_idempotency(key text PRIMARY KEY,user_id uuid,amount numeric);
 ''')

 # Compile original captured financial owners, then apply only source metadata
 # anchors. Financial execution remains covered by the full HS native lane.
 run('SET check_function_bodies=off;')
 for original in json.loads((R/'tests/fixtures/promo-ticket-play-through/generation-owners.json').read_text())+json.loads((R/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json').read_text()):
  run('SET check_function_bodies=off;'+original['definition']+';')
  check('exact original source '+original['proname'],one("SELECT md5(pg_get_functiondef('public."+original['signature']+"'::regprocedure))"),original['md5'])
 guard=json.loads((R/'tests/fixtures/promo-ticket-play-through/generation-admission-guard.json').read_text())
 run('SET check_function_bodies=off;'+guard['definition']+';REVOKE ALL ON FUNCTION public.fn_ca_guard_mtt_admission_contract() FROM PUBLIC,anon,authenticated,service_role;')
 check('actual installed admission contract preimage',one("SELECT md5(pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure))"),guard['md5'])
 # The P prerequisite adds this exact source hook; its body remains untouched.
 proc=next(x['definition'] for x in json.loads((R/'tests/fixtures/promo-ticket-play-through/generation-owners.json').read_text()) if x['proname']=='process_tournament_rebuy')
 needle='    v_response:=public.fn_ca_process_tournament_chip_purchase_money_v1(\n      p_tournament_id,p_user_id,v_type,p_cost,p_chips,v_t.current_level,\n      v_effective_token);'
 proc=proc.replace(needle,'    IF public.fn_ca_tournament_unit_cents(p_tournament_id)=1 THEN PERFORM public.fn_ca_promo_retire_busted_entry(p_tournament_id,p_user_id,v_candidate.id,v_effective_token); END IF;\n'+needle)
 run('SET check_function_bodies=off;'+proc+';')
 run('INSERT INTO ca_promo_play_through_settings VALUES(true,NULL);')
 def guarded(sql,path=None):
  script="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
  return subprocess.run(['node','--input-type=module','-e',script,str(path or MIGRATION)],input=sql,text=True,capture_output=True,check=True,cwd=R).stdout
 candidate=MIGRATION.read_text();start=candidate.index('DO $obligation_admission_pin$');end=candidate.index('END $obligation_admission_pin$;',start)+len('END $obligation_admission_pin$;')
 before=run('SET check_function_bodies=off;'+guarded(candidate[:start]+candidate[end:]),False)
 check('real protected stale-pin guard refuses the former missing credit pin',before.returncode!=0 and 'migration_left_a_stale_pin' in before.stderr and 'df387bd37001630d94ab2e380144ccab' in before.stderr,True)
 check('stale-pin refusal rolls back every generation table and original credit patch',one("SELECT to_regclass('public.ca_promo_profit_event_generations') IS NULL AND md5(pg_get_functiondef('public.fn_settle_tournament_obligation_before_atomic_batch_gate(uuid,text,integer,uuid,numeric,text,text,uuid)'::regprocedure))='df387bd37001630d94ab2e380144ccab' AND md5(pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure))='"+guard['md5']+"'"),'t')
 run('SET check_function_bodies=off;'+guarded(candidate))
 patched=one("SELECT pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)")
 check('validated original reentry gains source context at one non-addon boundary',patched.count('fn_ca_promo_profit_admission_context('),1)
 check('original P definitive bust hook is preserved',patched.count('fn_ca_promo_retire_busted_entry('),1)
 check('original money door remains unchanged and called twice',patched.count('v_response:=public.fn_ca_process_tournament_chip_purchase_money_v1('),2)
 new_hash=one("SELECT md5(pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure))")
 newguard=one("SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)")
 import re
 expected=re.sub(r'("signature":"public.process_tournament_rebuy\(uuid,uuid,text,numeric,numeric,integer,text\)","definition_md5":")[0-9a-f]{32}',lambda m:m[1]+new_hash,guard['definition'])
 collect_hash=one("SELECT md5(pg_get_functiondef('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'::regprocedure))")
 expected=re.sub(r'("signature":"public.fn_collect_bounty\(uuid,uuid,uuid,jsonb\)","definition_md5":")[0-9a-f]{32}',lambda m:m[1]+collect_hash,expected)
 credit_hash=one("SELECT md5(pg_get_functiondef('public.fn_settle_tournament_obligation_before_atomic_batch_gate(uuid,text,integer,uuid,numeric,text,text,uuid)'::regprocedure))")
 check('original credit metadata patch has independently derived exact postimage',credit_hash,'94cadb1836d8d0b67246cd4df4c47b3c')
 expected=expected.replace('"signature":"public.fn_settle_tournament_obligation_before_atomic_batch_gate(uuid,text,integer,uuid,numeric,text,text,uuid)","definition_md5":"df387bd37001630d94ab2e380144ccab"','"signature":"public.fn_settle_tournament_obligation_before_atomic_batch_gate(uuid,text,integer,uuid,numeric,text,text,uuid)","definition_md5":"'+credit_hash+'"')
 check('original admission contract changes only exact changed original-owner pins',newguard.strip(),expected.strip())
 check('actual admission contract private owner ACL and configuration survive',one("SELECT pg_get_userbyid(proowner)||':'||proacl::text||':'||proconfig::text FROM pg_proc WHERE oid='public.fn_ca_guard_mtt_admission_contract()'::regprocedure"),'postgres:{postgres=X/postgres}:{\"search_path=pg_catalog, public\"}')
 check('actual public PKO owner receives earned-head callback',one("SELECT position('fn_ca_promo_profit_add_earned_head' in pg_get_functiondef('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'::regprocedure))>0"),'t')
 check('actual public PKO owner receives exact head-retirement callback',one("SELECT position('fn_ca_promo_profit_retire_knocked_out_head' in pg_get_functiondef('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'::regprocedure))>0"),'t')
 check('actual public mystery owner scopes original bounty context',one("SELECT position('v_promo_bounty_prior' in pg_get_functiondef('public.fn_mystery_bounty_pay(uuid)'::regprocedure))>0"),'t')
 check('retired unguarded PKO core is unchanged',one("SELECT md5(pg_get_functiondef('public.fn_collect_bounty_unguarded_20260907(uuid,uuid,uuid,jsonb)'::regprocedure))"),'70f5f8d3d8a16ebb84ca06eda6cce33b')


 run(f"UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1hour';INSERT INTO tournament_players VALUES('{REG}','{T}','{U}','{C}',0,0,clock_timestamp(),0,NULL,false);INSERT INTO tables VALUES('{TB}','{T}');INSERT INTO tournament_refund_entitlements VALUES('{uid(40)}','{CH}','{REG}','{T}','{U}',0);INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('{CH}','{uid(40)}','{C}',clock_timestamp());INSERT INTO ca_promo_play_through_grants VALUES('{uid(41)}','{U}');INSERT INTO ca_promo_event_principal_lots VALUES('{uid(41)}','{T}','{CH}',45,45)")
 check('original entry charge owns initial registration generation',one(f"SELECT generation_id FROM ca_promo_profit_charge_generations WHERE charge_ledger_id='{CH}'"),REG)
 stacks=json.dumps([{'user_id':U,'stack':0}]);written=json.dumps({'written':{U:0}})
 run(f"INSERT INTO hand_atomic_commits VALUES('{H}','{TB}',1,clock_timestamp(),'{written}');SELECT fn_ca_promo_profit_capture_tournament_hand('{H}','{TB}','{stacks}')")
 check('accepted hand freezes exact original source prefix',one(f"SELECT charge_ledger_ids=ARRAY['{CH}'::uuid] FROM ca_promo_profit_tournament_hand_sources WHERE hand_id='{H}'"),'t')
 run(f"SELECT fn_ca_promo_profit_capture_tournament_hand('{H}','{TB}','{stacks}')")
 check('accepted hand replay is immutable once',one('SELECT count(*) FROM ca_promo_profit_tournament_hand_sources'),'1')
 bad=run(f"SELECT fn_ca_promo_profit_capture_tournament_hand('{H}','{TB}','[{{\"user_id\":\"{U}\",\"stack\":1}}]')",False)
 check('mismatched accepted ending stack refuses',bad.returncode!=0,True)
 run(f"INSERT INTO tournament_bounty_obligations VALUES('{BO}','{T}','{U}','[]','{H}','{TB}','{uid(98)}',0,clock_timestamp());SET app.bounty_obligation_id='{BO}';INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,amount_paid,amount_owed) VALUES('{OB}','{T}','{U}','bounty',0,5)")
 check('unpaid original bounty freezes exact old generation',one(f"SELECT generation_id||':'||amount_to FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{OB}'"),REG+':5')
 run(f"INSERT INTO tournament_knockout_candidates VALUES('{CAND}','{T}','{U}',0,'pending')")
 ctx=one(f"SELECT fn_ca_promo_profit_admission_context('{T}','{U}','{CAND}','real-reentry')")
 # No P-retirement receipt is present: this is the lawful owed-skip boundary.
 run(f"SET app.ca_promo_profit_admission='{ctx}';INSERT INTO tournament_refund_entitlements VALUES('{uid(42)}','{CH2}','{REG}','{T}','{U}',0);INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('{CH2}','{uid(42)}','{C}',clock_timestamp());SET app.ca_promo_profit_admission='' ")
 check('owed-skip reentry advances generation without deleting old bounty',one(f"SELECT generation_id FROM ca_promo_profit_generation_heads WHERE registration_id='{REG}'"),CAND)
 run(f"INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,amount_paid,amount_owed) VALUES('{OB2}','{T}','{U}','place',0,100)")
 check('ordinary later prize uses only new own funded entry',one(f"SELECT charge_ledger_ids=ARRAY['{CH2}'::uuid] FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{OB2}'"),'t')
 run(f"SET app.bounty_obligation_id='{BO}';UPDATE tournament_obligations SET amount_owed=7 WHERE id='{OB}'")
 check('late original bounty topup retains original hand prefix',one(f"SELECT count(*) FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{OB}' AND generation_id='{REG}' AND charge_ledger_ids=ARRAY['{CH}'::uuid]"),'2')
 def prepare(ob,amount):
  return one(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{ob}','tourney:{T}:obl:{ob}:0',{amount})")
 s=prepare(OB,3)
 check('partial original bounty source has exact amount',one(f"SELECT amount FROM ca_promo_profit_earning_sources WHERE source_id='{s}'"),'3')
 check('partial slice stays exact old earning receipt',one(f"SELECT amount||':'||generation_id FROM ca_promo_profit_earning_source_slices WHERE source_id='{s}'"),'3:'+REG)
 check('response loss source replay returns same immutable source',prepare(OB,3),s)
 key=f'tourney:{T}:obl:{OB}:0';led=uid(50)
 run(f"INSERT INTO wallet_credit_idempotency VALUES('{key}','{U}',3);INSERT INTO chip_ledger VALUES('{led}','prize_liability','player_wallet','{T}','{U}',3,'bounty','{T}','posted','{uid(99)}','{{}}',NULL);SET app.ca_promo_profit_earning_source='{s}';SELECT fn_ca_promo_profit_bind_earning_ledger('{led}')")
 check('physical payout club may differ from frozen earning club',one(f"SELECT count(*) FROM ca_promo_profit_earning_credit_links WHERE ledger_id='{led}' AND source_id='{s}'"),'1')
 check('exact ledger replay binds same original source',one(f"SELECT fn_ca_promo_profit_bind_earning_ledger('{led}')"),s)
 bad=run(f"INSERT INTO chip_ledger VALUES('{uid(51)}','prize_liability','player_wallet','{T}','{U}',4,'bounty','{T}','posted','{C}','{{}}',NULL);SET app.ca_promo_profit_earning_source='{s}';SELECT fn_ca_promo_profit_bind_earning_ledger('{uid(51)}')",False)
 check('wrong actual credit amount refuses binding',bad.returncode!=0,True)
 # New-generation accepted hand is provably clean even while old P remains owed.
 H2=uid(52);BO2=uid(53)
 run(f"INSERT INTO hand_atomic_commits VALUES('{H2}','{TB}',2,clock_timestamp(),'{written}');SELECT fn_ca_promo_profit_capture_tournament_hand('{H2}','{TB}','{stacks}');INSERT INTO tournament_bounty_obligations VALUES('{BO2}','{T}','{U}','[]','{H2}','{TB}','{uid(98)}',0,clock_timestamp());SET app.bounty_obligation_id='{BO2}';UPDATE tournament_obligations SET amount_owed=9 WHERE id='{OB}'")
 check('old owed P does not contaminate new own-funded hand',one(f"SELECT count(*) FROM ca_promo_profit_tournament_hand_sources WHERE hand_id='{H2}'"),'0')
 run(f"UPDATE tournament_obligations SET amount_paid=3 WHERE id='{OB}'")
 s2=one(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{OB}','tourney:{T}:obl:{OB}:300',6)")
 check('mixed old/new owed payment retains separate weighted slices',one(f"SELECT string_agg(amount::text,',' ORDER BY e.amount_from) FROM ca_promo_profit_earning_source_slices s JOIN ca_promo_profit_obligation_earnings e ON e.id=s.earning_receipt_id WHERE s.source_id='{s2}'"),'2,2,2')
 check('mixed generations have no invented single generation',one(f"SELECT generation_id IS NULL FROM ca_promo_profit_earning_sources WHERE source_id='{s2}'"),'t')
 check('new own-funded bounty slice has no old charge IDs',one(f"SELECT s.charge_ledger_ids='{{}}'::uuid[] FROM ca_promo_profit_earning_source_slices s JOIN ca_promo_profit_obligation_earnings e ON e.id=s.earning_receipt_id WHERE s.source_id='{s2}' AND e.amount_from=7"),'t')
 check('all original earning evidence rejects updates',run("UPDATE ca_promo_profit_obligation_earnings SET amount_to=100",False).returncode!=0,True)
 check('browser has no private producer access',one("SELECT has_function_privilege('authenticated','fn_ca_promo_profit_prepare_tournament_credit(uuid,text,numeric)','EXECUTE')"),'f')
 check('service cannot manufacture earning sources',one("SELECT has_table_privilege('service_role','ca_promo_profit_earning_sources','INSERT')"),'f')
 # Same generation addon after the old earning cannot alter the frozen prefix.
 run(f"INSERT INTO tournament_refund_entitlements VALUES('{uid(60)}','{uid(61)}','{REG}','{T}','{U}',0);INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('{uid(61)}','{uid(60)}','{C}',clock_timestamp())")
 check('later addon belongs to current generation',one(f"SELECT generation_id FROM ca_promo_profit_charge_generations WHERE charge_ledger_id='{uid(61)}'"),CAND)
 check('old bounty hand prefix excludes later addon',one(f"SELECT charge_ledger_ids=ARRAY['{CH}'::uuid] FROM ca_promo_profit_tournament_hand_sources WHERE hand_id='{H}'"),'t')
 # Source affinity survives an earlier return of all P capital.
 run(f"UPDATE ca_promo_event_principal_lots SET remaining=0 WHERE charge_ledger_id='{CH}';UPDATE ca_promo_profit_generation_heads SET generation_id='{REG}' WHERE registration_id='{REG}';INSERT INTO hand_atomic_commits VALUES('{uid(70)}','{TB}',3,clock_timestamp(),'{written}');SELECT fn_ca_promo_profit_capture_tournament_hand('{uid(70)}','{TB}','{stacks}')")
 check('original source affinity survives earlier full principal payout',one(f"SELECT charge_ledger_ids=ARRAY['{CH}'::uuid] FROM ca_promo_profit_tournament_hand_sources WHERE hand_id='{uid(70)}'"),'t')
 run(f"UPDATE ca_promo_profit_generation_heads SET generation_id='{CAND}' WHERE registration_id='{REG}'")
 # Bought head belongs to the actual new entry charge; original bounty adds
 # a separately owned old-hand component to the current head container.
 run(f"INSERT INTO tournament_refund_entitlements VALUES('{uid(71)}','{uid(72)}','{REG}','{T}','{U}',2);INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('{uid(72)}','{uid(71)}','{C}',clock_timestamp());UPDATE tournament_players SET current_bounty=2;SET app.bounty_obligation_id='{BO}';SELECT fn_ca_promo_profit_add_earned_head('{T}','{U}',3);UPDATE tournament_players SET current_bounty=5")
 check('bought head records exact cash entry source',one(f"SELECT charge_ledger_ids=ARRAY['{uid(72)}'::uuid] AND generation_id='{CAND}' FROM ca_promo_profit_head_components WHERE source_kind='bought_head'"),'t')
 check('earned head keeps old hand prefix in current head container',one(f"SELECT generation_id='{REG}' AND head_generation_id='{CAND}' AND charge_ledger_ids=ARRAY['{CH}'::uuid] FROM ca_promo_profit_head_components WHERE source_kind='earned_head'"),'t')
 run(f"SET app.bounty_obligation_id='{BO}';SELECT fn_ca_promo_profit_add_earned_head('{T}','{U}',3)")
 check('to-head response loss replay records one original component',one("SELECT count(*) FROM ca_promo_profit_head_components WHERE source_kind='earned_head'"),'1')
 bad=run(f"SET app.bounty_obligation_id='{BO}';SELECT fn_ca_promo_profit_add_earned_head('{T}','{U}',4)",False)
 check('changed to-head amount refuses reuse',bad.returncode!=0,True)
 residual=uid(73)
 run(f"INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,amount_paid,amount_owed) VALUES('{residual}','{T}','{U}','bounty_residual',0,5)")
 check('own residual preserves exact bought and earned head ranges',one(f"SELECT string_agg(amount_to-amount_from||':'||generation_id,',' ORDER BY amount_from) FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{residual}'"),f'3:{REG},2:{CAND}')
 check('head residual allocations retire only the exact owned components',one("SELECT count(*) FROM ca_promo_profit_head_retirements WHERE reason='residual'"),'2')
 rsource=one(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{residual}','tourney:{T}:obl:{residual}:0',4)")
 check('partial residual keeps independent component-weighted slices',one(f"SELECT string_agg(amount::text,',' ORDER BY e.amount_from) FROM ca_promo_profit_earning_source_slices s JOIN ca_promo_profit_obligation_earnings e ON e.id=s.earning_receipt_id WHERE source_id='{rsource}'"),'3,1')
 # Historical owed prizes cannot inherit a later promotion's source.
 run("UPDATE ca_promo_play_through_settings SET enforced_from=NULL")
 legacy=uid(80)
 run(f"INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,amount_paid,amount_owed,created_at) VALUES('{legacy}','{T}','{U}','place',0,4,clock_timestamp()-interval '1day');UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1hour'")
 ls=one(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{legacy}','tourney:{T}:obl:{legacy}:0',2)")
 check('preprogramme owed prize stays unrestricted after later gifts',one(f"SELECT charge_ledger_ids='{{}}'::uuid[] AND generation_id IS NULL FROM ca_promo_profit_earning_sources WHERE source_id='{ls}'"),'t')
 check('legacy partial freezes whole original owed range once',one(f"SELECT amount_from||':'||amount_to FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{legacy}'"),'0:4')
 # Shared actual Free Buy cutoff funding has a distinct original registration
 # slice for each player, while a cutoff prize part never creates a PKO head.
 reg2,user2=uid(81),uid(82);shared=uid(83)
 run(f"INSERT INTO tournament_players VALUES('{reg2}','{T}','{user2}','{C}',0,0,clock_timestamp(),0,NULL,false);INSERT INTO chip_ledger(id,metadata) VALUES('{shared}','{{\"kind\":\"midway_free_buy_promo_head\",\"stage\":\"cutoff\",\"bounty_part\":0}}');INSERT INTO ca_promo_free_buy_funding_slices VALUES('{shared}','{REG}',0.5),('{shared}','{reg2}',1)")
 check('shared actual cutoff binds two exact original registrations',one(f"SELECT count(*) FROM ca_promo_profit_charge_generations WHERE charge_ledger_id='{shared}'"),'2')
 check('cutoff prize subsidy never becomes an invented head component',one(f"SELECT count(*) FROM ca_promo_profit_head_components WHERE operation_ref LIKE 'free_buy_head:{shared}:%'"),'0')
 # W-only original source, even when capital was already returned, must keep
 # its original risk fraction. This is a typed source opening, not W minting.
 run('CREATE TABLE ca_promo_profit_event_lots(tournament_id uuid,user_id uuid,charge_ledger_id uuid,original_amount numeric,remaining numeric)')
 run(f"INSERT INTO ca_promo_profit_event_lots VALUES('{T}','{user2}','{shared}',1,0)")
 H3=uid(84);stacks2=json.dumps([{'user_id':user2,'stack':0}]);written2=json.dumps({'written':{user2:0}})
 run(f"INSERT INTO hand_atomic_commits VALUES('{H3}','{TB}',4,clock_timestamp(),'{written2}');SELECT fn_ca_promo_profit_capture_tournament_hand('{H3}','{TB}','{stacks2}')")
 check('W-only original affinity remains after earlier capital payout',one(f"SELECT charge_ledger_ids=ARRAY['{shared}'::uuid] FROM ca_promo_profit_tournament_hand_sources WHERE hand_id='{H3}'"),'t')
 # Actual financial award constructor and binder share one original
 # transaction; local typed money rows are immutable openings, not fake payers.
 target,targetreg,nled=uid(90),uid(91),uid(92)
 run(f"INSERT INTO tournament_players VALUES('{targetreg}','{target}','{U}','{C}',0,0,clock_timestamp(),0,'{T}',true)")
 op=f'tourney:{T}:seat:{U}:pool_transfer';meta=json.dumps({'kind':'satellite_seat_pool_transfer','user_id':U,'registration_id':targetreg})
 run(f"BEGIN;SELECT set_config('app.ca_promo_profit_nonwallet_source',fn_ca_promo_profit_prepare_nonwallet_earning('{T}','{U}',100,'{op}','event','{target}','{targetreg}',NULL)::text,true);INSERT INTO chip_ledger VALUES('{nled}','prize_liability','prize_liability','{T}','{target}',100,'tournament_buyin','{T}','posted','{uid(99)}','{meta}','{op}');SELECT fn_ca_promo_profit_bind_nonwallet_earning('{nled}','{U}');COMMIT")
 check('original noncash seat links actual source generation before roll',one(f"SELECT s.generation_id='{CAND}' AND s.earning_club_id='{C}' AND s.amount=100 FROM ca_promo_profit_earning_credit_links l JOIN ca_promo_profit_earning_sources s USING(source_id) WHERE l.ledger_id='{nled}'"),'t')
 check('noncash source replay reads immutable original link',one(f"SELECT fn_ca_promo_profit_bind_nonwallet_earning('{nled}','{U}')=(SELECT source_id FROM ca_promo_profit_earning_credit_links WHERE ledger_id='{nled}')"),'t')
 bad=run(f"SELECT fn_ca_promo_profit_bind_nonwallet_earning('{nled}','{user2}')",False)
 check('noncash replay cannot change original entrant',bad.returncode!=0,True)
 ticket,payoutid,tled=uid(93),uid(94),uid(95);top=f'tourney:{T}:satellite_ticket:place:1:ticket_escrow'
 meta=json.dumps({'kind':'direct_satellite_entry_ticket','user_id':U,'payout_id':payoutid})
 run(f"INSERT INTO tournament_tickets VALUES('{ticket}','{U}',100,'{T}','tournament_entry_only');INSERT INTO tournament_payouts VALUES('{payoutid}','{T}','{U}',100,'satellite_ticket','{{\"ticket_id\":\"{ticket}\"}}');BEGIN;SELECT set_config('app.ca_promo_profit_nonwallet_source',fn_ca_promo_profit_prepare_nonwallet_earning('{T}','{U}',100,'{top}','ticket','{ticket}',NULL,'{payoutid}')::text,true);INSERT INTO chip_ledger VALUES('{tled}','prize_liability','escrow','{T}','{ticket}',100,'ticket_issue','{T}','posted','{C}','{meta}','{top}');SELECT fn_ca_promo_profit_bind_nonwallet_earning('{tled}','{U}');COMMIT")
 check('original earned ticket freezes same exact generation and face',one(f"SELECT s.generation_id='{CAND}' AND s.amount=100 AND s.charge_ledger_ids=ARRAY(SELECT DISTINCT charge_ledger_id FROM ca_promo_profit_charge_generations WHERE generation_id='{CAND}' ORDER BY charge_ledger_id) FROM ca_promo_profit_earning_credit_links l JOIN ca_promo_profit_earning_sources s USING(source_id) WHERE l.ledger_id='{tled}'"),'t')
 check('noncash face has one exact earning slice, no invented original grant',one(f"SELECT sum(x.amount)=100 AND count(*)=1 FROM ca_promo_profit_earning_source_slices x JOIN ca_promo_profit_earning_credit_links l USING(source_id) WHERE l.ledger_id='{tled}'"),'t')
 # A zero-P initial wallet charge may precede original registration.
 # The canonical participant receipt, not a guessed or cached row, completes it.
 late_user,late_reg,late_charge,late_ent=uid(110),uid(111),uid(112),uid(113)
 snap=json.dumps({'id':late_reg,'tournament_id':T,'user_id':late_user,'club_id':C})
 run(f"BEGIN;INSERT INTO tournament_refund_entitlements VALUES('{late_ent}','{late_charge}',NULL,'{T}','{late_user}',0);INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('{late_charge}','{late_ent}','{C}',clock_timestamp());INSERT INTO tournament_players VALUES('{late_reg}','{T}','{late_user}','{C}',100,0,clock_timestamp(),0,NULL,false);INSERT INTO tournament_participant_funding_receipts VALUES('{late_reg}','{late_charge}','{late_ent}','{T}','{late_user}','chips',10,'{snap}');COMMIT")
 check('late original registration binds from canonical funding receipt',one(f"SELECT registration_id='{late_reg}' AND generation_id='{late_reg}' FROM ca_promo_profit_charge_generations WHERE charge_ledger_id='{late_charge}'"),'t')
 # An unbound original debit cannot commit an invented clean source.
 missing_ent,missing_charge=uid(114),uid(115)
 bad=run(f"BEGIN;INSERT INTO tournament_refund_entitlements VALUES('{missing_ent}','{missing_charge}',NULL,'{T}','{uid(116)}',0);INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('{missing_charge}','{missing_ent}','{C}',clock_timestamp());COMMIT",False)
 check('missing original paid registration witness refuses whole transaction',bad.returncode!=0 and 'original_paid_charge_generation_not_recorded' in bad.stderr,True)
 # A delayed old mystery payment cannot retire the new real entry head.
 oldcomponent,newcomponent,lossbo=uid(117),uid(118),uid(119)
 run(f"INSERT INTO ca_promo_profit_head_components(id,operation_ref,tournament_id,user_id,head_generation_id,generation_id,earning_club_id,charge_ledger_ids,amount,source_kind,earned_at) VALUES('{oldcomponent}','old head','{T}','{U}','{REG}','{REG}','{C}',ARRAY['{CH}'::uuid],5,'bought_head',clock_timestamp()),('{newcomponent}','new head','{T}','{U}','{CAND}','{CAND}','{C}',ARRAY['{CH2}'::uuid],2,'bought_head',clock_timestamp());INSERT INTO tournament_bounty_obligations VALUES('{lossbo}','{T}','{user2}','[]','{H}','{TB}','{U}',5,clock_timestamp());SET app.bounty_obligation_id='{lossbo}';SELECT fn_ca_promo_profit_retire_knocked_out_head('{T}','{U}',5)")
 check('delayed old head retires original accepted generation only',one(f"SELECT EXISTS(SELECT 1 FROM ca_promo_profit_head_retirements WHERE component_id='{oldcomponent}') AND NOT EXISTS(SELECT 1 FROM ca_promo_profit_head_retirements WHERE component_id='{newcomponent}')"),'t')
 # An add-on or rebuy between hands: the original delta-mode commit writes
 # round(db_before+engine_after-engine_before,2) and records db_before-
 # engine_before as rebased[user]. Production 2026-11-17 15:32Z: hands
 # #59866957/#59866958 rolled back on every replay and two tables froze.
 HA,HB=uid(120),uid(121);s0=json.dumps([{'user_id':U,'stack':0}])
 addon=json.dumps({'written':{U:3000},'rebased':{U:3000}});beyond=json.dumps({'written':{U:3001},'rebased':{U:3000}})
 run(f"INSERT INTO hand_atomic_commits VALUES('{HA}','{TB}',121,clock_timestamp(),'{addon}'),('{HB}','{TB}',122,clock_timestamp(),'{beyond}')")
 pre=run(f"SELECT fn_ca_promo_profit_capture_tournament_hand('{HA}','{TB}','{s0}')",False)
 check('pre-fix guard refuses an add-on hand the commit wrote whole',pre.returncode!=0 and 'original_tournament_earning_hand_players_mismatch' in pre.stderr,True)
 fix=REBASE_FIX.read_text();run('SET check_function_bodies=off;'+guarded(fix,REBASE_FIX))
 fixed=one("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure))")
 check('rebase fix keeps private owner, definer and ACL',one("SELECT pg_get_userbyid(proowner)||':'||prosecdef||':'||proacl::text FROM pg_proc WHERE oid='public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure"),'postgres:true:{postgres=X/postgres}')
 run(f"SELECT fn_ca_promo_profit_capture_tournament_hand('{HA}','{TB}','{s0}')")
 check('fixed guard captures the add-on hand once',one(f"SELECT count(*) FROM ca_promo_profit_tournament_hand_clocks WHERE hand_id='{HA}'"),'1')
 bad=run(f"SELECT fn_ca_promo_profit_capture_tournament_hand('{HB}','{TB}','{s0}')",False)
 check('a write beyond the recorded rebase still refuses',bad.returncode!=0 and 'original_tournament_earning_hand_players_mismatch' in bad.stderr,True)
 bad=run(f"SELECT fn_ca_promo_profit_capture_tournament_hand('{HA}','{TB}','[{{\"user_id\":\"{U}\",\"stack\":1}}]')",False)
 check('a rebased hand with a different engine stack still refuses',bad.returncode!=0,True)
 run('SET check_function_bodies=off;'+guarded(fix,REBASE_FIX))
 check('rebase fix is idempotent',one("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_tournament_hand(uuid,uuid,jsonb)'::regprocedure))"),fixed)
 # Satellite's original direct cash-remainder owner needs the same source
 # handoff as the ordinary obligation payer. Exercise the real helpers and
 # compile the guarded patch against the captured original cohort authority.
 run('ALTER TABLE tournament_obligations ADD COLUMN source text,ADD COLUMN place integer;')
 rem=uid(130);remkey=f'tourney:{T}:satellite_remainder:place:6'
 run(f"INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,amount_paid,amount_owed,source,place) VALUES('{rem}','{T}','{U}','satellite_remainder',0,16,'engine.fn_settle_satellite_tournament',6)")
 before=run(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{rem}','{remkey}',16)",False)
 check('pre-fix satellite original key refuses source preparation',before.returncode!=0 and 'original_tournament_earning_credit_intent_mismatch' in before.stderr,True)
 satellite=SATELLITE_FIX.read_text();run('SET check_function_bodies=off;'+guarded(satellite,SATELLITE_FIX))
 sid=one(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{rem}','{remkey}',16)")
 check('satellite exact unpaid remainder keeps original operation identity',one(f"SELECT operation_ref||':'||source_kind||':'||amount FROM ca_promo_profit_earning_sources WHERE source_id='{sid}'"),remkey+':satellite_remainder:16')
 check('satellite source preparation is idempotent',one(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{rem}','{remkey}',16)"),sid)
 for key,amount in [(remkey,15),(remkey+'x',16),(f'tourney:{T}:satellite_remainder:place:7',16)]:
  bad=run(f"SELECT fn_ca_promo_profit_prepare_tournament_credit('{rem}','{key}',{amount})",False)
  check('partial or wrong satellite remainder identity refuses '+key+':'+str(amount),bad.returncode!=0,True)
 # A wrong earning-source GUC still refuses; there is no new fallback.
 led=uid(131)
 run(f"INSERT INTO chip_ledger VALUES('{led}','prize_liability','player_wallet','{T}','{U}',16,'tournament_prize','{T}','posted','{C}','{{}}',NULL)")
 bad=run(f"SET app.ca_promo_profit_earning_source='';SELECT fn_ca_promo_profit_bind_earning_ledger('{led}')",False)
 check('missing original source still refuses the actual ledger binding',bad.returncode!=0,True)
 run(f"INSERT INTO wallet_credit_idempotency VALUES('{remkey}','{U}',16);SET app.ca_promo_profit_earning_source='{sid}';SELECT fn_ca_promo_profit_bind_earning_ledger('{led}')")
 check('satellite ledger binds exact original key and conserved earning slices',one(f"SELECT count(*) FROM ca_promo_profit_earning_credit_links WHERE ledger_id='{led}' AND source_id='{sid}'"),'1')
 check('satellite ledger response loss replay is idempotent',one(f"SELECT fn_ca_promo_profit_bind_earning_ledger('{led}')"),sid)
 cohort=one("SELECT pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)")
 check('actual cohort prepares source before its original direct payment',cohort.index('fn_ca_promo_profit_prepare_tournament_credit(')<cohort.index('v_credited := public.fn_credit_and_log('),True)
 check('actual cohort restores caller source after original payment',cohort.index("COALESCE(v_promo_earning_prior,'')")>cohort.index("p_payout_source => 'satellite_remainder'"),True)
 fixed=one("SELECT md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure))")
 run('SET check_function_bodies=off;'+guarded(satellite,SATELLITE_FIX))
 check('satellite source migration replay is idempotent',one("SELECT md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure))"),fixed)
 print(json.dumps({'status':'passed','checks':len(checks)}));(out/'RESULTS.json').write_text(json.dumps({'status':'passed','checks':checks},indent=2)+'\n')
finally:
 if started:subprocess.run([PG/'pg_ctl','-D',tmp/'data','-m','fast','-w','stop'],capture_output=True)
 (out/'CHECKS.json').write_text(json.dumps(checks,indent=2)+'\n')

# The same maintained CI entrypoint must execute the real public money owners.
financial=[os.sys.executable,str(R/'scripts/ci/test-promo-tournament-earning-financial.py'),'--output',str(out/'public-financial'),'--pg-bin',str(PG),'--financial-root',str(args.financial_root.resolve()),'--migration',str(MIGRATION),'--profit-root',str(args.profit_root.resolve())]
if args.custody_migration:financial+=['--custody-migration',str(args.custody_migration.resolve())]
subprocess.run(financial,check=True)

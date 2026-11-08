#!/usr/bin/env python3
"""Exact net-guarantee migration, real close writers, promo custody and correction guards on owned PG17."""
from pathlib import Path
import json, os, shutil, socket, subprocess, tempfile

ROOT=Path(__file__).resolve().parents[2]
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
work=Path(tempfile.mkdtemp(prefix='net-gtd-',dir=os.environ['TMPDIR']))
sock=Path(tempfile.mkdtemp(prefix='s-',dir=os.environ.get('CA_PG_SOCKET_ROOT',os.environ['TMPDIR'])))
guard=socket.socket();guard.bind(('127.0.0.1',0));port=str(guard.getsockname()[1]);started=False
def run(args,sql=None):
 r=subprocess.run([str(x)for x in args],input=sql,text=True,capture_output=True)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout
def q(sql):
 return run([PG/'psql','-X','-qAt','-h',sock,'-p',port,'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1'],sql).strip()
def fail(sql,needle):
 try:q(sql)
 except RuntimeError as e:
  assert needle in str(e),str(e);return
 raise AssertionError('expected refusal: '+needle)
U='fade0000-0000-0000-0000-000000000001'
T='f22ceae6-2850-40ef-8f97-7d3660be32a3'
try:
 run([PG/'initdb','-D',work/'data','-U','fixture','-A','trust','--no-locale'])
 run([PG/'pg_ctl','-D',work/'data','-l',work/'pg.log','-o',f"-k {sock} -p {port} -c listen_addresses=''",'-w','start']);started=True
 q((ROOT/'tests/sql/fixtures/bounty-guarantee-before.sql').read_text())
 q((ROOT/'supabase/migrations/20261102051957_tournament_guarantees_include_funded_bounties.sql').read_text())
 supplemental=(ROOT/'tests/sql/fixtures/bounty-owner-correction.sql').read_text().split('INSERT INTO clubs(id,asset)')[0]
 q(supplemental)
 pre=json.loads((ROOT/'scripts/ci/fixtures/net-guarantee/preimages.json').read_text())
 q('SET check_function_bodies=off;\n'+';\n'.join(x['definition'] for x in pre)+';')
 # Actual place-floor helper from its source migration, no unrelated migration replay.
 old=(ROOT/'supabase/migrations/20261105222502_a_buyin_guarantee_counts_the_whole_player_payment.sql').read_text()
 floor=old[old.index('CREATE FUNCTION public.fn_ca_guarantee_place_floor'):]
 q(floor[:floor.index('$fn$;')+len('$fn$;')])
 q("""CREATE FUNCTION fn_ca_fund_free_buy_at_cutoff_locked(uuid) RETURNS numeric LANGUAGE sql AS $$SELECT 0::numeric$$;
 CREATE FUNCTION fn_ca_return_excess_guarantee_promo_locked(uuid) RETURNS numeric LANGUAGE sql AS $$SELECT 0::numeric$$;
 CREATE FUNCTION fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION fn_ca_read_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$SELECT 'unlimited-mtt-v2'$$;
 CREATE SCHEMA smarter_private;
 CREATE TABLE smarter_private.nov3_tournament_attendance(tournament_id uuid,attendance_floor integer);
 CREATE TRIGGER exact_finalized_guard BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION trg_freeze_finalized_tournament_prize_pool();
 CREATE TRIGGER exact_managed_guard BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_guard_managed_game_lifecycle();
 """
 +f"INSERT INTO clubs(id,asset,chip_treasury)VALUES('{U}','chips',100000);"
 +f"INSERT INTO union_wallets(union_id,chip_balance,promo_wallet)VALUES('{U}',100000,1000);"
 +f"INSERT INTO tournaments(id,club_id,union_id,name,status,prize_pool,bounty_pool,guaranteed_prize,total_rake,prize_pool_finalized,payout_math_version,payout_unit_cents,variant,buy_in_amount,buy_in_fee,bounty_amount,payout_structure) VALUES('{T}','{U}','{U}','Net bounty fixture','RUNNING',1742,670,2500,268,false,1,1,'bounty',36,4,10,'[{{\"place\":1,\"percentage\":50}},{{\"place\":2,\"percentage\":20}},{{\"place\":3,\"percentage\":10}},{{\"place\":4,\"percentage\":5}},{{\"place\":5,\"percentage\":4}},{{\"place\":6,\"percentage\":3}},{{\"place\":7,\"percentage\":2}},{{\"place\":8,\"percentage\":2}},{{\"place\":9,\"percentage\":2}},{{\"place\":10,\"percentage\":1}},{{\"place\":11,\"percentage\":1}}]');"
 +f"INSERT INTO tournament_escrow(tournament_id,enforced,gross_in,fee_entries_in,bounty_in,prize_balance,bounty_balance,fee_balance,closed_at,terminal_closed_at)VALUES('{T}',true,2680,268,670,1742,670,268,NULL,NULL);"
 +f"INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,status) SELECT 'player_wallet',md5(i::text)::uuid,'prize_liability','{T}',40,'tournament_buyin','posted' FROM generate_series(1,67)i;")
 assert json.loads(q(f"SELECT fn_ca_guarantee_funding('{T}')"))['house_due']==0
 print('PASS: reproduced gross coverage hides the 88-chip shortfall',flush=True)
 migration=next((ROOT/'supabase/migrations').glob('*_net_guarantee_coverage_and_union_promo_funding.sql'))
 q((ROOT/'supabase/migrations/20260823000000_fix_entry_split_no_default_rake.sql').read_text())
 q("CREATE TABLE ca_manual_adjustments(id uuid,target_kind text,target_id uuid,tournament_id uuid,status text,amount numeric);CREATE TABLE wallet_credit_idempotency(key text,user_id uuid,amount numeric);")
 # Reproduce the installed money-DDL admission with its real predicate and guard.
 q("CREATE TABLE ca_money_rpc_registry(proname text PRIMARY KEY,status text,notes text);CREATE FUNCTION fn_ca_autoledger()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER native_promo_vocabulary AFTER UPDATE OF promo_wallet ON union_wallets FOR EACH ROW EXECUTE FUNCTION fn_ca_autoledger('promo_wallet=promo_wallet');")
 guard_defs=json.loads((ROOT/'scripts/ci/fixtures/satellite-qualifiers/current-money-ddl-guard-20260917.json').read_text())
 for definition in guard_defs['functions']:q(definition['definition']+';')
 q("CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION fn_ca_money_rpc_registry_guard();")
 source=migration.read_text()
 start=source.index('INSERT INTO public.ca_money_rpc_registry(proname,status,notes)')
 end=source.index('CREATE FUNCTION public.fn_ca_fund_union_guarantee_promo_locked',start)
 fail(source[:start]+source[end:],'is not in ca_money_rpc_registry')
 assert q("SELECT count(*) FROM pg_proc WHERE proname='fn_ca_fund_union_guarantee_promo_locked'")=='0'
 q(source)
 assert q("SELECT status FROM ca_money_rpc_registry WHERE proname='fn_ca_fund_union_guarantee_promo_locked'")=='approved'
 print('PASS: exact pre-fix migration refused atomically by the real money-DDL guard; registered source installs',flush=True)
 f=json.loads(q(f"SELECT fn_ca_guarantee_funding('{T}')"));assert f['net_coverage']==2412 and f['house_due']==88,f
 # Ordinary close invokes the new helper and actual legacy finalizer; rerun cannot debit twice.
 q(f"""BEGIN;
 SELECT fn_apply_prize_guarantee('{T}','native-net-proof');
 DO $$BEGIN
 IF (SELECT prize_pool FROM tournaments WHERE id='{T}')<>1830
 OR NOT(SELECT prize_pool_finalized FROM tournaments WHERE id='{T}')
 OR (SELECT promo_wallet FROM union_wallets)<>912
 OR (SELECT chip_balance FROM union_wallets)<>100000
 OR (SELECT prize_balance FROM tournament_escrow WHERE tournament_id='{T}')<>1830
 THEN RAISE EXCEPTION 'ordinary close conservation failed';END IF;END$$;
 SELECT fn_apply_prize_guarantee('{T}','native-replay');
 DO $$BEGIN IF (SELECT promo_wallet FROM union_wallets)<>912 THEN RAISE EXCEPTION 'double promo debit';END IF;END$$;
 ROLLBACK;""")
 # Refused promo and failed journal roll back the complete original transaction.
 for balance in ['NULL',"'NaN'::numeric"]:
  q(f'UPDATE union_wallets SET promo_wallet={balance};')
  fail(f"SELECT fn_apply_prize_guarantee('{T}','native-invalid-bank')",'union promo wallet cannot fund')
  assert q(f"SELECT prize_pool||':'||prize_pool_finalized FROM tournaments WHERE id='{T}'")=='1742.00:false'
 for balance in ["'Infinity'::numeric","'-Infinity'::numeric"]:
  fail(f'UPDATE union_wallets SET promo_wallet={balance};','numeric field overflow')
 q('UPDATE union_wallets SET promo_wallet=1000;')
 print('PASS: null/NaN are refused by the writer; infinities are refused by the stored numeric type',flush=True)
 q('UPDATE union_wallets SET promo_wallet=87;')
 fail(f"SELECT fn_apply_prize_guarantee('{T}','native-insufficient')",'union promo wallet cannot fund')
 assert q(f"SELECT prize_pool||':'||prize_pool_finalized FROM tournaments WHERE id='{T}'")=='1742.00:false'
 q("UPDATE union_wallets SET promo_wallet=1000;CREATE FUNCTION reject_net_journal()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native journal refusal';END$$;CREATE TRIGGER reject_net_journal BEFORE INSERT ON chip_ledger FOR EACH ROW WHEN(NEW.category='promo_send')EXECUTE FUNCTION reject_net_journal();")
 fail(f"SELECT fn_apply_prize_guarantee('{T}','native-journal')",'native journal refusal')
 assert q('SELECT promo_wallet FROM union_wallets')=='1000.00'
 q('DROP TRIGGER reject_net_journal ON chip_ledger;')
 print('PASS: exact net funding, union promo debit, escrow credit, finalization, replay, insufficient funds and journal rollback',flush=True)
 # Two real sessions racing the same close must debit promo once.
 C='f22ceae6-2850-40ef-8f97-7d3660be32a4'
 q(f"INSERT INTO tournaments SELECT (jsonb_populate_record(NULL::tournaments,to_jsonb(t)||jsonb_build_object('id','{C}'))).* FROM tournaments t WHERE id='{T}';INSERT INTO tournament_escrow SELECT(jsonb_populate_record(NULL::tournament_escrow,to_jsonb(e)||jsonb_build_object('tournament_id','{C}'))).* FROM tournament_escrow e WHERE tournament_id='{T}';INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,status)SELECT 'player_wallet',md5(i::text)::uuid,'prize_liability','{C}',40,'tournament_buyin','posted' FROM generate_series(1,67)i;")
 cmd=[str(x) for x in [PG/'psql','-X','-qAt','-h',sock,'-p',port,'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-c',f"SELECT fn_apply_prize_guarantee('{C}','native-concurrent')"]]
 sessions=[subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
 for session in sessions:
  out,err=session.communicate(timeout=20);assert session.returncode==0,err
  assert json.loads(out)['ok'],out
 assert q('SELECT promo_wallet FROM union_wallets')=='912.00'
 q('UPDATE union_wallets SET promo_wallet=1000;')
 print('PASS: two concurrent original close sessions debit promo only once',flush=True)
 # Finalized pools remain immutable; the completed case uses its separate approved house door.
 q(f"UPDATE tournaments SET prize_pool_finalized=true WHERE id='{T}';")
 fail(f"UPDATE tournaments SET prize_pool=1830 WHERE id='{T}'",'finalized')
 print('PASS: original finalized-pool guards remain armed and refuse a later pool rewrite',flush=True)

finally:
 if started:run([PG/'pg_ctl','-D',work/'data','-m','immediate','stop'])
 guard.close();shutil.rmtree(work);shutil.rmtree(sock)

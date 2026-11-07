#!/usr/bin/env python3
"""Private PG17 rehearsal of the 2026-11-04 Midway Free Buy rotation.
No production URL is accepted. Captured live preimages (md5-checked) plus the
captured accounting triggers are installed over a synthetic schema, the EXACT
candidate migration file is executed, and the four formats are exercised:
promo-funded registration (human and horse), player-wallet rebuy and add-on,
unplayed return, escrow reconstruction, shape freezing and the 00:30 carve-out.
"""
from pathlib import Path
import json, os, re, shutil, subprocess, tempfile, time
ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'scripts/ci/fixtures/midway-free-buy-rotation'
MIG=ROOT/'supabase/migrations/20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries.sql'
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
work=Path(tempfile.mkdtemp(prefix='midway-rotation-',dir=os.environ.get('TMPDIR')))
sock=Path(tempfile.mkdtemp(prefix='s-',dir=os.environ.get('CA_PG_SOCKET_ROOT',os.environ.get('TMPDIR'))))
port=str(36000+os.getpid()%10000)
started=False

def run(args,sql=None,env=None,timeout=60):
 r=subprocess.run([str(a) for a in args],input=sql,text=True,capture_output=True,timeout=timeout,env=env)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout

def query(db,sql):
 if os.environ.get('PGNODE'):
  env=dict(os.environ,PGHOST=str(sock),PGHOSTADDR='',PGPORT=port,PGUSER='postgres',PGDATABASE=db)
  return run([os.environ['PGNODE'],ROOT/'scripts/ci/probes/chip-journal-atomicity/postgres-runtime/registration-query.mjs'],json.dumps(sql)+'\n',env)
 return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',sock,'-p',port,'-U','postgres','-d',db],sql)

try:
 run([PG/'initdb','-D',work/'data','-U','postgres','-A','trust','--no-locale'])
 run([PG/'pg_ctl','-D',work/'data','-l',work/'postgres.log','-o',f'-k {sock} -p {port} -h 127.0.0.1','-w','start']);started=True
 query('postgres','CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
 query('postgres','CREATE DATABASE rotation')
 db='rotation'
 setup="""CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 """+(FIX/'schema.sql').read_text()+"""
 ALTER TABLE tournament_escrow ADD PRIMARY KEY(tournament_id);
 ALTER TABLE chip_ledger ADD PRIMARY KEY(id); CREATE UNIQUE INDEX ON chip_ledger(idempotency_key);
 ALTER TABLE tournaments ADD PRIMARY KEY(id); ALTER TABLE union_wallets ADD UNIQUE(union_id);
 ALTER TABLE tournament_players ADD PRIMARY KEY(id); CREATE UNIQUE INDEX ON tournament_players(tournament_id,user_id);
 CREATE TABLE ca_ledger_invariant_store_mode(store text,mode text);
 CREATE TABLE ca_ledger_invariant_mode(mode text); INSERT INTO ca_ledger_invariant_mode VALUES('refuse');
 """
 setup+='\n'.join(v for k,v in json.loads((FIX/'accounting-functions.json').read_text()).items() if k!='fn_ca_tournament_purchase_fee_ratio')
 query(db,setup)
 # Captured live definitions. Each must reproduce its production md5 here, so
 # the migration's own preimage guards are exercised, not bypassed.
 pre=json.loads((FIX/'preimages.json').read_text())
 query(db,'SET check_function_bodies=off;'+';\n'.join(p['definition'] for p in pre)+';')
 for p in pre:
  got=query(db,f"SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{p['name']}'").strip()
  assert got==p['live_md5'],(p['name'],got,p['live_md5'])
 query(db,(FIX/'stubs.sql').read_text()+"""
 CREATE TRIGGER mystery_contract BEFORE INSERT OR UPDATE OF is_mystery_bounty, mystery_bounty_profile, mystery_bounty_activation, mystery_bounty_activation_value, mystery_bounty_pool_percent, mystery_bounty_regular_pool_percent, mystery_bounty_top_percent ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_guard_tournament_mystery_creation_contract();
 CREATE TRIGGER zz_freerolls_are_free_buy BEFORE INSERT OR UPDATE OF buy_in_amount, buy_in_fee, tournament_type, variant, is_rebuy, add_on_available, rebuy_cost, addon_cost, rebuy_chips, addon_chips, rebuy_levels, addon_levels, max_rebuys ON tournaments FOR EACH ROW WHEN ((COALESCE(new.buy_in_amount, (0)::numeric) = (0)::numeric)) EXECUTE FUNCTION fn_freerolls_are_free_buy();
 CREATE TRIGGER zzzz_freeze_registered_tournament_settlement_contract BEFORE UPDATE OF variant, tournament_type, satellite_target_id, bubble_protection, buy_in_amount, guaranteed_prize ON tournaments FOR EACH ROW EXECUTE FUNCTION trg_freeze_registered_tournament_settlement_contract();
 CREATE TRIGGER aa_ca_capture_tournament_charge_entitlement AFTER INSERT ON chip_ledger FOR EACH ROW WHEN (((new.tournament_id IS NOT NULL) AND (new.from_type = 'player_wallet'::text) AND (new.to_type = 'prize_liability'::text))) EXECUTE FUNCTION fn_ca_capture_tournament_charge_entitlement();
 CREATE TRIGGER zz_ca_escrow_wallet_tx AFTER INSERT ON wallet_transactions FOR EACH ROW WHEN ((new.related_entity_id IS NOT NULL)) EXECUTE FUNCTION fn_ca_escrow_on_wallet_tx();
 CREATE TRIGGER actor BEFORE INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION enforce_chip_ledger_performed_by();
 CREATE TRIGGER balance_tally AFTER UPDATE ON union_wallets FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
 CREATE TRIGGER member_tally AFTER UPDATE ON club_members FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
 CREATE TRIGGER escrow_tally AFTER UPDATE ON tournament_escrow FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_store_move();
 CREATE TRIGGER ledger_tally AFTER INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_ledger_leg();
 CREATE CONSTRAINT TRIGGER money_invariant AFTER INSERT ON chip_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
 GRANT USAGE ON SCHEMA public,auth TO service_role;
 GRANT SELECT,UPDATE,INSERT ON ALL TABLES IN SCHEMA public TO service_role;
 """)
 query(db,(FIX/'opening.sql').read_text())
 # The actual production money-writer DDL guard (as test-midway-free-buy-full.py
 # installs it): every balance writer the candidate creates must be registered.
 # Registry rows production holds for the replaced writers (read 2026-11-05).
 query(db,"INSERT INTO ca_money_rpc_registry(proname,status,notes) VALUES('fn_ca_process_tournament_chip_purchase_money_v1','system','production row'),('fn_ca_tournament_escrow_chips','system','production row');")
 guard=(ROOT/'supabase/migrations/20260911160817_a_money_writing_function_is_registered_before_it_exists.sql').read_text()
 parts=[]
 for name in ['fn_ca_money_rpc_balance_columns','fn_ca_money_rpc_writes_balances','fn_ca_money_rpc_registry_guard']:
  match=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\(.*?AS (\$[a-z_]*\$).*?\1;',guard,re.S)
  assert match,name
  parts.append(match.group(0))
 query(db,'\n'.join(parts)+'''
 CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
 EXECUTE FUNCTION public.fn_ca_money_rpc_registry_guard();''')
 began=time.monotonic()
 out=query(db,MIG.read_text())
 took=time.monotonic()-began
 assert took<8,took
 print('PASS: exact candidate migration installed over md5-identical live preimages in %.2fs'%took,flush=True)
 print(query(db,(FIX/'cases.sql').read_text()),flush=True)
 # The production slot classifier lives with the digest watch. Install its
 # exact definition without the digest's unrelated operational preimages.
 watch=(ROOT/'supabase/migrations/20261105233756_the_midway_free_buy_watch_reads_the_schedule_not_event_ids.sql').read_text()
 slot=re.search(r'CREATE OR REPLACE FUNCTION public\.fn_ca_midway_free_buy_slot_format\(.*?AS (\$[a-z_]*\$).*?\1;',watch,re.S)
 assert slot,'missing production schedule slot classifier'
 query(db,slot.group(0))
 guard_migration=ROOT/'supabase/migrations/20261106004812_a_built_midway_free_buy_refuses_a_shape_its_schedule_does_no.sql'
 query(db,guard_migration.read_text())
 print(query(db,(FIX/'scheduled-guarantee.sql').read_text()),flush=True)
 # Installed a second time it must refuse (its preimages are gone), changing nothing.
 try:
  query(db,MIG.read_text()); raise AssertionError('Migration reinstalled over its own output')
 except RuntimeError as error:
  assert 'Inspected definition changed' in str(error),str(error)
 print('PASS: a second install is refused by its preimage guards',flush=True)
finally:
 if started: run([PG/'pg_ctl','-D',work/'data','-m','immediate','-w','stop'])
 shutil.rmtree(work)
 shutil.rmtree(sock)

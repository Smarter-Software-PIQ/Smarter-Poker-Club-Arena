#!/usr/bin/env python3
"""Private PG17 rehearsal of promo custody and the registered-event transition.
No production URL is accepted. Uses candidate functions and captured accounting
triggers, synthetic schema/identity, and explicit rollback of funding probes.
"""
from pathlib import Path
import json, os, re, shutil, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'scripts/ci/fixtures/midway-free-buy-pko'
MIG=ROOT/'supabase/migrations/20261102154336_midway_promo_funded_bounty_only_free_buys.sql'
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
work=Path(tempfile.mkdtemp(prefix='midway-pko-',dir=os.environ.get('TMPDIR')))
sock=Path(tempfile.mkdtemp(prefix='s-',dir=os.environ.get('CA_PG_SOCKET_ROOT',os.environ.get('TMPDIR'))))
port=str(35000+os.getpid()%10000)
started=False

def run(args,sql=None,env=None):
 r=subprocess.run([str(a) for a in args],input=sql,text=True,capture_output=True,timeout=60,env=env)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout

def query(db,sql):
 if os.environ.get('PGNODE'):
  env=dict(os.environ,PGHOST=str(sock),PGHOSTADDR='',PGPORT=port,PGUSER='postgres',PGDATABASE=db)
  return run([os.environ['PGNODE'],ROOT/'scripts/ci/probes/chip-journal-atomicity/postgres-runtime/registration-query.mjs'],json.dumps(sql)+'\n',env)
 return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',sock,'-p',port,'-U','postgres','-d',db],sql)

source=MIG.read_text()
def candidate(name):
 # Match objects preserve the complete candidate bytes, including parameters.
 found=list(re.finditer(r'CREATE OR REPLACE FUNCTION public\.'+re.escape(name)+r'\b.*?\bAS\s+(\$[A-Za-z_0-9]*\$).*?\1\s*;',source,re.S|re.I))
 assert len(found)==1,name
 return found[0].group(0)

try:
 run([PG/'initdb','-D',work/'data','-U','postgres','-A','trust','--no-locale'])
 run([PG/'pg_ctl','-D',work/'data','-l',work/'postgres.log','-o',f'-k {sock} -p {port} -h 127.0.0.1','-w','start']);started=True
 query('postgres','CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
 for case in ['runtime','funding','conversion']:
  query('postgres','CREATE DATABASE '+case)
  setup="""CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
  """+(FIX/'schema.sql').read_text()+"""
  ALTER TABLE tournament_escrow ADD PRIMARY KEY(tournament_id);
  ALTER TABLE chip_ledger ADD PRIMARY KEY(id); CREATE UNIQUE INDEX ON chip_ledger(idempotency_key);
  ALTER TABLE tournaments ADD PRIMARY KEY(id); ALTER TABLE union_wallets ADD UNIQUE(union_id);
  CREATE TABLE clubs(id uuid,asset text,is_platform boolean);
  CREATE TABLE ca_ledger_invariant_store_mode(store text,mode text);
  CREATE TABLE ca_ledger_invariant_mode(mode text); INSERT INTO ca_ledger_invariant_mode VALUES('refuse');
  """
  setup+='\n'.join(value for name,value in json.loads((FIX/'accounting-functions.json').read_text()).items() if name!='fn_ca_tournament_purchase_fee_ratio')
  for name in ['fn_ca_midway_free_buy_pko','fn_ca_midway_free_buy_promo_head',
    'fn_ca_midway_free_buy_conversion_transition','fn_ca_convert_midway_free_buy',
    'trg_freeze_registered_tournament_settlement_contract','fn_guard_managed_game_lifecycle']:
   setup+='\n'+candidate(name)
  setup+='\n'.join(re.findall(r'(?:REVOKE|GRANT) [^;]*(?:fn_ca_midway_free_buy|fn_ca_convert_midway_free_buy)[^;]*;',source))
  setup+="""
  CREATE TRIGGER settlement_contract BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION trg_freeze_registered_tournament_settlement_contract();
  CREATE TRIGGER managed_contract BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_guard_managed_game_lifecycle();
  CREATE TRIGGER actor BEFORE INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION enforce_chip_ledger_performed_by();
  CREATE TRIGGER balance_tally AFTER UPDATE ON union_wallets FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
  CREATE TRIGGER escrow_tally AFTER UPDATE ON tournament_escrow FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_store_move();
  CREATE TRIGGER ledger_tally AFTER INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_ledger_leg();
  CREATE CONSTRAINT TRIGGER money_invariant AFTER INSERT ON chip_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
  """
  query(case,setup)
  if case=='runtime':
   helpers=json.loads((FIX/'conversion-preimages.json').read_text())
   query(case,'SET check_function_bodies=off;'+''.join(v for k,v in helpers.items() if k in ['fn_ca_text_without_dollar','fn_ca_diamond_guarantee_copy','fn_ca_mtt_late_registration_minutes','fn_safe_jsonb_array','fn_ca_provisional_payout_structure','fn_ca_effective_payout_depth','fn_ca_payout_structure']))
   query(case,"""GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated;
   GRANT SELECT,UPDATE,INSERT ON ALL TABLES IN SCHEMA public TO service_role,authenticated;
   ALTER FUNCTION auth.role() RENAME TO fixture_original_role;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claims',true)::jsonb->>'role'$$;
   """)
   query(case,(FIX/'runtime-opening.sql').read_text())
   failed=False
   try:
    query(case,"SET ROLE service_role; SET request.jwt.claims='{\"role\":\"service_role\"}'; UPDATE tournaments SET spin_reveal_lag_ms=1000;")
   except RuntimeError as error:
    assert 'permission denied for function fn_ca_midway_free_buy_conversion_transition' in str(error),str(error)
    failed=True
   assert failed,'The original service-role trigger defect did not reproduce'
   migrations=list((ROOT/'supabase/migrations').glob('*_spin_launch_trigger_predicate_runtime_permissions.sql'))
   assert len(migrations)==1,migrations
   query(case,migrations[0].read_text())
   print(query(case,(FIX/'runtime.sql').read_text()),flush=True)
  else:
   migrations=list((ROOT/'supabase/migrations').glob('*_spin_launch_trigger_predicate_runtime_permissions.sql'))
   assert len(migrations)==1,migrations
   query(case,migrations[0].read_text())
   print(query(case,(FIX/(case+'.sql')).read_text()),flush=True)
finally:
 if started: run([PG/'pg_ctl','-D',work/'data','-m','immediate','-w','stop'])
 shutil.rmtree(work)
 shutil.rmtree(sock)

# Qualify the exact migration and terminal return against the maintained larger
# financial catalog as well as the focused transaction fixtures above.
import sys
subprocess.run([sys.executable,'-B',str(ROOT/'scripts/ci/test-midway-free-buy-full.py')],check=True)

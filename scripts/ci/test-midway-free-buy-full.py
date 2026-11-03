#!/usr/bin/env python3
"""Exact migration and cancellation in the retained native financial catalog.
Only opening registrations/identities are synthetic. No production URL accepted.
"""
from pathlib import Path
import hashlib, json, os, re, tempfile, time
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
R=Path(__file__).resolve().parents[2]
F=R/'scripts/ci/fixtures/midway-free-buy-pko'
M=R/'supabase/migrations/20261102154336_midway_promo_funded_bounty_only_free_buys.sql'
O=Path(tempfile.mkdtemp(prefix='mp-evidence-',dir=os.environ.get('TMPDIR')))
class MidwayExecution(module(R/'scripts/ci/test-mtt-unlimited.py','midway_full').Execution):
 # The required chip-journal gate ships a pinned pg Node client alongside its
 # embedded server, which deliberately has no psql executable. Use that same
 # transport, with only this newly owned cluster's connection parameters.
 def sql(self,database,query=None,*,file=None,label='sql',seconds=90,check=True):
  node=os.environ.get('PGNODE')
  if not node:
   return super().sql(database,query,file=file,label=label,seconds=seconds,check=check)
  source=Path(file).read_text() if file is not None else query
  # Node rejects SQL errors directly; only the retained psql error directive
  # is transport syntax. Every actual SQL statement remains byte-identical.
  source=source.replace('\\set ON_ERROR_STOP on\n','')
  self.env.update(PGHOST=str(self.socket),PGHOSTADDR='',PGPORT=self.port,PGUSER='postgres',PGDATABASE=database)
  return self.run(label,[node,R/'scripts/ci/probes/chip-journal-atomicity/postgres-runtime/registration-query.mjs'],text=json.dumps(source)+'\n',seconds=seconds,check=check)

E=MidwayExecution(
 R,O,Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin')),
 Path(os.environ.get('TMPDIR',tempfile.gettempdir())),600,
 socket_parent=Path(os.environ.get('CA_PG_SOCKET_ROOT',os.environ.get('TMPDIR',tempfile.gettempdir()))))
try:
 E.report['source_sha256']={str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),M,*F.iterdir()] if p.is_file()}
 E.start();d=E.database();install_financial_foundation(E,d,R,O)
 E.sql(d,'ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS payout_depth_percent numeric;',label='current-payout-column')
 sql='SET check_function_bodies=off;'+''.join(json.loads((F/'conversion-preimages.json').read_text()).values())
 E.sql(d,sql,label='inspected-current-preimages')
 E.sql(d,'CREATE TABLE public.tournament_schedules(id uuid,club_id uuid,config jsonb);',label='schedule-column-shapes')
 E.sql(d,"INSERT INTO ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES('union_wallet','counted','union_wallets','the union rake, bbj, promo, insurance and spin reserve wallets') ON CONFLICT DO NOTHING;",label='captured-promo-store-seed')
 E.sql(d,file=F/'full-opening.sql',label='synthetic-opening')
 # Install the actual production money-writer event guard before candidate DDL.
 # The retained financial catalog previously omitted event triggers entirely.
 guard=(R/'supabase/migrations/20260911160817_a_money_writing_function_is_registered_before_it_exists.sql').read_text()
 parts=[]
 for name in ['fn_ca_money_rpc_balance_columns','fn_ca_money_rpc_writes_balances','fn_ca_money_rpc_registry_guard']:
  match=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\(.*?AS (\$[a-z_]*\$).*?\1;',guard,re.S)
  assert match, name
  parts.append(match.group(0))
 E.sql(d,'\n'.join(parts)+'''
DROP EVENT TRIGGER IF EXISTS ab_ca_money_rpc_registered;
CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
EXECUTE FUNCTION public.fn_ca_money_rpc_registry_guard();''',label='production-money-writer-ddl-guard')
 # The old candidate must fail at the actual guard, with the whole install rolled back.
 old=M.read_text()
 old=re.sub(r'INSERT INTO public.ca_money_rpc_registry\(proname,status,notes\) VALUES.*?ON CONFLICT\(proname\) DO NOTHING;','',old,count=1,flags=re.S)
 failed=E.sql(d,old,label='unregistered-writer-refused',seconds=60,check=False)
 assert failed[0]!=0
 assert 'fn_ca_midway_free_buy_promo_head writes balance columns' in (failed[1]+failed[2])
 began=time.monotonic();E.sql(d,file=M,label='exact-candidate-install',seconds=60)
 E.report['install_seconds']=time.monotonic()-began
 fixes=list((R/'supabase/migrations').glob('*_spin_launch_trigger_predicate_runtime_permissions.sql'))
 assert len(fixes)==1,fixes
 E.sql(d,file=fixes[0],label='exact-runtime-boundary-install',seconds=60)
 assert E.report['install_seconds']<8
 E.sql(d,"""DO $$BEGIN
 IF has_function_privilege('anon','fn_ca_tournament_escrow_chips(uuid)','EXECUTE')
 OR has_function_privilege('service_role','fn_ca_tournament_charge_split(uuid,text,numeric)','EXECUTE')
 OR NOT has_function_privilege('service_role','fn_ca_tournament_escrow_chips(uuid)','EXECUTE') THEN
 RAISE EXCEPTION 'Original execution permissions changed'; END IF;
 IF (SELECT promo_wallet FROM union_wallets WHERE union_id='fade0000-0000-0000-0000-000000000001')<>588
 OR (SELECT bounty_balance FROM tournament_escrow WHERE tournament_id='10000000-0000-0000-0000-000000000001')<>412
 OR (SELECT sum(current_bounty) FROM tournament_players WHERE tournament_id='10000000-0000-0000-0000-000000000001')<>412 THEN
 RAISE EXCEPTION 'Full conversion custody disagrees'; END IF; END $$;""",label='converted-custody')
 before=E.snapshot(d,label='before-cancellation')
 E.sql(d,"""BEGIN;
 SET LOCAL request.jwt.claims='{"role":"service_role"}';
 DO $$DECLARE result jsonb; again jsonb; BEGIN
 result:=atomic_cancel_tournament('10000000-0000-0000-0000-000000000001',NULL);
 again:=atomic_cancel_tournament('10000000-0000-0000-0000-000000000001',NULL);
 IF result->>'fully_settled'<>'true' OR result->>'total_refunded'<>'0' OR result IS DISTINCT FROM again
 OR (SELECT promo_wallet FROM union_wallets WHERE union_id='fade0000-0000-0000-0000-000000000001')<>1000
 OR (SELECT bounty_balance FROM tournament_escrow WHERE tournament_id='10000000-0000-0000-0000-000000000001')<>0
 OR (SELECT count(*) FROM chip_ledger WHERE tournament_id='10000000-0000-0000-0000-000000000001' AND metadata->>'kind'='midway_free_buy_promo_head')<>824 THEN
 RAISE EXCEPTION 'Cancellation did not return exactly the sponsored chips'; END IF;
 END $$;
 SET CONSTRAINTS ALL IMMEDIATE;
 ROLLBACK;""",label='actual-promo-cancellation')
 assert E.snapshot(d,label='after-cancellation')==before
 E.report['passed']=True
 E.report['cases']=['exact migration installs','412 funded conversions','actual cancellation returns only sponsor funds','same receipt replay','full rollback']
finally:
 E.close();(O/'report.json').write_text(json.dumps(E.report,indent=2)+'\n')
print('Midway full native evidence: '+str(O/'report.json'))

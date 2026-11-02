"""Exact settlement refusal routing; never qualifies a financial transfer."""
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
from satellite_qualifier_fixture import module
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser()
for key in ('pg-bin','evidence','work-root','socket-root'):p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args()
for x in (a.evidence,a.work_root,a.socket_root):x.mkdir(parents=True,exist_ok=True)
n=module(ROOT/'scripts/ci/test-mtt-unlimited.py','owner_deletion_pg')
e=n.Execution(ROOT,a.evidence,a.pg_bin,a.work_root,120,socket_parent=a.socket_root)
source=ROOT/'scripts/ci/fixtures/tournament-abort/equal-share-before-owner-deletion.sql'
migration=ROOT/'supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql'
try:
 e.start();db=e.database()
 e.sql(db,"""
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA auth;CREATE SCHEMA smarter_private;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT ''service_role''::text';
CREATE FUNCTION fn_platform_frozen() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE TABLE tournaments(id uuid PRIMARY KEY,started_at timestamptz,status text,total_rake numeric);
CREATE TABLE smarter_private.tournament_abort_targets(operation_id uuid,tournament_id uuid,state text,receipt jsonb,quiescence jsonb,money_snapshot jsonb,asset text);
CREATE FUNCTION smarter_private.cancellation_lane(uuid) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION smarter_private.assert_tournament_abort_not_recovered(uuid,uuid) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION smarter_private.assert_tournament_abort_quiesced(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'NATIVE_NEXT_FINANCIAL_GATE'; END$$;
CREATE FUNCTION fn_ca_tournament_cancellation_receipt(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"existing_receipt":true}'::jsonb$$;
""",label='controlled-routing-only-dependencies')
 e.sql(db,source.read_text(),label='exact-production-settlement-before-change')
 target='2781bcd7-cc8a-4713-ab3e-0d0a81fdf110';other='ffffffff-ffff-4fff-8fff-ffffffffffff';op='10000000-0000-4000-8000-000000000001'
 for tid in (target,other):
  e.sql(db,f"INSERT INTO tournaments VALUES('{tid}','2026-10-29T20:45Z','RUNNING',0); INSERT INTO smarter_private.tournament_abort_targets VALUES('{op}','{tid}','stop_requested',NULL,NULL,NULL,'chips');",label='synthetic-routing-row')
 def refused(tid,expected):
  code,_,err=e.sql(db,f"SELECT fn_ca_settle_tournament_abort_equal_share('{op}','{tid}','native');",label=expected,check=False)
  if not code or expected not in err:raise RuntimeError('wrong refusal: '+err)
 refused(target,'NATIVE_NEXT_FINANCIAL_GATE')
 e.sql(db,migration.read_text(),label='exact-owner-instruction-install')
 refused(target,'owner_deletion_supersedes_equal_share')
 refused(other,'NATIVE_NEXT_FINANCIAL_GATE')
 e.sql(db,f"UPDATE smarter_private.tournament_abort_targets SET state='settled',receipt='{{\"mode\":\"started_operator_equal_share\"}}' WHERE tournament_id='{target}';",label='prior-committed-receipt-scene')
 if 'existing_receipt' not in e.sql(db,f"SELECT fn_ca_settle_tournament_abort_equal_share('{op}','{target}','native');",label='prior-committed-receipt-preserved')[1]:raise RuntimeError('existing receipt lost')
 e.sql(db,"""DO $$ BEGIN
 IF (SELECT count(*) FROM smarter_private.owner_tournament_deletion_intents)<>140 THEN RAISE EXCEPTION 'scope changed';END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.owner_tournament_deletion_intents WHERE original_started_at>='2026-11-02T06:00Z') THEN RAISE EXCEPTION 'today included';END IF;
 IF has_table_privilege('service_role','smarter_private.owner_tournament_deletion_intents','UPDATE') OR has_table_privilege('authenticated','smarter_private.owner_tournament_deletion_intents','SELECT') THEN RAISE EXCEPTION 'intent authority exposed';END IF;
 END $$;""",label='scope-and-authority')
 e.report.update(status='passed',scope=__doc__,source_sha256={str(x.relative_to(ROOT)):n.sha(x) for x in (source,migration,Path(__file__))})
except BaseException as err:e.report['failure']=repr(err)
finally:
 e.close();(a.evidence/'result.json').write_text(json.dumps(e.report,indent=2));print(json.dumps({k:e.report.get(k) for k in ('status','failure','cleanup')}))
sys.exit(0 if e.report['status']=='passed' else 1)

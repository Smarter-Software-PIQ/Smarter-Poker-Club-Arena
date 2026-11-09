#!/usr/bin/env python3
"""Original paid-book coordinator batches only its canonical linked proof budget."""
from pathlib import Path
import json
import os
import socket
import subprocess
import argparse
import tempfile
import shutil

parser=argparse.ArgumentParser();parser.add_argument('--pg-bin',type=Path,required=True);parser.add_argument('--scratch',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
repo=Path(__file__).resolve().parents[5];fixture=Path(__file__).parent
scratch=Path(tempfile.mkdtemp(prefix='linked-batch-',dir=args.scratch));pg=args.pg_bin
owners=json.loads((fixture/'actual-owners.json').read_text());cases_report=[]
environment={k:v for k,v in os.environ.items()if not k.startswith('PG')};environment['TMPDIR']=str(scratch);environment.pop('DATABASE_URL',None)
with socket.socket() as listener:
 listener.bind(('127.0.0.1',0));port=str(listener.getsockname()[1])
data=scratch/'data'

def command(arguments):
    return subprocess.run([str(v) for v in arguments], env=environment, text=True,
                          capture_output=True, check=True)

def query(source):
    result = subprocess.run(
        [str(pg / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
         '-p', port, '-U', 'postgres'],
        input="SET check_function_bodies=off;" + source,
        env=environment, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def controlled(source):
    return source.replace('clock_timestamp()', 'public.fixture_clock()').replace(
        'statement_timestamp()', 'public.fixture_statement_clock()').replace(
        'now()', 'public.fixture_clock()')

started = False
try:
    command([pg / 'initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'])
    command([pg / 'pg_ctl', '-D', data, '-l', scratch / 'probe.log', '-w', 'start',
             '-o', f"-k '' -h 127.0.0.1 -p {port} -c fsync=off -c full_page_writes=off"])
    started = True
    assert '17.' in command([pg/'postgres','--version']).stdout
    for name in ['fees-before-club-books/bootstrap.sql', 'weekly-fee-preparation/bootstrap.sql']:
        query((repo / 'scripts/ci/fixtures' / name).read_text())
    for item in json.loads((repo / 'scripts/ci/fixtures/weekly-fee-preparation/original-helpers.json').read_text()):
        query(controlled(item['definition']))
    for item in json.loads((repo / 'scripts/ci/fixtures/weekly-fee-preparation/original-owners.json').read_text()):
        if item['signature'].split('(')[0] in ['fn_weekly_accounting_attempt_begin', 'fn_accounting_close_windows']:
            query(controlled(item['definition']))
    query("""
CREATE OR REPLACE FUNCTION fixture_statement_clock() RETURNS timestamptz LANGUAGE sql AS
$$ SELECT '2026-10-26 09:00Z'::timestamptz $$;
CREATE OR REPLACE FUNCTION fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)
RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_build_object('success',true,'paid_scope_replay',true) $$;
DROP FUNCTION fn_accounting_close_report_keep(uuid,timestamptz,timestamptz);
CREATE FUNCTION fn_accounting_close_report_keep(uuid,timestamptz,timestamptz)
RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION fn_accounting_close_report_memo_key(uuid,timestamptz,timestamptz,OUT generation text,OUT memo_key text)
LANGUAGE sql AS $$ SELECT 'same-proof-generation'::text,'same-book-key'::text $$;
CREATE SEQUENCE batch_calls;
CREATE OR REPLACE FUNCTION fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)
RETURNS boolean LANGUAGE plpgsql AS
$$ DECLARE n bigint; BEGIN
 n:=nextval('batch_calls');

 IF current_setting('test.reader_refused',true)='on' AND n>1 THEN
  RAISE EXCEPTION 'canonical_reader_refused';
 END IF;
 IF current_setting('test.complete',true)='on' AND n>1 THEN RETURN true; END IF;
 IF current_setting('test.no_progress',true)='on' AND n>1 THEN RETURN false; END IF;
 PERFORM set_config('test.now',(fixture_clock()+COALESCE(CASE WHEN n>1 THEN NULLIF(current_setting('test.later_step_cost',true),'') END,NULLIF(current_setting('test.step_cost',true),''),'10 seconds')::interval)::text,true);
 INSERT INTO accounting_close_partials(kind,union_id,period_start,period_end,window_start,window_end,value,computed_at)
 VALUES(COALESCE(NULLIF(current_setting('test.proof_kind',true),''),'pnl_linked_window'),$1,$2,$3,$2+n*interval '2 hours',$2+(n+1)*interval '2 hours',
        jsonb_build_object('same_reader',true),fixture_clock());
 RETURN false;
END $$;
CREATE OR REPLACE FUNCTION fn_union_pnl_close_quality(uuid,timestamptz,timestamptz)
RETURNS jsonb LANGUAGE plpgsql AS
$$ BEGIN
 PERFORM fn_accounting_union_earned_plan_advance($1,$2,$3);
 RETURN '{"status":"blocked","issues":["union_pnl_certification_in_progress"]}'::jsonb;
END $$;
CREATE OR REPLACE FUNCTION fn_assert_cash_commission_period(uuid,uuid,timestamptz,timestamptz)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unexpected money boundary'; END $$;
ALTER TABLE accounting_routed_settlement_runs ADD COLUMN completed_at timestamptz;
""")

    # Preserve the actual canonical reader's bytes through the actual installer.
    # Only its execution/cost is controlled in the budget cases below.
    adapter=query("SELECT pg_get_functiondef('fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure)")
    canonical=json.loads((fixture/'canonical-advance.json').read_text())
    query(canonical['body'])
    query(owners['coordinator']);query(owners['eligibility'])
    query("REVOKE ALL ON FUNCTION public.fn_process_weekly_accounting_scope(uuid,uuid),smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)FROM PUBLIC;REVOKE ALL ON FUNCTION public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)TO service_role;")
    # Unchanged source65 / inventory proof prerequisite is an explicit isolated
    # boundary. Its actual production result is read independently before install.
    query("CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT true$$;CREATE OR REPLACE FUNCTION smarter_private.original_inventory_basis_generation()RETURNS text LANGUAGE sql AS $$SELECT 'unchanged-native-proof-generation'::text$$;")
    metadata_sql="SELECT jsonb_object_agg(p.oid::regprocedure::text,to_jsonb(p)-'prosrc')FROM pg_proc p WHERE p.oid IN('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure,'smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure,'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure)"
    metadata=query(metadata_sql)
    migration=repo/'supabase/migrations/20261109152937_batch_linked_proof_in_its_original_paid_book_budget.sql'
    js="import{stalePinGuardSQL}from './scripts/ci/migration-stale-pins.mjs';import{readFileSync}from'node:fs';let p=process.argv[1],s=readFileSync(p,'utf8');process.stdout.write(stalePinGuardSQL(p,s,s));"
    guarded=command(['node','--input-type=module','-e',js,migration]).stdout
    query("CREATE FUNCTION fixture_stale_pin()RETURNS text LANGUAGE sql AS $$SELECT '"+owners['before_md5']+"'::text$$;")
    try:query(guarded);raise AssertionError('stale pin was accepted')
    except RuntimeError as error:assert 'migration_left_a_stale_pin' in str(error),str(error)
    assert query("SELECT md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))")==owners['before_md5']
    assert query("SELECT md5(pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure))")==owners['eligibility_before_md5']
    query('DROP FUNCTION fixture_stale_pin();');query(guarded)
    assert query(metadata_sql)==metadata,'metadata changed'
    assert query("SELECT md5(pg_get_functiondef('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure))")==canonical['hash'],'canonical reader changed'
    assert query("SELECT md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))")==owners['after_md5']
    assert query("SELECT md5(pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure))")==owners['eligibility_after_md5']
    installed_coordinator=query("SELECT pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure)")
    try:query(guarded);raise AssertionError('replay accepted')
    except RuntimeError as error:assert 'PAID_BOOK_BATCH_PREIMAGE_CHANGED' in str(error),str(error)
    adapter=adapter.replace(adapter.splitlines()[0],canonical['body'].splitlines()[0])
    query(adapter)

    def reset():
        query('TRUNCATE union_accounting_runs,accounting_close_partials,phase_trace;'
              'ALTER SEQUENCE batch_calls RESTART WITH 1;'
              "SELECT setval('fixture_financial_calls',0,false);")

    def exercise(source_name, extra='', expected=1, failed=False):
        source = owners['coordinator'] if source_name=='scope.sql' else installed_coordinator
        query(controlled(source))
        reset()
        result = query(
            "SET test.now='2026-10-26 09:00Z';"
            "SET app.weekly_accounting_chunked='on';"
            "SET app.weekly_accounting_scope_budget='3 minutes';"
            "SET statement_timeout='240s';" + extra +
            "SELECT fn_process_weekly_accounting_scope(u(),NULL);")
        response = json.loads(result)
        rows = int(query('SELECT count(*) FROM accounting_close_partials;'))
        assert rows == expected, (source_name, extra, response, rows)
        assert response['failed'] == int(failed), response
        assert query('SELECT is_called FROM fixture_financial_calls;') == 'f'
        cases_report.append({'case':case_name,'proof_rows':rows,'expected_failed':failed,'passed':True,'response':response})
        return response, rows

    cases = [
        ('before', 'scope.sql', '', 1, False),
        ('fast bounded batch', 'scope-candidate.sql', '', 11, False),
        ('slower observed steps', 'scope-candidate.sql', "SET test.step_cost='40 seconds';", 2, False),
        ('later step slows admission', 'scope-candidate.sql', "SET test.later_step_cost='40 seconds';", 3, False),
        ('statement reserve', 'scope-candidate.sql', "SET statement_timeout='100s';", 1, False),
        ('shorter scope reserve', 'scope-candidate.sql', "SET app.weekly_accounting_scope_budget='1 minute';", 1, False),
        ('no timeout still scope bounded', 'scope-candidate.sql', "SET statement_timeout='0';", 11, False),
        ('no progress stops', 'scope-candidate.sql', "SET test.no_progress='on';", 1, False),
        ('canonical completion stops', 'scope-candidate.sql', "SET test.complete='on';", 1, False),
        ('reader refusal rolls back', 'scope-candidate.sql', "SET test.reader_refused='on';", 0, True),
        ('other phase preserved', 'scope-candidate.sql', "SET test.proof_kind='pnl_flows_window';", 1, False),
    ]
    for name, source, settings, expected, failed in cases:
        case_name=name
        exercise(source, settings, expected, failed)
        print('PASS', name)

    args.output.write_text(json.dumps({'passed':True,'cases':cases_report,'exact_install_stale_pin_rollback_metadata_replay':True,'canonical_reader_unchanged':canonical['hash'],'limits':'Actual complete coordinator with controlled clock/canonical-step cost and existing paid/preparation boundary adapters; no production or underlying canonical-proof capacity claim.'},indent=2)+'\n')
finally:
    if started:
        command([pg / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])

    shutil.rmtree(scratch)

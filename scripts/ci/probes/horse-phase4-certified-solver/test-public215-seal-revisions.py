#!/usr/bin/env python3
"""Actual revision/append source chunk under isolated native PG17 concurrent sessions."""
import json
import time
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
ROOT=Path(__file__).resolve().parents[4]
MIGRATION=ROOT/'supabase/migrations/20261031231748_public215_sealing_uses_bounded_input_bound_preparation.sql'
def candidate_function(source,name):
    starts=list(re.finditer(r'^CREATE(?: OR REPLACE)? FUNCTION public\.'+re.escape(name)+r'\s*\(',source,re.I|re.M))
    assert len(starts)==1,'Exactly one actual candidate definition required: '+name
    tail=source[starts[0].start():]
    delimiter=re.search(r'\bAS\s+(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)',tail,re.I)
    assert delimiter,'Dollar-quoted actual candidate body required: '+name
    end=tail.find(delimiter.group(1),delimiter.end())
    assert end>=0,'Unterminated candidate definition: '+name
    return tail[:end+len(delimiter.group(1))]+';'
def candidate_revoke(source,name):
    statements=re.findall(r'^REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.'+re.escape(name)+r'\([^;]+?\)\s+FROM\s+[^;]+;',source,re.I|re.M)
    assert len(statements)==1,'Exactly one narrow actual candidate helper ACL required: '+name
    return statements[0]

PG = Path(os.environ.get('PG17_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
clean = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
base = os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')
if platform.system() == 'Darwin':
    assert base and Path(base).resolve().is_relative_to('/Volumes/SmarterWork/agent-work')
    socket_base = '/Volumes/SmarterWork/agent-work/shared-capacity'
else:
    base = base or tempfile.gettempdir()
    socket_base = base

def command(args):
    result = subprocess.run(args, env=clean, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return result.stdout

with tempfile.TemporaryDirectory(prefix='seal-once-draft-', dir=base) as folder, tempfile.TemporaryDirectory(prefix='revision215-', dir=socket_base) as socket:
    task = Path(folder)
    data = task/'data'
    env = {**clean,'PGHOST':socket,'PGPORT':'55480','PGDATABASE':'postgres','PGUSER':'fixture_owner',
           'PGPASSFILE':str(task/'absent'), 'PGSERVICEFILE':str(task/'absent-service')}
    command([str(PG/'initdb'),'-D',str(data),'-U','fixture_owner','-A','trust','--no-locale','--encoding=UTF8'])
    command([str(PG/'pg_ctl'),'-D',str(data),'-l',str(task/'postgres.log'),'-o',f"-F -k {socket} -p 55480 -c listen_addresses=''",'-w','start'])
    try:
        def sql(text, role='fixture_owner', error=None):
            result = subprocess.run([str(PG/'psql'),'-XAt','-v','ON_ERROR_STOP=1'], input=text,
                env={**env,'PGUSER':role,'PGOPTIONS':'-c statement_timeout=10000 -c fixture.jwt_role='+role},
                text=True,capture_output=True,timeout=120)
            if error:
                assert result.returncode and error in result.stderr, result.stderr
            else:
                assert result.returncode == 0, result.stderr
            return result.stdout.strip()


        import hashlib
        candidate=MIGRATION.read_text()
        begin='-- BEGIN PUBLIC215 SEAL REVISION INPUT OWNERS'
        end='-- END PUBLIC215 SEAL REVISION INPUT OWNERS'
        assert candidate.count(begin)==1 and candidate.count(end)==1,'Exact revision owner section markers required'
        chunk=candidate.split(begin,1)[1].split(end,1)[0]
        guard=candidate_function(candidate,'fn_gto_v31_seal_preparation_guards')
        epoch_names=['solved_spots_gold','gto_v31_input_bundles','gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts','gto_v31_public_source_journal','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_selections','gto_v31_public_physics','gto_v31_public_model_compiled','gto_v31_public_model_audits','gto_v31_public_model_audit_combos']
        sql('''CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;
CREATE TABLE public.solved_spots_gold(id uuid PRIMARY KEY,payload text);
CREATE TABLE public.gto_v31_input_bundles(input_bundle_id uuid PRIMARY KEY,payload text);
CREATE TABLE public.gto_v31_datasets(dataset_id uuid PRIMARY KEY);
CREATE TABLE public.gto_v31_public_model_audits(audit_key text PRIMARY KEY);
CREATE TABLE public.gto_v31_public_model_audit_combos(audit_key text REFERENCES public.gto_v31_public_model_audits(audit_key)DEFERRABLE INITIALLY DEFERRED,combo integer,PRIMARY KEY(audit_key,combo));
''')
        for name in epoch_names:
            if name in ['solved_spots_gold','gto_v31_input_bundles','gto_v31_public_model_audits','gto_v31_public_model_audit_combos']:continue
            fk='REFERENCES public.gto_v31_datasets(dataset_id)'if name in ['gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts']else''
            sql('CREATE TABLE public.'+name+'(dataset_id uuid '+fk+',payload text)')
        # Pre-existing owners are deliberately not backfilled by new triggers.
        for table,key in [('solved_spots_gold','id'),('gto_v31_input_bundles','input_bundle_id')]:
            sql('INSERT INTO '+table+' SELECT (\'11111111-1111-4111-8111-\'||lpad(i::text,12,\'0\'))::uuid,\'preexisting\'FROM generate_series(1,5)i')
        original=(ROOT/'supabase/migrations/20261029070812_public_hist215_models_bind_independent_exact_public_state.sql').read_text()
        start=original.index('CREATE FUNCTION public.fn_gto_v31_public215_immutable_physics()');tail=original[start:];end=tail.index('$fn$;',tail.index('AS $fn$'))+6;sql(tail[:end])
        sql('BEGIN;'+chunk+'COMMIT;');sql(guard)
        assert sql("SELECT count(*)FROM gto_v31_seal_input_revisions WHERE input_kind<>'epoch'")=='0'
        assert sql("SELECT count(*)FROM gto_v31_seal_input_revisions WHERE input_kind='epoch'")=='13'
        tracked={}
        for table,key,kind in [('solved_spots_gold','id','gold'),('gto_v31_input_bundles','input_bundle_id','bundle')]:
            old='22222222-2222-4222-8222-222222222221';new='22222222-2222-4222-8222-222222222222'
            def revision(identity):return sql("SELECT revision||':'||present FROM gto_v31_seal_input_revisions WHERE input_kind='"+kind+"'AND input_id='"+identity+"'")
            sql("INSERT INTO "+table+" VALUES('"+old+"','new')");assert revision(old)=='1:true'
            sql("UPDATE "+table+" SET payload='updated'WHERE "+key+"='"+old+"'");assert revision(old)=='2:true'
            sql("UPDATE "+table+" SET "+key+"='"+new+"'WHERE "+key+"='"+old+"'");assert revision(old)=='3:false'and revision(new)=='1:true'
            sql("DELETE FROM "+table+" WHERE "+key+"='"+new+"'");assert revision(new)=='2:false'
            sql("INSERT INTO "+table+" VALUES('"+new+"','reinsert')");assert revision(new)=='3:true'
            assert sql("SELECT count(*)FROM gto_v31_seal_input_revisions WHERE input_kind='"+kind+"'")=='2'
            tracked[kind]=True
        # Every relevant TRUNCATE changes the epoch, with no full-owner scan.
        for name in epoch_names:
            suffix=' CASCADE' if name in ['gto_v31_public_model_audits']else''
            before=int(sql("SELECT revision FROM gto_v31_seal_input_revisions WHERE input_kind='epoch'AND input_id='"+name+"'"))
            sql('TRUNCATE '+name+suffix)
            after=int(sql("SELECT revision FROM gto_v31_seal_input_revisions WHERE input_kind='epoch'AND input_id='"+name+"'"));assert after==before+1,(name,before,after)
        sql('TRUNCATE gto_v31_seal_input_revisions',error='immutable')
        args=[str(PG/'psql'),'-qXAt','-v','ON_ERROR_STOP=1']
        def session():return subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**env,'PGOPTIONS':'-c statement_timeout=10000'})
        def line(p,s):p.stdin.write(s+'\n');p.stdin.flush();return p.stdout.readline().strip()
        def finish(p):p.stdin.close();p.wait(timeout=10);assert p.returncode==0,p.stderr.read()
        gold='44444444-4444-4444-8444-444444444444'
        sql("INSERT INTO solved_spots_gold VALUES('"+gold+"','owner')")
        reader=session();assert line(reader,'BEGIN;SELECT pg_backend_pid();').isdigit()
        assert line(reader,"SELECT id FROM solved_spots_gold WHERE id='"+gold+"'FOR SHARE;")==gold
        captured=line(reader,"SELECT revision FROM gto_v31_seal_input_revisions WHERE input_kind='gold'AND input_id='"+gold+"';")
        sql("SET lock_timeout='150ms';UPDATE solved_spots_gold SET payload='writer'WHERE id='"+gold+"'",error='lock timeout')
        assert line(reader,"SELECT revision FROM gto_v31_seal_input_revisions WHERE input_kind='gold'AND input_id='"+gold+"';")==captured
        line(reader,'COMMIT;SELECT 1;');finish(reader)
        sql("UPDATE solved_spots_gold SET payload='writer'WHERE id='"+gold+"'")
        assert int(sql("SELECT revision FROM gto_v31_seal_input_revisions WHERE input_kind='gold'AND input_id='"+gold+"'"))==int(captured)+1
        # RR snapshot before another transaction creates a revision row cannot
        # silently upsert/ignore the unseen conflict: PostgreSQL must raise40001.
        rr=session();assert line(rr,'BEGIN ISOLATION LEVEL REPEATABLE READ;SELECT count(*)FROM gto_v31_seal_input_revisions;').isdigit()
        future='55555555-5555-4555-8555-555555555555'
        sql("INSERT INTO solved_spots_gold VALUES('"+future+"','future')")
        rr.stdin.write("SELECT public.fn_gto_v31_seal_preparation_guards();\n");rr.stdin.close();rr.wait(timeout=10);assert rr.returncode!=0 and 'requires read committed'in rr.stderr.read()
        rr_writer=session();assert line(rr_writer,'BEGIN ISOLATION LEVEL REPEATABLE READ;SELECT count(*)FROM solved_spots_gold;').isdigit()
        sql("UPDATE solved_spots_gold SET payload='committed-after-snapshot'WHERE id='"+gold+"'")
        rr_writer.stdin.write("\\set VERBOSITY verbose\nUPDATE solved_spots_gold SET payload='stale-writer'WHERE id='"+gold+"';\n");rr_writer.stdin.close();rr_writer.wait(timeout=10);assert rr_writer.returncode!=0 and '40001'in rr_writer.stderr.read()
        # Actual existing FK and explicit trigger guard both obey parent lock.
        ds='66666666-6666-4666-8666-666666666666';sql("INSERT INTO gto_v31_datasets VALUES('"+ds+"')")
        owner=session();assert line(owner,"BEGIN;SELECT dataset_id FROM gto_v31_datasets WHERE dataset_id='"+ds+"'FOR UPDATE;")==ds
        for table in ['gto_v31_source_artifacts','gto_v31_public_source_journal']:
            sql("SET lock_timeout='150ms';INSERT INTO "+table+" VALUES('"+ds+"','source')",error='lock timeout')
        line(owner,'COMMIT;SELECT 1;');finish(owner)
        # Original audit generator owns this same lock and appends its complete
        # combos BEFORE header; the guard must remain reentrant.
        sql("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('v31-public-audit:ordinary',0));INSERT INTO gto_v31_public_model_audit_combos VALUES('ordinary',0);INSERT INTO gto_v31_public_model_audits VALUES('ordinary');COMMIT;")
        sql("INSERT INTO gto_v31_public_model_audit_combos VALUES('ordinary',1)",error='cannot be appended')
        sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO gto_v31_public_model_audit_combos VALUES('rr-refused',0)",error='requires read committed')
        # A pending producer header must serialize a late append, then reject
        # it after that original producer commits. Requires the actual same-key
        # advisory guard, not an invented fixture replacement.
        assert "pg_advisory_xact_lock(hashtextextended('v31-public-audit:'||NEW.audit_key,0))"in chunk
        producer=session();assert line(producer,"BEGIN;SELECT pg_backend_pid();").isdigit()
        assert line(producer,"SELECT pg_advisory_xact_lock(hashtextextended('v31-public-audit:late',0));SELECT 1;")==''
        assert producer.stdout.readline().strip()=='1'
        assert line(producer,"INSERT INTO gto_v31_public_model_audit_combos VALUES('late',0);INSERT INTO gto_v31_public_model_audits VALUES('late');SELECT 1;")=='1'
        sql("SET lock_timeout='150ms';INSERT INTO gto_v31_public_model_audit_combos VALUES('late',1)",error='lock timeout')
        line(producer,'COMMIT;SELECT 1;');finish(producer)
        sql("INSERT INTO gto_v31_public_model_audit_combos VALUES('late',1)",error='cannot be appended')
        print(json.dumps({'native_exit':0,'chunk_sha256':hashlib.sha256(chunk.encode()).hexdigest(),'gold_bundle_all_dml_idchange_delete_reinsert':tracked,'no_owner_backfill':True,'all13_truncate_epochs':True,'revision_truncate_refused':True,'read_committed_share_blocks_writer_and_revision_captured':True,'repeatable_read_unseen_revision_actual_guard_refused':True,'repeatable_read_stale_gold_writer_40001':True,'actual_guard_sha256':hashlib.sha256(guard.encode()).hexdigest(),'fk_and_explicit_parent_insert_block':True,'original_audit_order_reentrant':True,'late_append_wait_then_refuse':True,'audit_repeatable_read_refused':True}))
    finally:
        command([str(PG/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'])

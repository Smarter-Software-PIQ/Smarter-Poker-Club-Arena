#!/usr/bin/env python3
"""Actual five-CTE metric algebra vs exact per-cell raw combination, native PG17."""
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

with tempfile.TemporaryDirectory(prefix='seal-once-draft-', dir=base) as folder, tempfile.TemporaryDirectory(prefix='metric215-', dir=socket_base) as socket:
    task = Path(folder)
    data = task/'data'
    env = {**clean,'PGHOST':socket,'PGPORT':'55479','PGDATABASE':'postgres','PGUSER':'fixture_owner',
           'PGPASSFILE':str(task/'absent'), 'PGSERVICEFILE':str(task/'absent-service')}
    command([str(PG/'initdb'),'-D',str(data),'-U','fixture_owner','-A','trust','--no-locale','--encoding=UTF8'])
    command([str(PG/'pg_ctl'),'-D',str(data),'-l',str(task/'postgres.log'),'-o',f"-F -k {socket} -p 55479 -c listen_addresses=''",'-w','start'])
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
        baseline=(HERE/'public215-heldout-metrics-baseline.sql').read_text()
        assert hashlib.sha256(baseline.encode()).hexdigest()=='d8e00bbf31ae8a6333592f0265bbd601e3551a7f44ab6c21d24b89e04d52596e'
        candidate=MIGRATION.read_text()
        raw=candidate_function(candidate,'fn_gto_v31_public215_cell_metric_raw')+'\n'+candidate_revoke(candidate,'fn_gto_v31_public215_cell_metric_raw')
        merge=candidate_function(candidate,'fn_gto_v31_public215_metrics_from_raw')+'\n'+candidate_revoke(candidate,'fn_gto_v31_public215_metrics_from_raw')
        old_ctes=baseline[baseline.index('  WITH scored_nodes AS MATERIALIZED'):baseline.index('  SELECT jsonb_build_object(')]
        new_ctes=raw[raw.index('  WITH scored_nodes AS MATERIALIZED'):raw.index('  SELECT jsonb_build_object(')]
        assert new_ctes.replace('AND c.cell_id=p_cell_id','AND (p_game_family IS NULL OR c.game_family=p_game_family)')==old_ctes
        sql('''CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE public.gto_v31_datasets(dataset_id uuid PRIMARY KEY,policy_export_schema text,icm_model_checksum text);
CREATE TABLE public.gto_v31_runtime_cells(cell_id uuid PRIMARY KEY,dataset_id uuid,game_family text,action_specs jsonb,public_model jsonb,policy_representation text);
CREATE TABLE public.gto_v31_cell_source_receipts(dataset_id uuid,cell_id uuid,source_row_id uuid,source_node text,split text,source_node_checksum text);
CREATE TABLE public.solved_spots_gold(id uuid PRIMARY KEY,strategy_matrix_v2 jsonb);
CREATE TABLE public.gto_v31_public_model_audit_combos(audit_key text,combo integer,frequencies numeric[],policy_ev numeric);
-- Controlled unrelated boundaries: this fixture tests metric algebra, not scientific validation.
CREATE FUNCTION public.fn_gto_v31_assert_source_contract(jsonb,text,text)RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
CREATE FUNCTION public.fn_gto_v31_public215_required_audit(public.gto_v31_runtime_cells,text)RETURNS text LANGUAGE sql STABLE AS $$SELECT $1.cell_id::text||':'||$2$$;
CREATE FUNCTION public.fixture_node(tag text,w0 numeric,w1 numeric)RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('node',tag,'node_checksum',tag,'node_context',jsonb_build_object('board',tag),
 'matchups',(SELECT jsonb_agg(CASE i WHEN 0 THEN w0 WHEN 1 THEN w1 ELSE 0 END ORDER BY i) FROM generate_series(0,1325)i),
 'frequencies',jsonb_build_object('a',(SELECT jsonb_agg(0.123456789012345678901234567890::numeric ORDER BY i)FROM generate_series(0,1325)i),'b',(SELECT jsonb_agg(0.876543210987654321098765432110::numeric ORDER BY i)FROM generate_series(0,1325)i)),
 'policy_evs_bb',(SELECT jsonb_agg(0.333333333333333333333333333333::numeric ORDER BY i)FROM generate_series(0,1325)i),
 'action_evs_bb',jsonb_build_object('a',(SELECT jsonb_agg(-0.234567890123456789012345678901::numeric ORDER BY i)FROM generate_series(0,1325)i),'b',(SELECT jsonb_agg(0.987654321098765432109876543210::numeric ORDER BY i)FROM generate_series(0,1325)i)))$$;
INSERT INTO gto_v31_datasets VALUES('11111111-1111-4111-8111-111111111111','fixture','fixture');
INSERT INTO gto_v31_runtime_cells SELECT ('22222222-2222-4222-8222-22222222222'||i)::uuid,'11111111-1111-4111-8111-111111111111',(ARRAY['cash','spin','tourney_ev','tourney_icm','cash'])[i+1],
 jsonb_build_object('a',jsonb_build_object('family','check','size_value',NULL),'b',jsonb_build_object('family',CASE WHEN i=1 THEN 'call' ELSE 'bet' END,'size_value',CASE WHEN i=1 THEN NULL ELSE 0.712345678901234567890123456789::numeric END)),
 '{"action_ids":["b","a"]}'::jsonb,'public_hist215_v1'FROM generate_series(0,4)i;
INSERT INTO solved_spots_gold VALUES
 ('33333333-3333-4333-8333-333333333330',jsonb_build_object('nodes',jsonb_build_array(fixture_node('n0',1.111111111111111111111111111111,7.333333333333333333333333333333),fixture_node('n1',0.000000000000000000000000000001,5.000000000000000000000000000001)))),
 ('33333333-3333-4333-8333-333333333331',jsonb_build_object('nodes',jsonb_build_array(fixture_node('n2',3.123456789012345678901234567890,2.000000000000000000000000000003)))),
 ('33333333-3333-4333-8333-333333333332',jsonb_build_object('nodes',jsonb_build_array(fixture_node('n3',0,0))));
INSERT INTO gto_v31_cell_source_receipts SELECT c.dataset_id,c.cell_id,s.id,n->>'node','holdout',n->>'node_checksum'FROM gto_v31_runtime_cells c CROSS JOIN solved_spots_gold s CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes')n
 WHERE (right(c.cell_id::text,1)='0'AND n->>'node'IN('n0','n1'))OR(right(c.cell_id::text,1)='1'AND n->>'node'='n0')OR(right(c.cell_id::text,1)='2'AND n->>'node'='n2')OR(right(c.cell_id::text,1)='3'AND n->>'node'='n3')OR(right(c.cell_id::text,1)='4'AND n->>'node'='n2');
INSERT INTO gto_v31_public_model_audit_combos SELECT c.cell_id::text||':'||r.source_node,i,
 ARRAY[0.749999999999999999999999999999::numeric,0.250000000000000000000000000001::numeric],
 0.432109876543210987654321098765::numeric FROM gto_v31_runtime_cells c JOIN gto_v31_cell_source_receipts r USING(cell_id)CROSS JOIN generate_series(0,1)i
 WHERE right(c.cell_id::text,1)<>'2'AND NOT(right(c.cell_id::text,1)='1'AND i=1);
''')
        sql("UPDATE gto_v31_public_model_audit_combos SET frequencies=ARRAY[NULL::numeric,0.999999999999999999999999999999::numeric] WHERE audit_key LIKE '%:n1'AND combo=0")
        sql(baseline);sql(raw);sql(merge)
        ds="'11111111-1111-4111-8111-111111111111'::uuid"
        sql('CREATE TABLE raw_receipts AS SELECT fn_gto_v31_public215_cell_metric_raw('+ds+',cell_id)r FROM gto_v31_runtime_cells')
        for family in ['NULL',"'cash'","'spin'","'tourney_ev'","'tourney_icm'","'absent'"]:
            assert sql('SELECT fn_gto_v31_public215_heldout_metrics('+ds+','+family+') IS NOT DISTINCT FROM fn_gto_v31_public215_metrics_from_raw((SELECT jsonb_agg(r)FROM raw_receipts),'+family+')')=='t',family
            assert sql('SELECT fn_gto_v31_public215_heldout_metrics('+ds+','+family+')::text = fn_gto_v31_public215_metrics_from_raw((SELECT jsonb_agg(r)FROM raw_receipts),'+family+')::text')=='t',('scale',family)
        # Shared source UUID in different cells must not inflate source census.
        assert sql("SELECT fn_gto_v31_public215_metrics_from_raw((SELECT jsonb_agg(r)FROM raw_receipts),NULL)->>'holdout_source_rows'")=='2'
        assert sql("SELECT count(*)FROM raw_receipts WHERE (r->'holdout_source_ids')?'33333333-3333-4333-8333-333333333330'")=='2'
        assert sql("SELECT fn_gto_v31_public215_metrics_from_raw((SELECT jsonb_agg(r)FROM raw_receipts),'spin')->>'missing_observations'")=='1'
        # Empty input must retain the original no-observation NULL/zero behavior.
        assert sql("SELECT fn_gto_v31_public215_metrics_from_raw('[]',NULL)=fn_gto_v31_public215_heldout_metrics("+ds+",'absent')")=='t'
        assert sql("SELECT fn_gto_v31_public215_cell_metric_raw("+ds+",'99999999-9999-4999-8999-999999999999')IS NULL")=='t'
        raw_array='(SELECT jsonb_agg(r)FROM raw_receipts)';first='(SELECT r FROM raw_receipts ORDER BY r->>\'cell_id\'LIMIT 1)'
        invalid=[raw_array+'||jsonb_build_array('+first+')',"jsonb_build_array("+first+"||'{\"extra\":true}')",'jsonb_build_array('+first+"-'sums')",'jsonb_build_array(jsonb_set('+first+",'{counts,frequency}','1'::jsonb))",'jsonb_build_array(jsonb_set('+first+",'{sums,frequency_numerator}','\"NaN\"'::jsonb))",'jsonb_build_array(jsonb_set('+first+",'{holdout_source_ids}',jsonb_build_array('bad')))"]
        for expr in invalid:sql('SELECT fn_gto_v31_public215_metrics_from_raw('+expr+',NULL)',error='ERROR')
        # Helpers remain private, not a caller-controlled certification endpoint.
        for role in ['anon','authenticated','service_role']:
            assert sql("SELECT NOT has_function_privilege('"+role+"','public.fn_gto_v31_public215_metrics_from_raw(jsonb,text)','EXECUTE')")=='t'
        print(json.dumps({'native_exit':0,'original_five_ctes_two_filter_only':True,'global_four_families_absent_equal':True,'numeric_text_scale_equal':True,'overlapping_source_ids_union':True,'null_missing_sizing_regret_empty_preserved':True,'invalid_raw_cases_refused':len(invalid),'private_helpers':True,'limits':'Controlled source assertion/required-audit helpers isolate actual metric CTE algebra; no scientific qualification claim.'}))
    finally:
        command([str(PG/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'])

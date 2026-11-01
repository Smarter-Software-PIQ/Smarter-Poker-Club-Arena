#!/usr/bin/env python3
"""Full actual preparation migration under controlled nativePG17 metadata fixture."""
import json
import time
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('V31_SOURCE_ROOT',str(Path(__file__).resolve().parents[4])))
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

with tempfile.TemporaryDirectory(prefix='seal-once-draft-', dir=base) as folder, tempfile.TemporaryDirectory(prefix='preparation215-', dir=socket_base) as socket:
    task = Path(folder)
    data = task/'data'
    env = {**clean,'PGHOST':socket,'PGPORT':'55481','PGDATABASE':'postgres','PGUSER':'fixture_owner',
           'PGPASSFILE':str(task/'absent'), 'PGSERVICEFILE':str(task/'absent-service')}
    command([str(PG/'initdb'),'-D',str(data),'-U','fixture_owner','-A','trust','--no-locale','--encoding=UTF8'])
    command([str(PG/'pg_ctl'),'-D',str(data),'-l',str(task/'postgres.log'),'-o',f"-F -k {socket} -p 55481 -c listen_addresses='' -c track_functions=all",'-w','start'])
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
        migration=ROOT/'supabase/migrations/20261031231748_public215_sealing_uses_bounded_input_bound_preparation.sql'
        oldmigration=ROOT/'supabase/migrations/20261031215525_v31_model_validation_serializes_the_same_forest_once.sql'
        historical=(ROOT/'supabase/migrations/20261029070812_public_hist215_models_bind_independent_exact_public_state.sql').read_text()
        oldbase=(ROOT/'supabase/migrations/20260908181657_the_horse_reads_only_a_certified_solver_dataset.sql').read_text()
        def definition(text,name):
            starts=list(re.finditer(r'^CREATE(?: OR REPLACE)? FUNCTION public\.'+re.escape(name)+r'\s*\(',text,re.I|re.M));assert len(starts)==1,name
            tail=text[starts[0].start():];d=re.search(r'\bAS\s+(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)',tail,re.I);end=tail.index(d.group(1),d.end());return tail[:end+len(d.group(1))]+';'
        sql("CREATE ROLE anon LOGIN;CREATE ROLE authenticated LOGIN;CREATE ROLE service_role LOGIN;CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;CREATE FUNCTION auth.role()RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('fixture.jwt_role',true)$$;")
        sql('CREATE TABLE public.horse_league_results(id bigint PRIMARY KEY)')
        for table in ['gto_v31_input_bundles','gto_v31_datasets','gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts','gto_v31_release_evaluations']:
            match=re.search(r'^CREATE TABLE IF NOT EXISTS public\.'+table+r'\s*\(.*?^\);',oldbase,re.M|re.S);assert match,table;sql(match.group())
        for table in ['gto_v31_input_bundles','gto_v31_datasets','gto_v31_runtime_cells']:
            sql('ALTER TABLE '+table+' ADD COLUMN feature_contract_version text,ADD COLUMN policy_export_schema text,ADD COLUMN policy_representation text')
        sql('''ALTER TABLE gto_v31_runtime_cells ADD COLUMN public_model jsonb,ADD COLUMN public_template jsonb,ADD COLUMN public_training_provenance jsonb,ADD COLUMN public_model_build_receipt jsonb,ADD COLUMN model_checksum text,ADD COLUMN template_checksum text,ADD COLUMN feature_schema_checksum text,ADD COLUMN training_provenance_checksum text,ADD COLUMN model_build_receipt_checksum text,ADD COLUMN sql_physics_checksum text;
CREATE TABLE public.solved_spots_gold(id uuid PRIMARY KEY,scenario_hash text,strategy_matrix_v2 jsonb,quality_status text,audited_at timestamptz,source_artifact_checksum text,machine_id text,solver_version text,solver_binary_checksum text,pipeline_commit text,pipeline_bundle_checksum text,manifest_version text,manifest_checksum text);
CREATE TABLE public.gto_v31_model_preparations(dataset_id uuid,cell_key_checksum text,context jsonb,identity jsonb,preparation_checksum text,sql_physics_checksum text,program jsonb);
CREATE TABLE public.gto_v31_model_freezes(dataset_id uuid,cell_key_checksum text,public_model_build_receipt jsonb,model_build_receipt_checksum text);
CREATE TABLE public.gto_v31_public_source_journal(dataset_id uuid,source_row_id uuid,source_node text,context jsonb,board text,node_checksum text,artifact_checksum text,machine_id text);
CREATE TABLE public.gto_v31_public_selections(dataset_id uuid,input_bundle_checksum text,receipt jsonb,selected jsonb,frozen_models jsonb);
CREATE TABLE public.gto_v31_public_physics(physics_key text PRIMARY KEY,implementation_checksum text,legal_combos integer,exact_mass_rows jsonb);
CREATE TABLE public.gto_v31_public_model_compiled(model_checksum text,encoding_checksum text,heads jsonb);
CREATE TABLE public.gto_v31_public_model_audits(audit_key text PRIMARY KEY,physics_key text,model_checksum text,template_checksum text,encoding_checksum text,chronological_board text[],legal_combos integer,audit_checksum text,prepared_at timestamptz);
CREATE TABLE public.gto_v31_public_model_audit_combos(audit_key text REFERENCES public.gto_v31_public_model_audits(audit_key)DEFERRABLE INITIALLY DEFERRED,combo integer,features double precision[],raw_heads double precision[],policy_ev double precision,action_evs double precision[],frequencies double precision[],PRIMARY KEY(audit_key,combo));
''')
        for name in ['fn_gto_v31_json_checksum']:
            sql(definition(oldbase,name))
        for name in ['fn_gto_v31_public215_immutable_physics','fn_gto_v31_public215_cell_immutable','fn_gto_v31_public215_context','fn_gto_v31_public215_f64']:
            sql(definition(historical,name))
        for table,trigger,fn in [('gto_v31_runtime_cells','gto_v31_public215_cell_immutable','fn_gto_v31_public215_cell_immutable')]+[(table,table+'_immutable','fn_gto_v31_public215_immutable_physics')for table in ['gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_source_journal','gto_v31_public_selections','gto_v31_public_model_audits','gto_v31_public_model_audit_combos','gto_v31_public_physics','gto_v31_public_model_compiled']]:
            sql('CREATE TRIGGER '+trigger+' BEFORE UPDATE OR DELETE ON '+table+' FOR EACH ROW EXECUTE FUNCTION public.'+fn+'()')
        # Controlled scientific boundaries, declared BEFORE fingerprint capture.
        sql("CREATE FUNCTION public.fn_gto_v31_public215_physics_implementation()RETURNS text LANGUAGE sql STABLE AS $$SELECT '66f413bc9179d5b10df7c5a73547931c47a3e90fd7895c4de596c7287e98e733'$$;CREATE FUNCTION public.fn_gto_v31_public215_encoding_implementation()RETURNS text LANGUAGE sql STABLE AS $$SELECT '1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d'$$;")
        sql("CREATE FUNCTION public.fn_gto_v31_cell_payload_checksum_matrix_v2(jsonb)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT repeat('a',64)$$;")
        names=['fn_gto_v31_cell_payload_checksum','fn_gto_v31_public215_canonical','fn_gto_v31_public215_model_canonical_fast','fn_gto_v31_public215_model_valid','fn_gto_v31_seal_build','fn_gto_v31_source_node_v3_fields_valid','fn_gto_v31_source_node_v3_valid','fn_gto_v31_source_node_v4_valid']
        for name in names:sql(definition(oldmigration.read_text(),name))
        # Only pure model/source scientific validity is controlled. Actual migration
        # guards, revisions, fingerprint, locks, receipts and final writes are not.
        sql('''CREATE FUNCTION public.fn_gto_v31_public215_digest(jsonb)RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$SELECT public.fn_gto_v31_json_checksum($1)$$;
CREATE FUNCTION public.fn_gto_v31_cell_payload_valid(jsonb)RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$BEGIN RETURN true;END$$;
CREATE FUNCTION public.fn_gto_v31_cell_key_checksum(jsonb)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1->>'cell_key_checksum'$$;
CREATE FUNCTION public.fn_gto_v31_public215_source_headers_valid(public.gto_v31_datasets)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION public.fn_gto_v31_public215_selected_complete(public.gto_v31_datasets)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION public.fn_gto_v31_public215_frozen_model_valid(public.gto_v31_runtime_cells,public.gto_v31_datasets)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION public.fn_gto_v31_public215_frozen_map(public.gto_v31_datasets)RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '[]'::jsonb$$;
CREATE FUNCTION public.fn_gto_v31_assert_source_contract(jsonb,text,text)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$BEGIN RETURN $1;END$$;
CREATE FUNCTION public.fn_gto_v31_source_artifact_checksum(text,jsonb)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT public.fn_gto_v31_json_checksum(jsonb_build_object('scenario_hash',$1,'strategy_matrix_v2',$2))$$;
CREATE FUNCTION public.fn_gto_v31_public215_physics_key(jsonb,text[])RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT md5(array_to_string($2,''))$$;
CREATE FUNCTION public.fn_gto_v31_public215_audit_key(text,text,text[],text)RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT md5(array_to_string($3,''))$$;
CREATE FUNCTION public.fn_gto_v31_public215_required_audit(public.gto_v31_runtime_cells,text)RETURNS text LANGUAGE sql STABLE AS $$SELECT md5($2)$$;
''')
        for sig in ['fn_gto_v31_prepare_seal_cell(uuid,text)']:
            pass # Created only by the complete actual migration below.
        before=sql("SELECT jsonb_object_agg(proname,to_jsonb(p)-'prosrc')FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY["+','.join("'"+x+"'"for x in names)+"])")
        old_definitions=sql("SELECT jsonb_object_agg(proname,pg_get_functiondef(oid))FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY["+','.join("'"+x+"'"for x in names)+"])")
        candidate=migration.read_text();candidate_sha=hashlib.sha256(candidate.encode()).hexdigest();sql(candidate)
        after_metadata=sql("SELECT jsonb_object_agg(proname,to_jsonb(p)-'prosrc')FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY["+','.join("'"+x+"'"for x in names)+"])");assert after_metadata==before
        assert sql("SELECT count(*)FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'fn_gto_v31_%'")
        # 107 controlled contexts cover every unchanged final coverage dimension.
        contexts=[]
        families=[('cash','cash_ev'),('spin','chip_ev'),('spin','icm'),('tourney_ev','chip_ev'),('tourney_icm','icm')]
        roles=['open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in']
        boards=['AcKd'+rank+'h'for rank in '23456789TJ']
        for i in range(107):
            family,objective=families[i%5];street=['flop','turn','river'][(i//5)%3];role=roles[i%10]
            utility='cash_ev'if objective=='cash_ev'else'chip_ev'if objective=='chip_ev'else'spin_ladder'if family=='spin'else['satellite','bubble','final_table','in_money','ladder'][(i//5)%5]
            facing='none'if i%10<5 else'bet'if i%10==5 else'all_in'if i%10==9 else'raise'
            c={'street':street,'game_family':family,'objective':objective,'utility_context':utility,'table_size':2+i%9,'pot_type':['limped','srp','3bet','4bet_plus'][i%4],'hero_position':'BB','opponent_position':'SB','depth_bucket':80,'texture_class':'Brud','node_role':role,'facing_kind':facing,'facing_size_bucket':'none'if facing=='none'else'all_in'if facing=='all_in'else'mid'}
            bs=[b+('4s'if street=='turn'else'4s5c'if street=='river'else'')for b in boards]
            contexts.append({'i':i,'context':c,'boards':bs,'cases':[{'board':bs[8]},{'board':bs[9]}]})
        literal=lambda value:"'"+json.dumps(value,separators=(',',':')).replace("'","''")+"'::jsonb"
        sql('CREATE TABLE fixture_contexts AS SELECT (v->>\'i\')::int i,v->\'context\'context,v->\'boards\'boards,v->\'cases\'cases FROM jsonb_array_elements('+literal(contexts)+')v')
        sql("""INSERT INTO gto_v31_input_bundles(input_bundle_id,bundle_key,bundle_checksum,range_bundle_checksum,source_combo_order_checksum,icm_model_checksum,bundle_manifest,feature_contract_version,policy_export_schema,policy_representation)
SELECT '22222222-2222-4222-8222-222222222222','synthetic-preseal',repeat('8',64),repeat('f',64),repeat('e',64),repeat('9',64),jsonb_build_object('public215_protocols',jsonb_build_object('runtime_parity_protocol',jsonb_build_object('contexts',(SELECT jsonb_agg(jsonb_build_object('context',context,'cases',cases))FROM fixture_contexts)))),'holdem-public-hist215-v1','smarter-poker.pio-policy.v4','public_hist215_v1';
INSERT INTO gto_v31_datasets(dataset_id,dataset_key,solver_version,solver_binary_checksum,pipeline_commit,pipeline_bundle_checksum,manifest_version,manifest_checksum,source_combo_order_checksum,range_bundle_checksum,icm_model_checksum,input_bundle_id,input_bundle_checksum,machine_ids,declared_coverage,quality_gates,feature_contract_version,policy_export_schema,policy_representation)
SELECT '11111111-1111-4111-8111-111111111111','synthetic-preseal','fixture',repeat('a',64),repeat('b',40),repeat('c',64),'1',repeat('d',64),repeat('e',64),repeat('f',64),repeat('9',64),'22222222-2222-4222-8222-222222222222',repeat('8',64),ARRAY['M1','M2'],(SELECT jsonb_agg(context)FROM fixture_contexts),'{"max_frequency_mae":0.05,"max_sizing_mae":0.05,"max_policy_ev_mae_bb":0.05,"max_action_regret_bb":0.05,"min_regret_coverage":0.95}','holdem-public-hist215-v1','smarter-poker.pio-policy.v4','public_hist215_v1';
CREATE TABLE fixture_sources AS SELECT f.i,j,md5('source-'||f.i||'-'||j)::uuid id,md5('cell-'||f.i)::uuid cell_id,
 jsonb_build_object('nodes',jsonb_build_array(jsonb_build_object('node','r:0','node_checksum',repeat('4',64),'node_context',f.context||jsonb_build_object('board',f.boards->>CASE WHEN j<57 THEN 8 ELSE j-57 END),'frequencies','{"a":[0.5],"b":[0.5]}'::jsonb,'policy_evs_bb','[1]'::jsonb,'action_evs_bb','{"a":[1],"b":[1]}'::jsonb,'matchups','[1]'::jsonb))) matrix
 FROM fixture_contexts f CROSS JOIN generate_series(0,64)j;
INSERT INTO solved_spots_gold SELECT id,'fixture-scenario-'||id,matrix,'validated',now(),fn_gto_v31_source_artifact_checksum('fixture-scenario-'||id,matrix),CASE WHEN j<57 THEN'M1'ELSE'M2'END,'fixture',repeat('a',64),repeat('b',40),repeat('c',64),'1',repeat('d',64) FROM fixture_sources;
INSERT INTO gto_v31_source_artifacts SELECT '11111111-1111-4111-8111-111111111111',s.id,g.machine_id,g.scenario_hash,s.matrix#>>'{nodes,0,node_context,game_family}',80,s.matrix#>>'{nodes,0,node_context,street}',g.source_artifact_checksum,1,now(),now()FROM fixture_sources s JOIN solved_spots_gold g USING(id);
CREATE TABLE fixture_cells AS SELECT f.i,f.context||jsonb_build_object('cell_id',md5('cell-'||f.i)::uuid,'dataset_id','11111111-1111-4111-8111-111111111111','cell_key_checksum',fn_gto_v31_json_checksum(f.context),'action_specs','{"a":{"family":"check","size_value":null},"b":{"family":"bet","size_value":0.75}}'::jsonb,'hand_matrix','{}'::jsonb,'policy_ev_matrix','{}'::jsonb,'action_ev_matrix','{}'::jsonb,'source_rows',65,'train_source_rows',57,'holdout_source_rows',8,'lineage_checksum',(SELECT encode(extensions.digest(string_agg(id::text||':r:0:'||repeat('4',64),''ORDER BY id::text),'sha256'),'hex')FROM fixture_sources s WHERE s.i=f.i),'built_at',now(),'feature_contract_version','holdem-public-hist215-v1','policy_export_schema','smarter-poker.pio-policy.v4','policy_representation','public_hist215_v1','public_model','{"action_ids":["b","a"],"variant":"direct"}'::jsonb,'public_template',jsonb_build_object('context',f.context),'public_training_provenance','{}'::jsonb,'public_model_build_receipt','{}'::jsonb,'model_checksum',repeat('1',64),'template_checksum',repeat('2',64),'feature_schema_checksum',repeat('7',64),'training_provenance_checksum',repeat('3',64),'model_build_receipt_checksum',repeat('5',64),'sql_physics_checksum',fn_gto_v31_public215_digest(jsonb_build_object('physics',fn_gto_v31_public215_physics_implementation(),'encoding',fn_gto_v31_public215_encoding_implementation()))) cell FROM fixture_contexts f;
INSERT INTO gto_v31_runtime_cells SELECT(jsonb_populate_record(NULL::gto_v31_runtime_cells,cell||jsonb_build_object('cell_payload_checksum',fn_gto_v31_cell_payload_checksum(cell)))).*FROM fixture_cells;
INSERT INTO gto_v31_cell_source_receipts SELECT '11111111-1111-4111-8111-111111111111',s.cell_id,s.id,'r:0',repeat('4',64),g.source_artifact_checksum,g.machine_id,CASE WHEN s.j<57 THEN'train'ELSE'holdout'END,now() FROM fixture_sources s JOIN solved_spots_gold g USING(id);
INSERT INTO gto_v31_public_source_journal SELECT '11111111-1111-4111-8111-111111111111',s.id,'r:0',f.context,s.matrix#>>'{nodes,0,node_context,board}',repeat('4',64),g.source_artifact_checksum,g.machine_id FROM fixture_sources s JOIN solved_spots_gold g USING(id)JOIN fixture_contexts f USING(i);
INSERT INTO gto_v31_model_preparations SELECT dataset_id,cell_key_checksum,public_template->'context',jsonb_build_object('model_checksum',model_checksum,'template_checksum',template_checksum,'training_provenance_checksum',training_provenance_checksum),repeat('6',64),sql_physics_checksum,'{}'::jsonb FROM gto_v31_runtime_cells;
INSERT INTO gto_v31_model_freezes SELECT dataset_id,cell_key_checksum,public_model_build_receipt,model_build_receipt_checksum FROM gto_v31_runtime_cells;
INSERT INTO gto_v31_public_selections VALUES('11111111-1111-4111-8111-111111111111',repeat('8',64),'{}','[]','[]');
BEGIN;
INSERT INTO gto_v31_public_model_compiled VALUES(repeat('1',64),fn_gto_v31_public215_encoding_implementation(),'{}');
CREATE TEMP TABLE cache_boards AS SELECT DISTINCT b#>>'{}'board,CASE length(b#>>'{}')WHEN 6 THEN 1176 WHEN 8 THEN 1128 ELSE 1081 END legal FROM fixture_contexts CROSS JOIN LATERAL jsonb_array_elements(boards)b;
INSERT INTO gto_v31_public_physics SELECT md5(board),fn_gto_v31_public215_physics_implementation(),legal,(SELECT jsonb_agg('null'::jsonb)FROM generate_series(1,legal))FROM cache_boards;
INSERT INTO gto_v31_public_model_audit_combos SELECT md5(board),i,'{}','{}',1,ARRAY[1,1]::double precision[],ARRAY[0.5,0.5]::double precision[] FROM cache_boards CROSS JOIN LATERAL generate_series(0,legal-1)i;
INSERT INTO gto_v31_public_model_audits SELECT md5(board),md5(board),repeat('1',64),repeat('2',64),fn_gto_v31_public215_encoding_implementation(),ARRAY(SELECT substring(board FROM n FOR 2)FROM generate_series(1,length(board),2)n ORDER BY n),legal,repeat('a',64),now()FROM cache_boards;
COMMIT;
""")
        ds="'11111111-1111-4111-8111-111111111111'::uuid"
        first=sql('SELECT cell_key_checksum FROM gto_v31_runtime_cells ORDER BY cell_key_checksum LIMIT1'.replace('LIMIT1','LIMIT 1'))
        status=lambda key:sql('SELECT fn_gto_v31_seal_cell_preparation_status('+ds+",'"+key+"')->>'status'",role='service_role')
        assert status(first)=='missing'
        sql('SELECT fn_gto_v31_prepare_seal_cell('+ds+",'"+first+"')",role='anon',error='permission denied')
        keys=sql('SELECT cell_key_checksum FROM gto_v31_runtime_cells ORDER BY cell_key_checksum').splitlines()
        for key_index,key in enumerate(keys):
            if key_index==106:
                sql('SELECT fn_gto_v31_public215_assert_prepared_seal(d)FROM gto_v31_datasets d WHERE dataset_id='+ds,error='query returned no rows')
            reply=json.loads(sql('SELECT fn_gto_v31_prepare_seal_cell('+ds+",'"+key+"')",role='service_role'));assert reply['status']=='prepared'
        assert len(keys)==107 and sql('SELECT count(*)FROM gto_v31_seal_cell_preparations')=='107'
        source_calls=int(sql("SELECT calls FROM pg_stat_user_functions WHERE funcid='public.fn_gto_v31_assert_source_contract(jsonb,text,text)'::regprocedure"));assert source_calls==6955+856,source_calls
        payload_calls=int(sql("SELECT calls FROM pg_stat_user_functions WHERE funcid='public.fn_gto_v31_cell_payload_valid(jsonb)'::regprocedure"));assert payload_calls==107,payload_calls
        sql('SELECT fn_gto_v31_prepare_seal_cell('+ds+",'"+first+"')",role='service_role',error='already exists')
        assert status(first)=='prepared'
        # Same-source metadata mutation invalidates receipt and fails final reuse;
        # rollback restores both revision and source so remaining proof is original.
        source_id=sql("SELECT source_row_id FROM gto_v31_cell_source_receipts r JOIN gto_v31_runtime_cells c USING(cell_id)WHERE c.cell_key_checksum='"+first+"'LIMIT1".replace('LIMIT1','LIMIT 1'))
        sql("BEGIN;SET fixture.jwt_role='service_role';UPDATE solved_spots_gold SET quality_status='changed'WHERE id='"+source_id+"';DO $x$BEGIN IF fn_gto_v31_seal_cell_preparation_status("+ds+",'"+first+"')->>'status'<>'stale'THEN RAISE EXCEPTION 'stale not detected';END IF;END$x$;ROLLBACK;")
        sql("BEGIN;SET fixture.jwt_role='service_role';UPDATE gto_v31_input_bundles SET revocation_reason='synthetic-change';DO $x$BEGIN IF fn_gto_v31_seal_cell_preparation_status("+ds+",'"+first+"')->>'status'<>'stale'THEN RAISE EXCEPTION 'bundle stale not detected';END IF;END$x$;ROLLBACK;")
        assert status(first)=='prepared'
        sql("UPDATE gto_v31_seal_cell_preparations SET raw_metrics='{}'",error='immutable')
        for mutation in ["UPDATE solved_spots_gold SET quality_status='changed'WHERE id='"+source_id+"'", "UPDATE gto_v31_input_bundles SET revocation_reason='changed'", "UPDATE gto_v31_datasets SET quality_gates=quality_gates||'{\"max_frequency_mae\":0.01}'::jsonb"]:
            sql("BEGIN;SET fixture.jwt_role='service_role';"+mutation+";DO $refuse$BEGIN BEGIN PERFORM fn_gto_v31_public215_assert_prepared_seal(d)FROM gto_v31_datasets d WHERE dataset_id="+ds+";RAISE EXCEPTION 'stale receipt accepted';EXCEPTION WHEN no_data_found THEN NULL;END;END$refuse$;ROLLBACK;")
        sql("BEGIN;CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_source_headers_valid(public.gto_v31_datasets)RETURNS boolean LANGUAGE sql STABLE AS $changed$SELECT true /* changed validation implementation */$changed$;SET fixture.jwt_role='service_role';DO $refuse$BEGIN IF fn_gto_v31_seal_cell_preparation_status("+ds+",'"+first+"')->>'status'<>'stale'THEN RAISE EXCEPTION 'code staleness not detected';END IF;BEGIN PERFORM fn_gto_v31_public215_assert_prepared_seal(d)FROM gto_v31_datasets d WHERE dataset_id="+ds+";RAISE EXCEPTION 'code-stale receipt accepted';EXCEPTION WHEN no_data_found THEN NULL;END;END$refuse$;ROLLBACK;")
        raws=sql('SELECT jsonb_array_length(fn_gto_v31_public215_assert_prepared_seal(d))FROM gto_v31_datasets d WHERE dataset_id='+ds)
        assert raws=='107'
        checksum=sql('SELECT fn_gto_v31_seal_build('+ds+')',role='service_role');assert re.fullmatch('[0-9a-f]{64}',checksum)
        assert sql('SELECT state FROM gto_v31_datasets WHERE dataset_id='+ds)=='evaluating'
        assert sql('SELECT count(*)FROM gto_v31_release_evaluations')=='1'
        assert int(sql("SELECT calls FROM pg_stat_user_functions WHERE funcid='public.fn_gto_v31_assert_source_contract(jsonb,text,text)'::regprocedure"))==source_calls
        assert int(sql("SELECT calls FROM pg_stat_user_functions WHERE funcid='public.fn_gto_v31_cell_payload_valid(jsonb)'::regprocedure"))==payload_calls
        # Execute the candidate's documented function-only rollback byte-for-byte.
        rollback_region=candidate.split('-- ROLLBACK:',1)[1]
        lines=rollback_region.splitlines();first_rollback=next(i for i,line in enumerate(lines)if line=='-- BEGIN;');last_rollback=next(i for i,line in enumerate(lines)if line=='-- COMMIT;')
        rollback='\n'.join(re.sub(r'^-- ?', '',line)for line in lines[first_rollback:last_rollback+1]);sql(rollback)
        assert sql("SELECT jsonb_object_agg(proname,pg_get_functiondef(oid))FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY["+','.join("'"+x+"'"for x in names)+"]) ")==old_definitions
        assert sql("SELECT jsonb_object_agg(proname,to_jsonb(p)-'prosrc')FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY["+','.join("'"+x+"'"for x in names)+"])")==before
        assert sql('SELECT count(*)FROM gto_v31_seal_cell_preparations')=='107'
        assert sql('SELECT count(*)FROM gto_v31_release_evaluations')=='1'
        print(json.dumps({'source_assert_calls':source_calls,'payload_validator_calls':payload_calls,'rollback_old8_bytes_metadata_equal':True,'full_actual_migration_native_pass':True,'contexts_prepared':107,'final_seal_state':'evaluating','stale_gold_bundle_refused':True,'duplicate_preparation_refused':True,'untrusted_role_refused':True,'controlled_science_only':True,'migration_sha256':candidate_sha,'missing_receipt_final_refused':True,'stale_source_bundle_gates_code_final_refused':True,'immutable_receipt_refused':True,'baseline8_metadata_preserved':True}))
    finally:
        command([str(PG/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'])

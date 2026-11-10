"""Exact current witness expression and concurrent scope/join cover; isolated PG17."""
from pathlib import Path
import json,re,time

def qualify(q,env,root,work,cases,rows=120000):
    previous=env['PGDATABASE'];q('CREATE DATABASE witness_scope_cover;');env['PGDATABASE']='witness_scope_cover'
    try:
        f=root/'scripts/ci/fixtures/outcome-recognition-join-cover'
        q('CREATE SCHEMA smarter_private;'+(f/'actual-relations.sql').read_text())
        q('CREATE TABLE union_pnl_cash_outcome_touches(table_id uuid,hand_number bigint,recognized_at timestamptz,game_union_id text,PRIMARY KEY(table_id,hand_number));CREATE TABLE smarter_private.posthand_escrow_certificates(table_id uuid,hand_number bigint,PRIMARY KEY(table_id,hand_number));CREATE TABLE install_control(frozen boolean);INSERT INTO install_control VALUES(false);CREATE FUNCTION fn_platform_frozen()RETURNS boolean LANGUAGE sql AS $$SELECT frozen FROM install_control$$;')
        # Reporting readiness/generation is the existing explicit native seam.
        # The unchanged current witness body is real and byte guarded; this
        # read-only expression test does not qualify unrelated source68 owners.
        q("CREATE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT true$$;CREATE FUNCTION smarter_private.original_inventory_basis_generation()RETURNS text LANGUAGE sql AS $$SELECT 'original-inventory-245-v1:a364e4a8ab59299de12efabbfdac85eb'::text$$;")
        source=(f/'witness-current.sql').read_text();q('SET check_function_bodies=off;'+source)
        q("CREATE INDEX union_pnl_cash_outcome_touches_week ON union_pnl_cash_outcome_touches(game_union_id,recognized_at);CREATE INDEX union_pnl_cash_outcomes_scope_window ON union_pnl_cash_outcomes((game_scope->>'game_union_id'),recognized_at);CREATE INDEX union_pnl_cash_outcomes_recognition_join_cover ON union_pnl_cash_outcomes(recognized_at)INCLUDE(table_id,hand_number);")
        u='fade0000-0000-0000-0000-000000000001';other='fade0000-0000-0000-0000-000000000002';start='2026-10-26 07:00Z';end='2026-10-26 09:00Z'
        q("INSERT INTO union_pnl_cash_outcomes SELECT md5('witness-table-'||(n%100))::uuid,n,md5('witness-hand-'||n)::uuid,'1'::xid8,'"+start+"'::timestamptz+(n%604800)*interval'1 second',md5(n::text),jsonb_build_object('game_union_id',CASE WHEN n%4=0 THEN '"+other+"'ELSE '"+u+"'END),'{}'::jsonb FROM generate_series(1,"+str(rows)+")n;")
        q("""WITH payload AS(SELECT o.*,jsonb_build_object('game_union_id',CASE WHEN hand_number%8=0 THEN '"""+other+"""'ELSE '"""+u+"""'END,'host_club_id',NULL,'tournament_id',NULL,'is_private',false,'asset','chips','unit_scale',2)gs FROM union_pnl_cash_outcomes o WHERE hand_number%4=0),
 shaped AS(SELECT p.*,jsonb_build_object('provenance_link','resolved','game_scope',gs)e FROM payload p),proof AS(SELECT s.*,jsonb_build_object('status','proven','resolution_kind','cash_outcome_provenance_link','table_id',table_id,'hand_number',hand_number,'hand_id',hand_id,'outcome_payload_hash',payload_hash,'outcome_evidence_md5',md5(evidence::text),'roster_source','seat_inventory','manifest_id',NULL,'game_scope',gs,'evidence',e)pr FROM shaped s)
 INSERT INTO union_pnl_cash_outcome_link_resolutions(table_id,hand_number,hand_id,outcome_payload_hash,outcome_evidence_md5,roster_source,manifest_id,game_scope,evidence,proof,proof_md5,reason)
 SELECT table_id,hand_number,hand_id,payload_hash,md5(evidence::text),'seat_inventory',NULL,gs,e,pr,md5(pr::text),'Native current witness scope coverage'FROM proof;""")
        q("INSERT INTO union_pnl_cash_outcome_touches SELECT table_id,hand_number,recognized_at,CASE WHEN hand_number%3=0 THEN '"+other+"'ELSE '"+u+"'END FROM union_pnl_cash_outcomes;INSERT INTO smarter_private.posthand_escrow_certificates SELECT table_id,hand_number FROM union_pnl_cash_outcomes WHERE hand_number IN(4,8,7200);")
        q('VACUUM ANALYZE union_pnl_cash_outcomes;VACUUM ANALYZE union_pnl_cash_outcome_touches;VACUUM ANALYZE union_pnl_cash_outcome_link_resolutions;VACUUM ANALYZE smarter_private.posthand_escrow_certificates;')
        expression=source.split('RETURN jsonb_build_object',1)[1].rsplit('\nEND',1)[0].strip().rstrip(';');expression='jsonb_build_object'+expression
        for name,param in [('p_projected','$4'),('p_union','$1'),('p_start','$2'),('p_end','$3')]:expression=re.sub(r'\b'+name+r'\b',lambda _:param,expression)
        prepare='SET plan_cache_mode=force_generic_plan;PREPARE exact_witness(uuid,timestamptz,timestamptz,boolean)AS SELECT '+expression+';'
        call="EXECUTE exact_witness('"+u+"','"+start+"','"+end+"',%s)"
        def query(projected,explain=False):
            return q(prepare+('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)'if explain else'')+(call%str(projected).lower())+';')
        before=[query(True),query(False)]
        inside=[n for n in range(1,rows+1)if n%604800<7200]
        expected_links=sum(n%8==4 for n in inside)
        assert json.loads(before[0])=={'ordinary_count':sum(n%3!=0 for n in inside),'links':expected_links,'escrow_certificates':2}
        assert json.loads(before[1])=={'ordinary_count':sum(n%4!=0 for n in inside),'links':expected_links,'escrow_certificates':0}
        boundary=prepare+"EXECUTE exact_witness('"+u+"','2026-10-26 07:00:04Z','2026-10-26 07:00:08Z',true);"
        boundary_before=q(boundary)
        boundary_inside=[n for n in range(1,rows+1)if 4<=n%604800<8]
        assert json.loads(boundary_before)=={'ordinary_count':sum(n%3!=0 for n in boundary_inside),'links':sum(n%8==4 for n in boundary_inside),'escrow_certificates':1}
        migration=(root/'supabase/migrations/20261110050427_cover_original_link_witness_scope_and_join_keys.sql').read_text();preamble,body=migration.split('BEGIN;',1);body='BEGIN;'+body
        meta="SELECT jsonb_agg(to_jsonb(p)ORDER BY p.oid)FROM pg_proc p WHERE p.oid IN('smarter_private.weekly_hand_parts_witness(uuid,timestamptz,timestamptz,boolean)'::regprocedure,'smarter_private.original_inventory_proof_sources_match()'::regprocedure,'smarter_private.original_inventory_basis_generation()'::regprocedure)"
        original=q(meta);baseline=json.loads(query(True,True))[0]
        began=time.monotonic();q(preamble);build_seconds=time.monotonic()-began;q(body);q(preamble+body)
        assert [query(True),query(False)]==before and q(meta)==original and q(boundary)==boundary_before
        plan=json.loads(query(True,True))[0]
        def nodes(n):
            yield n
            for child in n.get('Plans',[]):yield from nodes(child)
        link_nodes=[n for n in nodes(plan['Plan'])if n.get('Relation Name')=='union_pnl_cash_outcome_link_resolutions']
        assert link_nodes and all(n['Node Type']=='Index Only Scan'and n.get('Heap Fetches')==0 for n in link_nodes),link_nodes
        assert all('table_id ='in n.get('Index Cond','')and 'hand_number ='in n.get('Index Cond','')for n in link_nodes),link_nodes
        for label,setup,reason in [('frozen','UPDATE install_control SET frozen=true;','LINK_WITNESS_COVER_OPERATOR_OR_FREEZE_REFUSED'),('source',"CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT false$$;",'LINK_WITNESS_COVER_ORIGINAL_SOURCE_REQUIRED')]:
            q(body.replace('BEGIN;','BEGIN;'+setup,1),reason)
        q('ALTER INDEX union_pnl_cash_links_witness_join_cover RENAME TO native_wrong_cover;');q(body,'LINK_WITNESS_COVER_EXACT_VALID_INDEX_REQUIRED');q('ALTER INDEX native_wrong_cover RENAME TO union_pnl_cash_links_witness_join_cover;')
        q(body.replace('COMMIT;',"DO $$BEGIN RAISE EXCEPTION 'native_cover_rollback';END$$;COMMIT;"),'native_cover_rollback')
        # Actual CHECK rejects corruption; a local fault seam then proves this
        # unconditional physical cover does not hide an invalid-proof row.
        q("UPDATE union_pnl_cash_outcome_link_resolutions SET proof_md5=repeat('0',32)WHERE hand_number=4;",'violates check constraint')
        q("ALTER TABLE union_pnl_cash_outcome_link_resolutions DROP CONSTRAINT union_pnl_cash_outcome_link_resolutions_check;UPDATE union_pnl_cash_outcome_link_resolutions SET proof_md5=repeat('0',32)WHERE hand_number=4;")
        assert [query(True),query(False)]==before
        assert q(meta)==original
        result={'status':'passed','outcomes':rows,'links':rows//4,'generic_plan_index_only':True,'ordinary_projected_raw_and_escrow_parity':True,'invalid_proof_link_not_hidden':True,'build_seconds':build_seconds,'index_bytes':int(q("SELECT pg_relation_size('union_pnl_cash_links_witness_join_cover');")),'old_plan':baseline,'new_plan':plan,'source_generation_metadata_unchanged':True,'limits':'Exact current RETURN expression and guarded concurrent installer; complete immutable link CHECKs except one explicit local corruption seam. Source68 readiness/generation controlled only here. Representative native timing is not production timing.'}
        (work/'current-witness-cover.json').write_text(json.dumps(result,indent=2)+'\n');cases.append('current_witness_unconditional_scope_join_cover_native_parity_and_index_only');return result
    finally:env['PGDATABASE']=previous

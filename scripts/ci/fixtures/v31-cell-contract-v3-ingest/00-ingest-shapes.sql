-- Production shapes added for the native proof of migration 20261115183033 (FLOP-5 D6), loaded after
-- scripts/ci/fixtures/v31-cell-contract-v3-build-seal. Generated from PokerIQ-Production
-- (kuklfnapbkmacvwxktbh) on 2026-11-15 inside READ ONLY transactions; never applied to production.
-- The three relations the ingest path writes or reads that the build/seal fixture lacks: every live column, default, constraint and V31 trigger (the seal revision clock omitted, as there), with row security and grants; and the 8 functions of the ingest closure the build/seal fixture lacks, byte-exact pg_get_functiondef copies of the live definitions with their live ACLs.
CREATE TABLE public.gto_v31_model_preparations (
  dataset_id uuid NOT NULL,
  cell_key_checksum text NOT NULL,
  context jsonb NOT NULL,
  program jsonb NOT NULL,
  identity jsonb NOT NULL,
  action_specs jsonb NOT NULL,
  train_lineage_checksum text NOT NULL,
  preparation_checksum text NOT NULL,
  sql_physics_checksum text NOT NULL,
  prepared_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.gto_v31_public_selections (
  dataset_id uuid NOT NULL,
  input_bundle_checksum text NOT NULL,
  receipt_checksum text NOT NULL,
  receipt jsonb NOT NULL,
  capture_checksum text NOT NULL,
  selected jsonb NOT NULL,
  frozen_models jsonb NOT NULL
);
CREATE TABLE public.gto_v31_public_source_journal (
  dataset_id uuid NOT NULL,
  source_row_id uuid NOT NULL,
  source_node text NOT NULL,
  context jsonb NOT NULL,
  board text NOT NULL,
  node_checksum text NOT NULL,
  artifact_checksum text NOT NULL,
  machine_id text NOT NULL
);
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.fn_gto_v31_ingest_source_artifact(p_dataset_id uuid, p_machine_id text, p_artifact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE d public.gto_v31_datasets;b public.gto_v31_input_bundles;v_receipt jsonb;receipt_sha text;seed text;result jsonb;persisted jsonb;matrix jsonb;node jsonb;v_source_id uuid;entry jsonb;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' AND current_user NOT IN('postgres','supabase_admin')THEN RAISE EXCEPTION 'service_role required';END IF;
 SELECT * INTO STRICT d FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
 IF d.policy_representation IS DISTINCT FROM 'public_hist215_v1' THEN RETURN public.fn_gto_v31_ingest_source_artifact_matrix_v2(p_dataset_id,p_machine_id,p_artifact);END IF;
 SELECT * INTO STRICT b FROM public.gto_v31_input_bundles WHERE input_bundle_id=d.input_bundle_id AND approval_status='approved' AND bundle_checksum=d.input_bundle_checksum;
 IF p_machine_id='M1'AND EXISTS(SELECT 1 FROM public.gto_v31_model_preparations p WHERE p.dataset_id=d.dataset_id)AND NOT EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=d.dataset_id AND a.source_row_id::text=lower(p_artifact->>'id'))THEN RAISE EXCEPTION 'complete M1 source partition is immutable after model preparation';END IF;
 IF p_machine_id='M2' THEN
  IF NOT public.fn_gto_v31_public215_keys(p_artifact,ARRAY['id','scenario_hash','game_family','stack_depth','street','solved_at','strategy_matrix_v2','selection_seed']) OR jsonb_typeof(p_artifact->'selection_seed') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'authenticated blind selection opening required';END IF;
  seed:=p_artifact->>'selection_seed';persisted:=p_artifact-'selection_seed';p_artifact:=NULL;
  matrix:=persisted->'strategy_matrix_v2';v_receipt:=matrix->'selection_receipt';receipt_sha:=matrix->>'selection_receipt_checksum';
  IF NOT public.fn_gto_v31_public215_keys(matrix,ARRAY['schema','combo_order','nodes','selection_receipt','selection_receipt_checksum']) OR receipt_sha IS DISTINCT FROM public.fn_gto_v31_public215_digest(v_receipt) OR public.fn_gto_v31_public215_selection_receipt(v_receipt,d,b,seed) IS NOT TRUE THEN seed:=NULL;RAISE EXCEPTION 'blind selected source v_receipt or opening is invalid';END IF;seed:=NULL;
  INSERT INTO public.gto_v31_public_selections VALUES(d.dataset_id,d.input_bundle_checksum,receipt_sha,v_receipt,v_receipt->>'capture_receipt_checksum',v_receipt->'selected',v_receipt->'frozen_models')ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.gto_v31_public_selections s WHERE s.dataset_id=d.dataset_id AND s.receipt_checksum=receipt_sha AND s.receipt=v_receipt)THEN RAISE EXCEPTION 'frozen blind selection v_receipt changed';END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(matrix->'nodes')LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_receipt->'selected')s WHERE s->>'context_id'=public.fn_gto_v31_public215_digest(public.fn_gto_v31_public215_context(node->'node_context')) AND s->>'board'=node#>>'{node_context,board}' AND s->>'rank_signature'=public.fn_gto_v31_public215_rank_signature(node#>>'{node_context,board}'))THEN RAISE EXCEPTION 'source node is outside the exact committed M2 subset';END IF;
  END LOOP;
  result:=public.fn_gto_v31_public215_ingest_m2(p_dataset_id,p_machine_id,persisted);
 ELSIF p_machine_id='M1' THEN
  IF p_artifact?'selection_seed' OR p_artifact#>'{strategy_matrix_v2,selection_receipt}' IS NOT NULL THEN RAISE EXCEPTION 'M1 cannot carry an M2 opening/v_receipt';END IF;
  result:=public.fn_gto_v31_ingest_source_artifact_matrix_v2(p_dataset_id,p_machine_id,p_artifact);
 ELSE RAISE EXCEPTION 'approved solver machine required';END IF;
 v_source_id:=(result->>'source_row_id')::uuid;
 -- Metadata comes from the SQL-normalized canonical artifact, never the caller.
 FOR node IN SELECT value FROM public.solved_spots_gold s CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes')WHERE s.id=v_source_id LOOP
  INSERT INTO public.gto_v31_public_source_journal VALUES(p_dataset_id,v_source_id,node->>'node',public.fn_gto_v31_public215_context(node->'node_context'),node#>>'{node_context,board}',node->>'node_checksum',result->>'source_artifact_checksum',p_machine_id)ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=p_dataset_id AND j.source_row_id=v_source_id AND j.source_node=node->>'node' AND j.context=public.fn_gto_v31_public215_context(node->'node_context') AND j.board=node#>>'{node_context,board}' AND j.node_checksum=node->>'node_checksum' AND j.artifact_checksum=result->>'source_artifact_checksum' AND j.machine_id=p_machine_id)THEN RAISE EXCEPTION 'immutable canonical source journal changed';END IF;
 END LOOP;RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_ingest_source_artifact_matrix_v2(p_dataset_id uuid, p_machine_id text, p_artifact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_matrix jsonb := p_artifact->'strategy_matrix_v2';
  v_node jsonb;
  v_row_id uuid;
  v_solved_at timestamptz;
  v_checksum text;
  v_nodes integer;
  v_inserted integer;
  v_normalized_nodes jsonb := '[]'::jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF p_machine_id NOT IN ('M1','M2') OR NOT (p_machine_id=ANY(v_dataset.machine_ids))
     OR p_artifact IS NULL OR jsonb_typeof(p_artifact)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_artifact))<>7
     OR NOT (p_artifact ?& ARRAY['id','scenario_hash','game_family','stack_depth','street','solved_at','strategy_matrix_v2'])
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
         'id','scenario_hash','game_family','street','solved_at'
       ]) field(key) WHERE jsonb_typeof(p_artifact->field.key)<>'string'
     )
     OR jsonb_typeof(p_artifact->'stack_depth')<>'number'
     OR jsonb_typeof(p_artifact->'strategy_matrix_v2')<>'object'
     OR p_artifact->>'id' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR length(COALESCE(p_artifact->>'scenario_hash','')) NOT BETWEEN 8 AND 512
     OR COALESCE(p_artifact->>'scenario_hash','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
     OR p_artifact->>'game_family' NOT IN ('cash','spin','tourney_ev','tourney_icm')
     OR NOT public.fn_gto_v31_json_safe_integer(p_artifact->'stack_depth',10,150)
     OR (p_artifact->>'stack_depth')::integer NOT IN (10,20,40,80,150)
     OR p_artifact->>'street' NOT IN ('flop','turn','river')
     OR jsonb_typeof(v_matrix)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_matrix))<>3
     OR NOT (v_matrix ?& ARRAY['schema','combo_order','nodes'])
     OR v_matrix->>'schema' IS DISTINCT FROM 'smarter-poker.pio-artifact.v31.1'
     OR v_matrix->>'combo_order' IS DISTINCT FROM
       'card=rank*4+suit; combo=b*(b-1)/2+a; 2c2d=0..AhAs=1325'
     OR jsonb_typeof(v_matrix->'nodes')<>'array'
     OR jsonb_array_length(v_matrix->'nodes') NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'source artifact envelope is invalid';
  END IF;
  v_row_id:=(p_artifact->>'id')::uuid;
  v_solved_at:=(p_artifact->>'solved_at')::timestamptz;
  IF v_solved_at IS NULL OR v_solved_at>now()+interval '5 minutes'
     OR v_solved_at<now()-interval '30 days' THEN
    RAISE EXCEPTION 'source artifact solved_at is outside the admission window';
  END IF;
  v_nodes:=jsonb_array_length(v_matrix->'nodes');
  FOR v_node IN SELECT value FROM jsonb_array_elements(v_matrix->'nodes') LOOP
    -- PostgreSQL owns the canonical node checksum. A worker may omit that one
    -- field, which avoids claiming that Python JSON number rendering is byte
    -- identical to PostgreSQL jsonb. A supplied checksum is still verified
    -- and can never be replaced silently.
    IF jsonb_typeof(v_node)='object'
       AND (SELECT count(*) FROM jsonb_object_keys(v_node))=11
       AND NOT (v_node?'node_checksum')
       AND (v_node ?& ARRAY['schema','node','node_context','line_proof','action_specs',
         'frequencies','policy_evs_bb','action_evs_bb','matchups',
         'source_combo_order_checksum','range_bundle_checksum']) THEN
      v_node:=v_node||jsonb_build_object(
        'node_checksum',public.fn_gto_v31_node_checksum(v_node)
      );
    END IF;
    IF jsonb_typeof(v_node)='object'
       AND v_node->>'schema'='smarter-poker.pio-policy.v4'
       AND (SELECT count(*) FROM jsonb_object_keys(v_node))=13
       AND NOT (v_node?'node_checksum')
       AND v_node ?& ARRAY['schema','node','node_context','line_proof','action_specs',
         'frequencies','policy_evs_bb','action_evs_bb','matchups',
         'source_combo_order_checksum','range_bundle_checksum','complete_public_state','solver_ranges'] THEN
      v_node:=v_node||jsonb_build_object('node_checksum',public.fn_gto_v31_node_checksum(v_node));
    END IF;
    PERFORM public.fn_gto_v31_assert_source_contract(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);
    IF NOT public.fn_gto_v31_source_node_valid(v_node)
       OR v_node#>>'{node_context,game_family}' IS DISTINCT FROM p_artifact->>'game_family'
       OR COALESCE((v_node#>>'{node_context,depth_bucket}')::integer,0)
            IS DISTINCT FROM (p_artifact->>'stack_depth')::integer
       OR v_node#>>'{node_context,street}' IS DISTINCT FROM p_artifact->>'street'
       OR v_node->>'source_combo_order_checksum' IS DISTINCT FROM v_dataset.source_combo_order_checksum
       OR v_node->>'range_bundle_checksum' IS DISTINCT FROM v_dataset.range_bundle_checksum
       OR v_node#>>'{line_proof,manifest_checksum}' IS DISTINCT FROM v_dataset.manifest_checksum THEN
      RAISE EXCEPTION 'source artifact contains an invalid or cross-dataset node';
    END IF;
    v_normalized_nodes:=v_normalized_nodes||jsonb_build_array(v_node);
  END LOOP;
  v_matrix:=jsonb_set(v_matrix,'{nodes}',v_normalized_nodes,false);
  IF (SELECT count(DISTINCT value->>'node') FROM jsonb_array_elements(v_matrix->'nodes'))<>v_nodes THEN
    RAISE EXCEPTION 'source artifact contains duplicate nodes';
  END IF;
  v_checksum:=public.fn_gto_v31_source_artifact_checksum(p_artifact->>'scenario_hash',v_matrix);

  INSERT INTO public.solved_spots_gold (
    id,scenario_hash,game_type,stack_depth,street,strategy_matrix_v2,solved_v2_at,
    solver_version,solver_binary_checksum,machine_id,pipeline_commit,pipeline_bundle_checksum,
    manifest_version,manifest_checksum,source_artifact_checksum,quality_status,audited_at
  ) VALUES (
    v_row_id,p_artifact->>'scenario_hash','gto_v31_'||(p_artifact->>'game_family'),
    (p_artifact->>'stack_depth')::integer,p_artifact->>'street',v_matrix,v_solved_at,
    v_dataset.solver_version,v_dataset.solver_binary_checksum,p_machine_id,
    v_dataset.pipeline_commit,v_dataset.pipeline_bundle_checksum,
    v_dataset.manifest_version,v_dataset.manifest_checksum,
    v_checksum,'validated',clock_timestamp()
  ) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=0 AND NOT EXISTS (
    SELECT 1 FROM public.solved_spots_gold s
     WHERE s.id=v_row_id AND s.scenario_hash=p_artifact->>'scenario_hash'
       AND s.game_type='gto_v31_'||(p_artifact->>'game_family')
       AND s.stack_depth=(p_artifact->>'stack_depth')::integer
       AND s.street=p_artifact->>'street' AND s.strategy_matrix_v2=v_matrix
       AND s.solved_v2_at=v_solved_at
       AND s.solver_version=v_dataset.solver_version
       AND s.solver_binary_checksum=v_dataset.solver_binary_checksum
       AND s.machine_id=p_machine_id AND s.pipeline_commit=v_dataset.pipeline_commit
       AND s.pipeline_bundle_checksum=v_dataset.pipeline_bundle_checksum
       AND s.manifest_version::text=v_dataset.manifest_version
       AND s.manifest_checksum=v_dataset.manifest_checksum
       AND s.source_artifact_checksum=v_checksum AND s.quality_status='validated'
       AND s.audited_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'source artifact id was reused with another immutable payload';
  END IF;

  INSERT INTO public.gto_v31_source_artifacts (
    dataset_id,source_row_id,machine_id,scenario_hash,game_family,stack_depth,
    street,source_artifact_checksum,node_count,solved_at
  ) VALUES (
    p_dataset_id,v_row_id,p_machine_id,p_artifact->>'scenario_hash',p_artifact->>'game_family',
    (p_artifact->>'stack_depth')::integer,p_artifact->>'street',v_checksum,v_nodes,v_solved_at
  ) ON CONFLICT (dataset_id,source_row_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=0 AND NOT EXISTS (
    SELECT 1 FROM public.gto_v31_source_artifacts a
     WHERE a.dataset_id=p_dataset_id AND a.source_row_id=v_row_id
       AND a.machine_id=p_machine_id AND a.scenario_hash=p_artifact->>'scenario_hash'
       AND a.game_family=p_artifact->>'game_family'
       AND a.stack_depth=(p_artifact->>'stack_depth')::integer
       AND a.street=p_artifact->>'street' AND a.source_artifact_checksum=v_checksum
       AND a.node_count=v_nodes AND a.solved_at=v_solved_at
  ) THEN
    RAISE EXCEPTION 'source artifact receipt id was reused with another payload';
  END IF;
  RETURN jsonb_build_object('source_row_id',v_row_id,'source_artifact_checksum',v_checksum,
    'node_count',v_nodes,'idempotent',v_inserted=0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_ingest_m2(p_dataset_id uuid, p_machine_id text, p_artifact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_matrix jsonb := p_artifact->'strategy_matrix_v2';
  v_node jsonb;
  v_row_id uuid;
  v_solved_at timestamptz;
  v_checksum text;
  v_nodes integer;
  v_inserted integer;
  v_normalized_nodes jsonb := '[]'::jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF p_machine_id NOT IN ('M1','M2') OR NOT (p_machine_id=ANY(v_dataset.machine_ids))
     OR p_artifact IS NULL OR jsonb_typeof(p_artifact)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_artifact))<>7
     OR NOT (p_artifact ?& ARRAY['id','scenario_hash','game_family','stack_depth','street','solved_at','strategy_matrix_v2'])
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
         'id','scenario_hash','game_family','street','solved_at'
       ]) field(key) WHERE jsonb_typeof(p_artifact->field.key)<>'string'
     )
     OR jsonb_typeof(p_artifact->'stack_depth')<>'number'
     OR jsonb_typeof(p_artifact->'strategy_matrix_v2')<>'object'
     OR p_artifact->>'id' !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR length(COALESCE(p_artifact->>'scenario_hash','')) NOT BETWEEN 8 AND 512
     OR COALESCE(p_artifact->>'scenario_hash','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
     OR p_artifact->>'game_family' NOT IN ('cash','spin','tourney_ev','tourney_icm')
     OR NOT public.fn_gto_v31_json_safe_integer(p_artifact->'stack_depth',10,150)
     OR (p_artifact->>'stack_depth')::integer NOT IN (10,20,40,80,150)
     OR p_artifact->>'street' NOT IN ('flop','turn','river')
     OR jsonb_typeof(v_matrix)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_matrix))<>5
     OR NOT (v_matrix ?& ARRAY['schema','combo_order','nodes','selection_receipt','selection_receipt_checksum'])
     OR v_matrix->>'schema' IS DISTINCT FROM 'smarter-poker.pio-artifact.v31.1'
     OR v_matrix->>'combo_order' IS DISTINCT FROM
       'card=rank*4+suit; combo=b*(b-1)/2+a; 2c2d=0..AhAs=1325'
     OR jsonb_typeof(v_matrix->'nodes')<>'array'
     OR jsonb_array_length(v_matrix->'nodes') NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'source artifact envelope is invalid';
  END IF;
  v_row_id:=(p_artifact->>'id')::uuid;
  v_solved_at:=(p_artifact->>'solved_at')::timestamptz;
  IF v_solved_at IS NULL OR v_solved_at>now()+interval '5 minutes'
     OR v_solved_at<now()-interval '30 days' THEN
    RAISE EXCEPTION 'source artifact solved_at is outside the admission window';
  END IF;
  v_nodes:=jsonb_array_length(v_matrix->'nodes');
  FOR v_node IN SELECT value FROM jsonb_array_elements(v_matrix->'nodes') LOOP
    -- PostgreSQL owns the canonical node checksum. A worker may omit that one
    -- field, which avoids claiming that Python JSON number rendering is byte
    -- identical to PostgreSQL jsonb. A supplied checksum is still verified
    -- and can never be replaced silently.
    IF jsonb_typeof(v_node)='object'
       AND (SELECT count(*) FROM jsonb_object_keys(v_node))=11
       AND NOT (v_node?'node_checksum')
       AND (v_node ?& ARRAY['schema','node','node_context','line_proof','action_specs',
         'frequencies','policy_evs_bb','action_evs_bb','matchups',
         'source_combo_order_checksum','range_bundle_checksum']) THEN
      v_node:=v_node||jsonb_build_object(
        'node_checksum',public.fn_gto_v31_node_checksum(v_node)
      );
    END IF;
    IF jsonb_typeof(v_node)='object'
       AND v_node->>'schema'='smarter-poker.pio-policy.v4'
       AND (SELECT count(*) FROM jsonb_object_keys(v_node))=13
       AND NOT (v_node?'node_checksum')
       AND v_node ?& ARRAY['schema','node','node_context','line_proof','action_specs',
         'frequencies','policy_evs_bb','action_evs_bb','matchups',
         'source_combo_order_checksum','range_bundle_checksum','complete_public_state','solver_ranges'] THEN
      v_node:=v_node||jsonb_build_object('node_checksum',public.fn_gto_v31_node_checksum(v_node));
    END IF;
    PERFORM public.fn_gto_v31_assert_source_contract(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);
    IF NOT public.fn_gto_v31_source_node_valid(v_node)
       OR v_node#>>'{node_context,game_family}' IS DISTINCT FROM p_artifact->>'game_family'
       OR COALESCE((v_node#>>'{node_context,depth_bucket}')::integer,0)
            IS DISTINCT FROM (p_artifact->>'stack_depth')::integer
       OR v_node#>>'{node_context,street}' IS DISTINCT FROM p_artifact->>'street'
       OR v_node->>'source_combo_order_checksum' IS DISTINCT FROM v_dataset.source_combo_order_checksum
       OR v_node->>'range_bundle_checksum' IS DISTINCT FROM v_dataset.range_bundle_checksum
       OR v_node#>>'{line_proof,manifest_checksum}' IS DISTINCT FROM v_dataset.manifest_checksum THEN
      RAISE EXCEPTION 'source artifact contains an invalid or cross-dataset node';
    END IF;
    v_normalized_nodes:=v_normalized_nodes||jsonb_build_array(v_node);
  END LOOP;
  v_matrix:=jsonb_set(v_matrix,'{nodes}',v_normalized_nodes,false);
  IF (SELECT count(DISTINCT value->>'node') FROM jsonb_array_elements(v_matrix->'nodes'))<>v_nodes THEN
    RAISE EXCEPTION 'source artifact contains duplicate nodes';
  END IF;
  v_checksum:=public.fn_gto_v31_source_artifact_checksum(p_artifact->>'scenario_hash',v_matrix);

  INSERT INTO public.solved_spots_gold (
    id,scenario_hash,game_type,stack_depth,street,strategy_matrix_v2,solved_v2_at,
    solver_version,solver_binary_checksum,machine_id,pipeline_commit,pipeline_bundle_checksum,
    manifest_version,manifest_checksum,source_artifact_checksum,quality_status,audited_at
  ) VALUES (
    v_row_id,p_artifact->>'scenario_hash','gto_v31_'||(p_artifact->>'game_family'),
    (p_artifact->>'stack_depth')::integer,p_artifact->>'street',v_matrix,v_solved_at,
    v_dataset.solver_version,v_dataset.solver_binary_checksum,p_machine_id,
    v_dataset.pipeline_commit,v_dataset.pipeline_bundle_checksum,
    v_dataset.manifest_version,v_dataset.manifest_checksum,
    v_checksum,'validated',clock_timestamp()
  ) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=0 AND NOT EXISTS (
    SELECT 1 FROM public.solved_spots_gold s
     WHERE s.id=v_row_id AND s.scenario_hash=p_artifact->>'scenario_hash'
       AND s.game_type='gto_v31_'||(p_artifact->>'game_family')
       AND s.stack_depth=(p_artifact->>'stack_depth')::integer
       AND s.street=p_artifact->>'street' AND s.strategy_matrix_v2=v_matrix
       AND s.solved_v2_at=v_solved_at
       AND s.solver_version=v_dataset.solver_version
       AND s.solver_binary_checksum=v_dataset.solver_binary_checksum
       AND s.machine_id=p_machine_id AND s.pipeline_commit=v_dataset.pipeline_commit
       AND s.pipeline_bundle_checksum=v_dataset.pipeline_bundle_checksum
       AND s.manifest_version::text=v_dataset.manifest_version
       AND s.manifest_checksum=v_dataset.manifest_checksum
       AND s.source_artifact_checksum=v_checksum AND s.quality_status='validated'
       AND s.audited_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'source artifact id was reused with another immutable payload';
  END IF;

  INSERT INTO public.gto_v31_source_artifacts (
    dataset_id,source_row_id,machine_id,scenario_hash,game_family,stack_depth,
    street,source_artifact_checksum,node_count,solved_at
  ) VALUES (
    p_dataset_id,v_row_id,p_machine_id,p_artifact->>'scenario_hash',p_artifact->>'game_family',
    (p_artifact->>'stack_depth')::integer,p_artifact->>'street',v_checksum,v_nodes,v_solved_at
  ) ON CONFLICT (dataset_id,source_row_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted=0 AND NOT EXISTS (
    SELECT 1 FROM public.gto_v31_source_artifacts a
     WHERE a.dataset_id=p_dataset_id AND a.source_row_id=v_row_id
       AND a.machine_id=p_machine_id AND a.scenario_hash=p_artifact->>'scenario_hash'
       AND a.game_family=p_artifact->>'game_family'
       AND a.stack_depth=(p_artifact->>'stack_depth')::integer
       AND a.street=p_artifact->>'street' AND a.source_artifact_checksum=v_checksum
       AND a.node_count=v_nodes AND a.solved_at=v_solved_at
  ) THEN
    RAISE EXCEPTION 'source artifact receipt id was reused with another payload';
  END IF;
  RETURN jsonb_build_object('source_row_id',v_row_id,'source_artifact_checksum',v_checksum,
    'node_count',v_nodes,'idempotent',v_inserted=0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_program_identity(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('model_checksum',p->>'model_checksum','template_checksum',p->>'template_checksum','feature_schema_checksum',p->>'feature_schema_checksum','training_provenance_checksum',p->>'training_provenance_checksum','variant',p#>>'{public_model,variant}','capture_receipt_checksum',p#>>'{public_training_provenance,capture_receipt_checksum}','training_recipe_checksum',p#>>'{public_training_provenance,training_recipe_checksum}','source_partition_checksum',p#>>'{public_training_provenance,source_partition_checksum}','runtime_parity_protocol_checksum',p#>>'{public_training_provenance,runtime_parity_protocol_checksum}','encoder_checksum',p#>>'{public_training_provenance,encoder_checksum}','physics_checksum',p#>>'{public_training_provenance,physics_checksum}','dependency_lock_checksum',p#>>'{public_training_provenance,dependency_lock_checksum}')
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_selected(p_protocol jsonb, p_seed text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c jsonb;candidate jsonb;selected jsonb:='[]';ranked jsonb;ctx text;key bytea;sig text;message bytea;item jsonb;
BEGIN
 IF p_seed!~'^[0-9a-f]{64}$' OR NOT public.fn_gto_v31_public215_keys(p_protocol,ARRAY['format','boards_per_context','context_id_rule','contexts','domain_separator','physical_board_rule','rank_message','rank_order','rank_selection','reservation_checksum','seed_bytes','seed_commitment_checksum']) OR p_protocol->>'format' IS DISTINCT FROM 'public_hist215_m2_selection_protocol_v1' OR p_protocol->'boards_per_context' IS DISTINCT FROM '8'::jsonb OR p_protocol->'seed_bytes' IS DISTINCT FROM '32'::jsonb OR p_protocol->>'domain_separator' IS DISTINCT FROM 'public_hist215_m2_rank_v1' OR p_protocol->>'rank_selection' IS DISTINCT FROM 'hmac_sha256_context_rank_first8_v1' OR jsonb_typeof(p_protocol->'contexts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_protocol->'contexts')<1 THEN RAISE EXCEPTION 'invalid approved blind selection protocol/opening';END IF;
 key:=decode(p_seed,'hex');IF encode(digest(key,'sha256'),'hex') IS DISTINCT FROM p_protocol->>'seed_commitment_checksum' THEN RAISE EXCEPTION 'blind selection commitment does not match';END IF;
 IF (SELECT count(DISTINCT value->>'context_id')FROM jsonb_array_elements(p_protocol->'contexts'))<>jsonb_array_length(p_protocol->'contexts') THEN RAISE EXCEPTION 'duplicate blind selection context';END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_protocol->'contexts') LOOP
  IF NOT public.fn_gto_v31_public215_keys(c,ARRAY['context','context_id','candidates']) OR c->>'context_id' IS DISTINCT FROM public.fn_gto_v31_public215_digest(c->'context') OR jsonb_typeof(c->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'candidates')<8 OR (SELECT count(DISTINCT value->>'rank_signature')FROM jsonb_array_elements(c->'candidates'))<>jsonb_array_length(c->'candidates') THEN RAISE EXCEPTION 'invalid blind candidate domain';END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(c->'candidates') LOOP
   IF NOT public.fn_gto_v31_public215_keys(candidate,ARRAY['board','rank_signature']) OR NOT public.fn_gto_v31_public215_cards(candidate->>'board') OR candidate->>'rank_signature' IS DISTINCT FROM public.fn_gto_v31_public215_rank_signature(candidate->>'board') OR length(candidate->>'board')<>(CASE c#>>'{context,street}' WHEN 'flop' THEN 6 WHEN 'turn' THEN 8 WHEN 'river' THEN 10 ELSE 0 END) THEN RAISE EXCEPTION 'invalid canonical blind candidate board';END IF;
  END LOOP;
  SELECT jsonb_agg(value ORDER BY score,value->>'rank_signature' COLLATE "C")INTO ranked FROM(SELECT value,hmac(convert_to(p_protocol->>'domain_separator','UTF8')||decode('00','hex')||convert_to(c->>'context_id','UTF8')||decode('00','hex')||convert_to(value->>'rank_signature','UTF8'),key,'sha256')score FROM jsonb_array_elements(c->'candidates')ORDER BY score,value->>'rank_signature' COLLATE "C" LIMIT 8)q;
  FOR item IN SELECT value FROM jsonb_array_elements(ranked)LOOP selected:=selected||jsonb_build_array(jsonb_build_object('context_id',c->>'context_id','rank_signature',item->>'rank_signature','board',item->>'board'));END LOOP;
 END LOOP;
 SELECT jsonb_agg(value ORDER BY value->>'context_id' COLLATE "C",value->>'rank_signature' COLLATE "C")INTO selected FROM jsonb_array_elements(selected);RETURN selected;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_selection_receipt(p jsonb, d gto_v31_datasets, b gto_v31_input_bundles, seed text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE protocols jsonb:=b.bundle_manifest->'public215_protocols';expected jsonb;entry jsonb;approved jsonb;previous text:='';identity text;i integer:=0;k text;
BEGIN
 IF NOT public.fn_gto_v31_public215_keys(p,ARRAY['format','dataset_id','input_bundle_checksum','source_partition_checksum','selection_protocol_checksum','seed_commitment_checksum','capture_receipt_checksum','training_recipe_checksum','runtime_parity_protocol_checksum','encoder_checksum','physics_checksum','dependency_lock_checksum','feature_schema_checksum','frozen_models','selected']) OR p->>'format' IS DISTINCT FROM 'public_hist215_m2_selection_receipt_v1' OR p->>'dataset_id' IS DISTINCT FROM d.dataset_id::text OR p->>'input_bundle_checksum' IS DISTINCT FROM d.input_bundle_checksum OR p->>'source_partition_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols->'source_partition') OR p->>'selection_protocol_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols#>'{source_partition,m2_selection}') OR p->>'seed_commitment_checksum' IS DISTINCT FROM protocols#>>'{source_partition,m2_selection,seed_commitment_checksum}' OR p->>'capture_receipt_checksum' IS DISTINCT FROM(SELECT prep.identity->>'capture_receipt_checksum'FROM public.gto_v31_model_preparations prep WHERE prep.dataset_id=d.dataset_id ORDER BY prep.cell_key_checksum LIMIT 1) OR p->>'feature_schema_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(d.feature_contract_version) THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['training_recipe','runtime_parity_protocol','dependency_lock'] LOOP IF p->>(k||'_checksum') IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols->k)THEN RETURN false;END IF;END LOOP;
 IF p->>'encoder_checksum' IS DISTINCT FROM protocols#>>'{training_recipe,encoder_checksum}' OR p->>'encoder_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols#>'{training_recipe,encoder_descriptor}') OR p->>'physics_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols->'physics_protocol') THEN RETURN false;END IF;
 IF jsonb_typeof(p->'frozen_models') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'frozen_models')<>jsonb_array_length(b.bundle_manifest->'public215_contexts') THEN RETURN false;END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p->'frozen_models')LOOP
  IF NOT public.fn_gto_v31_public215_keys(entry,ARRAY['context','model_checksum','model_build_receipt_checksum','template_checksum','training_provenance_checksum']) OR entry->'context' IS DISTINCT FROM b.bundle_manifest->'public215_contexts'->i->'context' OR entry->>'template_checksum' IS DISTINCT FROM b.bundle_manifest->'public215_contexts'->i->>'template_checksum' THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['model_checksum','model_build_receipt_checksum','template_checksum','training_provenance_checksum'] LOOP IF jsonb_typeof(entry->k) IS DISTINCT FROM 'string' OR entry->>k!~'^[0-9a-f]{64}$' OR entry->>k=repeat('0',64)THEN RETURN false;END IF;END LOOP;i:=i+1;
 END LOOP;
 IF p->'frozen_models'IS DISTINCT FROM public.fn_gto_v31_public215_frozen_map(d)THEN RETURN false;END IF;
 expected:=public.fn_gto_v31_public215_selected(protocols#>'{source_partition,m2_selection}',seed);RETURN p->'selected'=expected;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_source_node_v3_valid(p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_node->>'node_checksum' IS DISTINCT FROM public.fn_gto_v31_node_checksum(p_node) THEN RETURN false; END IF;
 RETURN public.fn_gto_v31_source_node_v3_fields_valid(p_node);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_source_node_valid(p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 CASE p_node->>'schema'
 WHEN 'smarter-poker.pio-policy.v3' THEN RETURN public.fn_gto_v31_source_node_v3_valid(p_node);
 WHEN 'smarter-poker.pio-policy.v4' THEN RETURN public.fn_gto_v31_source_node_v4_valid(p_node);
 ELSE RETURN false; END CASE;
END;
$function$
;

REVOKE ALL ON FUNCTION public.fn_gto_v31_ingest_source_artifact(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_ingest_source_artifact(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_ingest_source_artifact_matrix_v2(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_ingest_m2(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_program_identity(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_selected(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_selection_receipt(jsonb,gto_v31_datasets,gto_v31_input_bundles,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_node_v3_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_node_v3_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_node_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_node_valid(jsonb) TO service_role;
SET check_function_bodies = on;
ALTER TABLE public.gto_v31_model_preparations ADD CONSTRAINT gto_v31_model_preparations_pkey PRIMARY KEY (dataset_id, cell_key_checksum);
ALTER TABLE public.gto_v31_public_selections ADD CONSTRAINT gto_v31_public_selections_pkey PRIMARY KEY (dataset_id);
ALTER TABLE public.gto_v31_public_source_journal ADD CONSTRAINT gto_v31_public_source_journal_pkey PRIMARY KEY (dataset_id, source_row_id, source_node);
ALTER TABLE public.gto_v31_model_preparations ADD CONSTRAINT gto_v31_model_preparations_check CHECK ((identity = fn_gto_v31_public215_program_identity(program)));
ALTER TABLE public.gto_v31_public_source_journal ADD CONSTRAINT gto_v31_public_source_journal_machine_id_check CHECK ((machine_id = ANY (ARRAY['M1'::text, 'M2'::text])));
CREATE TRIGGER gto_v31_model_preparations_immutable BEFORE DELETE OR UPDATE ON public.gto_v31_model_preparations FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_public215_immutable_physics();
CREATE TRIGGER gto_v31_seal_dataset_insert_guard BEFORE INSERT ON public.gto_v31_model_preparations FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_seal_dataset_insert_guard();
ALTER TABLE public.gto_v31_model_preparations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_model_preparations FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_public_selections_immutable BEFORE DELETE OR UPDATE ON public.gto_v31_public_selections FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_public215_immutable_physics();
CREATE TRIGGER gto_v31_seal_dataset_insert_guard BEFORE INSERT ON public.gto_v31_public_selections FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_seal_dataset_insert_guard();
ALTER TABLE public.gto_v31_public_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_public_selections FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_public_source_journal_immutable BEFORE DELETE OR UPDATE ON public.gto_v31_public_source_journal FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_public215_immutable_physics();
CREATE TRIGGER gto_v31_seal_dataset_insert_guard BEFORE INSERT ON public.gto_v31_public_source_journal FOR EACH ROW EXECUTE FUNCTION fn_gto_v31_seal_dataset_insert_guard();
ALTER TABLE public.gto_v31_public_source_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_public_source_journal FROM PUBLIC, anon, authenticated, service_role;

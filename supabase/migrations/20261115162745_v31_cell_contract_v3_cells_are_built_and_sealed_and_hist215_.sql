-- 20261115162745_v31_cell_contract_v3_cells_are_built_and_sealed_and_hist215_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (FLOP-5 D6, V31 cell contract v3, DORMANT):
--
-- 20261115143957 taught gto_v31_runtime_cells to hold a cell contract v3 cell
-- (cell_contract_version, line_class) and gave the engine its readers. Three
-- layers still spoke v2 only, so no v3 cell could actually be produced:
--   (1) a holdem-public-hist215-v3 model cell was not storable: the dataset,
--       bundle and cell feature-contract checks and the SQL public215
--       encoding chain knew v1 and v2 only;
--   (2) the cell builders took 13-key contexts only and wrote no line;
--   (3) the seal compared 13-key contexts, so a registered v3 round could
--       never seal (its registered cells carry cell_contract and line_class).
-- Here each layer learns v3, reached only by an input that declares it:
--
--   (1) hist215-v3 storable
--       + fn_gto_v31_public215_v3_appended (the overbet facing bucket and the
--         donk role, indices 246..247, Club Arena encodePublic215V3Appended),
--         fn_gto_v31_public215_features_v3 (v2's 246 unchanged, then the two),
--         and the v3 chain generated from the installed v2 chain (compiled_raw,
--         audit_key, prepare_audit, audit_prediction, required_audit and
--         encoding_implementation_v3 over all 27 functions); the dispatchers
--         route hist215-v3 to it; v1 and v2 dispatch exactly as before and the
--         sealed v1 / v2 encoding identities are asserted unchanged
--       + fn_gto_v31_public215_template_valid_v3 (the v2 template rules over
--         the 15-key v3 cell, with the big bucket and the donk role)
--       feature identity, request, key, hand-matrix, compact-matrix, schema,
--       schema-of, model width, template, cell-model and bundle validators and
--       the bundle checksum admit hist215-v3 (a v3 bundle's contexts are whole
--       v3 cells); the datasets, input_bundles and runtime_cells
--       feature-contract and representation constraints admit it; a
--       hist215-v3 runtime cell must be a cell contract v3 cell; an audit
--       vector may be 248 wide
--   (2) builders write v3 cells, only when asked
--       fn_gto_v31_build_cell sends a context that declares cell_contract to
--       + fn_gto_v31_build_cell_matrix_v3 / fn_gto_v31_public215_build_cell_v3,
--       generated from the installed v2 builders: the context must be a whole
--       v3 cell of the dataset's declared coverage, source nodes must carry
--       that cell's cell_contract and line_class, and the row is written with
--       cell_contract_version 'v3' and its line_class
--       + fn_gto_v31_cell_payload_valid_matrix_v3 (the matrix validator with
--       depth 200 and the donk open role, for a v3 cell only); the key and
--       payload checksums of a v3 cell bind its contract and line
--       (+ fn_gto_v31_cell_contract_identity, '{}' for every other cell), so
--       two lines of one spot are two keys; fn_gto_v31_cell_context_valid
--       admits a whole v3 cell (declared coverage of a v3 dataset)
--   (3) the seal compares v3 cells
--       fn_gto_v31_runtime_cell_context returns the v3 cell's cell_contract and
--       line_class too, so fn_gto_v31_seal_matches_registration and
--       fn_gto_v31_seal_matches_range_provenance compare a v3 cell with its
--       registration and runtime mapping; the two seal steps compare the built
--       cells with declared coverage through it; range evidence and the
--       public215 training context key a v3 source node by its v3 cell.
--
-- DORMANT AND V2-IDENTICAL. Every function changed in place returns, for every
-- input without cell_contract, a line or hist215-v3 (every row and call that
-- exists), exactly what it returned before: each change is an exact-count
-- anchor on the installed text, md5-pinned before and after, ACL unchanged;
-- the self-test below re-derives the key and 13-key seal context of every
-- existing runtime cell. Production holds no registration and no v3 dataset;
-- nothing is registered, built, sealed, promoted or bound here. 200 bb v3
-- sources still need gto_v31_source_artifacts to admit stack depth 200 (and
-- real 200 bb ranges); a v3 cell at 10..150 can be built.
--
-- Additive and safe with existing rows: no row is changed; every replaced
-- constraint is the live text with v3 added (a superset). Not a hot table;
-- no install-window header needed. Requires 20261115143957.
--
-- @live-proof: to_regprocedure('public.fn_gto_v31_build_cell_matrix_v3(uuid,jsonb)') IS NOT NULL AND public.fn_gto_v31_public215_encoding_for('holdem-public-hist215-v3')=public.fn_gto_v31_public215_encoding_implementation_v3() AND md5(pg_get_functiondef('public.fn_gto_v31_build_cell(uuid,jsonb)'::regprocedure))='48f4cbde099bfed8ba81ce9a2ecd8eaa'

BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog,public;

-- 1. Preconditions: migration 20261115143957 is installed, nothing here exists yet, and the
-- sealed v1 (R7) and v2 (R8) encoding identities are the live ones (asserted again at the end).
DO $pre$
BEGIN
  IF to_regprocedure('public.fn_gto_v31_registration_cell_contract(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.gto_v31_runtime_cells'::regclass AND attname='line_class' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'migration 20261115143957 (runtime cells store cell contract v3) must be installed first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
     ('fn_gto_v31_cell_contract_identity','fn_gto_v31_public215_v3_appended','fn_gto_v31_public215_features_v3',
      'fn_gto_v31_public215_encoding_implementation_v3','fn_gto_v31_build_cell_matrix_v3','fn_gto_v31_public215_build_cell_v3')) THEN
    RAISE EXCEPTION 'the cell contract v3 build layer already exists';
  END IF;
  IF public.fn_gto_v31_public215_encoding_implementation() IS DISTINCT FROM '1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d' THEN
    RAISE EXCEPTION 'the sealed v1 encoding identity is not the live one (%)', public.fn_gto_v31_public215_encoding_implementation();
  END IF;
  -- The v2 identity hashes its 20 definitions in the database's collation order (production
  -- 8dc267e3...); it is recorded here and must be identical at the end.
  PERFORM set_config('ca.d6_encoding_v2', public.fn_gto_v31_public215_encoding_implementation_v2(), true);
  IF EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE feature_contract_version='holdem-public-hist215-v3')
     OR EXISTS (SELECT 1 FROM public.gto_v31_datasets WHERE feature_contract_version='holdem-public-hist215-v3') THEN
    RAISE EXCEPTION 'a hist215-v3 row already exists';
  END IF;
END
$pre$;

-- 2. New functions.
-- The cell-contract identity a v3 cell adds to its key, payload and seal context; '{}' for every
-- cell without cell_contract_version 'v3' (every cell that exists), so those keep their bytes.
-- Same ACL as fn_gto_v31_feature_identity, which the key checksum also calls.
CREATE FUNCTION public.fn_gto_v31_cell_contract_identity(p_cell jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE WHEN p_cell->>'cell_contract_version' = 'v3'
              THEN jsonb_build_object('cell_contract', 'v3', 'line_class', p_cell->'line_class')
              ELSE '{}'::jsonb END
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_contract_identity(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_cell_contract_identity(jsonb) TO service_role;

-- Feature contract v3 block (indices 246..247): one-hot of the exact public context category, zero
-- otherwise. Same rule and order as Club Arena encodePublic215V3Appended / PUBLIC_HIST215_V3_APPENDED
-- (and the v2 block's rule): cell_contract and line_class are context keys that name no category.
CREATE FUNCTION public.fn_gto_v31_public215_v3_appended(p_template jsonb)
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE appended text[]:=ARRAY['facing_size_bucket=big','node_role=donk'];present text[]:=ARRAY[]::text[];k text;val jsonb;out double precision[]:=ARRAY[]::double precision[];
BEGIN
 FOR k,val IN SELECT key,value FROM jsonb_each(p_template->'context') LOOP IF k NOT IN('texture_class','depth_bucket','table_size') THEN present:=array_append(present,k||'='||(val#>>'{}'));END IF;END LOOP;
 FOREACH k IN ARRAY appended LOOP out:=array_append(out,CASE WHEN k=ANY(present) THEN 1::double precision ELSE 0::double precision END);END LOOP;
 IF cardinality(out)<>2 THEN RAISE EXCEPTION 'public215 v3 appended shape';END IF;RETURN out;
END $function$;

CREATE FUNCTION public.fn_gto_v31_public215_features_v3(p_combo integer, p_board text, p_template jsonb, p_mass numeric[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE out double precision[];
BEGIN
 -- v2's 246 features unchanged in place (v1's 215, then the v2 block), then the v3 block.
 out:=public.fn_gto_v31_public215_features_v2(p_combo,p_board,p_template,p_mass)||public.fn_gto_v31_public215_v3_appended(p_template);
 IF cardinality(out)<>248 THEN RAISE EXCEPTION 'public215 v3 full feature shape';END IF;RETURN out;
END $function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_v3_appended(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_features_v3(integer,text,jsonb,numeric[]) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Generated v3 siblings: each is the installed text of its v2 source with exact-count anchors
-- replaced, so a v2 source that differs from the reviewed one refuses the whole migration. The
-- chain refers to itself (encoding_implementation_v3 names audit_key_v3, which calls it), so bodies
-- are checked by the self-test at the end. ACL: the source's (owner only).
SET LOCAL check_function_bodies=off;
DO $siblings$
DECLARE r record; e jsonb; def text; hits integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_public215_compiled_raw_v2(gto_v31_public215_head[],double precision[])'::regprocedure, '41825de5edd49220e0912efa81cbd61a', 'public.fn_gto_v31_public215_compiled_raw_v3(gto_v31_public215_head[],double precision[])',
     '[["FUNCTION public.fn_gto_v31_public215_compiled_raw_v2(", "FUNCTION public.fn_gto_v31_public215_compiled_raw_v3(", 1], ["cardinality(p_x)<>246", "cardinality(p_x)<>248", 1], ["''public215 finite246 vector''", "''public215 finite248 vector''", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text)'::regprocedure, '1fea57f3f7c03587d6cd2cb221fdb0c8', 'public.fn_gto_v31_public215_audit_key_v3(text,text,text[],text)',
     '[["FUNCTION public.fn_gto_v31_public215_audit_key_v2(", "FUNCTION public.fn_gto_v31_public215_audit_key_v3(", 1], ["''public_hist215_audit_v2''", "''public_hist215_audit_v3''", 1], ["public.fn_gto_v31_public215_encoding_implementation_v2()", "public.fn_gto_v31_public215_encoding_implementation_v3()", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_prepare_audit_v2(gto_v31_runtime_cells,text[])'::regprocedure, '07e5e4cf21c6b7cd233d7063611ac19d', 'public.fn_gto_v31_public215_prepare_audit_v3(gto_v31_runtime_cells,text[])',
     '[["FUNCTION public.fn_gto_v31_public215_prepare_audit_v2(", "FUNCTION public.fn_gto_v31_public215_prepare_audit_v3(", 1], ["''holdem-public-hist215-v2''", "''holdem-public-hist215-v3''", 1], ["public.fn_gto_v31_public215_audit_key_v2(", "public.fn_gto_v31_public215_audit_key_v3(", 1], ["public.fn_gto_v31_public215_encoding_implementation_v2()", "public.fn_gto_v31_public215_encoding_implementation_v3()", 3], ["public.fn_gto_v31_public215_features_v2(", "public.fn_gto_v31_public215_features_v3(", 1], ["public.fn_gto_v31_public215_compiled_raw_v2(", "public.fn_gto_v31_public215_compiled_raw_v3(", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_audit_prediction_v2(gto_v31_runtime_cells,text,integer)'::regprocedure, 'f0423d01b18109ab322ccfa84974d2a6', 'public.fn_gto_v31_public215_audit_prediction_v3(gto_v31_runtime_cells,text,integer)',
     '[["FUNCTION public.fn_gto_v31_public215_audit_prediction_v2(", "FUNCTION public.fn_gto_v31_public215_audit_prediction_v3(", 1], ["''holdem-public-hist215-v2''", "''holdem-public-hist215-v3''", 1], ["public.fn_gto_v31_public215_audit_key_v2(", "public.fn_gto_v31_public215_audit_key_v3(", 1], ["public.fn_gto_v31_public215_encoding_implementation_v2()", "public.fn_gto_v31_public215_encoding_implementation_v3()", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_required_audit_v2(gto_v31_runtime_cells,text)'::regprocedure, '72ec4bc568ffdb127ac81dba2fb34f6a', 'public.fn_gto_v31_public215_required_audit_v3(gto_v31_runtime_cells,text)',
     '[["FUNCTION public.fn_gto_v31_public215_required_audit_v2(", "FUNCTION public.fn_gto_v31_public215_required_audit_v3(", 1], ["''holdem-public-hist215-v2''", "''holdem-public-hist215-v3''", 1], ["''public215 v2 cell required''", "''public215 v3 cell required''", 1], ["public.fn_gto_v31_public215_audit_key_v2(", "public.fn_gto_v31_public215_audit_key_v3(", 1], ["public.fn_gto_v31_public215_encoding_implementation_v2()", "public.fn_gto_v31_public215_encoding_implementation_v3()", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_encoding_implementation_v2()'::regprocedure, 'e9d65fc19e9283f9d5b385b32d7d53ba', 'public.fn_gto_v31_public215_encoding_implementation_v3()',
     '[["FUNCTION public.fn_gto_v31_public215_encoding_implementation_v2(", "FUNCTION public.fn_gto_v31_public215_encoding_implementation_v3(", 1], ["''public.fn_gto_v31_public215_required_audit_v2(public.gto_v31_runtime_cells,text)''::regprocedure)", "''public.fn_gto_v31_public215_required_audit_v2(public.gto_v31_runtime_cells,text)''::regprocedure,''public.fn_gto_v31_public215_v3_appended(jsonb)''::regprocedure,''public.fn_gto_v31_public215_features_v3(integer,text,jsonb,numeric[])''::regprocedure,''public.fn_gto_v31_public215_compiled_raw_v3(public.gto_v31_public215_head[],double precision[])''::regprocedure,''public.fn_gto_v31_public215_audit_key_v3(text,text,text[],text)''::regprocedure,''public.fn_gto_v31_public215_prepare_audit_v3(public.gto_v31_runtime_cells,text[])''::regprocedure,''public.fn_gto_v31_public215_audit_prediction_v3(public.gto_v31_runtime_cells,text,integer)''::regprocedure,''public.fn_gto_v31_public215_required_audit_v3(public.gto_v31_runtime_cells,text)''::regprocedure)", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_template_valid_v2(jsonb)'::regprocedure, '648e632f4932607e1601281ebeef0c4b', 'public.fn_gto_v31_public215_template_valid_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_public215_template_valid_v2(", "FUNCTION public.fn_gto_v31_public215_template_valid_v3(", 1], ["''texture_class'',''node_role'',''facing_kind'',''facing_size_bucket'']) OR NOT pu", "''texture_class'',''node_role'',''facing_kind'',''facing_size_bucket'',''cell_contract'',''line_class'']) OR public.fn_gto_v31_cell_contract_v3_error(c) IS NOT NULL OR NOT pu", 1], ["WHERE key NOT IN(''depth_bucket'',''table_size'',''texture_class'') LOOP", "WHERE key NOT IN(''depth_bucket'',''table_size'',''texture_class'',''cell_contract'',''line_class'') LOOP", 1], ["''facing_raise'',''open'',''probe'') WHEN ''pot_type''", "''facing_raise'',''open'',''probe'',''donk'') WHEN ''pot_type''", 1], ["WHEN ''facing_size_bucket'' THEN v#>>''{}'' IN(''all_in'',''mid'',''none'',''small'')", "WHEN ''facing_size_bucket'' THEN v#>>''{}'' IN(''all_in'',''big'',''mid'',''none'',''small'')", 1]]'::jsonb),
    ('public.fn_gto_v31_cell_payload_valid_matrix_v2(jsonb)'::regprocedure, 'c5f90f180a99e1a5b662b7b7d1604c9a', 'public.fn_gto_v31_cell_payload_valid_matrix_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_cell_payload_valid_matrix_v2(", "FUNCTION public.fn_gto_v31_cell_payload_valid_matrix_v3(", 1], ["     OR COALESCE((p_cell->>''depth_bucket'')::integer,0) NOT IN (10,20,40,80,150)\n", "     OR COALESCE((p_cell->>''depth_bucket'')::integer,0) NOT IN (10,20,40,80,150,200)\n     OR p_cell->>''cell_contract_version'' IS DISTINCT FROM ''v3''\n     OR public.fn_gto_v31_cell_contract_v3_error(public.fn_gto_v31_public215_context(p_cell - ''cell_contract'')\n          || jsonb_build_object(''cell_contract'',''v3'',''line_class'',p_cell->''line_class'')) IS NOT NULL\n", 1], ["     OR COALESCE(v_role,'''') NOT IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''facing_bet'',''facing_raise'',''check_raise'',''bet_raise'',''all_in'')\n", "     OR COALESCE(v_role,'''') NOT IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''donk'',''facing_bet'',''facing_raise'',''check_raise'',''bet_raise'',''all_in'')\n", 1], ["IF v_role IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'') THEN", "IF v_role IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''donk'') THEN", 2]]'::jsonb),
    ('public.fn_gto_v31_build_cell_matrix_v2(uuid,jsonb)'::regprocedure, '0bfd692589785b6fc3e36f4d48a41b13', 'public.fn_gto_v31_build_cell_matrix_v3(uuid,jsonb)',
     '[["FUNCTION public.fn_gto_v31_build_cell_matrix_v2(", "FUNCTION public.fn_gto_v31_build_cell_matrix_v3(", 1], ["  IF p_context IS NULL OR jsonb_typeof(p_context)<>''object''\n     OR (SELECT count(*) FROM jsonb_object_keys(p_context))<>13\n     OR NOT (p_context ?& ARRAY[''street'',''game_family'',''objective'',''utility_context'',\n       ''table_size'',''pot_type'',''hero_position'',''opponent_position'',''depth_bucket'',\n       ''texture_class'',''node_role'',''facing_kind'',''facing_size_bucket'']) THEN\n    RAISE EXCEPTION ''compact cell context is invalid'';\n  END IF;", "  -- Cell contract v3 (FLOP-5 D6): the context is a whole v3 cell (13 keys, cell_contract, line_class).\n  IF NOT (jsonb_typeof(p_context)=''object'' AND p_context ? ''cell_contract'') OR public.fn_gto_v31_cell_context_valid(p_context) IS NOT TRUE THEN\n    RAISE EXCEPTION ''cell contract v3 cell context is invalid: %'', COALESCE(public.fn_gto_v31_cell_contract_v3_error(p_context),''not a valid V31 cell'');\n  END IF;", 1], ["     AND c.facing_size_bucket=p_context->>''facing_size_bucket'';", "     AND c.facing_size_bucket=p_context->>''facing_size_bucket''\n     AND c.cell_contract_version=''v3'' AND c.line_class=p_context->>''line_class'';", 1], ["       AND n.value#>>''{node_context,facing_size_bucket}''=p_context->>''facing_size_bucket''\n", "       AND n.value#>>''{node_context,facing_size_bucket}''=p_context->>''facing_size_bucket''\n       AND n.value#>>''{node_context,cell_contract}''=''v3''\n       AND n.value#>>''{node_context,line_class}''=p_context->>''line_class''\n", 1], ["  v_cell:=p_context||public.fn_gto_v31_feature_identity(", "  v_cell:=(p_context-''cell_contract'')||jsonb_build_object(''cell_contract_version'',''v3'')||public.fn_gto_v31_feature_identity(", 1], ["lineage_checksum,feature_contract_version,policy_export_schema\n  ) VALUES (", "lineage_checksum,feature_contract_version,policy_export_schema,cell_contract_version,line_class\n  ) VALUES (", 1], ["v_cell->>''lineage_checksum'',v_dataset.feature_contract_version,v_dataset.policy_export_schema\n  );", "v_cell->>''lineage_checksum'',v_dataset.feature_contract_version,v_dataset.policy_export_schema,''v3'',v_cell->>''line_class''\n  );", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_build_cell(uuid,jsonb)'::regprocedure, '39abfd440672a0c35e909794dbfa226a', 'public.fn_gto_v31_public215_build_cell_v3(uuid,jsonb)',
     '[["FUNCTION public.fn_gto_v31_public215_build_cell(", "FUNCTION public.fn_gto_v31_public215_build_cell_v3(", 1], ["  IF p_context IS NULL OR jsonb_typeof(p_context)<>''object''\n     OR (SELECT count(*) FROM jsonb_object_keys(p_context))<>13\n     OR NOT (p_context ?& ARRAY[''street'',''game_family'',''objective'',''utility_context'',\n       ''table_size'',''pot_type'',''hero_position'',''opponent_position'',''depth_bucket'',\n       ''texture_class'',''node_role'',''facing_kind'',''facing_size_bucket'']) THEN\n    RAISE EXCEPTION ''compact cell context is invalid'';\n  END IF;", "  -- Cell contract v3 (FLOP-5 D6): the context is a whole v3 cell (13 keys, cell_contract, line_class).\n  IF NOT (jsonb_typeof(p_context)=''object'' AND p_context ? ''cell_contract'') OR public.fn_gto_v31_cell_context_valid(p_context) IS NOT TRUE THEN\n    RAISE EXCEPTION ''cell contract v3 cell context is invalid: %'', COALESCE(public.fn_gto_v31_cell_contract_v3_error(p_context),''not a valid V31 cell'');\n  END IF;", 1], ["     AND c.facing_size_bucket=p_context->>''facing_size_bucket'';", "     AND c.facing_size_bucket=p_context->>''facing_size_bucket''\n     AND c.cell_contract_version=''v3'' AND c.line_class=p_context->>''line_class'';", 1], ["       AND n.value#>>''{node_context,facing_size_bucket}''=p_context->>''facing_size_bucket''\n", "       AND n.value#>>''{node_context,facing_size_bucket}''=p_context->>''facing_size_bucket''\n       AND n.value#>>''{node_context,cell_contract}''=''v3''\n       AND n.value#>>''{node_context,line_class}''=p_context->>''line_class''\n", 1], ["  v_cell:=p_context||v_envelope-''context''||", "  v_cell:=p_context||jsonb_build_object(''cell_contract_version'',''v3'')||v_envelope-''context''||", 1], ["model_build_receipt_checksum,sql_physics_checksum\n  ) VALUES (", "model_build_receipt_checksum,sql_physics_checksum,cell_contract_version,line_class\n  ) VALUES (", 1], ["v_modelcell.model_build_receipt_checksum,v_modelcell.sql_physics_checksum\n  );", "v_modelcell.model_build_receipt_checksum,v_modelcell.sql_physics_checksum,''v3'',p_context->>''line_class''\n  );", 1]]'::jsonb)
  ) AS p(src, pre_md5, dst, anchors) LOOP
    def := pg_get_functiondef(r.src);
    IF md5(def) IS DISTINCT FROM r.pre_md5 THEN RAISE EXCEPTION '% preimage changed (md5 %), refusing to generate %', r.src, md5(def), r.dst; END IF;
    IF to_regprocedure(r.dst) IS NOT NULL THEN RAISE EXCEPTION '% already exists', r.dst; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(r.anchors) LOOP
      hits := (length(def) - length(replace(def, e->>0, ''))) / length(e->>0);
      IF hits <> (e->>2)::integer THEN RAISE EXCEPTION '% anchor found % times, expected %: %', r.src, hits, e->>2, left(e->>0, 80); END IF;
      def := replace(def, e->>0, e->>1);
    END LOOP;
    EXECUTE def;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.dst);
    IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.dst)) IS DISTINCT FROM (SELECT proacl::text FROM pg_proc WHERE oid = r.src) THEN
      RAISE EXCEPTION '% ACL % is not its source ACL', r.dst, (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.dst));
    END IF;
  END LOOP;
END
$siblings$;

-- 4. In-place patches: exact-count anchors on the installed text, preimage md5 pinned, ACL unchanged.
-- Each one returns, for every input it accepted before (no cell_contract, no line, no hist215-v3),
-- exactly what it returned before; the self-test below and the native proof check it.
DO $patch$
DECLARE r record; e jsonb; def text; hits integer; acl text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_cell_key_checksum(jsonb)'::regprocedure, 'f792e7ea0d7c1e745a91090232431912',
     '[["||public.fn_gto_v31_policy_identity(p_cell->>''policy_export_schema''));", "||public.fn_gto_v31_policy_identity(p_cell->>''policy_export_schema'')||public.fn_gto_v31_cell_contract_identity(p_cell));", 1]]'::jsonb),
    ('public.fn_gto_v31_cell_payload_checksum(jsonb)'::regprocedure, '3460e2a33f90651c772833fe5ee51986',
     '[[" ''lineage_checksum'',p_cell->''lineage_checksum'');", " ''lineage_checksum'',p_cell->''lineage_checksum'')||public.fn_gto_v31_cell_contract_identity(p_cell);", 1]]'::jsonb),
    ('public.fn_gto_v31_runtime_cell_context(gto_v31_runtime_cells)'::regprocedure, 'd286ae723b6c6ceb96308d8e18572226',
     '[["''facing_kind'',c.facing_kind,''facing_size_bucket'',c.facing_size_bucket)\n$function$", "''facing_kind'',c.facing_kind,''facing_size_bucket'',c.facing_size_bucket)\n    ||public.fn_gto_v31_cell_contract_identity(jsonb_build_object(''cell_contract_version'',c.cell_contract_version,''line_class'',c.line_class))\n$function$", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_context(jsonb)'::regprocedure, '0018d1e5a3857e36075b6fc1d450b15f',
     '[[" SELECT jsonb_object_agg(k,p->k)FROM unnest(", " SELECT jsonb_object_agg(k,p->k)||CASE WHEN p->>''cell_contract''=''v3'' THEN jsonb_build_object(''cell_contract'',p->''cell_contract'',''line_class'',p->''line_class'') ELSE ''{}''::jsonb END FROM unnest(", 1]]'::jsonb),
    ('public.fn_gto_v31_record_range_evidence()'::regprocedure, '4649021f158cfa64115c4a04382d72b5',
     '[["    SELECT jsonb_object_agg(k, n->''node_context''->k) INTO v_cell", "    SELECT jsonb_object_agg(k, n->''node_context''->k)\n           || CASE WHEN n#>>''{node_context,cell_contract}'' = ''v3'' THEN jsonb_build_object(''cell_contract'', ''v3'', ''line_class'', n#>''{node_context,line_class}'') ELSE ''{}''::jsonb END INTO v_cell", 1]]'::jsonb),
    ('public.fn_gto_v31_cell_payload_valid(jsonb)'::regprocedure, '5f46b49de2039354c11a5e1d53688e43',
     '[[" IF COALESCE(p_cell->>''policy_representation'',''matrix_v2'')=''matrix_v2'' THEN RETURN public.fn_gto_v31_cell_payload_valid_matrix_v2(p_cell);END IF;", " IF COALESCE(p_cell->>''policy_representation'',''matrix_v2'')=''matrix_v2'' THEN RETURN CASE WHEN p_cell->>''cell_contract_version''=''v3'' THEN public.fn_gto_v31_cell_payload_valid_matrix_v3(p_cell) ELSE public.fn_gto_v31_cell_payload_valid_matrix_v2(p_cell) END;END IF;", 1], [" IF public.fn_gto_v31_public215_cell_model_valid(p_cell) IS NOT TRUE OR", " IF public.fn_gto_v31_public215_cell_model_valid(p_cell) IS NOT TRUE OR (p_cell->>''feature_contract_version''=''holdem-public-hist215-v3'') IS DISTINCT FROM (COALESCE(p_cell->>''cell_contract_version'','''')=''v3'') OR", 1]]'::jsonb),
    ('public.fn_gto_v31_cell_context_valid(jsonb)'::regprocedure, 'b11c35a91be4df5f230f8578c4d4ccbe',
     '[["BEGIN\n  IF p_context IS NULL OR jsonb_typeof(p_context) <> ''object''", "BEGIN\n  -- Cell contract v3 (FLOP-5 D6): a context that declares cell_contract is valid only as a whole v3\n  -- cell whose 13 v2 keys are valid when its 200 bb bucket reads as 150 and its donk role as open.\n  IF jsonb_typeof(p_context) = ''object'' AND p_context ? ''cell_contract'' THEN\n    RETURN public.fn_gto_v31_cell_contract_v3_error(p_context) IS NULL\n       AND public.fn_gto_v31_cell_context_valid((p_context - ''cell_contract'' - ''line_class'') || jsonb_build_object(\n             ''depth_bucket'', CASE WHEN p_context->''depth_bucket'' = ''200''::jsonb THEN ''150''::jsonb ELSE p_context->''depth_bucket'' END,\n             ''node_role'', CASE WHEN p_context->''node_role'' = ''\"donk\"''::jsonb THEN ''\"open\"''::jsonb ELSE p_context->''node_role'' END));\n  END IF;\n  IF p_context IS NULL OR jsonb_typeof(p_context) <> ''object''", 1]]'::jsonb),
    ('public.fn_gto_v31_feature_identity(text)'::regprocedure, '1d9d5f3c1847f328e839fa85e53313ee',
     '[["''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN RAISE EXCEPTION ''unknown feature", "''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'') THEN RAISE EXCEPTION ''unknown feature", 1]]'::jsonb),
    ('public.fn_gto_v31_feature_request_valid(jsonb)'::regprocedure, '32062f63cc21fec8331b3e11f27a4960',
     '[["''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')),false)", "''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'')),false)", 1]]'::jsonb),
    ('public.fn_gto_v31_feature_key(integer,text,text)'::regprocedure, 'baf697018bb5f0ee8763eeac6363c0a7',
     '[["IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN RAISE", "IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'') THEN RAISE", 1]]'::jsonb),
    ('public.fn_gto_v31_hand_matrix_valid(jsonb,text,text)'::regprocedure, '44039f9cc6eca89b8c48efd09ce685d0',
     '[["IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN", "IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'') THEN", 1]]'::jsonb),
    ('public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure, '5cd5b1e9595700c73f7931b27e6d3189',
     '[["IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN", "IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'') THEN", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_feature_schema(text)'::regprocedure, 'a09b1583b8b8e74616c78732c14999db',
     '[["WHEN ''holdem-public-hist215-v2'' THEN ''c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4'' END", "WHEN ''holdem-public-hist215-v2'' THEN ''c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4'' WHEN ''holdem-public-hist215-v3'' THEN ''26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784'' END", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_feature_contract_of_schema(text)'::regprocedure, 'c6e64549683b5f11e06d0bba4691e116',
     '[["THEN ''holdem-public-hist215-v2'' END", "THEN ''holdem-public-hist215-v2'' WHEN ''26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784'' THEN ''holdem-public-hist215-v3'' END", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_model_width(text)'::regprocedure, '067fece1cedd9a6bc80712f92b1ba034',
     '[["THEN 246 ELSE 215 END", "THEN 246 WHEN p_schema=''26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784'' THEN 248 ELSE 215 END", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_template_valid_for(jsonb,text)'::regprocedure, 'c50ecaf351de515141552f182ebbbfcc',
     '[["WHEN ''holdem-public-hist215-v2'' THEN public.fn_gto_v31_public215_template_valid_v2(p) ELSE false END", "WHEN ''holdem-public-hist215-v2'' THEN public.fn_gto_v31_public215_template_valid_v2(p)\n                       WHEN ''holdem-public-hist215-v3'' THEN public.fn_gto_v31_public215_template_valid_v3(p) ELSE false END", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_cell_model_valid(jsonb)'::regprocedure, '0786354a0288c663eb50df2847a2c81b',
     '[["p->>''feature_contract_version'' NOT IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')", "p->>''feature_contract_version'' NOT IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'')", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_bundle_valid(jsonb)'::regprocedure, 'a7092080d9e7c8af9080bb0d13408a17',
     '[["p->>''feature_contract_version'' NOT IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')", "p->>''feature_contract_version'' NOT IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'')", 1], ["OR (SELECT count(*)FROM jsonb_object_keys(context_entry->''context''))<>13 OR", "OR (SELECT count(*)FROM jsonb_object_keys(context_entry->''context''))<>(CASE WHEN p->>''feature_contract_version''=''holdem-public-hist215-v3'' THEN 15 ELSE 13 END) OR (p->>''feature_contract_version''=''holdem-public-hist215-v3'' AND public.fn_gto_v31_cell_contract_v3_error(context_entry->''context'') IS NOT NULL) OR", 1]]'::jsonb),
    ('public.fn_gto_v31_input_bundle_checksum(jsonb)'::regprocedure, '5521c369ae46e18456804f71d38679bd',
     '[["IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')AND", "IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'',''holdem-public-hist215-v3'')AND", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_encoding_for(text)'::regprocedure, 'a31e2394c580df6bc1b22f11f70a8289',
     '[[" ELSE public.fn_gto_v31_public215_encoding_implementation() END", " WHEN p_version=''holdem-public-hist215-v3'' THEN public.fn_gto_v31_public215_encoding_implementation_v3() ELSE public.fn_gto_v31_public215_encoding_implementation() END", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text)'::regprocedure, '197ff9246c9f7d139c898c5a2bd9c019',
     '[[" ELSE public.fn_gto_v31_public215_audit_key(", " WHEN p_version=''holdem-public-hist215-v3'' THEN public.fn_gto_v31_public215_audit_key_v3(p_model_checksum,p_template_checksum,p_board,p_physics_key) ELSE public.fn_gto_v31_public215_audit_key(", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[])'::regprocedure, '3b00a8c00c8f8bf4846b2e22c95d937c',
     '[["BEGIN\n IF p_cell.feature_contract_version=''holdem-public-hist215-v2''", "BEGIN\n IF p_cell.feature_contract_version=''holdem-public-hist215-v3'' THEN RETURN public.fn_gto_v31_public215_prepare_audit_v3(p_cell,p_board);END IF;\n IF p_cell.feature_contract_version=''holdem-public-hist215-v2''", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer)'::regprocedure, 'db74194beab005ea6226fd306e503c24',
     '[["BEGIN\n IF p_cell.feature_contract_version=''holdem-public-hist215-v2''", "BEGIN\n IF p_cell.feature_contract_version=''holdem-public-hist215-v3'' THEN RETURN public.fn_gto_v31_public215_audit_prediction_v3(p_cell,p_board,p_combo);END IF;\n IF p_cell.feature_contract_version=''holdem-public-hist215-v2''", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text)'::regprocedure, '0a95e324a6d12dd1421f8cd891fd3cd1',
     '[["BEGIN\n IF p_cell.feature_contract_version=''holdem-public-hist215-v2''", "BEGIN\n IF p_cell.feature_contract_version=''holdem-public-hist215-v3'' THEN RETURN public.fn_gto_v31_public215_required_audit_v3(p_cell,p_board);END IF;\n IF p_cell.feature_contract_version=''holdem-public-hist215-v2''", 1]]'::jsonb),
    ('public.fn_gto_v31_build_cell(uuid,jsonb)'::regprocedure, '7f2ecfd68f3fd56e0ad31f62a460a091',
     '[["BEGIN\n IF EXISTS(", "BEGIN\n -- Cell contract v3 (FLOP-5 D6): only a context (or a public215 envelope context) that declares\n -- cell_contract reaches the v3 builders; every other call takes the original dispatch below.\n IF jsonb_typeof(p_context)=''object'' AND (p_context ? ''cell_contract'' OR (jsonb_typeof(p_context->''context'')=''object'' AND p_context->''context'' ? ''cell_contract'')) THEN\n  IF EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation=''public_hist215_v1'') THEN RETURN public.fn_gto_v31_public215_build_cell_v3(p_dataset_id,p_context);END IF;RETURN public.fn_gto_v31_build_cell_matrix_v3(p_dataset_id,p_context);\n END IF;\n IF EXISTS(", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure, 'e6fe02f6e420574aba480ad651ea7cb0',
     '[["d.value=jsonb_build_object(\n             ''street'',c.street,''game_family'',c.game_family,''objective'',c.objective,\n             ''utility_context'',c.utility_context,''table_size'',c.table_size,\n             ''pot_type'',c.pot_type,''hero_position'',c.hero_position,\n             ''opponent_position'',c.opponent_position,''depth_bucket'',c.depth_bucket,\n             ''texture_class'',c.texture_class,''node_role'',c.node_role,\n             ''facing_kind'',c.facing_kind,''facing_size_bucket'',c.facing_size_bucket)", "d.value=public.fn_gto_v31_runtime_cell_context(c)", 2]]'::jsonb),
    ('public.fn_gto_v31_seal_build_legacy_v31(uuid)'::regprocedure, 'dfb563c4d50fa1485fab7e9887634f30',
     '[["d.value=jsonb_build_object(\n             ''street'',c.street,''game_family'',c.game_family,''objective'',c.objective,\n             ''utility_context'',c.utility_context,''table_size'',c.table_size,\n             ''pot_type'',c.pot_type,''hero_position'',c.hero_position,\n             ''opponent_position'',c.opponent_position,''depth_bucket'',c.depth_bucket,\n             ''texture_class'',c.texture_class,''node_role'',c.node_role,\n             ''facing_kind'',c.facing_kind,''facing_size_bucket'',c.facing_size_bucket)", "d.value=public.fn_gto_v31_runtime_cell_context(c)", 2]]'::jsonb)
  ) AS p(fn, pre_md5, anchors) LOOP
    def := pg_get_functiondef(r.fn);
    IF md5(def) IS DISTINCT FROM r.pre_md5 THEN RAISE EXCEPTION '% preimage changed (md5 %), refusing to patch', r.fn, md5(def); END IF;
    acl := (SELECT proacl::text FROM pg_proc WHERE oid = r.fn);
    FOR e IN SELECT value FROM jsonb_array_elements(r.anchors) LOOP
      hits := (length(def) - length(replace(def, e->>0, ''))) / length(e->>0);
      IF hits <> (e->>2)::integer THEN RAISE EXCEPTION '% anchor found % times, expected %: %', r.fn, hits, e->>2, left(e->>0, 80); END IF;
      def := replace(def, e->>0, e->>1);
    END LOOP;
    EXECUTE def;
    IF (SELECT proacl::text FROM pg_proc WHERE oid = r.fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION '% ACL changed', r.fn; END IF;
  END LOOP;
END
$patch$;
SET LOCAL check_function_bodies=on;

-- 5. Constraints: holdem-public-hist215-v3 is a storable feature contract (each replaced constraint is
-- the live text with v3 added, a superset for every existing row), a hist215-v3 cell is a cell
-- contract v3 cell, and an audit vector may be 248 wide (NOT VALID like its predecessor: every
-- existing row is 215 or 246 wide, and re-validating 2.4M rows would exceed the applier's budget).
DO $conpre$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('gto_v31_datasets', 'gto_v31_datasets_feature_contract_version_check', '3bc5db28253e89ca5e32c0e9af0fb571'),
    ('gto_v31_datasets', 'gto_v31_datasets_numeric_representation_identity_chk', '7a0e4fcf8c246c00854fd683850e4a70'),
    ('gto_v31_input_bundles', 'gto_v31_input_bundles_feature_contract_version_check', '3bc5db28253e89ca5e32c0e9af0fb571'),
    ('gto_v31_input_bundles', 'gto_v31_input_bundles_numeric_representation_identity_chk', '7a0e4fcf8c246c00854fd683850e4a70'),
    ('gto_v31_runtime_cells', 'gto_v31_runtime_cells_feature_contract_version_check', '3bc5db28253e89ca5e32c0e9af0fb571'),
    ('gto_v31_runtime_cells', 'gto_v31_runtime_cells_numeric_representation_identity_chk', '7a0e4fcf8c246c00854fd683850e4a70'),
    ('gto_v31_runtime_cells', 'gto_v31_runtime_cells_representation_payload_chk', '6ba0e8f21b2e9dc92ea756179f1ea618'),
    ('gto_v31_public_model_audit_combos', 'gto_v31_public_model_audit_combos_features_check', '54debde89c14d895ae7caf97a0e5c8e1')
  ) AS p(tbl, con, pre_md5) LOOP
    IF (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c WHERE c.conrelid = ('public.' || r.tbl)::regclass AND c.conname = r.con)
       IS DISTINCT FROM r.pre_md5 THEN
      RAISE EXCEPTION '%.% preimage changed, refusing to replace it', r.tbl, r.con;
    END IF;
  END LOOP;
END
$conpre$;
ALTER TABLE public.gto_v31_datasets
  DROP CONSTRAINT gto_v31_datasets_feature_contract_version_check,
  ADD CONSTRAINT gto_v31_datasets_feature_contract_version_check CHECK ((feature_contract_version = ANY (ARRAY['rank-suit-count-v1'::text, 'holdem-board-relative-v2'::text, 'holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text]))),
  DROP CONSTRAINT gto_v31_datasets_numeric_representation_identity_chk,
  ADD CONSTRAINT gto_v31_datasets_numeric_representation_identity_chk CHECK ((((feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v1'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v3'::text) AND (COALESCE(policy_representation, 'matrix_v2'::text) = 'matrix_v2'::text)) OR ((feature_contract_version = ANY (ARRAY['holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text])) AND (policy_representation = 'public_hist215_v1'::text) AND (policy_export_schema = 'smarter-poker.pio-policy.v4'::text))));
ALTER TABLE public.gto_v31_input_bundles
  DROP CONSTRAINT gto_v31_input_bundles_feature_contract_version_check,
  ADD CONSTRAINT gto_v31_input_bundles_feature_contract_version_check CHECK ((feature_contract_version = ANY (ARRAY['rank-suit-count-v1'::text, 'holdem-board-relative-v2'::text, 'holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text]))),
  DROP CONSTRAINT gto_v31_input_bundles_numeric_representation_identity_chk,
  ADD CONSTRAINT gto_v31_input_bundles_numeric_representation_identity_chk CHECK ((((feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v1'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v3'::text) AND (COALESCE(policy_representation, 'matrix_v2'::text) = 'matrix_v2'::text)) OR ((feature_contract_version = ANY (ARRAY['holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text])) AND (policy_representation = 'public_hist215_v1'::text) AND (policy_export_schema = 'smarter-poker.pio-policy.v4'::text))));
ALTER TABLE public.gto_v31_runtime_cells
  DROP CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check,
  ADD CONSTRAINT gto_v31_runtime_cells_feature_contract_version_check CHECK ((feature_contract_version = ANY (ARRAY['rank-suit-count-v1'::text, 'holdem-board-relative-v2'::text, 'holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text]))),
  DROP CONSTRAINT gto_v31_runtime_cells_numeric_representation_identity_chk,
  ADD CONSTRAINT gto_v31_runtime_cells_numeric_representation_identity_chk CHECK ((((feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v1'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2'::text) AND (feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v3'::text) AND (COALESCE(policy_representation, 'matrix_v2'::text) = 'matrix_v2'::text)) OR ((feature_contract_version = ANY (ARRAY['holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text])) AND (policy_representation = 'public_hist215_v1'::text) AND (policy_export_schema = 'smarter-poker.pio-policy.v4'::text)))),
  DROP CONSTRAINT gto_v31_runtime_cells_representation_payload_chk,
  ADD CONSTRAINT gto_v31_runtime_cells_representation_payload_chk CHECK (((((COALESCE(policy_representation, 'matrix_v2'::text) = 'matrix_v2'::text) AND (hand_matrix IS NOT NULL) AND (policy_ev_matrix IS NOT NULL) AND (action_ev_matrix IS NOT NULL) AND (public_model IS NULL) AND (public_template IS NULL) AND (public_training_provenance IS NULL) AND (public_model_build_receipt IS NULL) AND (model_checksum IS NULL) AND (template_checksum IS NULL) AND (feature_schema_checksum IS NULL) AND (training_provenance_checksum IS NULL) AND (model_build_receipt_checksum IS NULL) AND (sql_physics_checksum IS NULL)) OR ((policy_representation = 'public_hist215_v1'::text) AND (feature_contract_version = ANY (ARRAY['holdem-public-hist215-v1'::text, 'holdem-public-hist215-v2'::text, 'holdem-public-hist215-v3'::text])) AND (policy_export_schema = 'smarter-poker.pio-policy.v4'::text) AND (hand_matrix IS NULL) AND (policy_ev_matrix IS NULL) AND (action_ev_matrix IS NULL) AND (public_model IS NOT NULL) AND (public_template IS NOT NULL) AND (public_training_provenance IS NOT NULL) AND (public_model_build_receipt IS NOT NULL) AND (model_checksum IS NOT NULL) AND (template_checksum IS NOT NULL) AND (feature_schema_checksum IS NOT NULL) AND (training_provenance_checksum IS NOT NULL) AND (model_build_receipt_checksum IS NOT NULL) AND (sql_physics_checksum IS NOT NULL))) IS TRUE)),
  ADD CONSTRAINT gto_v31_runtime_cells_hist215_v3_cell_contract_chk CHECK ((
    feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v3' OR cell_contract_version = 'v3') IS TRUE);
ALTER TABLE public.gto_v31_public_model_audit_combos
  DROP CONSTRAINT gto_v31_public_model_audit_combos_features_check,
  ADD CONSTRAINT gto_v31_public_model_audit_combos_features_check CHECK ((cardinality(features) = ANY (ARRAY[215, 246, 248]))) NOT VALID;

-- 6. Postimages and self-test (cheap: no model or audit row is read).
DO $postimage$
DECLARE r record; t jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_build_cell(uuid,jsonb)', '48f4cbde099bfed8ba81ce9a2ecd8eaa'),
    ('public.fn_gto_v31_build_cell_matrix_v3(uuid,jsonb)', 'e3df6b712ed20ce615379eaa7d32ac73'),
    ('public.fn_gto_v31_cell_context_valid(jsonb)', '2c06e6ff8e664941bb7dceb4cedeee76'),
    ('public.fn_gto_v31_cell_key_checksum(jsonb)', '3ffe455a8b75944ad3f4faba23b7266d'),
    ('public.fn_gto_v31_cell_payload_checksum(jsonb)', '7bcf195fa5e3e5d35c52fff8280de483'),
    ('public.fn_gto_v31_cell_payload_valid(jsonb)', 'dd4d5cd34656fdfc882e10957a364117'),
    ('public.fn_gto_v31_cell_payload_valid_matrix_v3(jsonb)', '5cfba38627fc19ac7be903d35c671449'),
    ('public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text)', '415b4139f424682a385fbb9f427a769e'),
    ('public.fn_gto_v31_feature_identity(text)', '5f3a339dbbfa5f2b71ef8b68d3ec25f9'),
    ('public.fn_gto_v31_feature_key(integer,text,text)', '130912783976647b71d362107c3ead72'),
    ('public.fn_gto_v31_feature_request_valid(jsonb)', 'da05d18eff69a5f0c5e0d355bb09ad80'),
    ('public.fn_gto_v31_hand_matrix_valid(jsonb,text,text)', '103846a685a23e395ad578e5a31bee09'),
    ('public.fn_gto_v31_input_bundle_checksum(jsonb)', 'e081d144c37335087c4f3201de45bcfd'),
    ('public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text)', '03512b3d8f5bc7f71f4cd37c4af4240e'),
    ('public.fn_gto_v31_public215_audit_key_v3(text,text,text[],text)', 'f3ffb3291e3f9fe26c604be452654df5'),
    ('public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer)', '1db201dd5724669aa8552dbb72d80dbb'),
    ('public.fn_gto_v31_public215_audit_prediction_v3(gto_v31_runtime_cells,text,integer)', '9234403c66c2123920ecd4fa19c10971'),
    ('public.fn_gto_v31_public215_build_cell_v3(uuid,jsonb)', '840263ff6d92afe10ea60eac5b0f447a'),
    ('public.fn_gto_v31_public215_bundle_valid(jsonb)', '883667f981b44902cd76e24a616422a6'),
    ('public.fn_gto_v31_public215_cell_model_valid(jsonb)', 'bc7b88f7cd5378366fe40a900f71149d'),
    ('public.fn_gto_v31_public215_compiled_raw_v3(gto_v31_public215_head[],double precision[])', '9ef0acff379c3e1543cac3ff1f973020'),
    ('public.fn_gto_v31_public215_context(jsonb)', 'b16b672da4dd31471a7736f3843945c3'),
    ('public.fn_gto_v31_public215_encoding_for(text)', 'c27292820c23a94cc8583c62c9780599'),
    ('public.fn_gto_v31_public215_encoding_implementation_v3()', '1daf8c4311cf8f9aa048c416de037ab8'),
    ('public.fn_gto_v31_public215_feature_contract_of_schema(text)', '25326ebc7a1f736f195ef87b1e7cd3ad'),
    ('public.fn_gto_v31_public215_feature_schema(text)', 'bd7bcf581398774a6e607ebca39edff6'),
    ('public.fn_gto_v31_public215_model_width(text)', '9a8cc6ffcae54e92a25300a9fa073483'),
    ('public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[])', '39302c2fc78ecc628f773e7528e6993b'),
    ('public.fn_gto_v31_public215_prepare_audit_v3(gto_v31_runtime_cells,text[])', '4fd6fc7c6889693cebbd037edcdd7cf0'),
    ('public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text)', '21db7c9b3888a8ce87c7d34a2571cf48'),
    ('public.fn_gto_v31_public215_required_audit_v3(gto_v31_runtime_cells,text)', 'ceb86ed04cd4e864ef9dafbbef513975'),
    ('public.fn_gto_v31_public215_seal_prepared(uuid)', '96148d0189289c174838da9d53c5c66b'),
    ('public.fn_gto_v31_public215_template_valid_for(jsonb,text)', '9db3f115fccb17fc6134f95538b0887a'),
    ('public.fn_gto_v31_public215_template_valid_v3(jsonb)', '9bf0434a9336138de29f680da8072796'),
    ('public.fn_gto_v31_record_range_evidence()', '2f2e13cc72aa60de1db4d95ab3342f14'),
    ('public.fn_gto_v31_runtime_cell_context(gto_v31_runtime_cells)', '213e1b4afbd544b10c97e2ad2b4c5754'),
    ('public.fn_gto_v31_seal_build_legacy_v31(uuid)', '4ff9fd8f8cbea2d9b14b1825c11d34ca'),
    ('public.fn_gto_v31_cell_contract_identity(jsonb)', '5777847d0e8bc4ff19796765d2128c51'),
    ('public.fn_gto_v31_public215_v3_appended(jsonb)', '76a839938b16bb66b7caa886444566de'),
    ('public.fn_gto_v31_public215_features_v3(integer,text,jsonb,numeric[])', 'd0851ae82bb6cc1e0834d3e49bff6486')
  ) AS p(fn, post_md5) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.post_md5 THEN
      RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage', r.fn, md5(pg_get_functiondef(to_regprocedure(r.fn)));
    END IF;
  END LOOP;
  -- The sealed v1 and v2 encoding identities are untouched; v3 has its own.
  IF public.fn_gto_v31_public215_encoding_implementation() IS DISTINCT FROM '1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d'
     OR public.fn_gto_v31_public215_encoding_implementation_v2() IS DISTINCT FROM current_setting('ca.d6_encoding_v2')
     OR public.fn_gto_v31_public215_encoding_for('holdem-public-hist215-v1') IS DISTINCT FROM public.fn_gto_v31_public215_encoding_implementation()
     OR public.fn_gto_v31_public215_encoding_for('holdem-public-hist215-v2') IS DISTINCT FROM public.fn_gto_v31_public215_encoding_implementation_v2()
     OR public.fn_gto_v31_public215_encoding_for('holdem-public-hist215-v3') IS DISTINCT FROM public.fn_gto_v31_public215_encoding_implementation_v3()
     OR public.fn_gto_v31_public215_encoding_implementation_v3() !~ '^[0-9a-f]{64}$'
     OR public.fn_gto_v31_public215_encoding_implementation_v3() IN ('1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d',
                                                                    current_setting('ca.d6_encoding_v2')) THEN
    RAISE EXCEPTION 'selftest: encoding identities';
  END IF;
  IF public.fn_gto_v31_public215_feature_schema('holdem-public-hist215-v3') IS DISTINCT FROM '26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784'
     OR public.fn_gto_v31_public215_feature_schema('holdem-public-hist215-v2') IS DISTINCT FROM 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4'
     OR public.fn_gto_v31_public215_feature_schema('holdem-public-hist215-v1') IS DISTINCT FROM '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f'
     OR public.fn_gto_v31_public215_feature_contract_of_schema('26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784') IS DISTINCT FROM 'holdem-public-hist215-v3'
     OR public.fn_gto_v31_public215_model_width('26d9271d8b1b1b2400476e9cb1c22662e0086bf5111b1f2e1ce7281ef131b784') <> 248
     OR public.fn_gto_v31_public215_model_width('c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4') <> 246
     OR public.fn_gto_v31_public215_model_width('0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f') <> 215 THEN
    RAISE EXCEPTION 'selftest: feature schema identities';
  END IF;
  -- The v3 block lights exactly its own category.
  IF public.fn_gto_v31_public215_v3_appended('{"context":{"node_role":"facing_bet","facing_kind":"bet","facing_size_bucket":"big"}}') IS DISTINCT FROM ARRAY[1,0]::double precision[]
     OR public.fn_gto_v31_public215_v3_appended('{"context":{"node_role":"donk","facing_kind":"none","facing_size_bucket":"none"}}') IS DISTINCT FROM ARRAY[0,1]::double precision[]
     OR public.fn_gto_v31_public215_v3_appended('{"context":{"node_role":"facing_bet","facing_size_bucket":"mid","cell_contract":"v3","line_class":"x.b-big"}}') IS DISTINCT FROM ARRAY[0,0]::double precision[] THEN
    RAISE EXCEPTION 'selftest: v3 appended one-hot';
  END IF;
  -- Every existing runtime cell keeps its key and its 13-key seal context.
  IF EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
              WHERE c.cell_key_checksum IS DISTINCT FROM public.fn_gto_v31_cell_key_checksum(to_jsonb(c))
                 OR (SELECT count(*) FROM jsonb_object_keys(public.fn_gto_v31_runtime_cell_context(c))) <> 13) THEN
    RAISE EXCEPTION 'selftest: an existing runtime cell changed its key or its seal context';
  END IF;
  t := '{"street":"turn","game_family":"cash","objective":"cash_ev","utility_context":"cash_ev","table_size":2,"pot_type":"srp","hero_position":"BB","opponent_position":"SB","depth_bucket":150,"texture_class":"Brud","node_role":"barrel","facing_kind":"none","facing_size_bucket":"none"}';
  IF public.fn_gto_v31_cell_contract_identity(t) IS DISTINCT FROM '{}'::jsonb
     OR public.fn_gto_v31_cell_contract_identity(t || '{"cell_contract_version":null,"line_class":null}') IS DISTINCT FROM '{}'::jsonb
     OR public.fn_gto_v31_cell_contract_identity(t || '{"cell_contract_version":"v3","line_class":"x.b-mid.c/"}') IS DISTINCT FROM '{"cell_contract":"v3","line_class":"x.b-mid.c/"}'::jsonb
     OR public.fn_gto_v31_cell_context_valid(t) IS NOT TRUE
     OR public.fn_gto_v31_cell_context_valid(t || '{"line_class":"x.b-mid.c/x"}') IS NOT FALSE
     OR public.fn_gto_v31_cell_context_valid(t || '{"cell_contract":"v3","line_class":"x.b-mid.c/x","depth_bucket":200}') IS NOT TRUE
     OR public.fn_gto_v31_cell_context_valid(t || '{"cell_contract":"v3","line_class":"x.b-mid.c","depth_bucket":200}') IS NOT FALSE
     OR public.fn_gto_v31_cell_context_valid(t || '{"depth_bucket":200}') IS NOT FALSE THEN
    RAISE EXCEPTION 'selftest: cell contract identity or context validity';
  END IF;
END
$postimage$;

-- 7. Every new or patched function compiles (bodies were created with check_function_bodies off,
-- so a body error must surface here and refuse the migration, not at its first call).
-- Each body is checked under its own search_path (a validator parses with the session's).
DO $compiles$
DECLARE f regprocedure; lang text; sp text;
BEGIN
  PERFORM set_config('check_function_bodies', 'on', true);
  FOREACH f IN ARRAY ARRAY[
    'public.fn_gto_v31_build_cell(uuid,jsonb)',
    'public.fn_gto_v31_build_cell_matrix_v3(uuid,jsonb)',
    'public.fn_gto_v31_cell_context_valid(jsonb)',
    'public.fn_gto_v31_cell_key_checksum(jsonb)',
    'public.fn_gto_v31_cell_payload_checksum(jsonb)',
    'public.fn_gto_v31_cell_payload_valid(jsonb)',
    'public.fn_gto_v31_cell_payload_valid_matrix_v3(jsonb)',
    'public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text)',
    'public.fn_gto_v31_feature_identity(text)',
    'public.fn_gto_v31_feature_key(integer,text,text)',
    'public.fn_gto_v31_feature_request_valid(jsonb)',
    'public.fn_gto_v31_hand_matrix_valid(jsonb,text,text)',
    'public.fn_gto_v31_input_bundle_checksum(jsonb)',
    'public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text)',
    'public.fn_gto_v31_public215_audit_key_v3(text,text,text[],text)',
    'public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer)',
    'public.fn_gto_v31_public215_audit_prediction_v3(gto_v31_runtime_cells,text,integer)',
    'public.fn_gto_v31_public215_build_cell_v3(uuid,jsonb)',
    'public.fn_gto_v31_public215_bundle_valid(jsonb)',
    'public.fn_gto_v31_public215_cell_model_valid(jsonb)',
    'public.fn_gto_v31_public215_compiled_raw_v3(gto_v31_public215_head[],double precision[])',
    'public.fn_gto_v31_public215_context(jsonb)',
    'public.fn_gto_v31_public215_encoding_for(text)',
    'public.fn_gto_v31_public215_encoding_implementation_v3()',
    'public.fn_gto_v31_public215_feature_contract_of_schema(text)',
    'public.fn_gto_v31_public215_feature_schema(text)',
    'public.fn_gto_v31_public215_model_width(text)',
    'public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[])',
    'public.fn_gto_v31_public215_prepare_audit_v3(gto_v31_runtime_cells,text[])',
    'public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text)',
    'public.fn_gto_v31_public215_required_audit_v3(gto_v31_runtime_cells,text)',
    'public.fn_gto_v31_public215_seal_prepared(uuid)',
    'public.fn_gto_v31_public215_template_valid_for(jsonb,text)',
    'public.fn_gto_v31_public215_template_valid_v3(jsonb)',
    'public.fn_gto_v31_record_range_evidence()',
    'public.fn_gto_v31_runtime_cell_context(gto_v31_runtime_cells)',
    'public.fn_gto_v31_seal_build_legacy_v31(uuid)',
    'public.fn_gto_v31_cell_contract_identity(jsonb)',
    'public.fn_gto_v31_public215_v3_appended(jsonb)',
    'public.fn_gto_v31_public215_features_v3(integer,text,jsonb,numeric[])'
  ]::regprocedure[] LOOP
    SELECT l.lanname, (SELECT substr(c, 13) FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') INTO lang, sp
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = f;
    PERFORM set_config('search_path', COALESCE(sp, 'pg_catalog,public'), true);
    IF lang = 'plpgsql' THEN PERFORM plpgsql_validator(f); ELSIF lang = 'sql' THEN PERFORM fmgr_sql_validator(f);
    ELSE RAISE EXCEPTION '% is %, not plpgsql or sql', f, lang; END IF;
  END LOOP;
  PERFORM set_config('search_path', 'pg_catalog,public', true);
END
$compiles$;

COMMIT;

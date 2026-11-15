-- 20261115183033_v31_cell_contract_v3_sources_ingest_at_200_bb_only_for_a_v3_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (FLOP-5 D6, V31 cell contract v3 sources, DORMANT):
--
-- 20261115162745 builds and seals cell contract v3 cells from source nodes that
-- carry their v3 cell (cell_contract "v3" and line_class in node_context). No
-- such node could be ingested: the source-node validators take exactly the 16
-- v2 node_context keys, depth 10..150 and the v2 roles (a lead into the previous
-- street's aggressor, the v3 role "donk", is refused), and both ingest functions
-- and gto_v31_source_artifacts admit stack depth 10..150 only. Here a dataset
-- whose declared coverage is all cell contract v3 learns to ingest v3 sources,
-- up to the v3 depth bucket, 200 bb; every other dataset ingests exactly as
-- before:
--
--   + fn_gto_v31_cell_contract_of_coverage (declared coverage -> 'v3' or 'v2',
--     the registration rule of 20261115143957; every existing dataset is 'v2')
--   + fn_gto_v31_node_line_class_v3 (a port of World Hub pio_upi.line_class_v3,
--     pinned by the native proof to that function's answers on 1,704 nodes)
--   + v3 siblings generated from the installed v2 source-node chain:
--     fn_gto_v31_node_line_proof_v3 (the donk lead), complete_public_state_v3,
--     source_node_scalar_types_valid_v3 (depth 200), source_node_v3_fields_valid
--     _cell_v3 (18 node_context keys, depth 200, donk, and the node's
--     line_class must be the line its own path proves), source_node_v3_valid
--     _cell_v3, source_node_v4_valid_cell_v3, source_node_valid_cell_v3 and
--     assert_source_contract_v3; ACL: each one's source's
--   fn_gto_v31_ingest_source_artifact_matrix_v2 and fn_gto_v31_public215_ingest_m2
--     (in place, exact-count anchors, md5-pinned): for a v3 dataset an artifact
--     may be 200 bb and every node is checked by the v3 chain; for every other
--     dataset the same calls as before, in the same order
--   gto_v31_source_artifacts_stack_depth_check admits 200, and the new trigger
--     gto_v31_source_artifacts_v3_depth_guard refuses a 200 bb row of any other
--     dataset with that check's own error (SQLSTATE 23514, same message and
--     constraint name)
--
-- DORMANT AND V2-IDENTICAL. No dataset declares cell contract v3 (none can be
-- registered before 20261115143957 and 20261115162745), so every ingest in
-- production takes the unchanged path; the native proof replays a v2 corpus
-- through both ingest functions before and after, byte for byte. Real 200 bb
-- solver ranges do not exist yet (FLOP-4 C2, an external dependency): the 200 bb
-- path is proven on fixtures only. Nothing is registered, ingested or built here.
--
-- Additive and safe with existing rows: no row is changed; the replaced depth
-- check is a superset (19,828 rows on 2026-11-15, validated in milliseconds).
-- Not a hot table; no install-window header needed. Requires 20261115162745.
--
-- @live-proof: to_regprocedure('public.fn_gto_v31_source_node_valid_cell_v3(jsonb)') IS NOT NULL AND md5(pg_get_functiondef('public.fn_gto_v31_ingest_source_artifact_matrix_v2(uuid,text,jsonb)'::regprocedure))='9aa96e0347e70c0f2c7dfa1022c224f6' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_ingest_m2(uuid,text,jsonb)'::regprocedure))='5f5ccbd81eff5003bdcc2f783f9a930c'

BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog,public;

-- 1. Preconditions: migration 20261115162745 is installed and nothing here exists yet.
DO $pre$
BEGIN
  IF to_regprocedure('public.fn_gto_v31_build_cell_matrix_v3(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.fn_gto_v31_cell_contract_v3_error(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'migration 20261115162745 (cell contract v3 cells are built and sealed) must be installed first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
     ('fn_gto_v31_cell_contract_of_coverage','fn_gto_v31_node_line_class_v3','fn_gto_v31_source_artifact_depth_guard',
      'fn_gto_v31_node_line_proof_v3','fn_gto_v31_source_node_valid_cell_v3','fn_gto_v31_assert_source_contract_v3'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.gto_v31_source_artifacts'::regclass AND tgname='gto_v31_source_artifacts_v3_depth_guard') THEN
    RAISE EXCEPTION 'the cell contract v3 source layer already exists';
  END IF;
END
$pre$;

-- 2. New functions.
-- The cell contract a dataset's declared coverage declares: 'v3' when every declared cell is a
-- cell contract v3 cell (the rule fn_gto_v31_registration_cell_contract applies to a round
-- registration), 'v2' for everything else, never NULL. Every existing dataset reads 'v2'.
CREATE FUNCTION public.fn_gto_v31_cell_contract_of_coverage(p_declared_coverage jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(p_declared_coverage) IS DISTINCT FROM 'array' THEN 'v2'
    WHEN jsonb_array_length(p_declared_coverage) = 0 THEN 'v2'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_declared_coverage) c
                  WHERE jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'cell_contract' IS DISTINCT FROM 'v3') THEN 'v2'
    ELSE 'v3' END
$fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_contract_of_coverage(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_cell_contract_of_coverage(jsonb) TO service_role;

-- The v3 cell-key line of a Pio node: every public action before the node, size-bucketed, streets
-- separated by "/" and actions by "." (x check, c call, b-<bucket> bet, r-<bucket> raise, a any
-- wager that reaches the effective stack; small < 0.6, mid < 1.1, big otherwise, a bet over the
-- pot before it and a raise increment over the pot after the raiser calls). A port of World Hub
-- scripts/horse-solver-v31/pio_upi.py line_class_v3; NULL wherever that function raises. The
-- native proof pins it to that function's own answers on 1,704 nodes.
CREATE FUNCTION public.fn_gto_v31_node_line_class_v3(p_node text, p_root_pot_chips numeric, p_effective_stack_chips numeric)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $fn$
DECLARE
  v_tokens text[] := string_to_array(p_node, ':');
  v_token text;
  v_i integer;
  v_pot numeric := p_root_pot_chips;
  v_contrib numeric[] := ARRAY[0,0]::numeric[];
  v_total numeric[] := ARRAY[0,0]::numeric[];
  v_start numeric[] := ARRAY[0,0]::numeric[];
  v_actor integer := 0;
  v_current numeric := 0;
  v_wager boolean := false;
  v_target numeric;
  v_actor_total numeric;
  v_denominator numeric;
  v_fraction numeric;
  v_delta numeric;
  v_street text[] := ARRAY[]::text[];
  v_done text[] := ARRAY[]::text[];
  v_line text;
BEGIN
  IF p_node IS NULL OR p_root_pot_chips IS NULL OR p_effective_stack_chips IS NULL
     OR p_root_pot_chips <= 0 OR p_effective_stack_chips <= 0
     OR p_root_pot_chips <> trunc(p_root_pot_chips) OR p_effective_stack_chips <> trunc(p_effective_stack_chips) THEN
    RETURN NULL;
  END IF;
  IF COALESCE(array_length(v_tokens, 1), 0) < 2 OR v_tokens[1] <> 'r' OR v_tokens[2] <> '0' THEN RETURN NULL; END IF;
  FOR v_i IN 3..COALESCE(array_length(v_tokens, 1), 0) LOOP
    v_token := v_tokens[v_i];
    IF v_token ~ '^[2-9TJQKA][cdhs]$' THEN
      IF cardinality(v_done) >= 2 THEN RETURN NULL; END IF;
      v_done := array_append(v_done, array_to_string(v_street, '.'));
      v_street := ARRAY[]::text[];
      v_actor := 0; v_current := 0; v_wager := false;
      v_contrib := ARRAY[0,0]::numeric[]; v_start := v_total;
      CONTINUE;
    END IF;
    IF v_token = 'c' THEN
      IF v_wager THEN
        v_delta := v_current - v_contrib[v_actor + 1];
        v_contrib[v_actor + 1] := v_contrib[v_actor + 1] + v_delta;
        v_total[v_actor + 1] := v_total[v_actor + 1] + v_delta;
        v_pot := v_pot + v_delta;
        v_wager := false;
        v_street := array_append(v_street, 'c');
      ELSE
        v_street := array_append(v_street, 'x');
      END IF;
      v_actor := 1 - v_actor;
      CONTINUE;
    END IF;
    IF v_token !~ '^b[1-9][0-9]{0,78}$' THEN RETURN NULL; END IF;
    v_target := substring(v_token FROM 2)::numeric - v_start[v_actor + 1];
    v_actor_total := v_contrib[v_actor + 1] + p_effective_stack_chips - v_total[v_actor + 1];
    IF v_target <= v_contrib[v_actor + 1] OR (v_wager AND v_target <= v_current) OR v_target > v_actor_total THEN
      RETURN NULL;
    END IF;
    IF v_target = v_actor_total THEN
      v_street := array_append(v_street, 'a');
    ELSIF v_wager THEN
      v_denominator := v_pot + v_current - v_contrib[v_actor + 1];
      IF v_denominator <= 0 THEN RETURN NULL; END IF;
      v_fraction := (v_target - v_current) / v_denominator;
      v_street := array_append(v_street, 'r-' || CASE WHEN v_fraction <= 0 THEN 'none' WHEN v_fraction < 0.6 THEN 'small'
        WHEN v_fraction < 1.1 THEN 'mid' ELSE 'big' END);
    ELSE
      v_fraction := v_target / v_pot;
      v_street := array_append(v_street, 'b-' || CASE WHEN v_fraction <= 0 THEN 'none' WHEN v_fraction < 0.6 THEN 'small'
        WHEN v_fraction < 1.1 THEN 'mid' ELSE 'big' END);
    END IF;
    v_delta := v_target - v_contrib[v_actor + 1];
    v_contrib[v_actor + 1] := v_target;
    v_total[v_actor + 1] := v_total[v_actor + 1] + v_delta;
    v_pot := v_pot + v_delta;
    v_current := v_target; v_wager := true;
    v_actor := 1 - v_actor;
  END LOOP;
  v_line := array_to_string(array_append(v_done, array_to_string(v_street, '.')), '/');
  IF v_line !~ '^((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?(/((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?){0,2}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_line;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_node_line_class_v3(text,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_node_line_class_v3(text,numeric,numeric) TO service_role;

-- The depth check below admits 200; this guard keeps 200 to a dataset whose declared coverage is all
-- cell contract v3 and refuses it for any other dataset with the depth check's own error (SQLSTATE
-- 23514, the same message and constraint name), exactly as before.
CREATE FUNCTION public.fn_gto_v31_source_artifact_depth_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.stack_depth = 200 AND public.fn_gto_v31_cell_contract_of_coverage(
       (SELECT d.declared_coverage FROM public.gto_v31_datasets d WHERE d.dataset_id = NEW.dataset_id)) IS DISTINCT FROM 'v3' THEN
    RAISE EXCEPTION 'new row for relation "gto_v31_source_artifacts" violates check constraint "gto_v31_source_artifacts_stack_depth_check"'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gto_v31_source_artifacts_stack_depth_check',
            TABLE = 'gto_v31_source_artifacts', SCHEMA = 'public';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_artifact_depth_guard() FROM PUBLIC, anon, authenticated, service_role;

-- 3. Generated v3 siblings of the installed v2 source-node chain: each is the installed text of its
-- source with exact-count anchors replaced, so a source that differs from the reviewed one refuses
-- the whole migration. ACL: the source's (owner and service_role).
SET LOCAL check_function_bodies=off;
DO $siblings$
DECLARE r record; e jsonb; def text; hits integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric)'::regprocedure, '2485aad34b89fbf1118ca2f102a82f55', 'public.fn_gto_v31_node_line_proof_v3(text,integer,numeric,numeric)',
     '[["FUNCTION public.fn_gto_v31_node_line_proof(", "FUNCTION public.fn_gto_v31_node_line_proof_v3(", 1], ["      ELSIF v_previous_aggressor IS NULL THEN v_role:=''open'';\n      ELSE RETURN NULL;\n      END IF;", "      ELSIF v_previous_aggressor IS NULL THEN v_role:=''open'';\n      ELSE v_role:=''donk'';\n      END IF;", 1], ["      ELSIF v_previous_aggressor IS NOT NULL THEN\n        RETURN NULL;\n", "      ELSIF v_previous_aggressor IS NOT NULL THEN\n        v_role:=''donk'';\n", 1]]'::jsonb),
    ('public.fn_gto_v31_complete_public_state(jsonb)'::regprocedure, '8f16c1aa9dbe2e69a3d072e02314caf3', 'public.fn_gto_v31_complete_public_state_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_complete_public_state(", "FUNCTION public.fn_gto_v31_complete_public_state_v3(", 1], ["derived:=public.fn_gto_v31_node_line_proof(", "derived:=public.fn_gto_v31_node_line_proof_v3(", 1]]'::jsonb),
    ('public.fn_gto_v31_source_node_scalar_types_valid(jsonb)'::regprocedure, '699c27375f8d10972575bb5698458c99', 'public.fn_gto_v31_source_node_scalar_types_valid_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_source_node_scalar_types_valid(", "FUNCTION public.fn_gto_v31_source_node_scalar_types_valid_v3(", 1], ["public.fn_gto_v31_json_safe_integer(v_context->''depth_bucket'',10,150)", "public.fn_gto_v31_json_safe_integer(v_context->''depth_bucket'',10,200)", 1], ["''opponent_position'',''texture_class'',''node_role'',''facing_kind'',''facing_size_bucket'',''board''\n  ] LOOP", "''opponent_position'',''texture_class'',''node_role'',''facing_kind'',''facing_size_bucket'',''board'',\n    ''cell_contract'',''line_class''\n  ] LOOP", 1]]'::jsonb),
    ('public.fn_gto_v31_source_node_v3_fields_valid(jsonb)'::regprocedure, 'e430900de30df4844860e12985e1727d', 'public.fn_gto_v31_source_node_v3_fields_valid_cell_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_source_node_v3_fields_valid(", "FUNCTION public.fn_gto_v31_source_node_v3_fields_valid_cell_v3(", 1], ["public.fn_gto_v31_source_node_scalar_types_valid(p_node)", "public.fn_gto_v31_source_node_scalar_types_valid_v3(p_node)", 1], ["(SELECT count(*) FROM jsonb_object_keys(v_context))<>16", "(SELECT count(*) FROM jsonb_object_keys(v_context))<>18", 1], ["''facing_target_chips'',''facing_actor_total_chips''])", "''facing_target_chips'',''facing_actor_total_chips'',''cell_contract'',''line_class''])", 1], ["OR COALESCE((v_context->>''depth_bucket'')::integer,0) NOT IN (10,20,40,80,150)", "OR COALESCE((v_context->>''depth_bucket'')::integer,0) NOT IN (10,20,40,80,150,200)", 1], ["NOT IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''facing_bet''", "NOT IN (''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''donk'',''facing_bet''", 1], ["v_derived_line:=public.fn_gto_v31_node_line_proof(", "v_derived_line:=public.fn_gto_v31_node_line_proof_v3(", 1], ["     OR v_derived_line->''facing_actor_total_chips'' IS DISTINCT FROM v_context->''facing_actor_total_chips'' THEN", "     OR v_derived_line->''facing_actor_total_chips'' IS DISTINCT FROM v_context->''facing_actor_total_chips''\n     -- Cell contract v3 (FLOP-5 D6): the node names a whole v3 cell, and its line_class is the line\n     -- its own path proves (World Hub pio_upi.line_class_v3).\n     OR v_context->''cell_contract'' IS DISTINCT FROM ''\"v3\"''::jsonb\n     OR v_context->''line_class'' IS DISTINCT FROM to_jsonb(public.fn_gto_v31_node_line_class_v3(p_node->>''node'',v_root_pot_chips,v_effective_stack_chips))\n     OR public.fn_gto_v31_cell_contract_v3_error(public.fn_gto_v31_public215_context(v_context)) IS NOT NULL THEN", 1], ["(''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'')", "(''open'',''cbet'',''probe'',''delayed_cbet'',''barrel'',''donk'')", 3]]'::jsonb),
    ('public.fn_gto_v31_source_node_v3_valid(jsonb)'::regprocedure, '491d4b69a9bae5504770923072191059', 'public.fn_gto_v31_source_node_v3_valid_cell_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_source_node_v3_valid(", "FUNCTION public.fn_gto_v31_source_node_v3_valid_cell_v3(", 1], ["RETURN public.fn_gto_v31_source_node_v3_fields_valid(p_node);", "RETURN public.fn_gto_v31_source_node_v3_fields_valid_cell_v3(p_node);", 1]]'::jsonb),
    ('public.fn_gto_v31_source_node_v4_valid(jsonb)'::regprocedure, '45e1d9b287654e6aab57114d344f424e', 'public.fn_gto_v31_source_node_v4_valid_cell_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_source_node_v4_valid(", "FUNCTION public.fn_gto_v31_source_node_v4_valid_cell_v3(", 1], ["state IS DISTINCT FROM public.fn_gto_v31_complete_public_state(p_node)", "state IS DISTINCT FROM public.fn_gto_v31_complete_public_state_v3(p_node)", 1], ["public.fn_gto_v31_source_node_v3_fields_valid(projected)", "public.fn_gto_v31_source_node_v3_fields_valid_cell_v3(projected)", 1]]'::jsonb),
    ('public.fn_gto_v31_source_node_valid(jsonb)'::regprocedure, '35394efc3321b593ee1b2da1d17fa5a9', 'public.fn_gto_v31_source_node_valid_cell_v3(jsonb)',
     '[["FUNCTION public.fn_gto_v31_source_node_valid(", "FUNCTION public.fn_gto_v31_source_node_valid_cell_v3(", 1], ["RETURN public.fn_gto_v31_source_node_v3_valid(p_node);", "RETURN public.fn_gto_v31_source_node_v3_valid_cell_v3(p_node);", 1], ["RETURN public.fn_gto_v31_source_node_v4_valid(p_node);", "RETURN public.fn_gto_v31_source_node_v4_valid_cell_v3(p_node);", 1]]'::jsonb),
    ('public.fn_gto_v31_assert_source_contract(jsonb,text,text)'::regprocedure, '69ea62a35a05157f32c372c173d4d584', 'public.fn_gto_v31_assert_source_contract_v3(jsonb,text,text)',
     '[["FUNCTION public.fn_gto_v31_assert_source_contract(", "FUNCTION public.fn_gto_v31_assert_source_contract_v3(", 1], ["NOT public.fn_gto_v31_source_node_v4_valid(p_node)", "NOT public.fn_gto_v31_source_node_v4_valid_cell_v3(p_node)", 1]]'::jsonb)
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
    IF (SELECT proacl::text FROM pg_proc WHERE oid = r.src) LIKE '%service_role=X/%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.dst);
    END IF;
    IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.dst)) IS DISTINCT FROM (SELECT proacl::text FROM pg_proc WHERE oid = r.src) THEN
      RAISE EXCEPTION '% ACL % is not its source ACL', r.dst, (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.dst));
    END IF;
  END LOOP;
END
$siblings$;

-- 4. In-place patches of the two ingest functions: exact-count anchors on the installed text,
-- preimage md5 pinned, ACL unchanged. For a dataset that does not declare cell contract v3 each
-- makes the same calls as before, in the same order, and answers the same.
DO $patch$
DECLARE r record; e jsonb; def text; hits integer; acl text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_ingest_source_artifact_matrix_v2(uuid,text,jsonb)'::regprocedure, 'ad786aa2f1849699fafde1c318d428cb',
     '[["     OR NOT public.fn_gto_v31_json_safe_integer(p_artifact->''stack_depth'',10,150)\n     OR (p_artifact->>''stack_depth'')::integer NOT IN (10,20,40,80,150)\n", "     -- Cell contract v3 (FLOP-5 D6): a dataset whose declared coverage is all cell contract v3 may also\n     -- ingest the v3 depth bucket, 200 bb; every other artifact is checked exactly as before.\n     OR (NOT (public.fn_gto_v31_json_safe_integer(p_artifact->''stack_depth'',200,200)\n              AND public.fn_gto_v31_cell_contract_of_coverage(v_dataset.declared_coverage)=''v3'')\n         AND (NOT public.fn_gto_v31_json_safe_integer(p_artifact->''stack_depth'',10,150)\n              OR (p_artifact->>''stack_depth'')::integer NOT IN (10,20,40,80,150)))\n", 1], ["    PERFORM public.fn_gto_v31_assert_source_contract(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);\n    IF NOT public.fn_gto_v31_source_node_valid(v_node)\n", "    -- Cell contract v3 (FLOP-5 D6): every source node of a v3 dataset is a v3 node, checked by the v3\n    -- chain (its whole v3 cell, depth 200, donk, and the line its path proves); every other dataset''s\n    -- nodes are checked by the same calls as before.\n    IF public.fn_gto_v31_cell_contract_of_coverage(v_dataset.declared_coverage)=''v3'' THEN\n      PERFORM public.fn_gto_v31_assert_source_contract_v3(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);\n    ELSE\n      PERFORM public.fn_gto_v31_assert_source_contract(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);\n    END IF;\n    IF NOT (CASE WHEN public.fn_gto_v31_cell_contract_of_coverage(v_dataset.declared_coverage)=''v3''\n                 THEN public.fn_gto_v31_source_node_valid_cell_v3(v_node) ELSE public.fn_gto_v31_source_node_valid(v_node) END)\n", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_ingest_m2(uuid,text,jsonb)'::regprocedure, '262aea81c9aece77ae4b26437935ba7b',
     '[["     OR NOT public.fn_gto_v31_json_safe_integer(p_artifact->''stack_depth'',10,150)\n     OR (p_artifact->>''stack_depth'')::integer NOT IN (10,20,40,80,150)\n", "     -- Cell contract v3 (FLOP-5 D6): a dataset whose declared coverage is all cell contract v3 may also\n     -- ingest the v3 depth bucket, 200 bb; every other artifact is checked exactly as before.\n     OR (NOT (public.fn_gto_v31_json_safe_integer(p_artifact->''stack_depth'',200,200)\n              AND public.fn_gto_v31_cell_contract_of_coverage(v_dataset.declared_coverage)=''v3'')\n         AND (NOT public.fn_gto_v31_json_safe_integer(p_artifact->''stack_depth'',10,150)\n              OR (p_artifact->>''stack_depth'')::integer NOT IN (10,20,40,80,150)))\n", 1], ["    PERFORM public.fn_gto_v31_assert_source_contract(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);\n    IF NOT public.fn_gto_v31_source_node_valid(v_node)\n", "    -- Cell contract v3 (FLOP-5 D6): every source node of a v3 dataset is a v3 node, checked by the v3\n    -- chain (its whole v3 cell, depth 200, donk, and the line its path proves); every other dataset''s\n    -- nodes are checked by the same calls as before.\n    IF public.fn_gto_v31_cell_contract_of_coverage(v_dataset.declared_coverage)=''v3'' THEN\n      PERFORM public.fn_gto_v31_assert_source_contract_v3(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);\n    ELSE\n      PERFORM public.fn_gto_v31_assert_source_contract(v_node,v_dataset.policy_export_schema,v_dataset.icm_model_checksum);\n    END IF;\n    IF NOT (CASE WHEN public.fn_gto_v31_cell_contract_of_coverage(v_dataset.declared_coverage)=''v3''\n                 THEN public.fn_gto_v31_source_node_valid_cell_v3(v_node) ELSE public.fn_gto_v31_source_node_valid(v_node) END)\n", 1]]'::jsonb)
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

-- 5. The depth check admits the v3 bucket (the live text with 200 added, a superset for every
-- existing row); the guard keeps 200 to a v3 dataset and fires before the check.
DO $conpre$
BEGIN
  IF (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c
       WHERE c.conrelid = 'public.gto_v31_source_artifacts'::regclass AND c.conname = 'gto_v31_source_artifacts_stack_depth_check')
     IS DISTINCT FROM '1bbca26fe22b193d1db5646f252aabf1' THEN
    RAISE EXCEPTION 'gto_v31_source_artifacts.gto_v31_source_artifacts_stack_depth_check preimage changed, refusing to replace it';
  END IF;
END
$conpre$;
CREATE TRIGGER gto_v31_source_artifacts_v3_depth_guard BEFORE INSERT OR UPDATE OF stack_depth, dataset_id
  ON public.gto_v31_source_artifacts FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_source_artifact_depth_guard();
ALTER TABLE public.gto_v31_source_artifacts
  DROP CONSTRAINT gto_v31_source_artifacts_stack_depth_check,
  ADD CONSTRAINT gto_v31_source_artifacts_stack_depth_check CHECK ((stack_depth = ANY (ARRAY[10, 20, 40, 80, 150, 200])));

-- 6. Postimages and self-test (cheap: no source row is read).
DO $postimage$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_assert_source_contract_v3(jsonb,text,text)', '0513316617c6e91542e94ff837985e82'),
    ('public.fn_gto_v31_complete_public_state_v3(jsonb)', '788b87e4bc8517ff3ae078e7da281252'),
    ('public.fn_gto_v31_ingest_source_artifact_matrix_v2(uuid,text,jsonb)', '9aa96e0347e70c0f2c7dfa1022c224f6'),
    ('public.fn_gto_v31_node_line_proof_v3(text,integer,numeric,numeric)', '5a187952b1fb8a44a2b4012dbcae100e'),
    ('public.fn_gto_v31_public215_ingest_m2(uuid,text,jsonb)', '5f5ccbd81eff5003bdcc2f783f9a930c'),
    ('public.fn_gto_v31_source_node_scalar_types_valid_v3(jsonb)', '19c0c4e1961b02162457e24f35a67dce'),
    ('public.fn_gto_v31_source_node_v3_fields_valid_cell_v3(jsonb)', '0f69ccee2a4be105423748b53eea3f9b'),
    ('public.fn_gto_v31_source_node_v3_valid_cell_v3(jsonb)', '4dbc20b207bd80c747cec4e447bb11ce'),
    ('public.fn_gto_v31_source_node_v4_valid_cell_v3(jsonb)', '9381c5e02c0b56f5ad797ca9844d254e'),
    ('public.fn_gto_v31_source_node_valid_cell_v3(jsonb)', '110251f40bd95971e55b1c0a636b46f4'),
    ('public.fn_gto_v31_cell_contract_of_coverage(jsonb)', '92e5764fcc5f5baae5d2265fe2f2882f'),
    ('public.fn_gto_v31_node_line_class_v3(text,numeric,numeric)', '2b2ce8ed019bc08eea87d09c6f2466ea'),
    ('public.fn_gto_v31_source_artifact_depth_guard()', '114683db9484bc892a520ad62b3ffeef')
  ) AS p(fn, post_md5) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.post_md5 THEN
      RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage', r.fn, md5(pg_get_functiondef(to_regprocedure(r.fn)));
    END IF;
  END LOOP;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.gto_v31_source_artifacts'::regclass
       AND c.conname = 'gto_v31_source_artifacts_stack_depth_check') IS DISTINCT FROM 'CHECK ((stack_depth = ANY (ARRAY[10, 20, 40, 80, 150, 200])))' THEN
    RAISE EXCEPTION 'the depth check is not the reviewed one';
  END IF;
  -- The coverage rule, and World Hub pio_upi.line_class_v3's own answers on five lines.
  IF public.fn_gto_v31_cell_contract_of_coverage('[{"cell_contract":"v3"}]') IS DISTINCT FROM 'v3'
     OR public.fn_gto_v31_cell_contract_of_coverage('[{"cell_contract":"v3"},{}]') IS DISTINCT FROM 'v2'
     OR public.fn_gto_v31_cell_contract_of_coverage('[]') IS DISTINCT FROM 'v2'
     OR public.fn_gto_v31_cell_contract_of_coverage('{}') IS DISTINCT FROM 'v2'
     OR public.fn_gto_v31_cell_contract_of_coverage(NULL) IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION 'fn_gto_v31_cell_contract_of_coverage self-test failed';
  END IF;
  IF public.fn_gto_v31_node_line_class_v3('r:0', 650, 20000) IS DISTINCT FROM ''
     OR public.fn_gto_v31_node_line_class_v3('r:0:c:b650:c:Kh', 650, 20000) IS DISTINCT FROM 'x.b-mid.c/'
     OR public.fn_gto_v31_node_line_class_v3('r:0:c:b325:b1300', 650, 20000) IS DISTINCT FROM 'x.b-small.r-mid'
     OR public.fn_gto_v31_node_line_class_v3('r:0:c:c:Kh:c:c:2d', 650, 20000) IS DISTINCT FROM 'x.x/x.x/'
     OR public.fn_gto_v31_node_line_class_v3('r:0:b20000', 650, 20000) IS DISTINCT FROM 'a'
     OR public.fn_gto_v31_node_line_class_v3('r:0:f', 650, 20000) IS NOT NULL THEN
    RAISE EXCEPTION 'fn_gto_v31_node_line_class_v3 self-test failed';
  END IF;
  -- A flop lead into the preflop aggressor is a donk under v3 and refused under v2, as before;
  -- every line v2 proves, v3 proves the same.
  IF public.fn_gto_v31_node_line_proof_v3('r:0', 1, 650, 20000)->>'derived_node_role' IS DISTINCT FROM 'donk'
     OR public.fn_gto_v31_node_line_proof('r:0', 1, 650, 20000) IS NOT NULL
     OR public.fn_gto_v31_node_line_proof_v3('r:0:c:b325:b1300', 0, 650, 20000) IS DISTINCT FROM public.fn_gto_v31_node_line_proof('r:0:c:b325:b1300', 0, 650, 20000)
     OR public.fn_gto_v31_node_line_proof_v3('r:0:c:c:Kh', 1, 650, 20000) IS DISTINCT FROM public.fn_gto_v31_node_line_proof('r:0:c:c:Kh', 1, 650, 20000) THEN
    RAISE EXCEPTION 'fn_gto_v31_node_line_proof_v3 self-test failed';
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
    'public.fn_gto_v31_assert_source_contract_v3(jsonb,text,text)',
    'public.fn_gto_v31_complete_public_state_v3(jsonb)',
    'public.fn_gto_v31_ingest_source_artifact_matrix_v2(uuid,text,jsonb)',
    'public.fn_gto_v31_node_line_proof_v3(text,integer,numeric,numeric)',
    'public.fn_gto_v31_public215_ingest_m2(uuid,text,jsonb)',
    'public.fn_gto_v31_source_node_scalar_types_valid_v3(jsonb)',
    'public.fn_gto_v31_source_node_v3_fields_valid_cell_v3(jsonb)',
    'public.fn_gto_v31_source_node_v3_valid_cell_v3(jsonb)',
    'public.fn_gto_v31_source_node_v4_valid_cell_v3(jsonb)',
    'public.fn_gto_v31_source_node_valid_cell_v3(jsonb)',
    'public.fn_gto_v31_cell_contract_of_coverage(jsonb)',
    'public.fn_gto_v31_node_line_class_v3(text,numeric,numeric)',
    'public.fn_gto_v31_source_artifact_depth_guard()'
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

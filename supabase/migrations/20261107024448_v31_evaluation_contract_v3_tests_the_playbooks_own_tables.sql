-- 20261107024448_v31_evaluation_contract_v3_tests_the_playbooks_own_tables.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY: V31 EVALUATION CONTRACT V3.
--
-- Contract v2 certified a playbook on one fixed table per utility context
-- (heads-up 80bb cash, three-handed 20bb spins, six-handed 40bb tournaments)
-- and required every playbook to cover every family, street, pot type,
-- utility context, table size 2-10 and node role before it could seal. R7
-- (dataset 187815b1) therefore spread 107 cells thinly across all of it, and
-- the fixed tables reached 9 of them: its cash cells sat at ten-handed 80bb
-- (9), heads-up 10bb (8), nine-handed 40bb (9) and heads-up 80bb (1), and the
-- cash certification played exactly one cell. The verdict also came from a
-- single learning-on league run, and R7's league/cash loss existed only with
-- horse memory learning on (an exploit-read defect fixed separately as V83).
--
-- A dataset now carries its evaluation contract (gto_v31_datasets.
-- evaluation_contract). Every existing row is 'gto_v31_candidate.v2' and keeps
-- exactly today's rules and receipts (R7's loss and refusal are untouched);
-- every new row is 'gto_v31_candidate.v3' (an insert trigger refuses v2), and
-- the column never changes afterwards. Under v3:
--
--   * Scope: the seal requires only that each family/objective the dataset
--     actually carries covers flop, turn and river (fn_gto_v31_v3_breadth_ok);
--     heldout quality is required per family the dataset carries. A
--     dataset's out-of-scope spots miss and play exactly as they do with no
--     playbook loaded (HorseLogic falls through on a miss).
--   * Tables come from the cells (fn_gto_v31_v3_tables): one per distinct
--     (utility context, table size, depth bucket) of the family, named
--     `${utility}_${size}max_${depth}bb` in byte order, plus for cash one
--     human-calibrated six-max table at the deepest six-max cash depth when
--     six-max cash cells exist. The evaluator derives the same list from the
--     loaded cells and refuses on any difference (fn_gto_v31_evaluation_plan).
--   * Every table plays max(10,000, ceil(50,000 / tables)) duplicate pairs
--     (the family keeps at least 100,000 hands) and executes at least 300
--     playbook decisions; every league table carries its memory-learning-off
--     run on the same deals with the same floors; the verdict comes from the
--     learning-on run; and every sealed cell of the family must be executed
--     by at least one table of each kind (components list candidate_cells).
--   * Only families with cells are certified: receipts are 2 per family, the
--     promotion count is 1 + 2 x families, required node roles are the
--     dataset's own roles, and a candidate may not drop a family an active
--     incumbent plays.
--
-- Mechanics: six live functions get a minimal textual patch applied to
-- their exact live definition (md5 preimage guard before, md5 postimage
-- check after, each anchor must occur exactly once), so their v2 paths stay
-- byte-identical: fn_gto_v31_record_evaluation and
-- fn_gto_v31_candidate_evaluations_valid branch to new v3 functions;
-- fn_gto_v31_mark_candidate and fn_gto_v31_promote_dataset_epoch read their
-- required roles / families / receipt count from helpers that return the v2
-- constants for v2 datasets; fn_gto_v31_public215_seal_prepared gets a v3
-- breadth branch and reads its heldout family list from the same helper;
-- ca_gto_v31_certification_status adds evaluation_contract and
-- required_families (additive) so the qualification workflow counts the
-- dataset's own receipts.
-- CREATE OR REPLACE keeps every grant and owner. New functions are
-- SECURITY DEFINER with an empty PUBLIC grant; only the plan RPC is granted
-- to service_role. Adding the column changes the seal qualification
-- fingerprint, so no dataset may be mid-preparation (none is: the only
-- public215 building row, 2f9499d5, has no cells).
--
-- Not hot tables. gto_v31_datasets holds 12 rows; ADD COLUMN with a constant
-- default does not rewrite it. Native proof:
-- scripts/ci/test-v31-evaluation-contract-v3.py (PostgreSQL 17).
--
-- @live-proof: EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.gto_v31_datasets'::regclass AND attname='evaluation_contract' AND NOT attisdropped) AND NOT EXISTS (SELECT 1 FROM public.gto_v31_datasets WHERE evaluation_contract<>'gto_v31_candidate.v2' AND created_at<'2026-11-07') AND to_regprocedure('public.fn_gto_v31_evaluation_plan(uuid)') IS NOT NULL AND has_function_privilege('service_role','public.fn_gto_v31_evaluation_plan(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_evaluation_plan(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_gto_v31_record_evaluation_v3(uuid,text,text,bigint)','EXECUTE') AND md5(pg_get_functiondef('public.fn_gto_v31_record_evaluation(uuid,text,text,bigint)'::regprocedure))='3ab969726639d525ff445cc255e48aef' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure))='2e67050be5838b52822fbe33f396aeba'

BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_gto_v31_record_evaluation(uuid,text,text,bigint)'::regprocedure))
     IS DISTINCT FROM '6c75961616dd0c48513a11b6aa0fba3b' THEN
    RAISE EXCEPTION 'fn_gto_v31_record_evaluation_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_candidate_evaluations_valid(uuid,text)'::regprocedure))
     IS DISTINCT FROM '3cb0fadb5fbb21e61eaab662e67ba35b' THEN
    RAISE EXCEPTION 'fn_gto_v31_candidate_evaluations_valid_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_mark_candidate(uuid)'::regprocedure))
     IS DISTINCT FROM '02261b345a2bbd1987b8a4abbbc2d4f9' THEN
    RAISE EXCEPTION 'fn_gto_v31_mark_candidate_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)'::regprocedure))
     IS DISTINCT FROM 'f87350cb2e4dca44921f419529d0e847' THEN
    RAISE EXCEPTION 'fn_gto_v31_promote_dataset_epoch_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure))
     IS DISTINCT FROM '5004de7facc7f759bb6b8bc993f597b2' THEN
    RAISE EXCEPTION 'fn_gto_v31_public215_seal_prepared_preimage_changed';
  END IF;
  IF md5(pg_get_functiondef('public.ca_gto_v31_certification_status(uuid)'::regprocedure))
     IS DISTINCT FROM 'ae20103b60c148df94db32092e816610' THEN
    RAISE EXCEPTION 'ca_gto_v31_certification_status_preimage_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.gto_v31_datasets'::regclass
               AND attname='evaluation_contract' AND NOT attisdropped)
     OR to_regprocedure('public.fn_gto_v31_evaluation_plan(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'v31_evaluation_contract_v3_already_installed';
  END IF;
END $guard$;

-- 1. The contract column: every existing dataset is v2; every new one is v3.
ALTER TABLE public.gto_v31_datasets
  ADD COLUMN evaluation_contract text NOT NULL DEFAULT 'gto_v31_candidate.v2'
  CONSTRAINT gto_v31_datasets_evaluation_contract_check
    CHECK (evaluation_contract IN ('gto_v31_candidate.v2','gto_v31_candidate.v3'));
ALTER TABLE public.gto_v31_datasets ALTER COLUMN evaluation_contract SET DEFAULT 'gto_v31_candidate.v3';

CREATE FUNCTION public.fn_gto_v31_evaluation_contract_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3' THEN
      RAISE EXCEPTION 'a new V31 dataset is certified under evaluation contract v3';
    END IF;
  ELSIF NEW.evaluation_contract IS DISTINCT FROM OLD.evaluation_contract THEN
    RAISE EXCEPTION 'a V31 dataset''s evaluation contract is immutable';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_contract_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_datasets_evaluation_contract_guard
  BEFORE INSERT OR UPDATE ON public.gto_v31_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_evaluation_contract_guard();

-- 2. What a dataset must cover, by contract.
CREATE FUNCTION public.fn_gto_v31_v3_families(p_dataset_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(f.family ORDER BY f.ord),ARRAY[]::text[])
    FROM unnest(ARRAY['cash','spin','tourney_ev','tourney_icm']) WITH ORDINALITY f(family,ord)
   WHERE EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
                  WHERE c.dataset_id=p_dataset_id AND c.game_family=f.family)
$function$;

CREATE FUNCTION public.fn_gto_v31_required_families(p_dataset_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.gto_v31_datasets d
                            WHERE d.dataset_id=p_dataset_id
                              AND d.evaluation_contract='gto_v31_candidate.v3')
              THEN public.fn_gto_v31_v3_families(p_dataset_id)
              ELSE ARRAY['cash','spin','tourney_ev','tourney_icm']::text[] END
$function$;

CREATE FUNCTION public.fn_gto_v31_required_roles(p_dataset_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.gto_v31_datasets d
                            WHERE d.dataset_id=p_dataset_id
                              AND d.evaluation_contract='gto_v31_candidate.v3')
              THEN COALESCE((SELECT array_agg(DISTINCT c.node_role ORDER BY c.node_role)
                               FROM public.gto_v31_runtime_cells c
                              WHERE c.dataset_id=p_dataset_id),ARRAY[]::text[])
              ELSE ARRAY['open','cbet','probe','delayed_cbet','barrel','facing_bet',
                         'facing_raise','check_raise','bet_raise','all_in']::text[] END
$function$;

CREATE FUNCTION public.fn_gto_v31_v3_breadth_ok(p_dataset_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id)
     AND NOT EXISTS (
       SELECT 1
         FROM (SELECT DISTINCT c.game_family,c.objective FROM public.gto_v31_runtime_cells c
                WHERE c.dataset_id=p_dataset_id) fo
        CROSS JOIN unnest(ARRAY['flop','turn','river']) s(street)
        WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
                           WHERE c.dataset_id=p_dataset_id AND c.game_family=fo.game_family
                             AND c.objective=fo.objective AND c.street=s.street))
$function$;

-- 3. The v3 table list, cells and pair count (mirrored in
--    server/src/benchmark/GtoV31EvaluationContractV3.ts).
CREATE FUNCTION public.fn_gto_v31_v3_tables(p_dataset_id uuid, p_family text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT array_agg(t.k ORDER BY t.k COLLATE "C")
                     FROM (SELECT DISTINCT c.utility_context||'_'||c.table_size::text||'max_'
                                  ||c.depth_bucket::text||'bb' AS k
                             FROM public.gto_v31_runtime_cells c
                            WHERE c.dataset_id=p_dataset_id AND c.game_family=p_family) t),
                  ARRAY[]::text[])
      || COALESCE((SELECT ARRAY['human_cash_ev_6max_'||max(c.depth_bucket)::text||'bb']
                     FROM public.gto_v31_runtime_cells c
                    WHERE p_family='cash' AND c.dataset_id=p_dataset_id
                      AND c.game_family='cash' AND c.table_size=6
                   HAVING count(*)>0),ARRAY[]::text[])
$function$;

CREATE FUNCTION public.fn_gto_v31_v3_cells(p_dataset_id uuid, p_family text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(c.cell_key_checksum ORDER BY c.cell_key_checksum COLLATE "C"),
                  ARRAY[]::text[])
    FROM public.gto_v31_runtime_cells c
   WHERE c.dataset_id=p_dataset_id AND c.game_family=p_family
$function$;

CREATE FUNCTION public.fn_gto_v31_v3_pairs(p_tables integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_tables>=1 THEN greatest(10000,ceil(50000.0/p_tables)::integer) END
$function$;

-- 4. The plan the evaluator must match before it deals a hand.
CREATE FUNCTION public.fn_gto_v31_evaluation_plan(p_dataset_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contract text;
  v_families jsonb := '{}'::jsonb;
  v_family text;
  v_tables text[];
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT d.evaluation_contract INTO v_contract FROM public.gto_v31_datasets d
   WHERE d.dataset_id=p_dataset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset does not exist'; END IF;
  IF v_contract='gto_v31_candidate.v3' THEN
    FOREACH v_family IN ARRAY public.fn_gto_v31_v3_families(p_dataset_id) LOOP
      v_tables:=public.fn_gto_v31_v3_tables(p_dataset_id,v_family);
      v_families:=v_families||jsonb_build_object(v_family,jsonb_build_object(
        'tables',to_jsonb(v_tables),
        'cells',to_jsonb(public.fn_gto_v31_v3_cells(p_dataset_id,v_family)),
        'pairs_per_table',public.fn_gto_v31_v3_pairs(cardinality(v_tables)),
        'min_table_decisions',300));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('evaluation_contract',v_contract,'families',v_families);
END;
$function$;

-- 5. One run (a table's learning-on or learning-off play) meets the floors.
CREATE FUNCTION public.fn_gto_v31_v3_run_valid(p_run jsonb, p_pairs integer, p_cells text[])
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_run IS NULL OR jsonb_typeof(p_run) IS DISTINCT FROM 'object' OR p_pairs IS NULL THEN
    RETURN false;
  END IF;
  IF NOT (p_run ?& ARRAY['hands','bb100','stderr','duration_ms','illegal_actions',
            'truncated_streets','candidate_policy_hits','candidate_execution_mismatches',
            'candidate_cells']::text[]) THEN
    RETURN false;
  END IF;
  IF COALESCE(p_run->>'hands','') !~ '^[1-9][0-9]*$'
     OR jsonb_typeof(p_run->'bb100') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_run->'stderr') IS DISTINCT FROM 'number'
     OR COALESCE(p_run->>'duration_ms','') !~ '^[1-9][0-9]*$'
     OR COALESCE(p_run->>'illegal_actions','') !~ '^[0-9]+$'
     OR COALESCE(p_run->>'truncated_streets','') !~ '^[0-9]+$'
     OR COALESCE(p_run->>'candidate_policy_hits','') !~ '^[0-9]+$'
     OR COALESCE(p_run->>'candidate_execution_mismatches','') !~ '^[0-9]+$'
     OR jsonb_typeof(p_run->'candidate_cells') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF (p_run->>'hands')::bigint <> 2*p_pairs::bigint
     OR (p_run->>'stderr')::numeric < 0
     OR (p_run->>'illegal_actions')::bigint <> 0
     OR (p_run->>'truncated_streets')::bigint <> 0
     OR (p_run->>'candidate_execution_mismatches')::bigint <> 0
     OR (p_run->>'candidate_policy_hits')::bigint < 300
     OR jsonb_array_length(p_run->'candidate_cells') = 0 THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_run->'candidate_cells') x(v)
                      WHERE jsonb_typeof(x.v) IS DISTINCT FROM 'string'
                         OR NOT (x.v#>>'{}' = ANY(p_cells)))
     AND (SELECT count(*) FROM jsonb_array_elements_text(p_run->'candidate_cells'))
       = (SELECT count(DISTINCT x.v) FROM jsonb_array_elements_text(p_run->'candidate_cells') x(v));
END;
$function$;

-- 6. A v3 family result: exact tables, floors, memory-off runs, cell coverage
--    and totals that reconcile with the components (v2's identity checks).
CREATE FUNCTION public.fn_gto_v31_v3_result_valid(
  p_dataset public.gto_v31_datasets, p_kind text, p_family text,
  p_result public.horse_league_results, p_epoch_no integer, p_incumbent text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_roles constant text[] := ARRAY['open','cbet','probe','delayed_cbet','barrel','facing_bet',
    'facing_raise','check_raise','bet_raise','all_in'];
  v_tables text[];
  v_cells text[];
  v_n integer;
  v_pairs integer;
  v_profile text;
  v_keys integer;
  v_c jsonb;
  v_i integer;
  v_hands numeric; v_hits numeric; v_mism numeric; v_duration numeric;
  v_bb numeric; v_se numeric;
  v_component_roles text[]; v_result_roles text[]; v_reached text[];
BEGIN
  IF p_dataset.dataset_id IS NULL OR p_result.id IS NULL
     OR p_dataset.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3'
     OR p_kind IS NULL OR p_kind NOT IN ('paired_replay','league') THEN
    RETURN false;
  END IF;
  v_tables:=public.fn_gto_v31_v3_tables(p_dataset.dataset_id,p_family);
  v_cells:=public.fn_gto_v31_v3_cells(p_dataset.dataset_id,p_family);
  v_n:=cardinality(v_tables);
  IF v_n=0 THEN RETURN false; END IF;
  v_pairs:=public.fn_gto_v31_v3_pairs(v_n);
  v_profile:=CASE p_kind WHEN 'paired_replay' THEN 'policy_only_duplicate_deals'
                         ELSE 'full_brain_duplicate_deal_league' END;
  v_keys:=CASE p_kind WHEN 'league' THEN 12 ELSE 11 END;

  IF jsonb_typeof(p_result.config_a) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result.config_b) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result.candidate_benchmark_components) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_result.config_a))
       <> (8 + CASE WHEN p_dataset.feature_contract_version IS NULL THEN 0 ELSE 1 END
             + CASE WHEN p_dataset.policy_export_schema IS NULL THEN 0 ELSE 1 END)
     OR NOT (p_result.config_a ?& ARRAY['evaluation_contract','evaluation_kind','game_family',
       'dataset_checksum','candidate','evaluation_profile','scenarios',
       'evaluation_engine_commit']::text[])
     OR NOT public.fn_gto_v31_feature_request_valid(p_result.config_a)
     OR NOT public.fn_gto_v31_policy_request_valid(p_result.config_a)
     OR p_result.config_a->>'policy_export_schema' IS DISTINCT FROM p_dataset.policy_export_schema
     OR p_result.config_a->>'feature_contract_version' IS DISTINCT FROM p_dataset.feature_contract_version
     OR p_result.config_a->>'evaluation_contract' IS DISTINCT FROM 'gto_v31_candidate.v3'
     OR p_result.config_a->>'evaluation_kind' IS DISTINCT FROM p_kind
     OR p_result.config_a->>'game_family' IS DISTINCT FROM p_family
     OR p_result.config_a->>'dataset_checksum' IS DISTINCT FROM p_dataset.dataset_checksum
     OR p_result.config_a->>'candidate' IS DISTINCT FROM 'v31_certified'
     OR p_result.config_a->>'evaluation_profile' IS DISTINCT FROM v_profile
     OR p_result.config_a->'scenarios' IS DISTINCT FROM to_jsonb(v_tables)
     OR COALESCE(p_result.config_a->>'evaluation_engine_commit','') !~ '^[0-9a-f]{40}$'
     OR p_result.config_a->>'evaluation_engine_commit' = repeat('0',40)
     OR (SELECT count(*) FROM jsonb_object_keys(p_result.config_b)) <> 2
     OR p_result.config_b->>'incumbent_dataset_checksum' IS DISTINCT FROM p_incumbent
     OR p_result.config_b->>'candidate' IS DISTINCT FROM 'incumbent'
     OR p_result.matchup IS DISTINCT FROM public.fn_gto_v31_evaluation_matchup(
          p_kind,p_family,p_dataset.dataset_checksum,p_epoch_no)
     OR p_result.hands IS DISTINCT FROM 2*v_pairs*v_n
     OR p_result.illegal_actions IS DISTINCT FROM 0
     OR p_result.truncated_streets IS DISTINCT FROM 0
     OR p_result.candidate_execution_mismatches IS DISTINCT FROM 0
     OR COALESCE(p_result.candidate_policy_hits,0) < 300*v_n
     OR COALESCE(p_result.duration_ms,0) <= 0
     OR COALESCE(p_result.stderr,-1) < 0
     OR p_result.bb100 IS NULL
     OR COALESCE(array_length(p_result.candidate_node_roles,1),0) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_result.candidate_node_roles) r(v)
                 WHERE r.v IS NULL OR NOT (r.v = ANY(v_roles)))
     OR jsonb_array_length(p_result.candidate_benchmark_components) <> v_n THEN
    RETURN false;
  END IF;

  FOR v_i IN 1..v_n LOOP
    v_c:=p_result.candidate_benchmark_components->(v_i-1);
    IF NOT public.fn_gto_v31_v3_run_valid(v_c,v_pairs,v_cells) THEN RETURN false; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_c)) <> v_keys
       OR NOT (v_c ?& ARRAY['scenario','candidate_node_roles']::text[])
       OR v_c->>'scenario' IS DISTINCT FROM v_tables[v_i]
       OR jsonb_typeof(v_c->'candidate_node_roles') IS DISTINCT FROM 'array' THEN
      RETURN false;
    END IF;
    IF jsonb_array_length(v_c->'candidate_node_roles') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_c->'candidate_node_roles') r(v)
                   WHERE jsonb_typeof(r.v) IS DISTINCT FROM 'string'
                      OR NOT (r.v#>>'{}' = ANY(v_roles)))
       OR jsonb_array_length(v_c->'candidate_node_roles') <>
          (SELECT count(DISTINCT r.v) FROM jsonb_array_elements_text(v_c->'candidate_node_roles') r(v)) THEN
      RETURN false;
    END IF;
    IF p_kind='league' THEN
      IF NOT public.fn_gto_v31_v3_run_valid(v_c->'memory_off',v_pairs,v_cells)
         OR (SELECT count(*) FROM jsonb_object_keys(v_c->'memory_off')) <> 9 THEN
        RETURN false;
      END IF;
    ELSIF v_c ? 'memory_off' THEN
      RETURN false;
    END IF;
  END LOOP;

  SELECT sum((c.v->>'hands')::numeric), sum((c.v->>'candidate_policy_hits')::numeric),
         sum((c.v->>'candidate_execution_mismatches')::numeric), sum((c.v->>'duration_ms')::numeric),
         sum((c.v->>'bb100')::numeric*(c.v->>'hands')::numeric)/sum((c.v->>'hands')::numeric),
         sqrt(sum(power((c.v->>'stderr')::numeric*(c.v->>'hands')::numeric,2)))
           /sum((c.v->>'hands')::numeric)
    INTO v_hands,v_hits,v_mism,v_duration,v_bb,v_se
    FROM jsonb_array_elements(p_result.candidate_benchmark_components) c(v);
  SELECT array_agg(DISTINCT r.v COLLATE "C" ORDER BY r.v COLLATE "C") INTO v_component_roles
    FROM jsonb_array_elements(p_result.candidate_benchmark_components) c(v)
   CROSS JOIN LATERAL jsonb_array_elements_text(c.v->'candidate_node_roles') r(v);
  SELECT array_agg(DISTINCT r.v COLLATE "C" ORDER BY r.v COLLATE "C") INTO v_result_roles
    FROM unnest(p_result.candidate_node_roles) r(v);
  SELECT array_agg(DISTINCT x.v COLLATE "C" ORDER BY x.v COLLATE "C") INTO v_reached
    FROM jsonb_array_elements(p_result.candidate_benchmark_components) c(v)
   CROSS JOIN LATERAL jsonb_array_elements_text(c.v->'candidate_cells') x(v);

  RETURN v_hands = p_result.hands
     AND v_hits = p_result.candidate_policy_hits
     AND v_mism = p_result.candidate_execution_mismatches
     AND v_duration = p_result.duration_ms
     AND abs(v_bb - p_result.bb100) <= 0.000001
     AND abs(v_se - p_result.stderr) <= 0.000001
     AND v_component_roles IS NOT DISTINCT FROM v_result_roles
     AND array_length(p_result.candidate_node_roles,1) = array_length(v_result_roles,1)
     -- every sealed cell of the family was executed by a learning-on table
     AND v_reached IS NOT DISTINCT FROM v_cells;
END;
$function$;

-- 7. Recording a v3 receipt (the v2 rules, on the v3 result contract).
CREATE FUNCTION public.fn_gto_v31_record_evaluation_v3(
  p_dataset_id uuid, p_evaluation_kind text, p_game_family text, p_source_result_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_result public.horse_league_results%ROWTYPE;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
  v_incumbent text;
  v_verdict text;
  v_metrics jsonb;
  v_checksum text;
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p_evaluation_kind NOT IN ('paired_replay','league')
     OR p_game_family NOT IN ('cash','spin','tourney_ev','tourney_icm') THEN
    RAISE EXCEPTION 'evaluation kind or family is invalid';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='evaluating' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not awaiting evaluation'; END IF;
  IF v_dataset.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3' THEN
    RAISE EXCEPTION 'dataset is not certified under evaluation contract v3';
  END IF;
  IF NOT (p_game_family = ANY(public.fn_gto_v31_v3_families(p_dataset_id))) THEN
    RAISE EXCEPTION 'the dataset has no cells in family %; contract v3 certifies only the families a dataset plays',p_game_family;
  END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL AND promoted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no open evaluation epoch; open one for the evaluated engine commit first'; END IF;
  SELECT COALESCE((SELECT dataset_checksum FROM public.gto_v31_datasets
    WHERE state='active' AND dataset_id<>p_dataset_id LIMIT 1),'legacy_v30') INTO v_incumbent;
  SELECT * INTO v_result FROM public.horse_league_results WHERE id=p_source_result_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'league result does not exist'; END IF;
  IF v_result.run_date<current_date-2 OR v_result.run_date>current_date
     OR NOT public.fn_gto_v31_v3_result_valid(v_dataset,p_evaluation_kind,p_game_family,
              v_result,v_epoch.epoch_no,v_incumbent) THEN
    RAISE EXCEPTION 'league result is stale, unsafe, or not the contract v3 tables, floors, memory-off runs and cells of this candidate and incumbent';
  END IF;
  IF v_result.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_epoch.engine_commit THEN
    RAISE EXCEPTION 'the result was produced by a different engine commit than the open epoch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_release_evaluations e
     WHERE e.dataset_id=p_dataset_id
       AND e.evaluation_kind IN ('paired_replay','league')
       AND e.evaluation_epoch_id=v_epoch.epoch_id
       AND e.metrics#>>'{candidate_config,evaluation_engine_commit}'
           IS DISTINCT FROM v_result.config_a->>'evaluation_engine_commit'
  ) THEN
    RAISE EXCEPTION 'candidate evaluations were produced by different engine commits';
  END IF;

  v_verdict:=CASE WHEN v_result.bb100>2*v_result.stderr THEN 'win'
                  WHEN v_result.bb100<(-2*v_result.stderr) THEN 'loss' ELSE 'tie' END;
  v_metrics:=jsonb_build_object('source_result_id',v_result.id,'run_date',v_result.run_date,
    'matchup',v_result.matchup,'hands',v_result.hands,'bb100',v_result.bb100,
    'stderr',v_result.stderr,'illegal_actions',v_result.illegal_actions,
    'truncated_streets',v_result.truncated_streets,'duration_ms',v_result.duration_ms,
    'candidate_policy_hits',v_result.candidate_policy_hits,
    'candidate_execution_mismatches',v_result.candidate_execution_mismatches,
    'candidate_node_roles',v_result.candidate_node_roles,
    'benchmark_components',v_result.candidate_benchmark_components,
    'candidate_config',v_result.config_a,'incumbent_config',v_result.config_b);
  v_checksum:=public.fn_gto_v31_json_checksum(jsonb_build_object(
    'dataset_checksum',v_dataset.dataset_checksum,'kind',p_evaluation_kind,
    'family',p_game_family,'verdict',v_verdict,'metrics',v_metrics));
  INSERT INTO public.gto_v31_release_evaluations (
    dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,
    source_result_id,result_checksum,evaluation_epoch_id,evaluation_engine_commit
  ) VALUES (
    p_dataset_id,v_dataset.dataset_checksum,p_evaluation_kind,p_game_family,
    v_verdict,v_metrics,p_source_result_id,v_checksum,v_epoch.epoch_id,v_epoch.engine_commit
  ) ON CONFLICT (dataset_id,evaluation_kind,game_family,evaluation_engine_commit)
    WHERE evaluation_kind IN ('paired_replay','league') DO NOTHING
  RETURNING evaluation_id INTO v_id;
  IF v_id IS NULL THEN
    SELECT evaluation_id INTO v_id FROM public.gto_v31_release_evaluations
     WHERE dataset_id=p_dataset_id AND evaluation_kind=p_evaluation_kind
       AND game_family=p_game_family AND evaluation_epoch_id=v_epoch.epoch_id
       AND result_checksum=v_checksum;
    IF v_id IS NULL THEN RAISE EXCEPTION 'an evaluation receipt already exists with another result'; END IF;
  END IF;
  RETURN v_id;
END;
$function$;

-- 8. The v3 receipt set: exactly the dataset's families, both kinds, one
--    engine commit, every receipt still valid; never dropping an incumbent family.
CREATE FUNCTION public.fn_gto_v31_candidate_evaluations_valid_v3(p_dataset_id uuid, p_dataset_checksum text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_families text[];
  v_incumbent text;
  v_incumbent_id uuid;
  v_active_incumbents integer;
  v_receipts integer;
  v_engine_commits integer;
  v_epoch_id uuid; v_epoch_no integer; v_epoch_commit text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0));
  IF p_dataset_id IS NULL
     OR COALESCE(p_dataset_checksum,'')!~'^[0-9a-f]{64}$'
     OR p_dataset_checksum=repeat('0',64) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id;
  IF NOT FOUND OR v_dataset.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3'
     OR v_dataset.dataset_checksum IS DISTINCT FROM p_dataset_checksum THEN
    RETURN false;
  END IF;
  SELECT p.epoch_id,p.epoch_no,p.engine_commit INTO v_epoch_id,v_epoch_no,v_epoch_commit
    FROM public.gto_v31_evaluation_epochs p
   WHERE p.dataset_id=p_dataset_id AND p.superseded_at IS NULL AND p.promoted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  v_families:=public.fn_gto_v31_v3_families(p_dataset_id);
  IF cardinality(v_families)=0 THEN RETURN false; END IF;

  SELECT count(*),max(d.dataset_checksum),(array_agg(d.dataset_id))[1]
    INTO v_active_incumbents,v_incumbent,v_incumbent_id
    FROM public.gto_v31_datasets d
   WHERE d.state='active' AND d.dataset_id<>p_dataset_id;
  IF v_active_incumbents=0 THEN
    v_incumbent:='legacy_v30';
  ELSIF v_active_incumbents<>1
     OR COALESCE(v_incumbent,'')!~'^[0-9a-f]{64}$'
     OR v_incumbent=repeat('0',64) THEN
    RETURN false;
  ELSIF EXISTS (SELECT 1 FROM unnest(public.fn_gto_v31_v3_families(v_incumbent_id)) f(v)
                 WHERE NOT (f.v = ANY(v_families))) THEN
    -- Promotion retires the incumbent; a narrower playbook would silently
    -- stop serving a family the incumbent certified.
    RETURN false;
  END IF;

  SELECT count(*),
         count(DISTINCT e.metrics#>>'{candidate_config,evaluation_engine_commit}')
    INTO v_receipts,v_engine_commits
    FROM public.gto_v31_release_evaluations e
    JOIN public.horse_league_results r ON r.id=e.source_result_id
   WHERE e.dataset_id=p_dataset_id
     AND e.dataset_checksum=p_dataset_checksum
     AND e.evaluation_kind IN ('paired_replay','league')
     AND e.evaluation_epoch_id=v_epoch_id;
  IF v_receipts<>2*cardinality(v_families) OR v_engine_commits<>1 THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY['paired_replay','league']) k(kind)
     CROSS JOIN unnest(v_families) f(family)
      LEFT JOIN public.gto_v31_release_evaluations e
        ON e.dataset_id=p_dataset_id
       AND e.dataset_checksum=p_dataset_checksum
       AND e.evaluation_kind=k.kind
       AND e.game_family=f.family
       AND e.evaluation_epoch_id=v_epoch_id
      LEFT JOIN public.horse_league_results r ON r.id=e.source_result_id
     WHERE e.evaluation_id IS NULL
        OR r.id IS NULL
        OR e.verdict NOT IN ('win','tie')
        OR e.verdict IS DISTINCT FROM CASE
             WHEN r.bb100>2*r.stderr THEN 'win'
             WHEN r.bb100<(-2*r.stderr) THEN 'loss'
             ELSE 'tie'
           END
        OR NOT public.fn_gto_v31_v3_result_valid(v_dataset,k.kind,f.family,r,v_epoch_no,v_incumbent)
        OR r.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_epoch_commit
        OR e.evaluation_engine_commit IS DISTINCT FROM v_epoch_commit
        OR e.metrics IS DISTINCT FROM jsonb_build_object(
          'source_result_id',r.id,'run_date',r.run_date,'matchup',r.matchup,
          'hands',r.hands,'bb100',r.bb100,'stderr',r.stderr,
          'illegal_actions',r.illegal_actions,'truncated_streets',r.truncated_streets,
          'duration_ms',r.duration_ms,'candidate_policy_hits',r.candidate_policy_hits,
          'candidate_execution_mismatches',r.candidate_execution_mismatches,
          'candidate_node_roles',r.candidate_node_roles,
          'benchmark_components',r.candidate_benchmark_components,
          'candidate_config',r.config_a,'incumbent_config',r.config_b)
        OR e.result_checksum IS DISTINCT FROM public.fn_gto_v31_json_checksum(
          jsonb_build_object('dataset_checksum',p_dataset_checksum,
            'kind',k.kind,'family',f.family,
            'verdict',e.verdict,'metrics',e.metrics))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_families(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_required_families(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_required_roles(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_breadth_ok(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_tables(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_cells(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_pairs(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_run_valid(jsonb,integer,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_result_valid(public.gto_v31_datasets,text,text,public.horse_league_results,integer,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_record_evaluation_v3(uuid,text,text,bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_candidate_evaluations_valid_v3(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_evaluation_plan(uuid) TO service_role;

-- 9. Minimal patches to the live definitions. Each anchor must occur exactly
--    once; each result must equal its proven postimage.
CREATE FUNCTION pg_temp.v31_patch(p_fn regprocedure, p_pairs text[], p_post text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i integer;
BEGIN
  FOR i IN 1..array_length(p_pairs,1)/2 LOOP
    IF (length(d)-length(replace(d,p_pairs[2*i-1],'')))/length(p_pairs[2*i-1]) <> 1 THEN
      RAISE EXCEPTION 'v31 contract v3 patch anchor % of % does not occur exactly once',i,p_fn;
    END IF;
    d:=replace(d,p_pairs[2*i-1],p_pairs[2*i]);
  END LOOP;
  EXECUTE d;
  IF md5(pg_get_functiondef(p_fn)) IS DISTINCT FROM p_post THEN
    RAISE EXCEPTION 'v31 contract v3 postimage of % differs: %',p_fn,md5(pg_get_functiondef(p_fn));
  END IF;
END;
$function$;

SELECT pg_temp.v31_patch('public.fn_gto_v31_record_evaluation(uuid,text,text,bigint)'::regprocedure, ARRAY[
$a$    RAISE EXCEPTION 'evaluation kind or family is invalid';
  END IF;
$a$, $b$    RAISE EXCEPTION 'evaluation kind or family is invalid';
  END IF;
  -- Contract v3 (2026-11-06): a v3 dataset's receipts follow its own tables.
  IF EXISTS (SELECT 1 FROM public.gto_v31_datasets
              WHERE dataset_id=p_dataset_id AND evaluation_contract='gto_v31_candidate.v3') THEN
    RETURN public.fn_gto_v31_record_evaluation_v3(p_dataset_id,p_evaluation_kind,p_game_family,p_source_result_id);
  END IF;
$b$], '3ab969726639d525ff445cc255e48aef');

SELECT pg_temp.v31_patch('public.fn_gto_v31_candidate_evaluations_valid(uuid,text)'::regprocedure, ARRAY[
$a$  -- Only the dataset's open evaluation epoch qualifies; earlier epochs stay
$a$, $b$  -- Contract v3 (2026-11-06): a v3 dataset's receipt set is its own families.
  IF EXISTS (SELECT 1 FROM public.gto_v31_datasets
              WHERE dataset_id=p_dataset_id AND evaluation_contract='gto_v31_candidate.v3') THEN
    RETURN public.fn_gto_v31_candidate_evaluations_valid_v3(p_dataset_id,p_dataset_checksum);
  END IF;

  -- Only the dataset's open evaluation epoch qualifies; earlier epochs stay
$b$], 'd928f21116030039a307017b6d3d1449');

SELECT pg_temp.v31_patch('public.fn_gto_v31_mark_candidate(uuid)'::regprocedure, ARRAY[
$a$CROSS JOIN unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel',
           'facing_bet','facing_raise','check_raise','bet_raise','all_in']) required_role(value)$a$,
$b$CROSS JOIN unnest(public.fn_gto_v31_required_roles(p_dataset_id)) required_role(value)$b$],
'03a09bcd3dd0330e1e3666566b61b100');

SELECT pg_temp.v31_patch('public.fn_gto_v31_promote_dataset_epoch(uuid,text,text)'::regprocedure, ARRAY[
$a$CROSS JOIN unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel',
           'facing_bet','facing_raise','check_raise','bet_raise','all_in']) required_role(value)$a$,
$b$CROSS JOIN unnest(public.fn_gto_v31_required_roles(p_dataset_id)) required_role(value)$b$,
$a$unnest(ARRAY['cash','spin','tourney_ev','tourney_icm']) family(value)$a$,
$b$unnest(public.fn_gto_v31_required_families(p_dataset_id)) family(value)$b$,
$a$e.evaluation_epoch_id=v_epoch.epoch_id)))<>9 THEN$a$,
$b$e.evaluation_epoch_id=v_epoch.epoch_id)))<>(1+2*cardinality(public.fn_gto_v31_required_families(p_dataset_id))) THEN$b$],
'6f8a2eda90c5d9698a99a41e0abf40d4');

SELECT pg_temp.v31_patch('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure, ARRAY[
$a$  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='flop')
$a$, $b$  IF v_dataset.evaluation_contract='gto_v31_candidate.v3' THEN
    -- Contract v3 (2026-11-06): breadth within the dataset's own scope.
    IF NOT public.fn_gto_v31_v3_breadth_ok(p_dataset_id) THEN
      RAISE EXCEPTION 'required v3 scope coverage is incomplete: every family and objective the dataset carries must cover flop, turn and river';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='flop')
$b$,
$a$  FOREACH v_family IN ARRAY ARRAY['cash','spin','tourney_ev','tourney_icm'] LOOP$a$,
$b$  FOREACH v_family IN ARRAY public.fn_gto_v31_required_families(p_dataset_id) LOOP$b$],
'2e67050be5838b52822fbe33f396aeba');

SELECT pg_temp.v31_patch('public.ca_gto_v31_certification_status(uuid)'::regprocedure, ARRAY[
$a$        'coverage',d.coverage,
$a$, $b$        'evaluation_contract',d.evaluation_contract,
        'required_families',to_jsonb(public.fn_gto_v31_required_families(d.dataset_id)),
        'coverage',d.coverage,
$b$], '68174015d725f8e6316dd5c3d373504a');

COMMIT;

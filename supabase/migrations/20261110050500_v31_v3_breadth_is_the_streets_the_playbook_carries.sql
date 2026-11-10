-- V31 evaluation contract v3: breadth is the streets the playbook carries.
--
-- Contract v3 (#9807, 2026-11-07) made the seal require that every family and
-- objective a dataset carries covers flop, turn AND river. R8
-- (1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b) was planned with turn and river
-- cells only (no flop texture had board capacity for its 57 + 8 board design)
-- and completed every stage up to seal_dataset, which fn_gto_v31_v3_breadth_ok
-- refused on 2026-11-10 03:59:57Z. Owner decision 2026-11-09 22:56 CST: the
-- playbook certifies the streets it carries; streets it does not carry stay
-- with the horse brain, exactly as today.
--
-- Breadth now means: the dataset has cells, and every family/objective it
-- carries covers every street the dataset carries anywhere. A playbook may
-- omit a street for everyone; it may not carry a street for one family or
-- objective and leave another without it. The pre-v3 branch of
-- fn_gto_v31_public215_seal_prepared (flop required) is unchanged.
--
-- Preimage guards: the live function bodies must be the #9807 ones.
-- Proof: scripts/ci/test-v31-evaluation-contract-v3.py (throwaway cluster).
-- Rollback: re-install the #9807 definition of fn_gto_v31_v3_breadth_ok.

BEGIN;

DO $guard$
DECLARE
  v_breadth text;
  v_seal text;
BEGIN
  SELECT md5(p.prosrc) INTO v_breadth FROM pg_proc p
   WHERE p.oid='public.fn_gto_v31_v3_breadth_ok(uuid)'::regprocedure;
  IF v_breadth IS DISTINCT FROM 'd62801e1098e2c18e6cebdae5563cb06' THEN
    RAISE EXCEPTION 'fn_gto_v31_v3_breadth_ok preimage differs (%); refusing to patch an unknown definition', v_breadth;
  END IF;
  SELECT p.prosrc INTO v_seal FROM pg_proc p
   WHERE p.oid='public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure;
  IF (length(v_seal)-length(replace(v_seal,'required v3 scope coverage is incomplete: every family and objective the dataset carries must cover flop, turn and river','')))
     / length('required v3 scope coverage is incomplete: every family and objective the dataset carries must cover flop, turn and river') <> 1 THEN
    RAISE EXCEPTION 'fn_gto_v31_public215_seal_prepared does not carry exactly one v3 breadth refusal message; refusing to patch';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_v3_breadth_ok(p_dataset_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Breadth within the dataset's own scope: every family/objective the
  -- playbook carries covers every street the playbook carries anywhere.
  SELECT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id)
     AND NOT EXISTS (
       SELECT 1
         FROM (SELECT DISTINCT c.game_family,c.objective FROM public.gto_v31_runtime_cells c
                WHERE c.dataset_id=p_dataset_id) fo
        CROSS JOIN (SELECT DISTINCT c.street FROM public.gto_v31_runtime_cells c
                     WHERE c.dataset_id=p_dataset_id) s
        WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
                           WHERE c.dataset_id=p_dataset_id AND c.game_family=fo.game_family
                             AND c.objective=fo.objective AND c.street=s.street))
$function$;

-- Owner only, exactly as #9807 left it (the seal calls it as the owner).
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_breadth_ok(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure) INTO v_def;
  v_def := replace(v_def,
    'required v3 scope coverage is incomplete: every family and objective the dataset carries must cover flop, turn and river',
    'required v3 scope coverage is incomplete: every family and objective the dataset carries must cover every street the playbook carries');
  EXECUTE v_def;
END
$patch$;

DO $post$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid='public.fn_gto_v31_v3_breadth_ok(uuid)'::regprocedure)
     = 'd62801e1098e2c18e6cebdae5563cb06' THEN
    RAISE EXCEPTION 'fn_gto_v31_v3_breadth_ok was not replaced';
  END IF;
  IF position('must cover every street the playbook carries' IN
       (SELECT p.prosrc FROM pg_proc p WHERE p.oid='public.fn_gto_v31_public215_seal_prepared(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fn_gto_v31_public215_seal_prepared message was not patched';
  END IF;
END
$post$;

COMMIT;

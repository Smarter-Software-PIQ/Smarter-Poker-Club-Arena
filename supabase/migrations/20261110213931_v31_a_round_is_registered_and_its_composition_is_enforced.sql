-- 20261110213931_v31_a_round_is_registered_and_its_composition_is_enforced
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-10 21:39:31 UTC.
--
-- A V31 ROUND IS REGISTERED BEFORE IT RUNS, AND ITS COMPOSITION IS ENFORCED (2026-11-10)
--
-- WHY. Dan approved the R8 plan on 2026-11-06 with a density pre-flight of
-- "100 cells (70 flop, 23 turn, 7 river)". The dataset that was solved,
-- trained and sealed had 0 flop / 67 turn / 33 river. The change happened at
-- plan freeze (2026-11-07 20:58Z-21:55Z): the approved plan could not meet
-- the 57 M1 + 8 M2 board recipe on 58 of 76 flop contexts, the predecessor
-- writer re-selected cells under an unidentified "coordinator's decision",
-- and nothing downstream compared the re-frozen plan with the approval. The
-- approval existed only as prose in gto_v31_program_state.evidence
-- (r8_density_preflight), so no check could read it. The first check that
-- noticed anything was the v3 breadth rule at the final seal call, after
-- every solver hour had been spent (CHECKPOINT 2026-11-10T16:45Z, "PLAN
-- DEVIATION RECORD"). Owner direction 2026-11-10 15:09 CST: "Implement a
-- permanent pre-execution check binding the approved composition and source
-- manifest to the actual generated workload. Verify actual artifacts again
-- before training and sealing. Fail clearly on discrepancies; do not silently
-- substitute available cells." and "Before consuming a new held-out set,
-- record the candidate, exact composition, dataset provenance, acceptance
-- criteria and bounded evaluation plan through the programme's required
-- registration process."
--
-- WHAT CHANGES.
--
-- gto_v31_round_registrations is that registration process: one row per
-- round, written before the round's dataset exists, carrying the owner's
-- authorization (source and quote), the candidate (what changes and why),
-- the exact cell list and its street composition, the cell-set checksum,
-- the dataset provenance, the acceptance criteria (the quality gates the
-- seal applies) and the bounded evaluation plan. A registration is
-- immutable; only the two lifecycle stamps move, once each.
--
-- Three checks bind it to the actual workload, each failing with the
-- registered and the actual composition in the message:
--   1. dataset insert (before any solve: M1/M2 work is keyed to a dataset):
--      the dataset_key must have a registration that no other dataset used,
--      its declared_coverage must be exactly the registered cell set and its
--      quality_gates exactly the registered gates;
--   2. training (World Hub trainer, same change set): the manifest's M1
--      contexts must hash to the registered cell-set checksum before any fit;
--   3. seal (the only point the held-out set is consumed): the runtime cells
--      actually built must be exactly the registered cell set; the seal
--      stamps heldout_consumed_at, and the dataset (one per registration)
--      cannot be sealed twice.
--
-- The cell-set checksum is fn_gto_v31_public215_digest of the contexts in
-- canonical order, the same digest the Python pipeline already computes
-- byte for byte (public_hist215.digest), so the trainer and the database
-- agree without any new hashing code.
--
-- Datasets created before this migration keep their history; they are never
-- re-checked at insert. Any seal from now on needs a registration, so an
-- abandoned 'building' dataset of an earlier round cannot be sealed around
-- this rule.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.gto_v31_round_registrations (
  registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_key text NOT NULL UNIQUE CHECK (round_key ~ '^r[0-9]{1,4}$'),
  dataset_key text NOT NULL UNIQUE CHECK (dataset_key ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'),
  composition jsonb NOT NULL,
  cells jsonb NOT NULL,
  cell_set_checksum text NOT NULL CHECK (cell_set_checksum ~ '^[0-9a-f]{64}$'),
  owner_authorization jsonb NOT NULL,
  candidate jsonb NOT NULL,
  dataset_provenance jsonb NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  evaluation_plan jsonb NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  dataset_id uuid UNIQUE REFERENCES public.gto_v31_datasets(dataset_id),
  heldout_consumed_at timestamptz
);

COMMENT ON TABLE public.gto_v31_round_registrations IS
  'One row per V31 round, written before its dataset exists: owner authorization, candidate, exact cell list and street composition, cell-set checksum, dataset provenance, acceptance criteria and bounded evaluation plan. Dataset insert, training and seal are each checked against it.';

ALTER TABLE public.gto_v31_round_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_round_registrations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.gto_v31_round_registrations TO service_role;

-- The 13 context keys of a V31 cell, as a jsonb object, from a runtime row.
CREATE FUNCTION public.fn_gto_v31_runtime_cell_context(c public.gto_v31_runtime_cells)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'street',c.street,'game_family',c.game_family,'objective',c.objective,
    'utility_context',c.utility_context,'table_size',c.table_size,'pot_type',c.pot_type,
    'hero_position',c.hero_position,'opponent_position',c.opponent_position,
    'depth_bucket',c.depth_bucket,'texture_class',c.texture_class,'node_role',c.node_role,
    'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket)
$function$;

-- Street composition of a cell list: {"flop":n,"turn":n,"river":n}, zeros kept.
CREATE FUNCTION public.fn_gto_v31_cell_composition(p_cells jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'flop', (SELECT count(*) FROM jsonb_array_elements(p_cells) e WHERE e->>'street'='flop'),
    'turn', (SELECT count(*) FROM jsonb_array_elements(p_cells) e WHERE e->>'street'='turn'),
    'river',(SELECT count(*) FROM jsonb_array_elements(p_cells) e WHERE e->>'street'='river'))
$function$;

-- Canonical cell-set checksum: digest of the contexts in canonical byte order.
-- Python: public_hist215.digest(sorted(cells, key=canonical_bytes)).
CREATE FUNCTION public.fn_gto_v31_cell_set_checksum(p_cells jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_gto_v31_public215_digest(COALESCE(
    (SELECT jsonb_agg(e ORDER BY public.fn_gto_v31_public215_canonical(e) COLLATE "C")
       FROM jsonb_array_elements(p_cells) e), '[]'::jsonb))
$function$;

CREATE FUNCTION public.fn_gto_v31_composition_text(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT format('%s flop / %s turn / %s river', p->>'flop', p->>'turn', p->>'river')
$function$;

-- Registration validity and immutability.
CREATE FUNCTION public.fn_gto_v31_round_registration_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE k text;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'a V31 round registration is permanent';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['dataset_id','heldout_consumed_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['dataset_id','heldout_consumed_at'])
       OR (OLD.dataset_id IS NOT NULL AND NEW.dataset_id IS DISTINCT FROM OLD.dataset_id)
       OR (OLD.heldout_consumed_at IS NOT NULL AND NEW.heldout_consumed_at IS DISTINCT FROM OLD.heldout_consumed_at)
       OR (NEW.heldout_consumed_at IS NOT NULL AND NEW.dataset_id IS NULL) THEN
      RAISE EXCEPTION 'a V31 round registration is immutable; only its dataset link and held-out consumption are stamped, once each';
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT
  IF NEW.dataset_id IS NOT NULL OR NEW.heldout_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a V31 round is registered before its dataset exists';
  END IF;
  IF jsonb_typeof(NEW.cells) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.cells) < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.cells) e
                 WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(e) x) IS DISTINCT FROM
                       ARRAY['depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position',
                             'node_role','objective','opponent_position','pot_type','street','table_size',
                             'texture_class','utility_context']
                    OR e->>'street' NOT IN ('flop','turn','river'))
     OR (SELECT count(DISTINCT public.fn_gto_v31_public215_canonical(e)) FROM jsonb_array_elements(NEW.cells) e)
        <> jsonb_array_length(NEW.cells) THEN
    RAISE EXCEPTION 'registered cells must be distinct V31 cell contexts with the 13 context keys';
  END IF;
  IF NEW.composition IS DISTINCT FROM public.fn_gto_v31_cell_composition(NEW.cells) THEN
    RAISE EXCEPTION 'registered composition % is not the composition of the registered cells (%)',
      NEW.composition, public.fn_gto_v31_cell_composition(NEW.cells);
  END IF;
  IF NEW.cell_set_checksum IS DISTINCT FROM public.fn_gto_v31_cell_set_checksum(NEW.cells) THEN
    RAISE EXCEPTION 'registered cell-set checksum does not hash the registered cells';
  END IF;
  FOREACH k IN ARRAY ARRAY['approved_by','approved_at','source','quote'] LOOP
    IF jsonb_typeof(NEW.owner_authorization->k) IS DISTINCT FROM 'string' OR btrim(NEW.owner_authorization->>k) = '' THEN
      RAISE EXCEPTION 'owner_authorization needs approved_by, approved_at, source and quote';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['summary','changes','diagnosis'] LOOP
    IF NEW.candidate->k IS NULL OR NEW.candidate->k = 'null'::jsonb THEN
      RAISE EXCEPTION 'candidate needs summary, changes and diagnosis';
    END IF;
  END LOOP;
  -- eligibility_checksum: the board-capacity census the plan was selected
  -- under. R8's approved 70/23/7 had none and could not be built.
  FOREACH k IN ARRAY ARRAY['plan_checksum','eligibility_checksum','pipeline_commit','board_recipe','ranges'] LOOP
    IF NEW.dataset_provenance->k IS NULL OR NEW.dataset_provenance->k = 'null'::jsonb THEN
      RAISE EXCEPTION 'dataset_provenance needs plan_checksum, eligibility_checksum, pipeline_commit, board_recipe and ranges';
    END IF;
  END LOOP;
  IF NOT public.fn_gto_v31_quality_gates_valid(NEW.acceptance_criteria->'quality_gates') THEN
    RAISE EXCEPTION 'acceptance_criteria.quality_gates must be valid V31 quality gates';
  END IF;
  -- The programme's standing thresholds (every round since R4) are a floor:
  -- a registration may tighten them, never loosen them.
  IF (NEW.acceptance_criteria#>>'{quality_gates,max_frequency_mae}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,max_sizing_mae}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,max_policy_ev_mae_bb}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,max_action_regret_bb}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,min_regret_coverage}')::numeric < 0.95 THEN
    RAISE EXCEPTION 'a registration may not loosen the V31 quality thresholds (0.05 frequency, sizing, policy EV and regret; 0.95 regret coverage)';
  END IF;
  IF jsonb_typeof(NEW.evaluation_plan->'heldout_consumptions') IS DISTINCT FROM 'number'
     OR (NEW.evaluation_plan->>'heldout_consumptions') <> '1'
     OR NEW.evaluation_plan->'steps' IS NULL THEN
    RAISE EXCEPTION 'evaluation_plan must consume the held-out set exactly once and list its steps';
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER gto_v31_round_registration_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.gto_v31_round_registrations
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_round_registration_guard();
CREATE TRIGGER gto_v31_round_registration_no_truncate
  BEFORE TRUNCATE ON public.gto_v31_round_registrations
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_gto_v31_round_registration_guard();

-- 1. Dataset insert: the dataset is exactly its registered round.
CREATE FUNCTION public.fn_gto_v31_dataset_matches_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r public.gto_v31_round_registrations%ROWTYPE; v_comp jsonb;
BEGIN
  SELECT * INTO r FROM public.gto_v31_round_registrations
   WHERE dataset_key = NEW.dataset_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V31 dataset % has no round registration: register the round (composition, cells, provenance, acceptance criteria, evaluation plan) before any dataset is created', NEW.dataset_key;
  END IF;
  IF r.dataset_id IS NOT NULL THEN
    RAISE EXCEPTION 'V31 round % already has its dataset; a registration is used once', r.round_key;
  END IF;
  v_comp := public.fn_gto_v31_cell_composition(NEW.declared_coverage);
  IF public.fn_gto_v31_cell_set_checksum(NEW.declared_coverage) IS DISTINCT FROM r.cell_set_checksum
     OR jsonb_array_length(NEW.declared_coverage) <> jsonb_array_length(r.cells) THEN
    RAISE EXCEPTION 'V31 round % composition differs from its registration: registered % (% cells, set %), declared % (% cells, set %); no cell may be substituted',
      r.round_key, public.fn_gto_v31_composition_text(r.composition), jsonb_array_length(r.cells), left(r.cell_set_checksum,12),
      public.fn_gto_v31_composition_text(v_comp), jsonb_array_length(NEW.declared_coverage),
      left(public.fn_gto_v31_cell_set_checksum(NEW.declared_coverage),12);
  END IF;
  IF NEW.quality_gates IS DISTINCT FROM r.acceptance_criteria->'quality_gates' THEN
    RAISE EXCEPTION 'V31 round % quality gates differ from its registered acceptance criteria: registered %, declared %',
      r.round_key, r.acceptance_criteria->'quality_gates', NEW.quality_gates;
  END IF;
  RETURN NEW;
END $function$;

CREATE FUNCTION public.fn_gto_v31_dataset_links_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.gto_v31_round_registrations SET dataset_id = NEW.dataset_id
   WHERE dataset_key = NEW.dataset_key AND dataset_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V31 dataset % could not be linked to its registration', NEW.dataset_key;
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER gto_v31_dataset_matches_registration
  BEFORE INSERT ON public.gto_v31_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_dataset_matches_registration();
CREATE TRIGGER gto_v31_dataset_links_registration
  AFTER INSERT ON public.gto_v31_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_dataset_links_registration();

-- 3. Seal: the cells actually built are exactly the registered cells, and the
-- held-out set is consumed once.
CREATE FUNCTION public.fn_gto_v31_seal_matches_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r public.gto_v31_round_registrations%ROWTYPE; v_cells jsonb; v_comp jsonb;
BEGIN
  IF OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL THEN
    IF OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
      RAISE EXCEPTION 'V31 dataset % is already sealed; its held-out set was consumed', OLD.dataset_key;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.gto_v31_round_registrations
   WHERE dataset_id = NEW.dataset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V31 dataset % has no round registration and cannot consume a held-out set', NEW.dataset_key;
  END IF;
  IF r.heldout_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'V31 round % already consumed its held-out set at %', r.round_key, r.heldout_consumed_at;
  END IF;
  SELECT COALESCE(jsonb_agg(public.fn_gto_v31_runtime_cell_context(c)), '[]'::jsonb) INTO v_cells
    FROM public.gto_v31_runtime_cells c WHERE c.dataset_id = NEW.dataset_id;
  v_comp := public.fn_gto_v31_cell_composition(v_cells);
  IF public.fn_gto_v31_cell_set_checksum(v_cells) IS DISTINCT FROM r.cell_set_checksum
     OR jsonb_array_length(v_cells) <> jsonb_array_length(r.cells) THEN
    RAISE EXCEPTION 'V31 round % built cells differ from its registration at seal: registered % (% cells), built % (% cells); the held-out set is not consumed',
      r.round_key, public.fn_gto_v31_composition_text(r.composition), jsonb_array_length(r.cells),
      public.fn_gto_v31_composition_text(v_comp), jsonb_array_length(v_cells);
  END IF;
  IF NEW.quality_gates IS DISTINCT FROM r.acceptance_criteria->'quality_gates' THEN
    RAISE EXCEPTION 'V31 round % seal gates differ from its registered acceptance criteria', r.round_key;
  END IF;
  UPDATE public.gto_v31_round_registrations SET heldout_consumed_at = NEW.sealed_at
   WHERE registration_id = r.registration_id;
  RETURN NEW;
END $function$;

CREATE TRIGGER gto_v31_seal_matches_registration
  BEFORE UPDATE OF sealed_at ON public.gto_v31_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_seal_matches_registration();

-- The registration process. service_role only (the gateway / the round writer).
CREATE FUNCTION public.fn_gto_v31_register_round(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM
        ARRAY['acceptance_criteria','candidate','cell_set_checksum','cells','composition','dataset_key',
              'dataset_provenance','evaluation_plan','owner_authorization','round_key'] THEN
    RAISE EXCEPTION 'a V31 round registration has exactly round_key, dataset_key, composition, cells, cell_set_checksum, owner_authorization, candidate, dataset_provenance, acceptance_criteria and evaluation_plan';
  END IF;
  INSERT INTO public.gto_v31_round_registrations(round_key, dataset_key, composition, cells, cell_set_checksum,
    owner_authorization, candidate, dataset_provenance, acceptance_criteria, evaluation_plan)
  VALUES (p->>'round_key', p->>'dataset_key', p->'composition', p->'cells', p->>'cell_set_checksum',
    p->'owner_authorization', p->'candidate', p->'dataset_provenance', p->'acceptance_criteria', p->'evaluation_plan')
  RETURNING registration_id INTO v_id;
  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_runtime_cell_context(public.gto_v31_runtime_cells),
  public.fn_gto_v31_cell_composition(jsonb), public.fn_gto_v31_cell_set_checksum(jsonb),
  public.fn_gto_v31_composition_text(jsonb), public.fn_gto_v31_round_registration_guard(),
  public.fn_gto_v31_dataset_matches_registration(), public.fn_gto_v31_dataset_links_registration(),
  public.fn_gto_v31_seal_matches_registration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_register_round(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_register_round(jsonb) TO service_role;

-- Self-check inside the transaction: the R8 deviation is exactly what the
-- insert check refuses. A registration with R8's approved street counts is
-- not needed; any registered set differing from the declared one is refused,
-- and the R8 dataset (created before this migration) is untouched.
DO $proof$
DECLARE v_r8 jsonb;
BEGIN
  SELECT declared_coverage INTO v_r8 FROM public.gto_v31_datasets
   WHERE dataset_id='1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b';
  IF v_r8 IS NOT NULL AND public.fn_gto_v31_cell_composition(v_r8) <> '{"flop":0,"turn":67,"river":33}'::jsonb THEN
    RAISE EXCEPTION 'R8 declared composition reads differently than its rejection record';
  END IF;
END $proof$;

COMMIT;

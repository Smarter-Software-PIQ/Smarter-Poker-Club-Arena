-- 20261112185251_v31_a_registered_cell_declares_its_range_provenance_and_the_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A REGISTERED V31 CELL DECLARES ITS RANGE PROVENANCE, AND THE DATA MUST AGREE (2026-11-12)
--
-- WHY. Dataset R8 (1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b, rejected, untouched
-- here) had at least 61 of its 100 cells solved with the pipeline model
-- conditional_history / "authored_range_preserving_response": every earlier
-- bet, check and call is FORCED and both players keep their FULL authored
-- root ranges at the target node, although in real play those earlier
-- decisions narrow the ranges. Nothing recorded or checked that assumption:
-- the database had no field for it, the cell key names only a node role, and
-- no gate tests it (v31-rootcause package, DECISION-PACKAGE.md section 1,
-- RANGE-DESIGN.md section 3). Owner direction 2026-11-12: "implementation of
-- the range-provenance guard"; "Make the defect impossible to conceal behind
-- an unspecified range assumption"; "Reject invalid or missing provenance
-- through the maintained authoritative path"; "Distinguish invalid
-- forced-line ranges from legitimate action-conditioned ranges. Do not reject
-- correctly constructed subgames merely because their public history
-- includes previous decisions."
--
-- WHAT CHANGES. The round registration of 20261110213931 gains
-- cell_provenance: one entry per registered cell declaring
--   range_construction   'root' | 'natural' | 'subgame' ('forced' and anything
--                        else is refused)
--   public_history       the exact ordered public actions before the node
--                        (street, position, solver_player, family,
--                        target_chips) and, per step, how many actions the
--                        betting tree offered there (available_actions)
--   upstream_solve_checksum   for 'subgame', the solve whose natural ranges
--                        are its inputs
--   game                 variant nlh, two players to the flop, pot type,
--                        depth bucket, effective stack, root pot, rake
--                        [fraction, cap] and the betting-tree checksum
--   runtime_mapping      the cell key the engine may serve it for and the
--                        acting solver seat
-- Four checks bind the declaration, none of them trusting it:
--   1. registration: missing, malformed, unknown or 'forced' provenance is
--      refused; 'root' is refused when any earlier step had more than one
--      available action; a bet, call, raise or all-in can never be declared
--      a one-action step;
--   2. dataset insert: the declared betting tree must be the dataset's
--      manifest checksum;
--   3. source ingest (the first point the solved data exists): each source
--      node of a registered cell must have been solved after exactly the
--      declared public history, with the declared rake, tree, stack, root
--      pot and acting seat, and must carry exact node ranges (policy export
--      v4). Its ranges are compared with the cell's first source board and
--      the result is kept in gto_v31_range_evidence;
--   4. seal: for 'natural' and 'subgame', a player who made a real earlier
--      decision must NOT hold a constant rescale of one range on every
--      source board (that is the forced-line signature the pipeline's
--      validate_conditional_support enforces, and what R8 was); for 'root'
--      both players MUST. A cell needs two source boards to be verifiable,
--      and every ingested node must have its evidence.
--
-- The comparison is between source boards, not against a declared root
-- vector: a forced line leaves range(board) = c(board) x root on every
-- board, so any two boards agree up to a constant wherever neither board
-- blocks the hand; a declared vector could be wrong, the boards cannot.
--
-- NOT CHANGED. No quality threshold, seal metric or gate. No existing
-- dataset, registration or source row is modified, relabelled or
-- re-validated; R6, R7 and R8 keep their rows and states. A dataset without
-- a registration could already not be sealed (20261110213931); from now on a
-- registration without provenance cannot be created, and one that somehow
-- lacks it can neither create a dataset nor be sealed.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.gto_v31_round_registrations ADD COLUMN cell_provenance jsonb;

COMMENT ON COLUMN public.gto_v31_round_registrations.cell_provenance IS
  'One entry per registered cell: range_construction (root, natural or subgame; never forced), the exact public history with the number of tree actions at each step, the upstream solve for a subgame, the game assumptions (variant, players, pot type, depth, stack, root pot, rake, betting-tree checksum) and the runtime cell key. Checked at registration, dataset insert, source ingest and seal.';

-- NULL when the provenance is valid for the registered cells, else the reason.
CREATE FUNCTION public.fn_gto_v31_cell_provenance_error(p_cells jsonb, p_provenance jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE e jsonb; s jsonb; g jsonb; m jsonb; v_rc text; v_real integer; v_label text;
BEGIN
  IF p_provenance IS NULL OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'array' THEN
    RETURN 'range provenance is missing: every registered cell declares how its ranges were constructed';
  END IF;
  IF jsonb_array_length(p_provenance) <> jsonb_array_length(p_cells)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_provenance) x
                 WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR jsonb_typeof(x->'cell') IS DISTINCT FROM 'object')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_cells) c
                 WHERE (SELECT count(*) FROM jsonb_array_elements(p_provenance) x
                         WHERE public.fn_gto_v31_public215_canonical(x->'cell') = public.fn_gto_v31_public215_canonical(c)) <> 1) THEN
    RETURN 'range provenance is missing for a registered cell: exactly one provenance entry per registered cell';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_provenance) LOOP
    v_label := format('%s %s %s v %s %s', e#>>'{cell,street}', e#>>'{cell,node_role}', e#>>'{cell,hero_position}',
                      e#>>'{cell,opponent_position}', e#>>'{cell,texture_class}');
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM
       ARRAY['cell','game','public_history','range_construction','runtime_mapping','upstream_solve_checksum'] THEN
      RETURN format('cell %s range provenance must have exactly cell, range_construction, public_history, upstream_solve_checksum, game and runtime_mapping', v_label);
    END IF;
    v_rc := CASE WHEN jsonb_typeof(e->'range_construction') = 'string' THEN e->>'range_construction' END;
    IF v_rc = 'forced' THEN
      RETURN format('cell %s declares range_construction "forced": a forced-line (conditional_history) cell keeps full root ranges after earlier decisions and can never be registered', v_label);
    END IF;
    IF v_rc IS NULL OR v_rc NOT IN ('root','natural','subgame') THEN
      RETURN format('cell %s has unknown range_construction %s: it must be root, natural or subgame', v_label, COALESCE(e->>'range_construction','(none)'));
    END IF;
    IF jsonb_typeof(e->'public_history') IS DISTINCT FROM 'array' THEN
      RETURN format('cell %s public_history must be the ordered list of public actions before the node', v_label);
    END IF;
    v_real := 0;
    FOR s IN SELECT value FROM jsonb_array_elements(e->'public_history') LOOP
      IF jsonb_typeof(s) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM
            ARRAY['available_actions','family','position','solver_player','street','target_chips']
         OR jsonb_typeof(s->'family') IS DISTINCT FROM 'string'
         OR s->>'family' NOT IN ('check','bet','call','raise','all_in')
         OR jsonb_typeof(s->'street') IS DISTINCT FROM 'string' OR s->>'street' NOT IN ('flop','turn','river')
         OR jsonb_typeof(s->'position') IS DISTINCT FROM 'string' OR btrim(s->>'position') = ''
         OR jsonb_typeof(s->'solver_player') IS DISTINCT FROM 'number' OR s->>'solver_player' NOT IN ('0','1')
         OR jsonb_typeof(s->'target_chips') IS DISTINCT FROM 'number' OR s->>'target_chips' !~ '^[0-9]{1,15}$'
         OR jsonb_typeof(s->'available_actions') IS DISTINCT FROM 'number' OR s->>'available_actions' !~ '^[1-9][0-9]?$' THEN
        RETURN format('cell %s public_history step is malformed: each step has street, position, solver_player, family, target_chips and available_actions', v_label);
      END IF;
      IF s->>'family' <> 'check' AND (s->>'available_actions')::integer < 2 THEN
        RETURN format('cell %s declares a %s as a one-action step: a bet, call, raise or all-in is always a decision with more than one available action', v_label, s->>'family');
      END IF;
      IF (s->>'available_actions')::integer >= 2 THEN v_real := v_real + 1; END IF;
    END LOOP;
    IF v_rc = 'root' AND v_real > 0 THEN
      RETURN format('cell %s declares range_construction "root" after %s earlier decision(s) with more than one available action: such a node is natural or subgame, never root', v_label, v_real);
    END IF;
    IF v_rc = 'subgame' THEN
      IF jsonb_typeof(e->'upstream_solve_checksum') IS DISTINCT FROM 'string'
         OR e->>'upstream_solve_checksum' !~ '^[0-9a-f]{64}$' OR e->>'upstream_solve_checksum' = repeat('0',64) THEN
        RETURN format('cell %s is a subgame and must name the upstream solve whose natural ranges are its inputs (upstream_solve_checksum)', v_label);
      END IF;
    ELSIF e->'upstream_solve_checksum' IS DISTINCT FROM 'null'::jsonb THEN
      RETURN format('cell %s is not a subgame and may not name an upstream solve', v_label);
    END IF;
    g := e->'game';
    IF jsonb_typeof(g) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(g) k) IS DISTINCT FROM
          ARRAY['betting_tree_checksum','chips_per_bb','depth_bucket','effective_stack_chips','players_to_flop',
                'pot_type','rake','root_pot_chips','variant']
       OR g->'variant' IS DISTINCT FROM '"nlh"'::jsonb
       OR g->'players_to_flop' IS DISTINCT FROM '2'::jsonb
       OR g->'pot_type' IS DISTINCT FROM e#>'{cell,pot_type}'
       OR g->'depth_bucket' IS DISTINCT FROM e#>'{cell,depth_bucket}'
       OR jsonb_typeof(g->'chips_per_bb') IS DISTINCT FROM 'number' OR g->>'chips_per_bb' !~ '^[1-9][0-9]{0,8}$'
       OR jsonb_typeof(g->'effective_stack_chips') IS DISTINCT FROM 'number' OR g->>'effective_stack_chips' !~ '^[1-9][0-9]{0,14}$'
       OR jsonb_typeof(g->'root_pot_chips') IS DISTINCT FROM 'number' OR g->>'root_pot_chips' !~ '^[1-9][0-9]{0,14}$'
       OR (g->>'effective_stack_chips')::numeric <> (g->>'depth_bucket')::numeric * (g->>'chips_per_bb')::numeric
       OR jsonb_typeof(g->'rake') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'rake') <> 2
       OR jsonb_typeof(g#>'{rake,0}') IS DISTINCT FROM 'number' OR (g#>>'{rake,0}')::numeric NOT BETWEEN 0 AND 1
       OR jsonb_typeof(g#>'{rake,1}') IS DISTINCT FROM 'number' OR g#>>'{rake,1}' !~ '^[0-9]{1,15}$'
       OR jsonb_typeof(g->'betting_tree_checksum') IS DISTINCT FROM 'string'
       OR g->>'betting_tree_checksum' !~ '^[0-9a-f]{64}$' OR g->>'betting_tree_checksum' = repeat('0',64) THEN
      RETURN format('cell %s game assumptions are missing or disagree with the cell: variant nlh, players_to_flop 2, the cell''s pot_type and depth_bucket, chips_per_bb, effective_stack_chips, root_pot_chips, rake [fraction, cap] and betting_tree_checksum', v_label);
    END IF;
    m := e->'runtime_mapping';
    IF jsonb_typeof(m) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) IS DISTINCT FROM ARRAY['cell_key','hero_solver_player']
       OR m->'cell_key' IS DISTINCT FROM e->'cell'
       OR jsonb_typeof(m->'hero_solver_player') IS DISTINCT FROM 'number' OR m->>'hero_solver_player' NOT IN ('0','1') THEN
      RETURN format('cell %s runtime_mapping must name exactly the registered cell key and the acting solver seat', v_label);
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN 'range provenance is malformed: ' || SQLERRM;
END $function$;

-- 1. Registration: no round is registered on an unstated or forced range assumption.
CREATE FUNCTION public.fn_gto_v31_round_registration_provenance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_error text;
BEGIN
  v_error := public.fn_gto_v31_cell_provenance_error(NEW.cells, NEW.cell_provenance);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'V31 round % cannot be registered: %', NEW.round_key, v_error;
  END IF;
  RETURN NEW;
END $function$;

-- Fires after gto_v31_round_registration_guard (name order), which owns the cell shape.
CREATE TRIGGER gto_v31_round_registration_provenance
  BEFORE INSERT ON public.gto_v31_round_registrations
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_round_registration_provenance_guard();

-- 2. Dataset insert: the declared betting tree is the dataset's manifest.
CREATE FUNCTION public.fn_gto_v31_dataset_matches_range_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r public.gto_v31_round_registrations%ROWTYPE; v_tree text;
BEGIN
  SELECT * INTO r FROM public.gto_v31_round_registrations WHERE dataset_key = NEW.dataset_key;
  IF NOT FOUND THEN
    RETURN NEW;  -- gto_v31_dataset_matches_registration refuses an unregistered dataset
  END IF;
  IF r.cell_provenance IS NULL THEN
    RAISE EXCEPTION 'V31 round % was registered without range provenance and cannot create a dataset', r.round_key;
  END IF;
  SELECT e#>>'{game,betting_tree_checksum}' INTO v_tree FROM jsonb_array_elements(r.cell_provenance) e
   WHERE e#>>'{game,betting_tree_checksum}' IS DISTINCT FROM NEW.manifest_checksum LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'V31 round % range provenance mismatch: registered betting tree % but the dataset manifest is %',
      r.round_key, left(COALESCE(v_tree,'(none)'),12), left(NEW.manifest_checksum,12);
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER gto_v31_dataset_matches_range_provenance
  BEFORE INSERT ON public.gto_v31_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_dataset_matches_range_provenance();

-- True when two exact node ranges of one player, on two boards, are the same
-- range up to one positive constant wherever neither board blocks the hand:
-- same support and one ratio (relative tolerance 1e-6, the pipeline's own
-- validate_conditional_support tolerance). Combo order: card = rank*4+suit,
-- combo = hi*(hi-1)/2+lo.
CREATE FUNCTION public.fn_gto_v31_range_is_rescale(
  p_ref double precision[], p_ref_board text, p_obs double precision[], p_obs_board text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  WITH blocked AS (
    SELECT (strpos('23456789TJQKA', substr(b.board, k, 1)) - 1) * 4 + strpos('cdhs', substr(b.board, k + 1, 1)) - 1 AS card
      FROM (VALUES (p_ref_board), (p_obs_board)) b(board)
     CROSS JOIN LATERAL generate_series(1, length(b.board), 2) k),
  live AS (
    SELECT p_ref[hi * (hi - 1) / 2 + lo + 1] AS r, p_obs[hi * (hi - 1) / 2 + lo + 1] AS o
      FROM generate_series(1, 51) hi CROSS JOIN LATERAL generate_series(0, hi - 1) lo
     WHERE NOT EXISTS (SELECT 1 FROM blocked x WHERE x.card IN (hi, lo)))
  SELECT COALESCE(array_length(p_ref, 1) = 1326 AND array_length(p_obs, 1) = 1326, false)
     AND COALESCE(bool_and((r > 0) = (o > 0)), false)
     AND COALESCE(max(o / r) FILTER (WHERE r > 0 AND o > 0)
                  <= min(o / r) FILTER (WHERE r > 0 AND o > 0) * (1 + 1e-6), false)
    FROM live
$function$;

-- What the solved data says about each source node's ranges. One row per
-- ingested source node of a provenance-registered round; the first node of a
-- cell keeps its two range vectors as that cell's reference.
CREATE TABLE public.gto_v31_range_evidence (
  dataset_id uuid NOT NULL REFERENCES public.gto_v31_datasets(dataset_id) ON DELETE CASCADE,
  source_row_id uuid NOT NULL,
  source_node text NOT NULL,
  cell_key text NOT NULL,
  registered boolean NOT NULL,
  board text NOT NULL,
  is_reference boolean NOT NULL,
  reference_oop double precision[],
  reference_ip double precision[],
  oop_is_rescale boolean,
  ip_is_rescale boolean,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, source_row_id, source_node),
  CONSTRAINT gto_v31_range_evidence_shape CHECK (
    (NOT registered AND NOT is_reference AND reference_oop IS NULL AND reference_ip IS NULL
       AND oop_is_rescale IS NULL AND ip_is_rescale IS NULL)
    OR (registered AND is_reference AND reference_oop IS NOT NULL AND reference_ip IS NOT NULL
       AND oop_is_rescale IS NULL AND ip_is_rescale IS NULL)
    OR (registered AND NOT is_reference AND reference_oop IS NULL AND reference_ip IS NULL
       AND oop_is_rescale IS NOT NULL AND ip_is_rescale IS NOT NULL))
);
CREATE UNIQUE INDEX gto_v31_range_evidence_one_reference
  ON public.gto_v31_range_evidence (dataset_id, cell_key) WHERE is_reference;
CREATE INDEX gto_v31_range_evidence_cell ON public.gto_v31_range_evidence (dataset_id, cell_key);

COMMENT ON TABLE public.gto_v31_range_evidence IS
  'Per source node of a provenance-registered V31 round: whether each player''s exact node range is a constant rescale of the same player''s range on the cell''s first source board. All boards rescaled is the forced-line (unnarrowed root range) signature; the seal compares it with the registered range_construction.';

ALTER TABLE public.gto_v31_range_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_range_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.gto_v31_range_evidence TO service_role;

CREATE FUNCTION public.fn_gto_v31_range_evidence_is_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'V31 range evidence is append-only';
END $function$;

CREATE TRIGGER gto_v31_range_evidence_append_only
  BEFORE UPDATE ON public.gto_v31_range_evidence
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_range_evidence_is_append_only();
CREATE TRIGGER gto_v31_range_evidence_no_truncate
  BEFORE TRUNCATE ON public.gto_v31_range_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_gto_v31_range_evidence_is_append_only();

-- 3. Source ingest. Both ingest functions write solved_spots_gold and then
-- gto_v31_source_artifacts inside one transaction holding the dataset row, so
-- this trigger sees the stored nodes and runs once per artifact, serialized
-- per dataset. A dataset whose round has no provenance (everything created
-- before this migration) is left exactly as it was.
CREATE FUNCTION public.fn_gto_v31_record_range_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.gto_v31_round_registrations%ROWTYPE; ref public.gto_v31_range_evidence%ROWTYPE;
  v_nodes jsonb; n jsonb; p jsonb; v_cell jsonb; v_key text; v_label text; v_history jsonb; v_board text;
  v_oop double precision[]; v_ip double precision[];
BEGIN
  SELECT * INTO r FROM public.gto_v31_round_registrations WHERE dataset_id = NEW.dataset_id FOR UPDATE;
  IF NOT FOUND OR r.cell_provenance IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.strategy_matrix_v2->'nodes' INTO v_nodes FROM public.solved_spots_gold s WHERE s.id = NEW.source_row_id;
  IF v_nodes IS NULL OR jsonb_typeof(v_nodes) IS DISTINCT FROM 'array' OR jsonb_array_length(v_nodes) <> NEW.node_count THEN
    RAISE EXCEPTION 'V31 round % source artifact % has no readable source nodes; its range provenance cannot be verified',
      r.round_key, NEW.source_row_id;
  END IF;
  FOR n IN SELECT value FROM jsonb_array_elements(v_nodes) LOOP
    SELECT jsonb_object_agg(k, n->'node_context'->k) INTO v_cell
      FROM unnest(ARRAY['street','game_family','objective','utility_context','table_size','pot_type','hero_position',
                        'opponent_position','depth_bucket','texture_class','node_role','facing_kind','facing_size_bucket']) k;
    v_key := public.fn_gto_v31_public215_canonical(v_cell);
    v_board := n#>>'{node_context,board}';
    SELECT e INTO p FROM jsonb_array_elements(r.cell_provenance) e
     WHERE public.fn_gto_v31_public215_canonical(e->'cell') = v_key;
    IF p IS NULL THEN
      -- Not a registered cell: it cannot become one (the seal compares the built cells with the registration).
      INSERT INTO public.gto_v31_range_evidence(dataset_id, source_row_id, source_node, cell_key, registered, board, is_reference)
      VALUES (NEW.dataset_id, NEW.source_row_id, n->>'node', v_key, false, COALESCE(v_board,''), false);
      CONTINUE;
    END IF;
    v_label := format('%s %s %s v %s %s', p#>>'{cell,street}', p#>>'{cell,node_role}', p#>>'{cell,hero_position}',
                      p#>>'{cell,opponent_position}', p#>>'{cell,texture_class}');
    SELECT COALESCE(jsonb_agg(x.step - 'available_actions' ORDER BY x.ord), '[]'::jsonb) INTO v_history
      FROM jsonb_array_elements(p->'public_history') WITH ORDINALITY x(step, ord);
    IF n#>'{complete_public_state,public_history}' IS DISTINCT FROM v_history THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % was solved after public history % but the registration declares %',
        r.round_key, v_label, n->>'node', COALESCE(n#>'{complete_public_state,public_history}','null'::jsonb), v_history;
    END IF;
    IF n#>'{complete_public_state,utility,rake}' IS DISTINCT FROM p#>'{game,rake}' THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % was solved with rake % but the registration declares rake %',
        r.round_key, v_label, n->>'node', COALESCE(n#>'{complete_public_state,utility,rake}','null'::jsonb), p#>'{game,rake}';
    END IF;
    IF n#>>'{line_proof,manifest_checksum}' IS DISTINCT FROM p#>>'{game,betting_tree_checksum}' THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % was solved on betting tree % but the registration declares %',
        r.round_key, v_label, n->>'node', left(COALESCE(n#>>'{line_proof,manifest_checksum}','(none)'),12), left(p#>>'{game,betting_tree_checksum}',12);
    END IF;
    IF n#>'{line_proof,effective_stack_chips}' IS DISTINCT FROM p#>'{game,effective_stack_chips}'
       OR n#>'{line_proof,chips_per_bb}' IS DISTINCT FROM p#>'{game,chips_per_bb}'
       OR n#>'{line_proof,root_pot_chips}' IS DISTINCT FROM p#>'{game,root_pot_chips}'
       OR n#>'{line_proof,hero_solver_player}' IS DISTINCT FROM p#>'{runtime_mapping,hero_solver_player}' THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % stack, root pot, chip unit or acting seat (%, %, %, seat %) differs from the registration (%, %, %, seat %)',
        r.round_key, v_label, n->>'node',
        n#>>'{line_proof,effective_stack_chips}', n#>>'{line_proof,root_pot_chips}', n#>>'{line_proof,chips_per_bb}', n#>>'{line_proof,hero_solver_player}',
        p#>>'{game,effective_stack_chips}', p#>>'{game,root_pot_chips}', p#>>'{game,chips_per_bb}', p#>>'{runtime_mapping,hero_solver_player}';
    END IF;
    IF jsonb_typeof(n#>'{solver_ranges,OOP}') IS DISTINCT FROM 'array' OR jsonb_typeof(n#>'{solver_ranges,IP}') IS DISTINCT FROM 'array'
       OR jsonb_array_length(n#>'{solver_ranges,OOP}') <> 1326 OR jsonb_array_length(n#>'{solver_ranges,IP}') <> 1326
       OR v_board IS NULL OR v_board !~ '^([2-9TJQKA][cdhs]){3,5}$' THEN
      RAISE EXCEPTION 'V31 round % cell % source node % carries no exact node ranges (policy export v4 solver_ranges); its range provenance cannot be verified',
        r.round_key, v_label, n->>'node';
    END IF;
    v_oop := ARRAY(SELECT (x.w#>>'{}')::double precision FROM jsonb_array_elements(n#>'{solver_ranges,OOP}') WITH ORDINALITY x(w, ord) ORDER BY x.ord);
    v_ip := ARRAY(SELECT (x.w#>>'{}')::double precision FROM jsonb_array_elements(n#>'{solver_ranges,IP}') WITH ORDINALITY x(w, ord) ORDER BY x.ord);
    SELECT * INTO ref FROM public.gto_v31_range_evidence
     WHERE dataset_id = NEW.dataset_id AND cell_key = v_key AND is_reference;
    IF NOT FOUND THEN
      INSERT INTO public.gto_v31_range_evidence(dataset_id, source_row_id, source_node, cell_key, registered, board,
        is_reference, reference_oop, reference_ip)
      VALUES (NEW.dataset_id, NEW.source_row_id, n->>'node', v_key, true, v_board, true, v_oop, v_ip);
    ELSE
      INSERT INTO public.gto_v31_range_evidence(dataset_id, source_row_id, source_node, cell_key, registered, board,
        is_reference, oop_is_rescale, ip_is_rescale)
      VALUES (NEW.dataset_id, NEW.source_row_id, n->>'node', v_key, true, v_board, false,
        public.fn_gto_v31_range_is_rescale(ref.reference_oop, ref.board, v_oop, v_board),
        public.fn_gto_v31_range_is_rescale(ref.reference_ip, ref.board, v_ip, v_board));
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

CREATE TRIGGER gto_v31_source_artifact_records_range_evidence
  AFTER INSERT ON public.gto_v31_source_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_record_range_evidence();

-- 4. Seal: the declaration must be what the solved data shows. Fires before
-- gto_v31_seal_matches_registration (name order); either refusal aborts the
-- seal transaction, so the held-out set is not consumed.
CREATE FUNCTION public.fn_gto_v31_seal_matches_range_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.gto_v31_round_registrations%ROWTYPE; p jsonb; v_key text; v_label text; v_rc text;
  v_nodes bigint; v_evidence bigint; v_n bigint; v_refs bigint; v_oop boolean; v_ip boolean;
  v_real boolean[]; v_seat integer; v_all boolean;
BEGIN
  IF OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.gto_v31_round_registrations WHERE dataset_id = NEW.dataset_id;
  IF NOT FOUND THEN
    RETURN NEW;  -- gto_v31_seal_matches_registration refuses an unregistered dataset
  END IF;
  IF r.cell_provenance IS NULL THEN
    RAISE EXCEPTION 'V31 round % has no range provenance and cannot be sealed; the held-out set is not consumed', r.round_key;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.cell_provenance) e
              WHERE e#>>'{game,betting_tree_checksum}' IS DISTINCT FROM NEW.manifest_checksum) THEN
    RAISE EXCEPTION 'V31 round % range provenance mismatch at seal: the registered betting tree is not the dataset manifest %; the held-out set is not consumed',
      r.round_key, left(NEW.manifest_checksum,12);
  END IF;
  SELECT COALESCE(sum(a.node_count),0) INTO v_nodes FROM public.gto_v31_source_artifacts a WHERE a.dataset_id = NEW.dataset_id;
  SELECT count(*) INTO v_evidence FROM public.gto_v31_range_evidence e WHERE e.dataset_id = NEW.dataset_id;
  IF v_nodes <> v_evidence THEN
    RAISE EXCEPTION 'V31 round % range evidence is incomplete at seal: % source nodes ingested, % with range evidence; the held-out set is not consumed',
      r.round_key, v_nodes, v_evidence;
  END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(r.cell_provenance) LOOP
    v_key := public.fn_gto_v31_public215_canonical(p->'cell');
    v_rc := p->>'range_construction';
    v_label := format('%s %s %s v %s %s', p#>>'{cell,street}', p#>>'{cell,node_role}', p#>>'{cell,hero_position}',
                      p#>>'{cell,opponent_position}', p#>>'{cell,texture_class}');
    SELECT count(*), count(*) FILTER (WHERE e.is_reference),
           bool_and(e.oop_is_rescale) FILTER (WHERE NOT e.is_reference),
           bool_and(e.ip_is_rescale) FILTER (WHERE NOT e.is_reference)
      INTO v_n, v_refs, v_oop, v_ip
      FROM public.gto_v31_range_evidence e WHERE e.dataset_id = NEW.dataset_id AND e.cell_key = v_key AND e.registered;
    IF v_n < 2 OR v_refs <> 1 OR v_oop IS NULL OR v_ip IS NULL THEN
      RAISE EXCEPTION 'V31 round % cell % has % source node(s) with range evidence: a range construction cannot be verified on fewer than two source boards; the held-out set is not consumed',
        r.round_key, v_label, v_n;
    END IF;
    IF v_rc = 'root' THEN
      IF NOT (v_oop AND v_ip) THEN
        RAISE EXCEPTION 'V31 round % cell % range provenance mismatch at seal: declared "root" but its source nodes carry narrowed ranges (unnarrowed on every source board: OOP %, IP %); the held-out set is not consumed',
          r.round_key, v_label, v_oop, v_ip;
      END IF;
    ELSE
      SELECT ARRAY[COALESCE(bool_or(s->>'solver_player' = '0' AND (s->>'available_actions')::integer >= 2), false),
                   COALESCE(bool_or(s->>'solver_player' = '1' AND (s->>'available_actions')::integer >= 2), false)]
        INTO v_real FROM jsonb_array_elements(p->'public_history') s;
      FOR v_seat IN 0..1 LOOP
        v_all := CASE v_seat WHEN 0 THEN v_oop ELSE v_ip END;
        IF v_real[v_seat + 1] AND v_all THEN
          RAISE EXCEPTION 'V31 round % cell % range provenance mismatch at seal: declared "%" after a real decision by %, but % holds a constant rescale of one unnarrowed range on all % source boards. That is the forced-line signature (conditional_history, authored_range_preserving_response), not an action-conditioned range; the held-out set is not consumed',
            r.round_key, v_label, v_rc, CASE v_seat WHEN 0 THEN 'OOP' ELSE 'IP' END,
            CASE v_seat WHEN 0 THEN 'OOP' ELSE 'IP' END, v_n;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

CREATE TRIGGER gto_v31_seal_matches_range_provenance
  BEFORE UPDATE OF sealed_at ON public.gto_v31_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_seal_matches_range_provenance();

-- The registration process now carries the provenance. Same body as
-- 20261110213931 with cell_provenance added to the exact key list.
CREATE OR REPLACE FUNCTION public.fn_gto_v31_register_round(p jsonb)
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
        ARRAY['acceptance_criteria','candidate','cell_provenance','cell_set_checksum','cells','composition','dataset_key',
              'dataset_provenance','evaluation_plan','owner_authorization','round_key'] THEN
    RAISE EXCEPTION 'a V31 round registration has exactly round_key, dataset_key, composition, cells, cell_set_checksum, cell_provenance, owner_authorization, candidate, dataset_provenance, acceptance_criteria and evaluation_plan';
  END IF;
  INSERT INTO public.gto_v31_round_registrations(round_key, dataset_key, composition, cells, cell_set_checksum,
    cell_provenance, owner_authorization, candidate, dataset_provenance, acceptance_criteria, evaluation_plan)
  VALUES (p->>'round_key', p->>'dataset_key', p->'composition', p->'cells', p->>'cell_set_checksum',
    p->'cell_provenance', p->'owner_authorization', p->'candidate', p->'dataset_provenance', p->'acceptance_criteria',
    p->'evaluation_plan')
  RETURNING registration_id INTO v_id;
  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_provenance_error(jsonb, jsonb),
  public.fn_gto_v31_round_registration_provenance_guard(), public.fn_gto_v31_dataset_matches_range_provenance(),
  public.fn_gto_v31_range_is_rescale(double precision[], text, double precision[], text),
  public.fn_gto_v31_range_evidence_is_append_only(), public.fn_gto_v31_record_range_evidence(),
  public.fn_gto_v31_seal_matches_range_provenance()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_register_round(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_register_round(jsonb) TO service_role;

-- Self-check inside the transaction: history is untouched. R8 is still the
-- rejected dataset it was, and no existing round carries invented provenance.
DO $proof$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gto_v31_datasets
              WHERE dataset_id = '1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b' AND state <> 'rejected') THEN
    RAISE EXCEPTION 'R8 must remain rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_round_registrations WHERE cell_provenance IS NOT NULL) THEN
    RAISE EXCEPTION 'no existing registration may be given range provenance by this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_range_evidence) THEN
    RAISE EXCEPTION 'no range evidence may be written for existing datasets';
  END IF;
END $proof$;

COMMIT;

-- 20261113143100_v31_cell_contract_v3_the_registration_accepts_v3_cells_dorma.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- V31 cell contract v3: the round registration accepts v3 cells (dormant)
--
-- WHY. The turn/river pilot (HV31 FLOP-2 W10) found three registration gaps
-- in the v2 cell key: (1) every stack over 110 bb is served by the 150 bucket
-- although real horse cash hands have a median effective stack of 199 bb;
-- (2) a node facing a bet of 1.1 pot or more has no public215 encoder
-- category; (3) the key carries only the facing bet's bucket, so a turn
-- barrel after a called 0.75-pot flop bet and after a called 1.5-pot flop bet
-- are one cell (13 colliding keys over 74 of the pilot tree's 86 keyable
-- decision nodes), and a lead into the previous aggressor has no role.
-- Contract v3 adds the 200 bucket, the "donk" role and "line_class" (the
-- size-bucketed public line) to the cell, declared per cell by
-- "cell_contract": "v3".
--
-- WHAT. Only the registration contract changes, and only for a registration
-- whose cells declare cell_contract:
--   fn_gto_v31_cell_contract_v3_error   new: a v3 cell's shape
--   fn_gto_v31_round_registration_guard v3 branch first; the v2 check is the
--                                       original text, reached by every
--                                       registration without cell_contract
--   fn_gto_v31_cell_provenance_error    a v3 entry's runtime mapping also
--                                       names cell_contract and line_class,
--                                       and its line_class must name its
--                                       public history; v2 entries take the
--                                       original path unchanged
-- Every registration, entry and cell refused before is still refused (a
-- cell with a cell_contract key was refused as "not 13 keys"; it is now
-- admitted only as a fully valid v3 cell in an all-v3 registration).
--
-- DORMANT. No table, column, row or grant changes. Production holds no
-- registration (0 rows); no dataset declares v3. A v3 round can be
-- REGISTERED; it cannot yet be built or sealed: gto_v31_runtime_cells has no
-- line_class column, so fn_gto_v31_seal_matches_registration (13-key
-- runtime contexts) refuses a v3 round at seal, and the dataset and cell
-- validators still allow depth 10..150 only. Those are extended when a v3
-- dataset is actually produced, under its own review.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- NULL when p_cell is a well-formed cell contract v3 context, else the reason.
-- v3 = the 13 V31 context keys, "cell_contract": "v3" and "line_class": the
-- size-bucketed public line before the node (World Hub pio_upi.line_class_v3,
-- Club Arena GtoDecisionContext.gtoV31LineClassV3). v3 adds the 200 bb depth
-- bucket and the "donk" open role.
CREATE FUNCTION public.fn_gto_v31_cell_contract_v3_error(p_cell jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_kind text; v_bucket text; v_street integer;
BEGIN
  IF jsonb_typeof(p_cell) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cell) k) IS DISTINCT FROM
        ARRAY['cell_contract','depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position',
              'line_class','node_role','objective','opponent_position','pot_type','street','table_size',
              'texture_class','utility_context'] THEN
    RETURN 'a cell contract v3 cell has exactly the 13 V31 context keys, cell_contract and line_class';
  END IF;
  IF p_cell->'cell_contract' IS DISTINCT FROM '"v3"'::jsonb THEN
    RETURN 'cell_contract must be "v3"';
  END IF;
  v_street := array_position(ARRAY['flop','turn','river'], CASE WHEN jsonb_typeof(p_cell->'street') = 'string' THEN p_cell->>'street' END);
  IF v_street IS NULL THEN
    RETURN 'a v3 cell street is flop, turn or river';
  END IF;
  IF jsonb_typeof(p_cell->'depth_bucket') IS DISTINCT FROM 'number' OR p_cell->>'depth_bucket' NOT IN ('10','20','40','80','150','200') THEN
    RETURN 'a v3 cell depth_bucket is 10, 20, 40, 80, 150 or 200';
  END IF;
  IF jsonb_typeof(p_cell->'line_class') IS DISTINCT FROM 'string'
     OR p_cell->>'line_class' !~ '^((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?(/((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?){0,2}$'
     OR length(p_cell->>'line_class') - length(replace(p_cell->>'line_class', '/', '')) <> v_street - 1 THEN
    RETURN format('a v3 %s cell line_class "%s" is malformed or names another street', p_cell->>'street', p_cell->>'line_class');
  END IF;
  v_role := p_cell->>'node_role'; v_kind := p_cell->>'facing_kind'; v_bucket := p_cell->>'facing_size_bucket';
  IF NOT ((v_role IN ('open','cbet','probe','delayed_cbet','barrel','donk') AND v_kind = 'none' AND v_bucket = 'none')
          OR (v_role = 'all_in' AND v_kind = 'all_in' AND v_bucket = 'all_in')
          OR (v_role = 'facing_bet' AND v_kind = 'bet' AND v_bucket IN ('small','mid','big'))
          OR (v_role IN ('facing_raise','check_raise','bet_raise') AND v_kind = 'raise' AND v_bucket IN ('small','mid','big'))) THEN
    RETURN format('a v3 cell role %s, facing %s and size %s disagree', v_role, v_kind, v_bucket);
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_round_registration_guard()
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
  -- Cell contract v3 (20261113 B5): a registration whose cells declare
  -- cell_contract is a v3 registration and every cell must be a valid v3
  -- context. Any other registration takes the unchanged v2 check below.
  IF jsonb_typeof(NEW.cells) = 'array' AND jsonb_array_length(NEW.cells) >= 1
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.cells) e
                  WHERE jsonb_typeof(e) = 'object' AND e ? 'cell_contract') THEN
    SELECT public.fn_gto_v31_cell_contract_v3_error(e) INTO k
      FROM jsonb_array_elements(NEW.cells) e
     WHERE public.fn_gto_v31_cell_contract_v3_error(e) IS NOT NULL LIMIT 1;
    IF k IS NOT NULL
       OR (SELECT count(DISTINCT public.fn_gto_v31_public215_canonical(e)) FROM jsonb_array_elements(NEW.cells) e)
          <> jsonb_array_length(NEW.cells) THEN
      RAISE EXCEPTION 'registered cells must be distinct V31 cell contract v3 contexts; one registration is all v2 or all v3: %',
        COALESCE(k, 'a cell repeats');
    END IF;
  ELSIF jsonb_typeof(NEW.cells) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.cells) < 1
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

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_provenance_error(p_cells jsonb, p_provenance jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE e jsonb; s jsonb; g jsonb; m jsonb; u jsonb; v_rc text; v_real integer; v_label text;
        v_decided text[]; v_seats text[]; v_hero integer; v_line text;
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
       ARRAY['cell','game','public_history','range_construction','runtime_mapping','unnarrowed_seats','upstream_solve_checksum'] THEN
      RETURN format('cell %s range provenance must have exactly cell, range_construction, public_history, upstream_solve_checksum, unnarrowed_seats, game and runtime_mapping', v_label);
    END IF;
    v_rc := CASE WHEN jsonb_typeof(e->'range_construction') = 'string' THEN e->>'range_construction' END;
    IF v_rc = 'forced' THEN
      RETURN format('cell %s declares range_construction "forced": a forced-line (conditional_history) cell keeps full root ranges after earlier decisions and can never be registered', v_label);
    END IF;
    IF v_rc IS NULL OR v_rc NOT IN ('root','natural','subgame') THEN
      RETURN format('cell %s has unknown range_construction %s: it must be root, natural or subgame', v_label, COALESCE(e->>'range_construction','(none)'));
    END IF;
    -- The runtime mapping: the cell's own key components, the acting solver
    -- seat and the seat -> position map, all consistent with each other.
    m := e->'runtime_mapping';
    IF jsonb_typeof(m) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) IS DISTINCT FROM
          (CASE WHEN jsonb_typeof(e->'cell') = 'object' AND e->'cell' ? 'cell_contract'
               -- cell contract v3: the mapping also names the contract and the line
               THEN ARRAY['cell_contract','depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position',
                          'hero_solver_player','line_class','node_role','objective','opponent_position','pot_type',
                          'solver_positions','street','table_size','utility_context']
               ELSE ARRAY['depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position','hero_solver_player',
                'node_role','objective','opponent_position','pot_type','solver_positions','street','table_size','utility_context'] END)
       OR (m - 'hero_solver_player' - 'solver_positions') IS DISTINCT FROM ((e->'cell') - 'texture_class')
       OR jsonb_typeof(m->'hero_solver_player') IS DISTINCT FROM 'number' OR m->>'hero_solver_player' NOT IN ('0','1')
       OR jsonb_typeof(m->'solver_positions') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'solver_positions') <> 2
       OR jsonb_typeof(m#>'{solver_positions,0}') IS DISTINCT FROM 'string'
       OR jsonb_typeof(m#>'{solver_positions,1}') IS DISTINCT FROM 'string'
       OR m#>>'{solver_positions,0}' = m#>>'{solver_positions,1}' THEN
      RETURN format('cell %s runtime_mapping must name exactly the registered cell''s key components (street, node role, facing, positions, depth and game keys), the acting solver seat and the two solver seat positions', v_label);
    END IF;
    v_hero := (m->>'hero_solver_player')::integer;
    IF m->'solver_positions'->v_hero IS DISTINCT FROM e#>'{cell,hero_position}'
       OR m->'solver_positions'->(1 - v_hero) IS DISTINCT FROM e#>'{cell,opponent_position}' THEN
      RETURN format('cell %s runtime_mapping seat disagrees with the cell: solver seat %s sits at %s, but the cell''s hero is %s', v_label,
                    v_hero, m->'solver_positions'->>v_hero, e#>>'{cell,hero_position}');
    END IF;
    IF jsonb_typeof(e->'public_history') IS DISTINCT FROM 'array' THEN
      RETURN format('cell %s public_history must be the ordered list of public actions before the node', v_label);
    END IF;
    v_real := 0;
    v_decided := ARRAY[]::text[];
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
      IF s->'position' IS DISTINCT FROM m->'solver_positions'->((s->>'solver_player')::integer) THEN
        RETURN format('cell %s public_history step by solver seat %s at %s disagrees with the runtime mapping''s seat positions', v_label,
                      s->>'solver_player', s->>'position');
      END IF;
      -- available_actions is DECLARED: the database cannot read the betting
      -- tree and trusts this count. The pipeline is the check (World Hub
      -- public_hist215.build_cell_provenance derives it from tree_lines and
      -- verify_round_registration refuses any other value).
      IF s->>'family' <> 'check' AND (s->>'available_actions')::integer < 2 THEN
        RETURN format('cell %s declares a %s as a one-action step: a bet, call, raise or all-in is always a decision with more than one available action', v_label, s->>'family');
      END IF;
      IF (s->>'available_actions')::integer >= 2 THEN
        v_real := v_real + 1;
        v_decided := v_decided || CASE s->>'solver_player' WHEN '0' THEN 'OOP' ELSE 'IP' END;
      END IF;
    END LOOP;
    IF v_rc = 'root' AND v_real > 0 THEN
      RETURN format('cell %s declares range_construction "root" after %s earlier decision(s) with more than one available action: such a node is natural or subgame, never root', v_label, v_real);
    END IF;
    IF v_rc = 'subgame' THEN
      -- Recorded, not verified: no table here holds the upstream solve.
      IF jsonb_typeof(e->'upstream_solve_checksum') IS DISTINCT FROM 'string'
         OR e->>'upstream_solve_checksum' !~ '^[0-9a-f]{64}$' OR e->>'upstream_solve_checksum' = repeat('0',64) THEN
        RETURN format('cell %s is a subgame and must name the upstream solve whose natural ranges are its inputs (upstream_solve_checksum)', v_label);
      END IF;
    ELSIF e->'upstream_solve_checksum' IS DISTINCT FROM 'null'::jsonb THEN
      RETURN format('cell %s is not a subgame and may not name an upstream solve', v_label);
    END IF;
    -- A seat that took one action with every hand at its earlier decision
    -- legitimately holds an unnarrowed range; it must be declared, and the
    -- seal then requires the data to show it.
    IF jsonb_typeof(e->'unnarrowed_seats') IS DISTINCT FROM 'array' THEN
      RETURN format('cell %s unnarrowed_seats must be a list (empty when every deciding seat narrowed)', v_label);
    END IF;
    v_seats := ARRAY[]::text[];
    FOR u IN SELECT value FROM jsonb_array_elements(e->'unnarrowed_seats') LOOP
      IF jsonb_typeof(u) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(u) k) IS DISTINCT FROM ARRAY['reason','seat','upstream_evidence_checksum']
         OR u->'seat' NOT IN ('"OOP"'::jsonb, '"IP"'::jsonb)
         OR u->'reason' IS DISTINCT FROM '"pure_prior_action"'::jsonb
         OR jsonb_typeof(u->'upstream_evidence_checksum') IS DISTINCT FROM 'string'
         OR u->>'upstream_evidence_checksum' !~ '^[0-9a-f]{64}$' OR u->>'upstream_evidence_checksum' = repeat('0',64) THEN
        RETURN format('cell %s unnarrowed seat is malformed: each has exactly seat (OOP or IP), reason pure_prior_action and upstream_evidence_checksum', v_label);
      END IF;
      IF v_rc = 'root' THEN
        RETURN format('cell %s is root: no seat has decided, so none can be declared unnarrowed', v_label);
      END IF;
      IF u->>'seat' = ANY(v_seats) THEN
        RETURN format('cell %s declares seat %s unnarrowed twice', v_label, u->>'seat');
      END IF;
      IF NOT (u->>'seat' = ANY(v_decided)) THEN
        RETURN format('cell %s declares %s unnarrowed by a pure prior action, but %s made no earlier decision with more than one available action', v_label, u->>'seat', u->>'seat');
      END IF;
      -- Only a seat that CHECKED at every earlier decision can keep an
      -- unnarrowed range legitimately; a bet, call, raise or all-in is the
      -- forced-line pattern (R8) and can never be waived by a declaration.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(e->'public_history') h
                  WHERE h->>'solver_player' = CASE u->>'seat' WHEN 'OOP' THEN '0' ELSE '1' END
                    AND h->>'family' <> 'check') THEN
        RETURN format('cell %s declares %s unnarrowed, but %s bet, called, raised or went all-in before the node: only a seat whose every earlier decision was a check can be declared unnarrowed', v_label, u->>'seat', u->>'seat');
      END IF;
      v_seats := v_seats || (u->>'seat');
    END LOOP;
    -- At least one deciding seat must stay undeclared and show narrowing,
    -- unless the cell has a single deciding seat (qualified above).
    IF cardinality(v_seats) > 0
       AND (SELECT count(DISTINCT x) FROM unnest(v_decided) x) >= 2
       AND cardinality(v_seats) >= (SELECT count(DISTINCT x) FROM unnest(v_decided) x) THEN
      RETURN format('cell %s declares every deciding seat unnarrowed: at least one seat with a real earlier decision must show an action-conditioned range', v_label);
    END IF;
    -- Cell contract v3: the cell must be a valid v3 context and its line_class
    -- must name exactly the public history, step by step and street by street
    -- (x check, c call, b bet, r raise, a all-in; sizes are the pipeline's).
    IF e->'cell' ? 'cell_contract' THEN
      IF public.fn_gto_v31_cell_contract_v3_error(e->'cell') IS NOT NULL THEN
        RETURN format('cell %s %s', v_label, public.fn_gto_v31_cell_contract_v3_error(e->'cell'));
      END IF;
      SELECT string_agg(z.part, '/' ORDER BY z.s) INTO v_line FROM (
        SELECT s.s, COALESCE((SELECT string_agg(CASE q.h->>'family' WHEN 'check' THEN 'x' WHEN 'call' THEN 'c'
                                                 WHEN 'bet' THEN 'b' WHEN 'raise' THEN 'r' ELSE 'a' END, '.' ORDER BY q.o)
                                FROM jsonb_array_elements(e->'public_history') WITH ORDINALITY q(h, o)
                               WHERE q.h->>'street' = (ARRAY['flop','turn','river'])[s.s]), '') AS part
          FROM generate_series(1, array_position(ARRAY['flop','turn','river'], e#>>'{cell,street}')) s(s)) z;
      IF v_line IS DISTINCT FROM regexp_replace(e#>>'{cell,line_class}', '-(small|mid|big)', '', 'g')
         OR (SELECT count(*) FROM jsonb_array_elements(e->'public_history') h
              WHERE array_position(ARRAY['flop','turn','river'], h->>'street')
                    > array_position(ARRAY['flop','turn','river'], e#>>'{cell,street}')) > 0 THEN
        RETURN format('cell %s line_class "%s" does not name its public history (%s)', v_label, e#>>'{cell,line_class}', COALESCE(v_line, 'none'));
      END IF;
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
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN 'range provenance is malformed: ' || SQLERRM;
END $function$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_contract_v3_error(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Self-check inside the transaction (no table is read or written).
DO $proof$
DECLARE v2 jsonb := '{"street":"turn","game_family":"cash","objective":"cash_ev","utility_context":"cash_ev","table_size":6,"pot_type":"srp","hero_position":"BTN","opponent_position":"BB","depth_bucket":150,"texture_class":"Brpd","node_role":"barrel","facing_kind":"none","facing_size_bucket":"none"}';
        v3 jsonb;
BEGIN
  v3 := v2 || '{"cell_contract":"v3","line_class":"x.b-mid.c/x","depth_bucket":200}';
  IF public.fn_gto_v31_cell_contract_v3_error(v3) IS NOT NULL THEN
    RAISE EXCEPTION 'v3 self-check: a valid v3 cell is refused: %', public.fn_gto_v31_cell_contract_v3_error(v3);
  END IF;
  IF public.fn_gto_v31_cell_contract_v3_error(v2) IS NULL
     OR public.fn_gto_v31_cell_contract_v3_error(v3 || '{"line_class":"x.b-mid.c"}') IS NULL
     OR public.fn_gto_v31_cell_contract_v3_error(v3 || '{"depth_bucket":300}') IS NULL
     OR public.fn_gto_v31_cell_contract_v3_error(v3 || '{"cell_contract":"v4"}') IS NULL
     OR public.fn_gto_v31_cell_contract_v3_error(v3 || '{"node_role":"donk","facing_kind":"bet"}') IS NULL THEN
    RAISE EXCEPTION 'v3 self-check: an invalid v3 cell is admitted';
  END IF;
END $proof$;

COMMIT;

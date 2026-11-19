-- THE HORSE OPTION SWITCH TELLS THE STYLE OPTIONS BY NAME, NOT BY THEIR SHADOW STATE
--
-- WHY: until now four functions of the switch told a style option from any other option by asking whether its
-- states include 'shadow' (public.fn_ca_horse_option_switch_states(option) @> ARRAY['shadow'] or
-- 'shadow' = ANY (v_states)). That held while only the seven style options had a shadow state. The non-style option
-- shadow (2026-11-18, server/src/engine/HorseOptionShadow.ts) gives `shadow` to non-style options too, and with the
-- old test:
--   - fn_ca_horse_option_switch_set would skip the own-citation and recorded-evidence rules for `on` of such an
--     option;
--   - fn_ca_horse_option_switch_record_evidence would refuse to record its evidence;
--   - fn_ca_horse_style_switch_effective would put its row in the STYLE configuration (which the engine then reads as
--     invalid, so every style option fails safe to off), and fn_ca_horse_option_switch_effective would leave it out.
-- So each now asks 'canary' instead: only the style options have canary (the table CHECK
-- ca_horse_style_switch_state_fits_option and the states function say so, and no follow-up gives canary to any
-- other option). Today the two tests name exactly the same seven options, so NOTHING CHANGES in what any function
-- answers or accepts; the shadow lists follow in the next list follow-up, which must install after this file.
--
-- UNCHANGED: every rule of 20261116004500 (own citation, recorded evidence, off-only first, the advisory lock, the
-- audit row), the answer shapes of both reads, every grant. No table, column or row is touched.
--
-- COST: four CREATE OR REPLACE FUNCTION in one transaction; no table is locked.
-- THE SERVING-REGISTRY GUARD STAYS IN BOTH WRITERS. 20261119053236 (the reset-trap guard) put
-- fn_ca_horse_option_registry_refusal into fn_ca_horse_option_switch_set and _record_evidence. This file is later and
-- replaces the same two functions, so both bodies below carry that guard call unchanged, and the read back refuses
-- to commit without it.
BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.fn_ca_horse_style_switch_effective()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'options', coalesce((SELECT jsonb_object_agg(s.option, s.state)
                         FROM public.ca_horse_style_switch s
                         WHERE public.fn_ca_horse_option_switch_states(s.option) @> ARRAY['canary']),
                        '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_effective()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 2,
    'style', public.fn_ca_horse_style_switch_effective(),
    'options', coalesce((SELECT jsonb_object_agg(s.option, s.state)
                         FROM public.ca_horse_style_switch s
                         WHERE NOT (public.fn_ca_horse_option_switch_states(s.option) @> ARRAY['canary'])),
                        '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_record_evidence(
  p_option text, p_evidence_path text, p_evidence_sha256 text, p_kind text, p_reference text,
  p_reviewed_head text, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_states  text[] := public.fn_ca_horse_option_switch_states(p_option);
  v_id      bigint;
  v_refusal text;
BEGIN
  IF v_states IS NULL THEN
    RAISE EXCEPTION 'not a switchable option: %', coalesce(p_option, '(null)');
  END IF;
  IF NOT ('on' = ANY (v_states)) THEN
    RAISE EXCEPTION 'option % is off-only: no evidence is recorded for it', p_option;
  END IF;
  IF 'canary' = ANY (v_states) THEN
    RAISE EXCEPTION 'option % is a style option: its switch does not use an evidence record', p_option;
  END IF;
  IF p_evidence_path IS NULL OR length(p_evidence_path) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'an evidence file path is required';
  END IF;
  IF p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'the evidence sha256 is 64 lowercase hex characters';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('evidence', 'owner_forced') THEN
    RAISE EXCEPTION 'the kind is evidence or owner_forced';
  END IF;
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'a reference is required: the independent ACCEPT, or the owner''s verbatim order';
  END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an actor is required';
  END IF;
  -- the serving engine must register the option, with 'on' (registry guard, reset trap)
  v_refusal := public.fn_ca_horse_option_registry_refusal(p_option, 'on');
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION '%', v_refusal;
  END IF;

  INSERT INTO public.ca_horse_option_switch_evidence
    (option, evidence_path, evidence_sha256, kind, reference, reviewed_head, recorded_by)
  VALUES (p_option, p_evidence_path, p_evidence_sha256, p_kind, btrim(p_reference), p_reviewed_head, p_actor)
  ON CONFLICT ON CONSTRAINT ca_horse_option_switch_evidence_one_per_file DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'evidence % is already recorded for option %', p_evidence_sha256, p_option;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'option', p_option, 'kind', p_kind, 'evidence_sha256', p_evidence_sha256);
END
$function$;

-- The write: style options told by canary, plus the serving-registry guard of 20261119053236 (the serving engine
-- must register the option and the state).
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_set(p_option text, p_state text, p_actor text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_states  text[] := public.fn_ca_horse_option_switch_states(p_option);
  v_old     text;
  v_at      timestamptz := now();
  v_refusal text;
BEGIN
  IF v_states IS NULL THEN
    RAISE EXCEPTION 'not a switchable option: %', coalesce(p_option, '(null)');
  END IF;
  IF p_state IS NULL OR NOT (p_state = ANY (v_states)) THEN
    RAISE EXCEPTION 'option % does not support state % (it supports %)',
      p_option, coalesce(p_state, '(null)'), array_to_string(v_states, ', ');
  END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an actor is required';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'the note is longer than 500 characters';
  END IF;
  -- 'on' for a non-style option carries the option's own citation; the note is kept in the audit row below
  IF p_state = 'on' AND NOT ('canary' = ANY (v_states))
     AND NOT (p_note IS NOT NULL AND p_note LIKE 'authority: ' || p_option || ' %'
              AND p_note ~ 'sha256 [0-9a-f]{64}') THEN
    RAISE EXCEPTION 'option % may be set on only with a note that cites its own authority (authority: % <file> sha256 <64 hex>)',
      p_option, p_option;
  END IF;
  -- and the cited sha256 is a recorded evidence file of this option (an ACCEPT or an owner-forced record)
  IF p_state = 'on' AND NOT ('canary' = ANY (v_states))
     AND NOT EXISTS (
       SELECT 1 FROM public.ca_horse_option_switch_evidence e
       WHERE e.option = p_option
         AND e.evidence_sha256 = substring(p_note FROM 'sha256 ([0-9a-f]{64})')) THEN
    RAISE EXCEPTION 'option % may be set on only after its evidence is recorded: the sha256 its note cites has no row in ca_horse_option_switch_evidence (fn_ca_horse_option_switch_record_evidence)',
      p_option;
  END IF;
  -- the serving engine must register the option and this state, or the row resets that engine (reset trap)
  v_refusal := public.fn_ca_horse_option_registry_refusal(p_option, p_state);
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION '%', v_refusal;
  END IF;

  -- the same lock key as fn_ca_horse_style_switch_set, so the two writers of one option never interleave
  PERFORM pg_advisory_xact_lock(hashtext('ca_horse_style_switch:' || p_option));
  SELECT s.state INTO v_old FROM public.ca_horse_style_switch s WHERE s.option = p_option FOR UPDATE;

  INSERT INTO public.ca_horse_style_switch AS s (option, state, updated_by, updated_at, note)
  VALUES (p_option, p_state, p_actor, v_at, p_note)
  ON CONFLICT (option) DO UPDATE
    SET state = excluded.state, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
        note = excluded.note;

  INSERT INTO public.ca_horse_style_switch_audit (option, old_state, new_state, changed_by, changed_at, note)
  VALUES (p_option, v_old, p_state, p_actor, v_at, p_note);

  RETURN jsonb_build_object('option', p_option, 'state', p_state, 'updated_at', v_at);
END
$function$;

-- Probes (scripts/ci/templates/function-probe.sql): each runs the new body once in a subtransaction that is always
-- undone, so no evidence or switch row survives. omahaCardImpact is a registered non-style option that supports on;
-- styleFoldBluff is a style option (it has canary). Any error but the sentinel rolls the whole migration back.

-- @probe-for: public.fn_ca_horse_option_switch_record_evidence
DO $probe$
DECLARE
  v_sha text := repeat('a', 64);
BEGIN
  -- a non-style option records evidence (the canary test lets it through)
  PERFORM public.fn_ca_horse_option_switch_record_evidence(
    'omahaCardImpact', 'migration-probe/evidence.md', v_sha, 'evidence', 'migration probe (undone)', NULL,
    'migration-probe');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_horse_option_switch_set
DO $probe$
DECLARE
  v_sha text := repeat('b', 64);
BEGIN
  -- on for a non-style option passes the own-citation and recorded-evidence rules
  PERFORM public.fn_ca_horse_option_switch_record_evidence(
    'omahaCardImpact', 'migration-probe/evidence.md', v_sha, 'evidence', 'migration probe (undone)', NULL,
    'migration-probe');
  PERFORM public.fn_ca_horse_option_switch_set(
    'omahaCardImpact', 'on', 'migration-probe', 'authority: omahaCardImpact migration-probe/evidence.md sha256 ' || v_sha);
  -- a style option (canary) is set without a citation
  PERFORM public.fn_ca_horse_option_switch_set('styleFoldBluff', 'off', 'migration-probe', NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_style_switch_effective() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_effective() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_style_switch_effective() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_effective() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) TO service_role;

-- Read back: the style options are exactly the options with canary, no installed function asks for 'shadow' to tell
-- them apart, the evidence rule is still in the set function, and no browser role reaches any of the four.
DO $readback$
BEGIN
  IF (SELECT count(*) FROM unnest(ARRAY['styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
        'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction', 'styleFoldBluff']::text[]) AS n
      WHERE public.fn_ca_horse_option_switch_states(n) @> ARRAY['canary']) <> 7 THEN
    RAISE EXCEPTION 'a style option has no canary state';
  END IF;
  IF position('ARRAY[''shadow'']' IN pg_get_functiondef('public.fn_ca_horse_style_switch_effective()'::regprocedure)) > 0
     OR position('ARRAY[''shadow'']' IN pg_get_functiondef('public.fn_ca_horse_option_switch_effective()'::regprocedure)) > 0
     OR position('''shadow'' = ANY' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) > 0
     OR position('''shadow'' = ANY' IN pg_get_functiondef('public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'a switch function still tells the style options by their shadow state';
  END IF;
  IF position('fn_ca_horse_option_registry_refusal' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) = 0
     OR position('fn_ca_horse_option_registry_refusal' IN pg_get_functiondef('public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'an installed writer does not consult the serving registry (the reset-trap guard of 20261119053236)';
  END IF;
  IF position('ca_horse_option_switch_evidence' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the installed set function does not consult the evidence record';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_effective()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_effective()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the option switch';
  END IF;
END
$readback$;

COMMIT;

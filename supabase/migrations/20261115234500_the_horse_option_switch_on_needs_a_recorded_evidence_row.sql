-- THE HORSE OPTION SWITCH: 'on' NEEDS A RECORDED EVIDENCE ROW
--
-- WHAT THIS CHANGES, AND WHY:
--
-- public.fn_ca_horse_option_switch_set (20261114072215) writes 'on' for a non-style, non-off-only option when the
-- note has the FORM 'authority: <option> <file> sha256 <64 hex>'. Nothing checked the file, the hash or the status
-- behind it (Hand Analysis N1 on the switch registry, 2026-11-15; owner 2026-11-14 23:10 Chicago: "Evidence gates
-- must validate the required approval/status semantics, not section presence alone"). From here on the cited
-- sha256 must be RECORDED first, for that option, in public.ca_horse_option_switch_evidence, with the kind of the
-- record ('evidence': an independent ACCEPT; 'owner_forced': the owner's verbatim order, evidence not met) and its
-- reference. The record is written only through fn_ca_horse_option_switch_record_evidence, which refuses an
-- unregistered or off-only option and an empty reference.
--
-- UNCHANGED: off, clear, the seven style options (on, shadow, canary, off), the off-only refusals, the table
-- checks, the registered names (this file carries no registry list and is not a follow-up of the lists), the two
-- read functions, every grant. Rows already in public.ca_horse_style_switch are not touched: an option that is on
-- stays on; switching it on AGAIN needs its record.
--
-- COST: one small new table (one row per recorded evidence file), read only by the set function; one function
-- replaced. No live table is rewritten or locked beyond the function swap.
BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.ca_horse_option_switch_evidence (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  option          text NOT NULL,
  evidence_path   text NOT NULL CHECK (length(evidence_path) BETWEEN 1 AND 300),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  kind            text NOT NULL CHECK (kind IN ('evidence', 'owner_forced')),
  reference       text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 2000),
  reviewed_head   text CHECK (reviewed_head IS NULL OR reviewed_head ~ '^[0-9a-f]{7,40}$'),
  recorded_by     text NOT NULL CHECK (length(recorded_by) BETWEEN 1 AND 200),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ca_horse_option_switch_evidence_one_per_file UNIQUE (option, evidence_sha256)
);
ALTER TABLE public.ca_horse_option_switch_evidence ENABLE ROW LEVEL SECURITY;

-- The record: one option, one evidence file and hash, what kind of authority it is and where that authority is.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_record_evidence(
  p_option text, p_evidence_path text, p_evidence_sha256 text, p_kind text, p_reference text,
  p_reviewed_head text, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_states text[] := public.fn_ca_horse_option_switch_states(p_option);
  v_id     bigint;
BEGIN
  IF v_states IS NULL THEN
    RAISE EXCEPTION 'not a switchable option: %', coalesce(p_option, '(null)');
  END IF;
  IF NOT ('on' = ANY (v_states)) THEN
    RAISE EXCEPTION 'option % is off-only: no evidence is recorded for it', p_option;
  END IF;
  IF 'shadow' = ANY (v_states) THEN
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

-- The write for any registered option, as in 20261114072215, plus one rule: 'on' for a non-style option needs the
-- sha256 its note cites to be recorded for that option.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_set(p_option text, p_state text, p_actor text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_states text[] := public.fn_ca_horse_option_switch_states(p_option);
  v_old    text;
  v_at     timestamptz := now();
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
  IF p_state = 'on' AND NOT ('shadow' = ANY (v_states))
     AND NOT (p_note IS NOT NULL AND p_note LIKE 'authority: ' || p_option || ' %'
              AND p_note ~ 'sha256 [0-9a-f]{64}') THEN
    RAISE EXCEPTION 'option % may be set on only with a note that cites its own authority (authority: % <file> sha256 <64 hex>)',
      p_option, p_option;
  END IF;
  -- and the cited sha256 is a recorded evidence file of this option (an ACCEPT or an owner-forced record)
  IF p_state = 'on' AND NOT ('shadow' = ANY (v_states))
     AND NOT EXISTS (
       SELECT 1 FROM public.ca_horse_option_switch_evidence e
       WHERE e.option = p_option
         AND e.evidence_sha256 = substring(p_note FROM 'sha256 ([0-9a-f]{64})')) THEN
    RAISE EXCEPTION 'option % may be set on only after its evidence is recorded: the sha256 its note cites has no row in ca_horse_option_switch_evidence (fn_ca_horse_option_switch_record_evidence)',
      p_option;
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

REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) TO service_role;

-- No role writes the record directly; the engine and the operator read it.
REVOKE ALL ON TABLE public.ca_horse_option_switch_evidence FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ca_horse_option_switch_evidence_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_horse_option_switch_evidence TO service_role;

-- Read back: the access law and the new rule in the installed function.
DO $readback$
BEGIN
  IF has_table_privilege('anon', 'public.ca_horse_option_switch_evidence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_option_switch_evidence', 'SELECT')
     OR has_table_privilege('service_role', 'public.ca_horse_option_switch_evidence', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the option switch evidence, or service_role can write it directly';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot use the option switch evidence';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ca_horse_option_switch_evidence'::regclass) THEN
    RAISE EXCEPTION 'row level security is off on the option switch evidence';
  END IF;
  IF position('ca_horse_option_switch_evidence' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the installed set function does not consult the evidence record';
  END IF;
END
$readback$;

COMMIT;

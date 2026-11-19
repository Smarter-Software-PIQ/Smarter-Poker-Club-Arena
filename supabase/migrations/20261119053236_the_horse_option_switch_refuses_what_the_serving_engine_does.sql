-- 20261119053236_the_horse_option_switch_refuses_what_the_serving_engine_does.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE HORSE OPTION SWITCH REFUSES WHAT THE SERVING ENGINE DOES NOT REGISTER (the reset-trap guard)
--
-- WHAT THIS CHANGES, AND WHY:
--
-- THE TRAP. A row in public.ca_horse_style_switch, even 'off', for an option the SERVING engine does not register
-- makes that engine's parser reject the whole configuration (server/src/engine/HorseOptionSwitch.ts,
-- optionSwitchStatesFrom): every switched non-style option on that engine then runs at its release default, so
-- every approved off state and every evidenced on state is silently undone. fn_ca_horse_option_switch_set checks
-- only the database whitelist (the newest registry-list migration), and that list is written from main: it is
-- AHEAD of the serving release whenever a list follow-up is installed before the engine that registers its
-- options is deployed, and after a rollback.
--
-- THE GUARD. The engine publishes, at boot and on every switch read (every 30 s), the option names it registers
-- and the states each supports, keyed by its full release sha (server/src/engine/horseDecision/
-- optionRegistryPublisher.ts), through fn_ca_horse_option_registry_publish into
-- public.ca_horse_option_registry_serving. fn_ca_horse_option_switch_set and
-- fn_ca_horse_option_switch_record_evidence then refuse, with an error naming the release, a name or a state that
-- a FRESH published registry does not list.
--
-- WHICH RELEASE IS SERVING. Every release whose row was refreshed in the last 5 minutes (ten switch reads) is
-- treated as serving, and the name and state must be listed by EVERY one of them. One fresh release is the normal
-- case. Two fresh releases happen during a cutover (the old engine's row stays fresh up to 5 minutes after it stops)
-- and in any overlap where both engines read the switch: a row that one of them does not register resets that one,
-- so "freshest only" would be the wrong guard there. The cost is a refusal for up to 5 minutes after a cutover for a
-- name only the new release registers; the error says so.
--
-- NO FRESH REGISTRY: AS TODAY, AND IT SAYS SO. Before an engine with the publisher is deployed (first boot after this
-- lands), or when no engine has published for 5 minutes, the two functions behave exactly as before and raise a
-- NOTICE that the serving-registry guard is not active for that write.
--
-- UNCHANGED: clear (removing a row can only cure the trap, never cause it, so it is never refused), the old style
-- setter, the database whitelist and its CHECK constraints (this file carries no registry list markers and is not a
-- follow-up of the lists), the evidence rule for 'on', the two read functions, every grant. No switch row is
-- written or changed. Installing it twice leaves the same state.
--
-- COST: one table of one small row per release (rows not refreshed for 30 days are removed by the publish), one
-- UPDATE of that row per engine per 30 s (the registry value is rewritten only when its digest changes), and one
-- primary-key read per operator write. No live table is touched or locked.
BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.ca_horse_option_registry_serving (
  release_sha     text PRIMARY KEY CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  registry        jsonb NOT NULL CHECK (jsonb_typeof(registry) = 'object'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^[0-9a-f]{64}$'),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  seen_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_horse_option_registry_serving ENABLE ROW LEVEL SECURITY;

-- The publish: one release, its whole registry and the digest the engine computed over it. The digest is checked
-- here (sha256 of the engine's canonical JSON: [[name, [states...]], ...] sorted by name), so a truncated or
-- reshaped registry is refused, never stored as the serving one.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_registry_publish(
  p_release_sha text, p_registry jsonb, p_digest text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_names     integer;
  v_canonical text;
  v_now       timestamptz := now();
BEGIN
  IF p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'the release sha is 40 lowercase hex characters';
  END IF;
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'the registry digest is 64 lowercase hex characters';
  END IF;
  IF p_registry IS NULL OR jsonb_typeof(p_registry) <> 'object' THEN
    RAISE EXCEPTION 'the registry is a JSON object of option name to states';
  END IF;
  SELECT count(*) INTO v_names FROM jsonb_object_keys(p_registry);
  IF v_names NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'the registry names % options (1 to 4000 expected)', v_names;
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_each(p_registry) e
       WHERE e.key !~ '^[A-Za-z][A-Za-z0-9]{0,62}$'
          OR jsonb_typeof(e.value) <> 'array'
          OR NOT (e.value ? 'off')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) s
                     WHERE jsonb_typeof(s) <> 'string'
                        OR s #>> '{}' NOT IN ('off', 'shadow', 'canary', 'on'))) THEN
    RAISE EXCEPTION 'every registry entry is a plain option name with its states (off always, then shadow, canary, on)';
  END IF;
  SELECT '[' || string_agg(
           '["' || e.key || '",[' ||
           (SELECT string_agg('"' || (s.v #>> '{}') || '"', ',' ORDER BY s.n)
              FROM jsonb_array_elements(e.value) WITH ORDINALITY AS s(v, n)) || ']]',
           ',' ORDER BY e.key COLLATE "C") || ']'
    INTO v_canonical
    FROM jsonb_each(p_registry) e;
  IF encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex') <> p_digest THEN
    RAISE EXCEPTION 'the registry digest does not match the registry';
  END IF;

  INSERT INTO public.ca_horse_option_registry_serving AS r
    (release_sha, registry, registry_digest, first_seen_at, seen_at)
  VALUES (p_release_sha, p_registry, p_digest, v_now, v_now)
  ON CONFLICT (release_sha) DO UPDATE
    SET seen_at = excluded.seen_at,
        -- an unchanged registry keeps its stored value (and its TOAST): only seen_at moves
        registry = CASE WHEN r.registry_digest = excluded.registry_digest THEN r.registry ELSE excluded.registry END,
        registry_digest = excluded.registry_digest;

  DELETE FROM public.ca_horse_option_registry_serving r
  WHERE r.seen_at < v_now - interval '30 days';

  RETURN jsonb_build_object('release_sha', p_release_sha, 'options', v_names, 'seen_at', v_now);
END
$function$;

-- The guard: NULL when every fresh published registry lists the option (and the state, when one is given); the
-- refusal text otherwise. No fresh registry: NULL and a NOTICE that the guard is not active.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_registry_refusal(p_option text, p_state text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r record;
  v_fresh integer := 0;
BEGIN
  FOR r IN
    SELECT s.release_sha, s.registry
    FROM public.ca_horse_option_registry_serving s
    WHERE s.seen_at >= now() - interval '5 minutes'
    ORDER BY s.seen_at DESC, s.release_sha
  LOOP
    v_fresh := v_fresh + 1;
    IF NOT (r.registry ? coalesce(p_option, '')) THEN
      RETURN format('the serving engine release %s does not register option %s: a switch row for it, even off, would '
                    'make that engine drop every switched option to its release default (deploy the release that '
                    'registers it first; a release replaced less than 5 minutes ago still counts as serving)',
                    left(r.release_sha, 12), coalesce(p_option, '(null)'));
    END IF;
    IF p_state IS NOT NULL AND NOT ((r.registry -> p_option) ? p_state) THEN
      RETURN format('the serving engine release %s does not support state %s for option %s (it supports %s): such a '
                    'row would make that engine drop every switched option to its release default',
                    left(r.release_sha, 12), p_state, p_option,
                    (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(r.registry -> p_option) x));
    END IF;
  END LOOP;
  IF v_fresh = 0 THEN
    RAISE NOTICE 'no serving engine has published its option registry in the last 5 minutes: the serving-registry guard is not active for %, which is checked against the database whitelist only',
      coalesce(p_option, '(null)');
  END IF;
  RETURN NULL;
END
$function$;

-- The record, as in 20261116004500, plus the guard: evidence is recorded to turn an option on, so the serving
-- release must register the option with 'on'.
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

-- The write, as in 20261116004500, plus the guard: the serving engine must register the option and the state.
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

REVOKE ALL ON FUNCTION public.fn_ca_horse_option_registry_publish(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_registry_refusal(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_registry_publish(text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_registry_refusal(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) TO service_role;

-- No role writes the registry directly; the engine writes it through the publish function, the operator reads it.
REVOKE ALL ON TABLE public.ca_horse_option_registry_serving FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_horse_option_registry_serving TO service_role;

-- Read back: the access law, and the guard in both installed writers.
DO $readback$
BEGIN
  IF has_table_privilege('anon', 'public.ca_horse_option_registry_serving', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_option_registry_serving', 'SELECT')
     OR has_table_privilege('service_role', 'public.ca_horse_option_registry_serving', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_registry_publish(text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_registry_publish(text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_registry_refusal(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_registry_refusal(text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the option registry, or service_role can write it directly';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_registry_publish(text, jsonb, text)', 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.ca_horse_option_registry_serving', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot publish or read the option registry';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ca_horse_option_registry_serving'::regclass) THEN
    RAISE EXCEPTION 'row level security is off on the option registry';
  END IF;
  IF position('fn_ca_horse_option_registry_refusal' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) = 0
     OR position('fn_ca_horse_option_registry_refusal' IN pg_get_functiondef('public.fn_ca_horse_option_switch_record_evidence(text, text, text, text, text, text, text)'::regprocedure)) = 0
     OR position('ca_horse_option_switch_evidence' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'an installed writer does not consult the serving registry or the evidence record';
  END IF;
END
$readback$;

COMMIT;

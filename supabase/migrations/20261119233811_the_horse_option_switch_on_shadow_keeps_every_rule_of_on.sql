-- 20261119233811_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE HORSE OPTION SWITCH: ON_SHADOW KEEPS EVERY RULE OF ON
--
-- WHAT THIS CHANGES, AND WHY:
--
-- `shadow` passes nothing to the acted decision, so the source default decides. 47 registered options are OFF in
-- source and ON in production only by an 'on' row (every categorical PLO rule, holdemManiacSampleGate,
-- holdemPersonaPostflop, ...): a shadow row for one of them would switch that rule OFF on live tables. The new state
-- `on_shadow` measures such a rule without changing it: the engine passes `<option>: true` to the acted decision,
-- exactly as for 'on', and re-decides once with false (server/src/engine/HorseOptionSwitch.ts, optionSwitchDecisionOpts
-- and optionSwitchShadowFlip; counted option_shadow_<option>_<changed|same>_seen like shadow).
--
-- Because on_shadow ACTS as on, it keeps every rule of 'on' here:
--   - fn_ca_horse_option_switch_set: the body of 20261119144300 with `p_state = 'on'` widened to
--     `p_state IN ('on', 'on_shadow')` in the own-citation rule and the recorded-evidence rule. Everything else is
--     unchanged: the states check first (off-only and style options never list on_shadow, so they are refused there),
--     the style options told by canary, the serving-registry guard fn_ca_horse_option_registry_refusal(p_option,
--     p_state) of 20261119053236 (a fresh serving registry that does not list on_shadow for the option refuses the
--     write: an engine without on_shadow would reject the whole configuration), the advisory lock and the audit row.
--   - fn_ca_horse_option_registry_publish: the body of 20261119053236 with 'on_shadow' accepted as a state, or the
--     serving engine that registers it could not publish (its registry would never be fresh, and the guard would be
--     off for every write).
--   - the table's own state check (from 20261113201841, state IN off/shadow/canary/on) is replaced by one that also
--     accepts on_shadow. WHICH options take it is not decided here: the CHECK ca_horse_style_switch_state_fits_option
--     and fn_ca_horse_option_switch_states (the list follow-up written by server/scripts/gen-horse-option-switch-sql.ts,
--     installed AFTER this file and refusing to install before it) list exactly the on_shadow options, and its
--     ca_horse_style_switch_on_cites_authority makes on_shadow cite its own authority at the table, from any writer.
--
-- UNTIL THE LIST FOLLOW-UP INSTALLS NOTHING CHANGES: no option's states list on_shadow, so the set function refuses it
-- for every option, and the table's ca_horse_style_switch_state_fits_option admits it for none.
--
-- UNCHANGED: clear, the evidence record function (evidence is recorded with 'on', which every on_shadow option
-- supports), the two reads (a non-style on_shadow row is in the wide read, never in the style read: they tell the
-- style options by canary), every grant. No switch row is written or changed. Installing it twice leaves the same
-- state.
--
-- COST: one ALTER of a table of one row per switched option, read once per 30 seconds (lock_timeout 3 s, one attempt),
-- and two CREATE OR REPLACE FUNCTION, in one transaction.
BEGIN;

SET LOCAL lock_timeout = '3s';

-- The table's own state check: the four states and on_shadow. The old one is the single-column CHECK on state of
-- 20261113201841 (found by its columns, whatever its generated name).
DO $drop_old_state_check$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.ca_horse_style_switch'::regclass
      AND con.contype = 'c'
      AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                              WHERE a.attrelid = 'public.ca_horse_style_switch'::regclass
                                AND a.attname = 'state')]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE public.ca_horse_style_switch DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$drop_old_state_check$;

ALTER TABLE public.ca_horse_style_switch
  ADD CONSTRAINT ca_horse_style_switch_state_is_known
  CHECK (state IN ('off', 'shadow', 'on_shadow', 'canary', 'on'));

-- The publish of 20261119053236, with on_shadow accepted as a state.
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
                        OR s #>> '{}' NOT IN ('off', 'shadow', 'on_shadow', 'canary', 'on'))) THEN
    RAISE EXCEPTION 'every registry entry is a plain option name with its states (off always, then shadow, on_shadow, canary, on)';
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

-- The write of 20261119144300 (style options told by canary, the serving-registry guard of 20261119053236), with
-- on_shadow under every rule of 'on': the own citation and the recorded evidence.
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
  -- 'on' and 'on_shadow' (which acts as on) for a non-style option carry the option's own citation; the note is kept
  -- in the audit row below
  IF p_state IN ('on', 'on_shadow') AND NOT ('canary' = ANY (v_states))
     AND NOT (p_note IS NOT NULL AND p_note LIKE 'authority: ' || p_option || ' %'
              AND p_note ~ 'sha256 [0-9a-f]{64}') THEN
    RAISE EXCEPTION 'option % may be set % only with a note that cites its own authority (authority: % <file> sha256 <64 hex>)',
      p_option, p_state, p_option;
  END IF;
  -- and the cited sha256 is a recorded evidence file of this option (an ACCEPT or an owner-forced record)
  IF p_state IN ('on', 'on_shadow') AND NOT ('canary' = ANY (v_states))
     AND NOT EXISTS (
       SELECT 1 FROM public.ca_horse_option_switch_evidence e
       WHERE e.option = p_option
         AND e.evidence_sha256 = substring(p_note FROM 'sha256 ([0-9a-f]{64})')) THEN
    RAISE EXCEPTION 'option % may be set % only after its evidence is recorded: the sha256 its note cites has no row in ca_horse_option_switch_evidence (fn_ca_horse_option_switch_record_evidence)',
      p_option, p_state;
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

-- Probes (tests/a-migration-proves-its-functions-before-commit.law.test.ts): each runs a new body before COMMIT in a
-- subtransaction that is always undone. They depend on no option's current states: until the list follow-up installs
-- no option lists on_shadow. The fixture is one published registry for a release sha no engine has (forty zeros).

-- @probe-for: public.fn_ca_horse_option_registry_publish
DO $probe$
DECLARE
  v_reg    jsonb := '{"probeFixtureOption": ["off", "on_shadow", "on"]}';
  v_digest text  := encode(sha256(convert_to('[["probeFixtureOption",["off","on_shadow","on"]]]', 'UTF8')), 'hex');
  v_out    jsonb;
BEGIN
  -- on_shadow is accepted as a state, and the digest is still checked over it
  v_out := public.fn_ca_horse_option_registry_publish(repeat('0', 40), v_reg, v_digest);
  IF (v_out ->> 'options')::integer <> 1
     OR NOT EXISTS (SELECT 1 FROM public.ca_horse_option_registry_serving
                    WHERE release_sha = repeat('0', 40) AND registry_digest = v_digest) THEN
    RAISE EXCEPTION 'probe: the publish did not store the on_shadow fixture registry (%)', v_out;
  END IF;
  -- an unknown state is still refused
  BEGIN
    PERFORM public.fn_ca_horse_option_registry_publish(repeat('0', 40), '{"probeFixtureOption": ["off", "onn"]}',
      encode(sha256(convert_to('[["probeFixtureOption",["off","onn"]]]', 'UTF8')), 'hex'));
    RAISE EXCEPTION 'probe: an unknown state was published';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'every registry entry is a plain option name with its states%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_horse_option_switch_set
DO $probe$
DECLARE
  v_digest text := encode(sha256(convert_to('[["probeFixtureOption",["off"]]]', 'UTF8')), 'hex');
BEGIN
  -- a style option never takes on_shadow (its states do not list it): refused before anything else
  BEGIN
    PERFORM public.fn_ca_horse_option_switch_set('styleFoldBluff', 'on_shadow', 'migration-probe', NULL);
    RAISE EXCEPTION 'probe: a style option was set on_shadow';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'option styleFoldBluff does not support state on_shadow %' THEN RAISE; END IF;
  END;
  -- the serving-registry guard is in the new body: a fresh registry that does not list the option refuses the write
  PERFORM public.fn_ca_horse_option_registry_publish(repeat('0', 40), '{"probeFixtureOption": ["off"]}', v_digest);
  BEGIN
    PERFORM public.fn_ca_horse_option_switch_set('v16Hu', 'off', 'migration-probe', 'migration probe');
    RAISE EXCEPTION 'probe: the switch write was not refused for an option the serving registry does not list';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'the serving engine release % does not register option v16Hu:%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_option_registry_publish(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_registry_publish(text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_set(text, text, text, text) TO service_role;

-- Read back: the set function keeps the serving-registry guard, the canary style test and the evidence rule, and puts
-- on_shadow under the citation and evidence rules; the publish accepts on_shadow; the table accepts it; no browser
-- role reaches either function. Any miss rolls the whole file back.
DO $readback$
DECLARE
  v_set     text := pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure);
  v_publish text := pg_get_functiondef('public.fn_ca_horse_option_registry_publish(text, jsonb, text)'::regprocedure);
BEGIN
  IF position('fn_ca_horse_option_registry_refusal(p_option, p_state)' IN v_set) = 0 THEN
    RAISE EXCEPTION 'the installed set function does not consult the serving registry (the reset-trap guard of 20261119053236)';
  END IF;
  IF position('NOT (''canary'' = ANY (v_states))' IN v_set) = 0
     OR position('''shadow'' = ANY' IN v_set) > 0 THEN
    RAISE EXCEPTION 'the installed set function does not tell the style options by canary';
  END IF;
  IF position('ca_horse_option_switch_evidence' IN v_set) = 0
     OR (length(v_set) - length(replace(v_set, 'p_state IN (''on'', ''on_shadow'') AND NOT (''canary'' = ANY (v_states))', '')))
        / length('p_state IN (''on'', ''on_shadow'') AND NOT (''canary'' = ANY (v_states))') <> 2 THEN
    RAISE EXCEPTION 'the installed set function does not hold on_shadow to the own-citation and evidence rules of on';
  END IF;
  IF position('''on_shadow''' IN v_publish) = 0 THEN
    RAISE EXCEPTION 'the installed registry publish does not accept on_shadow';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ca_horse_style_switch'::regclass
                   AND conname = 'ca_horse_style_switch_state_is_known'
                   AND pg_get_constraintdef(oid) LIKE '%on_shadow%') THEN
    RAISE EXCEPTION 'the switch table does not accept on_shadow';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_option_registry_publish(text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_registry_publish(text, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the option switch';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_registry_publish(text, jsonb, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_set(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot publish the option registry or write the switch';
  END IF;
END
$readback$;

COMMIT;

-- THE HORSE STYLE READ HAS A LIVE SWITCH (2026-11-13)
--
-- Each of the seven opponent-style options (server/src/engine/HorseStyleSwitch.ts) has a runtime state: off,
-- shadow, canary or on. The engine reads the states once a minute through fn_ca_horse_style_switch_effective and
-- hands them to every decision worker. This is the owner's required live off switch: an option can be stopped
-- without an engine release.
--
-- FAILS SAFE TO OFF. No row means off. The engine treats an unreadable, invalid or stale answer as every option
-- off. This migration adds NO rows, so installing it changes no Horse decision.
--
-- NEW OBJECTS ONLY: two small tables and two functions. It touches no existing table, takes no lock on a live
-- table and is compatible with every engine build (an engine that does not know the function never calls it).
--
-- WHO MAY WRITE: service_role only, through fn_ca_horse_style_switch_set, which records every change in the
-- audit table in the same transaction. No browser role can read or write either table or call either function.
BEGIN;

CREATE TABLE public.ca_horse_style_switch (
  option      text PRIMARY KEY
              CHECK (option IN ('styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
                                'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction',
                                'styleFoldBluff')),
  state       text NOT NULL CHECK (state IN ('off', 'shadow', 'canary', 'on')),
  updated_by  text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 200),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  note        text CHECK (note IS NULL OR length(note) <= 500)
);

CREATE TABLE public.ca_horse_style_switch_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  option      text NOT NULL,
  old_state   text,
  new_state   text NOT NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

ALTER TABLE public.ca_horse_style_switch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_horse_style_switch_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_horse_style_switch FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ca_horse_style_switch_audit FROM PUBLIC, anon, authenticated;

-- The read: exactly {"version": 1, "options": {<option>: <state>, ...}}, naming only options that have a row.
-- Never null, never another key: the engine parser (parseStyleSwitchConfig) rejects any other shape, and a
-- rejection turns every option off.
CREATE FUNCTION public.fn_ca_horse_style_switch_effective()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'options', coalesce((SELECT jsonb_object_agg(s.option, s.state) FROM public.ca_horse_style_switch s),
                        '{}'::jsonb));
$function$;

-- The write: one option, one state, one audit row, one transaction. Nothing is coerced: an unknown option or
-- state raises.
CREATE FUNCTION public.fn_ca_horse_style_switch_set(p_option text, p_state text, p_actor text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old text;
  v_at  timestamptz := now();
BEGIN
  IF p_option IS NULL OR p_option NOT IN ('styleValueBettorNotManiac', 'styleBigBetHonesty', 'styleRaiseRespect',
       'styleTightReRaiserRespect', 'styleFoldRatePreRepair', 'styleValueExtraction', 'styleFoldBluff') THEN
    RAISE EXCEPTION 'unknown style option: %', coalesce(p_option, '(null)');
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('off', 'shadow', 'canary', 'on') THEN
    RAISE EXCEPTION 'unknown style state: %', coalesce(p_state, '(null)');
  END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an actor is required';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'the note is longer than 500 characters';
  END IF;

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

REVOKE ALL ON FUNCTION public.fn_ca_horse_style_switch_effective() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_horse_style_switch_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_style_switch_effective() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_style_switch_set(text, text, text, text) TO service_role;

-- Read back: with no rows the answer is exactly the empty configuration, and no browser role holds a grant.
DO $readback$
BEGIN
  IF public.fn_ca_horse_style_switch_effective() IS DISTINCT FROM '{"version": 1, "options": {}}'::jsonb THEN
    RAISE EXCEPTION 'the empty style switch does not read as the empty configuration';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_style_switch_effective()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_horse_style_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_style_switch_set(text, text, text, text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.ca_horse_style_switch', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_style_switch', 'SELECT') THEN
    RAISE EXCEPTION 'a browser role can reach the style switch';
  END IF;
END
$readback$;

COMMIT;

-- 20261119211354_engine_settings_change_at_the_next_hand_without_a_cutover.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner order 2026-11-19 12:54 Chicago: "WE NEED TO
-- STOP REQUIRING AN ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS
-- AND FIXES"):
--
-- Most engine cutovers this month shipped a changed NUMBER inside code that was
-- already running. This adds the engine runtime settings channel: versioned
-- settings rows the engine reads every 30 s (fn_ca_engine_runtime_settings_current),
-- validates against the keys and ranges its own release registers
-- (server/src/engine/runtimeSettings/registry.ts) and applies at each table's
-- next hand boundary, never mid-hand. An unknown key or an out-of-range value
-- makes the engine refuse the whole version and keep serving the last good one;
-- a failed read keeps the current settings. Every table records the version
-- its hands pinned whenever that changes (ca_engine_runtime_settings_hand_use).
--
-- VERSION 1 IS TODAY'S COMPILED VALUES, EXACTLY. Nothing changes in play when
-- this installs: the seed below equals every compiledDefault in the registry,
-- held by server/src/engine/runtimeSettings/compiledDefaultsMatchTheCode.law.test.ts.
-- The engine code that reads this ships with the next engine release; until
-- then nothing reads these objects.
--
-- PUBLISH: fn_ca_engine_runtime_settings_publish(settings, note, actor) writes a
-- new version and makes it active (a key left out keeps its compiled default).
-- ROLLBACK: fn_ca_engine_runtime_settings_rollback(version, note, actor) writes
-- a NEW version with that version's settings (versions only ever increase).
-- server/scripts/runtime-settings-publish.ts validates against the registry first.
--
-- New tables only; no hot relation is locked. Grants: service_role only.
--
-- @live-proof: EXISTS(SELECT 1 FROM public.ca_engine_runtime_settings_versions WHERE version = 1 AND actor = 'migration 20261119211354') AND EXISTS(SELECT 1 FROM public.ca_engine_runtime_settings_active) AND to_regprocedure('public.fn_ca_engine_runtime_settings_current()') IS NOT NULL AND to_regprocedure('public.fn_ca_engine_runtime_settings_record_use(jsonb,text)') IS NOT NULL

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.ca_engine_runtime_settings_versions (
  version          bigint PRIMARY KEY CHECK (version >= 1),
  settings         jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  note             text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 2000),
  actor            text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  rolled_back_from bigint REFERENCES public.ca_engine_runtime_settings_versions (version),
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_engine_runtime_settings_versions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ca_engine_runtime_settings_active (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version      bigint NOT NULL REFERENCES public.ca_engine_runtime_settings_versions (version),
  activated_at timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200)
);
ALTER TABLE public.ca_engine_runtime_settings_active ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ca_engine_runtime_settings_hand_use (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope            text NOT NULL CHECK (length(scope) BETWEEN 1 AND 200),
  hand_id          text NOT NULL CHECK (length(hand_id) BETWEEN 1 AND 200),
  version          bigint NOT NULL CHECK (version >= 0),
  previous_version bigint CHECK (previous_version >= 0),
  release_sha      text CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  pinned_at        timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_engine_runtime_settings_hand_use ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ca_engine_runtime_settings_hand_use_scope_idx
  ON public.ca_engine_runtime_settings_hand_use (scope, pinned_at DESC);

-- A published settings object: 1 to 500 plain dotted keys, every value a JSON number. The engine checks each key and
-- range against its own registry; this only keeps the table to the shape the engine reads.
CREATE OR REPLACE FUNCTION public.fn_ca_engine_runtime_settings_shape_refusal(p_settings jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object'
      THEN 'the settings are a JSON object of setting key to number'
    WHEN (SELECT count(*) FROM jsonb_object_keys(p_settings)) NOT BETWEEN 1 AND 500
      THEN 'the settings name 1 to 500 keys'
    WHEN EXISTS (SELECT 1 FROM jsonb_each(p_settings) e
                 WHERE e.key !~ '^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$'
                    OR jsonb_typeof(e.value) <> 'number')
      THEN 'every setting is a dotted key (area.name) with a JSON number'
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_engine_runtime_settings_current()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object('version', v.version, 'settings', v.settings, 'activated_at', a.activated_at)
  FROM public.ca_engine_runtime_settings_active a
  JOIN public.ca_engine_runtime_settings_versions v ON v.version = a.version
  WHERE a.singleton
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_engine_runtime_settings_publish(
  p_settings jsonb, p_note text, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_refusal text := public.fn_ca_engine_runtime_settings_shape_refusal(p_settings);
  v_version bigint;
BEGIN
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION '%', v_refusal;
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'a note of 3 to 2000 characters says why';
  END IF;
  IF p_actor IS NULL OR length(btrim(p_actor)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an actor is required';
  END IF;
  -- one publisher at a time: versions are dense and strictly increasing
  PERFORM pg_advisory_xact_lock(hashtext('ca_engine_runtime_settings_publish'));
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.ca_engine_runtime_settings_versions;
  INSERT INTO public.ca_engine_runtime_settings_versions (version, settings, note, actor)
  VALUES (v_version, p_settings, btrim(p_note), btrim(p_actor));
  INSERT INTO public.ca_engine_runtime_settings_active AS a (singleton, version, activated_at, actor)
  VALUES (true, v_version, now(), btrim(p_actor))
  ON CONFLICT (singleton) DO UPDATE
    SET version = excluded.version, activated_at = excluded.activated_at, actor = excluded.actor;
  RETURN jsonb_build_object('version', v_version, 'settings', p_settings);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_engine_runtime_settings_rollback(
  p_version bigint, p_note text, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_settings jsonb;
  v_result   jsonb;
BEGIN
  SELECT v.settings INTO v_settings FROM public.ca_engine_runtime_settings_versions v WHERE v.version = p_version;
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'settings version % does not exist', p_version;
  END IF;
  v_result := public.fn_ca_engine_runtime_settings_publish(
    v_settings, format('rollback to version %s: %s', p_version, coalesce(btrim(p_note), '')), p_actor);
  UPDATE public.ca_engine_runtime_settings_versions
     SET rolled_back_from = p_version
   WHERE version = (v_result ->> 'version')::bigint;
  RETURN v_result || jsonb_build_object('rolled_back_from', p_version);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_engine_runtime_settings_record_use(p_rows jsonb, p_release_sha text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'the rows are a JSON array of at most 500 hand-use rows';
  END IF;
  INSERT INTO public.ca_engine_runtime_settings_hand_use
    (scope, hand_id, version, previous_version, release_sha, pinned_at)
  SELECT r ->> 'scope', r ->> 'hand_id', (r ->> 'version')::bigint, (r ->> 'previous_version')::bigint,
         CASE WHEN p_release_sha ~ '^[0-9a-f]{40}$' THEN p_release_sha END,
         (r ->> 'pinned_at')::timestamptz
  FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM public.ca_engine_runtime_settings_hand_use u
  WHERE u.recorded_at < now() - interval '90 days';
  RETURN v_count;
END
$function$;

REVOKE ALL ON TABLE public.ca_engine_runtime_settings_versions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ca_engine_runtime_settings_active FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ca_engine_runtime_settings_hand_use FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_engine_runtime_settings_versions TO service_role;
GRANT SELECT ON TABLE public.ca_engine_runtime_settings_active TO service_role;
GRANT SELECT ON TABLE public.ca_engine_runtime_settings_hand_use TO service_role;

REVOKE ALL ON FUNCTION public.fn_ca_engine_runtime_settings_shape_refusal(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_engine_runtime_settings_current() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_engine_runtime_settings_publish(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_engine_runtime_settings_rollback(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_engine_runtime_settings_record_use(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_runtime_settings_shape_refusal(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_runtime_settings_current() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_runtime_settings_publish(jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_runtime_settings_rollback(bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_runtime_settings_record_use(jsonb, text) TO service_role;

-- VERSION 1: today's compiled values, exactly (runtime settings seed: begin)
INSERT INTO public.ca_engine_runtime_settings_versions (version, settings, note, actor)
SELECT 1,
       '{"horse.v67RiverRaiseShade":0.1,"horse.v65TurnShadeCap":0.12,"horse.v68AirShadeScale":1,"horse.tournamentFlatBump":0,"lightning.fastFoldFloorMs":450,"lightning.fastFoldMedianMs":600,"lightning.fastFoldSigma":0.5,"lightning.fastFoldMaxMs":3000,"lightning.fastFoldTempoMin":0.8,"lightning.fastFoldTempoMax":1.25}'::jsonb,
       'the compiled values of the engine release that introduced runtime settings; no behaviour change',
       'migration 20261119211354'
WHERE NOT EXISTS (SELECT 1 FROM public.ca_engine_runtime_settings_versions);
-- (runtime settings seed: end)
INSERT INTO public.ca_engine_runtime_settings_active (singleton, version, actor)
SELECT true, 1, 'migration 20261119211354'
WHERE NOT EXISTS (SELECT 1 FROM public.ca_engine_runtime_settings_active);

-- @probe-for: public.fn_ca_engine_runtime_settings_publish
-- @probe-for: public.fn_ca_engine_runtime_settings_rollback
DO $probe$
DECLARE v_r jsonb; v_b jsonb;
BEGIN
  v_r := public.fn_ca_engine_runtime_settings_publish('{"horse.v67RiverRaiseShade":0.11}'::jsonb, 'probe publish', 'probe');
  IF (public.fn_ca_engine_runtime_settings_current() ->> 'version')::bigint <> (v_r ->> 'version')::bigint THEN
    RAISE EXCEPTION 'publish did not make its version current: %', v_r;
  END IF;
  v_b := public.fn_ca_engine_runtime_settings_rollback(1, 'probe rollback', 'probe');
  IF (v_b ->> 'version')::bigint <> (v_r ->> 'version')::bigint + 1
     OR (public.fn_ca_engine_runtime_settings_current() -> 'settings')
        IS DISTINCT FROM (SELECT settings FROM public.ca_engine_runtime_settings_versions WHERE version = 1) THEN
    RAISE EXCEPTION 'rollback did not publish version 1 settings as a new version: %', v_b;
  END IF;
  BEGIN
    PERFORM public.fn_ca_engine_runtime_settings_publish('{"horse.v67RiverRaiseShade":"0.2"}'::jsonb, 'probe bad', 'probe');
    RAISE EXCEPTION 'a non-number value was published';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'every setting is a dotted key%' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_engine_runtime_settings_record_use
DO $probe$
DECLARE v_n integer;
BEGIN
  v_n := public.fn_ca_engine_runtime_settings_record_use(
    '[{"scope":"table:probe","hand_id":"1","version":1,"previous_version":0,"pinned_at":"2026-11-19T21:00:00Z"}]'::jsonb,
    NULL);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'record_use wrote % rows, expected 1', v_n;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;

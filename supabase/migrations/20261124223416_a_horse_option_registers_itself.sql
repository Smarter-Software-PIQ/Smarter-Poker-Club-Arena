-- 20261124223416_a_horse_option_registers_itself.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A HORSE OPTION REGISTERS ITSELF (the end of the full-list re-assert)
--
-- WHAT THIS CHANGES, AND WHY:
--
-- THE COLLISION. The database whitelist of the Horse option switch was three CHECK constraints on
-- public.ca_horse_style_switch and the literal lists inside public.fn_ca_horse_option_switch_states. A CHECK cannot
-- be added to, only replaced, so every pull request that registered one option (or moved one to off-only) carried a
-- migration re-asserting ALL the registered names (285 on 2026-11-19, 346 on 2026-11-20, 365 on 2026-11-23, 367 and then 369 on 2026-11-24). Migrations install in merge order: of two such pull requests the second
-- overwrote the first, and one generated before the first merged silently un-locked every option the first had
-- locked. Three lanes lost an afternoon to it on 2026-11-19 and one stale list was a blocking review finding.
--
-- THE FIX. The whitelist becomes rows: public.ca_horse_option_whitelist, one row per registered option (its kind,
-- style or plain, the migrations that hold it off-only, and its shadow level: none, on_shadow or shadow). The switch table refers to it:
--   - ca_horse_style_switch_option_is_registered is now a FOREIGN KEY to the whitelist (an unregistered option cannot
--     be written, by any writer; a registered option with a switch row cannot be removed);
--   - ca_horse_style_switch_on_cites_authority and ca_horse_style_switch_state_fits_option are now enforced by one
--     AFTER INSERT OR UPDATE row trigger with the SAME rules and the SAME names in its errors: 'on' and 'on_shadow'
--     for a non-style option cite its own authority; canary only for a style option; shadow for a style option and
--     an option whose level is shadow; on_shadow for an option whose level is on_shadow or shadow (never a style or
--     off-only option); 'on' never for an off-only option;
--   - fn_ca_horse_option_switch_states reads the row (same answers, NULL for an unregistered name).
-- A later pull request registers its options with one line each,
--   SELECT public.fn_ca_horse_option_register('<option>', 'plain' | 'style', <off-only>,
--                                             'none' | 'on_shadow' | 'shadow', '<its migration name>');
-- which is idempotent and COMMUTES: two such migrations give the same whitelist in either install order, and
-- neither can touch a name the other registered or locked.
--
-- THE SHADOW LEVEL ONLY NARROWS. Registering an option that is already registered keeps the LOWER of the two
-- levels (none < on_shadow < shadow), so two registrations commute. A wider level is fn_ca_horse_option_allow_shadow,
-- its own call, listed by name in OPTION_SWITCH_APPROVED_UNLOCKS. A level is never narrowed, and a hold never added,
-- under a switch row that is in a state the option would lose.
--
-- OFF-ONLY IS MONOTONIC. Registering can add an off-only hold, never remove one. A hold is lifted only by
-- fn_ca_horse_option_unlock, which must name exactly the migrations holding it (a hold added by a pull request the
-- caller did not know about makes it raise, loudly, instead of being lifted), and an option is removed only by
-- fn_ca_horse_option_unregister (never while held or while it has a switch row). The whitelist's own guard trigger
-- refuses any other UPDATE, DELETE or TRUNCATE that would do either. everyUpgradeHasALiveSwitch.law.test.ts fails
-- for an un-lock or a removal that is not listed in OPTION_SWITCH_APPROVED_UNLOCKS.
--
-- THE SEED CARRIES NO LIST. The rows are read from what is INSTALLED: the names of the CHECK constraint this file
-- replaces, each classified by the states function this file replaces, and refused unless the constraint and the
-- function name exactly the same options. It then refuses to install unless what it read is exactly the lists of
-- the last full-list migration (20261124141237, by fingerprint): the database and the law start from the same
-- whitelist, or nothing changes. A full-list follow-up that is merged but not installed yet, or one merged after
-- this file was written, stops it loudly instead of being overwritten or overwriting.
--
-- UNCHANGED: every switch row and audit row (none is written, changed or removed); fn_ca_horse_option_switch_set,
-- _clear, _record_evidence, _effective, the old style setter, fn_ca_horse_option_registry_publish and
-- fn_ca_horse_option_registry_refusal (the serving-registry guard) are not redefined here; every grant on them.
-- fn_ca_horse_option_switch_states keeps its signature and its grant (service_role only). Installing this file
-- twice leaves the same state. Registering an option ENABLES NOTHING: no row is the release default.
--
-- COST: one table of one short row per registered option (369), one primary-key read per switch write, three ALTERs on a table of one row
-- per switched option that is read once per 30 seconds. No live table is touched or locked.
BEGIN;

-- One attempt, no retry: the ALTER below takes ACCESS EXCLUSIVE on a table read every 30 seconds.
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.ca_horse_option_whitelist (
  option        text PRIMARY KEY CHECK (option ~ '^[A-Za-z][A-Za-z0-9]{0,62}$'),
  kind          text NOT NULL CHECK (kind IN ('style', 'plain')),
  -- the migrations holding the option off-only, sorted; empty when 'on' is offered
  locked_by     text[] NOT NULL DEFAULT '{}'::text[],
  off_only      boolean GENERATED ALWAYS AS (cardinality(locked_by) > 0) STORED,
  -- how far the engine's counterfactual re-decision goes for a plain option that is not held: none (off, on),
  -- on_shadow (off, on_shadow, on) or shadow (off, shadow, on_shadow, on). A style option has its own shadow arm.
  shadow        text NOT NULL DEFAULT 'none' CHECK (shadow IN ('none', 'on_shadow', 'shadow')),
  registered_by text NOT NULL CHECK (length(registered_by) BETWEEN 1 AND 200),
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ca_horse_option_whitelist_a_style_option_is_never_off_only
    CHECK (kind <> 'style' OR cardinality(locked_by) = 0),
  CONSTRAINT ca_horse_option_whitelist_a_style_option_has_its_own_shadow_arm
    CHECK (kind <> 'style' OR shadow = 'none')
);
ALTER TABLE public.ca_horse_option_whitelist ENABLE ROW LEVEL SECURITY;

-- The seed: the installed whitelist, read from the installed constraint and the installed states function.
DO $seed$
DECLARE
  v_me       constant text := '20261124223416_a_horse_option_registers_itself';
  -- the lists of the last full-list migration, 20261124141237: md5 of 'option:kind:off-only(0|1):shadow level' joined by ','
  -- in byte order of the option. everyUpgradeHasALiveSwitch.law.test.ts computes it from that file.
  v_lists    constant text := '87f19956481790299450a5cbbb0e9381';
  v_found    text;
  v_type     "char";
  v_def      text;
  v_src      text;
  v_names    text[];
  v_fn_names text[];
  v_states   text[];
  v_name     text;
  v_rows     integer;
BEGIN
  SELECT c.contype, pg_get_constraintdef(c.oid) INTO v_type, v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.ca_horse_style_switch'::regclass
    AND c.conname = 'ca_horse_style_switch_option_is_registered';
  SELECT count(*) INTO v_rows FROM public.ca_horse_option_whitelist;
  IF v_type = 'f' THEN
    -- installed already: the rows are the whitelist, nothing is seeded again
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'the option whitelist is installed and empty';
    END IF;
    RETURN;
  END IF;
  IF v_type IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'public.ca_horse_style_switch has no ca_horse_style_switch_option_is_registered CHECK to read the installed whitelist from';
  END IF;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'the option whitelist holds % rows before its seed', v_rows;
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_names
  FROM regexp_matches(v_def, '''([^'']*)''', 'g') AS m;
  SELECT regexp_replace(p.prosrc, '-{2}[^\n]*', '', 'g') INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.fn_ca_horse_option_switch_states(text)'::regprocedure;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_fn_names
  FROM regexp_matches(v_src, '''([^'']*)''', 'g') AS m
  WHERE m[1] NOT IN ('off', 'shadow', 'on_shadow', 'canary', 'on');
  IF v_names IS NULL OR v_names IS DISTINCT FROM v_fn_names THEN
    RAISE EXCEPTION 'the installed CHECK names % options and the installed states function % and they differ: the whitelist is not seeded from a database that disagrees with itself',
      coalesce(cardinality(v_names), 0), coalesce(cardinality(v_fn_names), 0);
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    IF v_name !~ '^[A-Za-z][A-Za-z0-9]{0,62}$' THEN
      RAISE EXCEPTION 'the installed CHECK holds %, which is not an option name', v_name;
    END IF;
    v_states := public.fn_ca_horse_option_switch_states(v_name);
    IF v_states = ARRAY['off', 'shadow', 'canary', 'on'] THEN
      INSERT INTO public.ca_horse_option_whitelist (option, kind, registered_by) VALUES (v_name, 'style', v_me);
    ELSIF v_states = ARRAY['off'] THEN
      INSERT INTO public.ca_horse_option_whitelist (option, kind, locked_by, registered_by)
      VALUES (v_name, 'plain', ARRAY[v_me], v_me);
    ELSIF v_states = ARRAY['off', 'shadow', 'on_shadow', 'on'] THEN
      INSERT INTO public.ca_horse_option_whitelist (option, kind, shadow, registered_by)
      VALUES (v_name, 'plain', 'shadow', v_me);
    ELSIF v_states = ARRAY['off', 'on_shadow', 'on'] THEN
      INSERT INTO public.ca_horse_option_whitelist (option, kind, shadow, registered_by)
      VALUES (v_name, 'plain', 'on_shadow', v_me);
    ELSIF v_states = ARRAY['off', 'on'] THEN
      INSERT INTO public.ca_horse_option_whitelist (option, kind, registered_by) VALUES (v_name, 'plain', v_me);
    ELSE
      RAISE EXCEPTION 'the installed states function answers % for %, which the installed CHECK accepts', v_states, v_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.ca_horse_option_whitelist w WHERE w.kind = 'style')
     OR NOT EXISTS (SELECT 1 FROM public.ca_horse_option_whitelist w WHERE w.kind = 'plain') THEN
    RAISE EXCEPTION 'the installed whitelist has no style option or no other option';
  END IF;
  -- the database held exactly the lists the law counts from: not an older full list (a follow-up not installed
  -- yet would install over this file), not a newer one
  SELECT md5(string_agg(w.option || ':' || w.kind || ':' || CASE WHEN w.off_only THEN '1' ELSE '0' END || ':' || w.shadow, ','
                        ORDER BY w.option COLLATE "C"))
    INTO v_found FROM public.ca_horse_option_whitelist w;
  IF v_found IS DISTINCT FROM v_lists THEN
    RAISE EXCEPTION 'the installed whitelist (% options, lists %) is not the one of 20261124141237_horse_option_switch_oop_reraise_range_holds (lists %): a full-list follow-up is not installed yet, or a newer one is. Nothing is changed',
      cardinality(v_names), v_found, v_lists;
  END IF;
  -- every row already written fits the seeded whitelist (the CHECKs being replaced said so; read, not trusted)
  IF EXISTS (
       SELECT 1 FROM public.ca_horse_style_switch s
       LEFT JOIN public.ca_horse_option_whitelist w ON w.option = s.option
       WHERE w.option IS NULL
          OR (w.kind = 'style' AND s.state = 'on_shadow')
          OR (w.kind <> 'style' AND s.state <> 'off'
              AND (w.off_only
                   OR NOT (s.state = 'on'
                           OR (s.state = 'on_shadow' AND w.shadow IN ('on_shadow', 'shadow'))
                           OR (s.state = 'shadow' AND w.shadow = 'shadow'))))) THEN
    RAISE EXCEPTION 'a switch row does not fit the installed whitelist: nothing is changed';
  END IF;
END
$seed$;

-- The states an option may be set to; NULL for an option that is not registered. Same signature and answers as
-- before; it now reads the option's row, so it is STABLE, and SECURITY DEFINER so that service_role (its only
-- grantee) needs nothing more than the EXECUTE it already has.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_states(p_option text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  -- registry-lists-version: 20261124223416
  SELECT CASE
    WHEN w.kind = 'style' THEN ARRAY['off', 'shadow', 'canary', 'on']
    WHEN w.off_only THEN ARRAY['off']
    WHEN w.shadow = 'shadow' THEN ARRAY['off', 'shadow', 'on_shadow', 'on']
    WHEN w.shadow = 'on_shadow' THEN ARRAY['off', 'on_shadow', 'on']
    ELSE ARRAY['off', 'on']
  END
  FROM public.ca_horse_option_whitelist w
  WHERE w.option = p_option;
$function$;

-- The two state rules the CHECK constraints held, for every writer of the switch table. AFTER, so it judges the row
-- as it is stored. The errors carry the names of the constraints they replace.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_row_fits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_kind     text;
  v_off_only boolean;
  v_shadow   text;
BEGIN
  SELECT w.kind, w.off_only, w.shadow INTO v_kind, v_off_only, v_shadow
  FROM public.ca_horse_option_whitelist w
  WHERE w.option = NEW.option;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'new row for relation "ca_horse_style_switch" violates "ca_horse_style_switch_option_is_registered": option % is not registered', NEW.option
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ca_horse_style_switch_option_is_registered';
  END IF;
  IF v_kind = 'style' THEN
    -- a style option has its own shadow arm (shadow, canary); on_shadow is never one of its states
    IF NEW.state = 'on_shadow' THEN
      RAISE EXCEPTION 'new row for relation "ca_horse_style_switch" violates "ca_horse_style_switch_state_fits_option": option % does not take state %', NEW.option, NEW.state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ca_horse_style_switch_state_fits_option';
    END IF;
    RETURN NULL;
  END IF;
  -- 'on' and 'on_shadow' (which acts as on) for a non-style option carry the option's OWN citation in the note:
  -- 'authority: <option> <file> sha256 <64 lowercase hex>'
  IF NEW.state IN ('on', 'on_shadow')
     AND NOT coalesce(NEW.note LIKE 'authority: ' || NEW.option || ' %' AND NEW.note ~ 'sha256 [0-9a-f]{64}', false) THEN
    RAISE EXCEPTION 'new row for relation "ca_horse_style_switch" violates "ca_horse_style_switch_on_cites_authority": on for option % cites its own authority in the note', NEW.option
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ca_horse_style_switch_on_cites_authority';
  END IF;
  -- canary only for a style option; shadow only at level shadow; on_shadow at level on_shadow or shadow; nothing
  -- but off for an off-only option
  IF NOT coalesce(
       NEW.state = 'off'
       OR (NOT v_off_only
           AND (NEW.state = 'on'
                OR (NEW.state = 'on_shadow' AND v_shadow IN ('on_shadow', 'shadow'))
                OR (NEW.state = 'shadow' AND v_shadow = 'shadow'))), false) THEN
    RAISE EXCEPTION 'new row for relation "ca_horse_style_switch" violates "ca_horse_style_switch_state_fits_option": option % does not take state %', NEW.option, NEW.state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ca_horse_style_switch_state_fits_option';
  END IF;
  RETURN NULL;
END
$function$;

-- The whitelist's own guard: a hold is never lifted and an option never removed by a plain UPDATE, DELETE or
-- TRUNCATE (a stale script, a hand edit); only the two named functions below do it. A shadow level is widened only
-- by fn_ca_horse_option_allow_shadow. An option is not made off-only while its switch row is anything but 'off', and
-- its level is not narrowed under a switch row in a state it would lose.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_whitelist_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'the option whitelist is never truncated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ca_horse_option.unregister', true) IS DISTINCT FROM OLD.option THEN
      RAISE EXCEPTION 'registered option % is removed only by fn_ca_horse_option_unregister', OLD.option;
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.option <> OLD.option OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'registered option % keeps its name and its kind', OLD.option;
  END IF;
  IF NOT (NEW.locked_by @> OLD.locked_by)
     AND current_setting('ca_horse_option.unlock', true) IS DISTINCT FROM OLD.option THEN
    RAISE EXCEPTION 'the off-only hold of option % is lifted only by fn_ca_horse_option_unlock', OLD.option;
  END IF;
  IF array_position(ARRAY['none', 'on_shadow', 'shadow'], NEW.shadow) > array_position(ARRAY['none', 'on_shadow', 'shadow'], OLD.shadow)
     AND current_setting('ca_horse_option.allow_shadow', true) IS DISTINCT FROM OLD.option THEN
    RAISE EXCEPTION 'the shadow level of option % is widened only by fn_ca_horse_option_allow_shadow', OLD.option;
  END IF;
  IF cardinality(OLD.locked_by) = 0 AND cardinality(NEW.locked_by) > 0
     AND EXISTS (SELECT 1 FROM public.ca_horse_style_switch s WHERE s.option = NEW.option AND s.state <> 'off') THEN
    RAISE EXCEPTION 'switch row % is not off and the option would become off-only: set it off or clear it before this migration', NEW.option;
  END IF;
  IF NEW.shadow <> OLD.shadow
     AND EXISTS (SELECT 1 FROM public.ca_horse_style_switch s
                 WHERE s.option = NEW.option
                   AND ((s.state = 'shadow' AND NEW.shadow <> 'shadow')
                        OR (s.state = 'on_shadow' AND NEW.shadow = 'none'))) THEN
    RAISE EXCEPTION 'switch row % is in a state the option would no longer take at shadow level %: set it on or off, or clear it, before this migration', NEW.option, NEW.shadow;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS ca_horse_option_whitelist_guard ON public.ca_horse_option_whitelist;
CREATE TRIGGER ca_horse_option_whitelist_guard
  BEFORE UPDATE OR DELETE ON public.ca_horse_option_whitelist
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_horse_option_whitelist_guard();
DROP TRIGGER IF EXISTS ca_horse_option_whitelist_guard_truncate ON public.ca_horse_option_whitelist;
CREATE TRIGGER ca_horse_option_whitelist_guard_truncate
  BEFORE TRUNCATE ON public.ca_horse_option_whitelist
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_horse_option_whitelist_guard();

-- REGISTER: what a pull request that adds an option (or holds one off-only) ships, one call per option.
-- Idempotent, and two calls commute: a new option gets its row; an option already registered keeps its kind (a
-- different kind is refused), can only GAIN an off-only hold (p_off_only = false never lifts one) and keeps the
-- LOWER of its shadow level and p_shadow (a wider p_shadow never widens it).
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_register(
  p_option text, p_kind text, p_off_only boolean, p_shadow text, p_migration text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row    public.ca_horse_option_whitelist%ROWTYPE;
  v_levels constant text[] := ARRAY['none', 'on_shadow', 'shadow'];
  v_narrow boolean;
  v_hold   boolean;
BEGIN
  IF p_option IS NULL OR p_option !~ '^[A-Za-z][A-Za-z0-9]{0,62}$' THEN
    RAISE EXCEPTION 'an option name is letters and digits, starting with a letter (got %)', coalesce(p_option, '(null)');
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('style', 'plain') THEN
    RAISE EXCEPTION 'the kind of option % is style or plain', p_option;
  END IF;
  IF p_off_only IS NULL THEN
    RAISE EXCEPTION 'option % is registered off-only (true) or not (false)', p_option;
  END IF;
  IF p_kind = 'style' AND p_off_only THEN
    RAISE EXCEPTION 'style option % cannot be off-only', p_option;
  END IF;
  IF p_shadow IS NULL OR NOT (p_shadow = ANY (v_levels)) THEN
    RAISE EXCEPTION 'the shadow level of option % is none, on_shadow or shadow', p_option;
  END IF;
  IF p_shadow <> 'none' AND (p_kind = 'style' OR p_off_only) THEN
    RAISE EXCEPTION 'the shadow level of a style or off-only option is none (option %)', p_option;
  END IF;
  IF p_migration IS NULL OR p_migration !~ '^[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'option % is registered by a migration, named <version>_<snake_case>', p_option;
  END IF;
  -- the rows are the whitelist only while the switch reads them: an old full-list follow-up installed after this
  -- migration would have put the literal lists back
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = 'public.fn_ca_horse_option_switch_states(text)'::regprocedure
                   AND p.prosrc LIKE '%public.ca_horse_option_whitelist%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                    WHERE c.conrelid = 'public.ca_horse_style_switch'::regclass
                      AND c.conname = 'ca_horse_style_switch_option_is_registered' AND c.contype = 'f') THEN
    RAISE EXCEPTION 'the option switch no longer reads public.ca_horse_option_whitelist (an old full-list follow-up was installed over it): reinstall the whitelist before registering %', p_option;
  END IF;

  -- no switch write runs between the whitelist guard's read of the option's switch row and the hold or the narrowing
  -- (readers are not blocked)
  LOCK TABLE public.ca_horse_style_switch IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v_row FROM public.ca_horse_option_whitelist w WHERE w.option = p_option FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.ca_horse_option_whitelist (option, kind, locked_by, shadow, registered_by)
    VALUES (p_option, p_kind,
            CASE WHEN p_off_only THEN ARRAY[p_migration] ELSE '{}'::text[] END, p_shadow, p_migration);
    RETURN 'registered';
  END IF;
  IF v_row.kind <> p_kind THEN
    RAISE EXCEPTION 'option % is registered as % and cannot be registered as %', p_option, v_row.kind, p_kind;
  END IF;
  v_hold := p_off_only AND NOT (p_migration = ANY (v_row.locked_by));
  v_narrow := array_position(v_levels, p_shadow) < array_position(v_levels, v_row.shadow);
  IF v_hold OR v_narrow THEN
    UPDATE public.ca_horse_option_whitelist w
    SET locked_by = CASE WHEN v_hold
                         THEN ARRAY(SELECT x FROM unnest(w.locked_by || p_migration) AS x GROUP BY x ORDER BY x COLLATE "C")
                         ELSE w.locked_by END,
        shadow = CASE WHEN v_narrow THEN p_shadow ELSE w.shadow END,
        registered_by = least(w.registered_by COLLATE "C", p_migration COLLATE "C")
    WHERE w.option = p_option;
    RETURN concat_ws(' and ', CASE WHEN v_hold THEN 'held off-only' END,
                              CASE WHEN v_narrow THEN 'narrowed to ' || p_shadow END);
  END IF;
  IF p_migration COLLATE "C" < v_row.registered_by COLLATE "C" THEN
    UPDATE public.ca_horse_option_whitelist w SET registered_by = p_migration WHERE w.option = p_option;
  END IF;
  RETURN 'unchanged';
END
$function$;

-- ALLOW SHADOW: the only way a shadow level is widened (none < on_shadow < shadow). Never for a style option, never
-- while the option is held off-only. A level that is already as wide answers 'unchanged'; a narrower one is refused
-- (narrowing is a register call).
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_allow_shadow(p_option text, p_shadow text, p_migration text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row    public.ca_horse_option_whitelist%ROWTYPE;
  v_levels constant text[] := ARRAY['none', 'on_shadow', 'shadow'];
BEGIN
  IF p_migration IS NULL OR p_migration !~ '^[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'a shadow level is widened by a migration, named <version>_<snake_case>';
  END IF;
  IF p_shadow IS NULL OR p_shadow NOT IN ('on_shadow', 'shadow') THEN
    RAISE EXCEPTION 'a shadow level is widened to on_shadow or shadow';
  END IF;
  SELECT * INTO v_row FROM public.ca_horse_option_whitelist w WHERE w.option = p_option FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'option % is not registered', coalesce(p_option, '(null)');
  END IF;
  IF v_row.kind = 'style' THEN
    RAISE EXCEPTION 'style option % has its own shadow arm: its shadow level stays none', p_option;
  END IF;
  IF cardinality(v_row.locked_by) > 0 THEN
    RAISE EXCEPTION 'option % is held off-only by %: lift the hold by name (fn_ca_horse_option_unlock) before widening its shadow level', p_option, v_row.locked_by;
  END IF;
  IF array_position(v_levels, p_shadow) < array_position(v_levels, v_row.shadow) THEN
    RAISE EXCEPTION 'option % takes %: a narrower shadow level is a register call, not allow_shadow', p_option, v_row.shadow;
  END IF;
  IF p_shadow = v_row.shadow THEN
    RETURN 'unchanged';
  END IF;
  PERFORM set_config('ca_horse_option.allow_shadow', p_option, true);
  UPDATE public.ca_horse_option_whitelist w SET shadow = p_shadow WHERE w.option = p_option;
  PERFORM set_config('ca_horse_option.allow_shadow', '', true);
  RETURN 'widened to ' || p_shadow;
END
$function$;

-- UN-LOCK: the only way an off-only hold is lifted. p_lifts names EXACTLY the migrations holding the option: a hold
-- the caller did not know about (another pull request's) makes it raise instead of being lifted with the rest.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_unlock(p_option text, p_lifts text[], p_migration text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_held  text[];
  v_lifts text[] := ARRAY(SELECT x FROM unnest(coalesce(p_lifts, '{}'::text[])) AS x GROUP BY x ORDER BY x COLLATE "C");
BEGIN
  IF p_migration IS NULL OR p_migration !~ '^[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'a hold is lifted by a migration, named <version>_<snake_case>';
  END IF;
  SELECT w.locked_by INTO v_held FROM public.ca_horse_option_whitelist w WHERE w.option = p_option FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'option % is not registered', coalesce(p_option, '(null)');
  END IF;
  IF cardinality(v_held) = 0 THEN
    RAISE EXCEPTION 'option % is not off-only: there is no hold to lift', p_option;
  END IF;
  IF v_held <> v_lifts THEN
    RAISE EXCEPTION 'option % is held off-only by %, and this un-lock names %: every hold is lifted by name or none is',
      p_option, v_held, v_lifts;
  END IF;
  PERFORM set_config('ca_horse_option.unlock', p_option, true);
  UPDATE public.ca_horse_option_whitelist w SET locked_by = '{}'::text[] WHERE w.option = p_option;
  PERFORM set_config('ca_horse_option.unlock', '', true);
  RETURN 'unlocked';
END
$function$;

-- UNREGISTER: the only way an option leaves the whitelist. Never while it is held off-only (lift the hold first, by
-- name) and never while it has a switch row (clear it first, audited).
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_unregister(p_option text, p_migration text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_held text[];
BEGIN
  IF p_migration IS NULL OR p_migration !~ '^[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'an option is removed by a migration, named <version>_<snake_case>';
  END IF;
  -- no switch write for the option runs between the check below and the removal
  LOCK TABLE public.ca_horse_style_switch IN SHARE ROW EXCLUSIVE MODE;
  SELECT w.locked_by INTO v_held FROM public.ca_horse_option_whitelist w WHERE w.option = p_option FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'option % is not registered', coalesce(p_option, '(null)');
  END IF;
  IF cardinality(v_held) > 0 THEN
    RAISE EXCEPTION 'option % is held off-only by %: lift the hold by name (fn_ca_horse_option_unlock) before removing it', p_option, v_held;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_horse_style_switch s WHERE s.option = p_option) THEN
    RAISE EXCEPTION 'option % has a switch row: clear it (fn_ca_horse_option_switch_clear, audited) before removing it', p_option;
  END IF;
  PERFORM set_config('ca_horse_option.unregister', p_option, true);
  DELETE FROM public.ca_horse_option_whitelist w WHERE w.option = p_option;
  PERFORM set_config('ca_horse_option.unregister', '', true);
  RETURN 'unregistered';
END
$function$;

-- The switch table: the three literal-list CHECKs give way to the foreign key and the row trigger.
ALTER TABLE public.ca_horse_style_switch
  DROP CONSTRAINT IF EXISTS ca_horse_style_switch_option_is_registered,
  DROP CONSTRAINT IF EXISTS ca_horse_style_switch_on_cites_authority,
  DROP CONSTRAINT IF EXISTS ca_horse_style_switch_state_fits_option,
  ADD CONSTRAINT ca_horse_style_switch_option_is_registered
    FOREIGN KEY (option) REFERENCES public.ca_horse_option_whitelist (option)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS ca_horse_style_switch_row_fits ON public.ca_horse_style_switch;
CREATE TRIGGER ca_horse_style_switch_row_fits
  AFTER INSERT OR UPDATE ON public.ca_horse_style_switch
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_horse_option_switch_row_fits();

-- Grants. The states function keeps its only grantee. The whitelist is written by migrations alone: no role is
-- granted the four writers or the trigger functions; service_role may read the rows, as it may the switch table.
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_states(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_states(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_register(text, text, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_allow_shadow(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_unlock(text, text[], text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_unregister(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_row_fits() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_horse_option_whitelist_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ca_horse_option_whitelist FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_horse_option_whitelist TO service_role;

-- Read back: the rows answer; nothing else does; the key and the trigger are there; no browser role reaches any of it.
DO $readback$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.ca_horse_option_whitelist w
       WHERE public.fn_ca_horse_option_switch_states(w.option) IS DISTINCT FROM
             CASE WHEN w.kind = 'style' THEN ARRAY['off', 'shadow', 'canary', 'on']
                  WHEN w.off_only THEN ARRAY['off']
                  WHEN w.shadow = 'shadow' THEN ARRAY['off', 'shadow', 'on_shadow', 'on']
                  WHEN w.shadow = 'on_shadow' THEN ARRAY['off', 'on_shadow', 'on']
                  ELSE ARRAY['off', 'on'] END) THEN
    RAISE EXCEPTION 'a registered option does not answer with its states';
  END IF;
  IF public.fn_ca_horse_option_switch_states('notAnOption') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'an unregistered name is switchable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                 WHERE c.conrelid = 'public.ca_horse_style_switch'::regclass AND c.contype = 'f'
                   AND c.conname = 'ca_horse_style_switch_option_is_registered')
     OR EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = 'public.ca_horse_style_switch'::regclass AND c.contype = 'c'
                  AND c.conname IN ('ca_horse_style_switch_option_is_registered',
                                    'ca_horse_style_switch_on_cites_authority',
                                    'ca_horse_style_switch_state_fits_option'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = 'public.ca_horse_style_switch'::regclass
                      AND t.tgname = 'ca_horse_style_switch_row_fits' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'the switch table does not carry the whitelist key and its row trigger';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ca_horse_option_register(text, text, boolean, text, text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ca_horse_option_allow_shadow(text, text, text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ca_horse_option_unlock(text, text[], text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ca_horse_option_unregister(text, text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.ca_horse_option_whitelist', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ca_horse_option_whitelist', 'SELECT')
     OR has_table_privilege('service_role', 'public.ca_horse_option_whitelist', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION 'a role reaches the option whitelist that should not, or service_role lost the states function';
  END IF;
END
$readback$;

-- The probe: every new function and the trigger run once, on a fixture option, inside a block that is always
-- undone. Any error but the sentinel rolls the whole migration back.
-- @probe-for: public.fn_ca_horse_option_register
-- @probe-for: public.fn_ca_horse_option_allow_shadow
-- @probe-for: public.fn_ca_horse_option_unlock
-- @probe-for: public.fn_ca_horse_option_unregister
-- @probe-for: public.fn_ca_horse_option_switch_row_fits
-- @probe-for: public.fn_ca_horse_option_whitelist_guard
DO $probe$
DECLARE
  v_a      constant text := '20261124223416_probe_a';
  v_b      constant text := '20261124223417_probe_b';
  v_note   constant text := 'authority: probeFixtureOption probe.md sha256 ' || repeat('0', 64);
  v_step   text;
  v_name   text;
  v_got    text;
BEGIN
  -- one statement per call: a later statement sees what an earlier one wrote
  v_got := public.fn_ca_horse_option_register('probeFixtureOption', 'plain', false, 'shadow', v_b);
  v_got := v_got || '|' || public.fn_ca_horse_option_register('probeFixtureOption', 'plain', false, 'shadow', v_a);
  IF v_got <> 'registered|unchanged'
     OR public.fn_ca_horse_option_switch_states('probeFixtureOption') IS DISTINCT FROM ARRAY['off', 'shadow', 'on_shadow', 'on'] THEN
    RAISE EXCEPTION 'probe: a registered shadow option is not offered off, shadow, on_shadow and on (%)', v_got;
  END IF;
  -- the switch table, any writer: a registered option takes off, shadow, a cited on_shadow and a cited on; nothing else
  INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES ('probeFixtureOption', 'off', 'probe');
  UPDATE public.ca_horse_style_switch SET state = 'shadow' WHERE option = 'probeFixtureOption';
  UPDATE public.ca_horse_style_switch SET state = 'on_shadow', note = v_note WHERE option = 'probeFixtureOption';
  FOREACH v_step IN ARRAY ARRAY[
    'UPDATE public.ca_horse_style_switch SET note = ''try on_shadow'' WHERE option = ''probeFixtureOption''|ca_horse_style_switch_on_cites_authority',
    -- on_shadow while the level would become none: the narrowing is refused
    'SELECT public.fn_ca_horse_option_register(''probeFixtureOption'', ''plain'', false, ''none'', ''' || v_a || ''')|would no longer take',
    'SELECT public.fn_ca_horse_option_register(''probeFixtureOption'', ''plain'', true, ''none'', ''' || v_a || ''')|would become off-only'
  ] LOOP
    BEGIN
      EXECUTE split_part(v_step, '|', 1);
      RAISE EXCEPTION 'probe: not refused: %', split_part(v_step, '|', 1) USING ERRCODE = 'data_exception';
    EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
      IF v_name IS DISTINCT FROM split_part(v_step, '|', 2) AND SQLERRM NOT LIKE '%' || split_part(v_step, '|', 2) || '%' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  -- the level narrows by registering (the lower of the two), and widens only by name
  v_got := public.fn_ca_horse_option_register('probeFixtureOption', 'plain', false, 'on_shadow', v_a);
  v_got := v_got || '|' || public.fn_ca_horse_option_register('probeFixtureOption', 'plain', false, 'shadow', v_b);
  IF v_got <> 'narrowed to on_shadow|unchanged'
     OR public.fn_ca_horse_option_switch_states('probeFixtureOption') IS DISTINCT FROM ARRAY['off', 'on_shadow', 'on'] THEN
    RAISE EXCEPTION 'probe: registering does not keep the lower shadow level (%)', v_got;
  END IF;
  UPDATE public.ca_horse_style_switch SET state = 'on', note = v_note WHERE option = 'probeFixtureOption';
  FOREACH v_step IN ARRAY ARRAY[
    'UPDATE public.ca_horse_style_switch SET note = ''try on'' WHERE option = ''probeFixtureOption''|ca_horse_style_switch_on_cites_authority',
    'UPDATE public.ca_horse_style_switch SET state = ''shadow'' WHERE option = ''probeFixtureOption''|ca_horse_style_switch_state_fits_option',
    'UPDATE public.ca_horse_style_switch SET state = ''canary'' WHERE option = ''probeFixtureOption''|ca_horse_style_switch_state_fits_option',
    'INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES (''probeUnregisteredOption'', ''off'', ''probe'')|ca_horse_style_switch_option_is_registered',
    'UPDATE public.ca_horse_option_whitelist SET shadow = ''shadow'' WHERE option = ''probeFixtureOption''|widened only by fn_ca_horse_option_allow_shadow',
    -- on while the row is on: the hold is refused
    'SELECT public.fn_ca_horse_option_register(''probeFixtureOption'', ''plain'', true, ''none'', ''' || v_a || ''')|would become off-only',
    'SELECT public.fn_ca_horse_option_register(''probeFixtureOption'', ''style'', false, ''none'', ''' || v_a || ''')|cannot be registered as style',
    'SELECT public.fn_ca_horse_option_register(''probeFixtureOption'', ''plain'', true, ''shadow'', ''' || v_a || ''')|shadow level of a style or off-only option is none',
    'SELECT public.fn_ca_horse_option_unregister(''probeFixtureOption'', ''' || v_a || ''')|has a switch row'
  ] LOOP
    BEGIN
      EXECUTE split_part(v_step, '|', 1);
      RAISE EXCEPTION 'probe: not refused: %', split_part(v_step, '|', 1) USING ERRCODE = 'data_exception';
    EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
      IF v_name IS DISTINCT FROM split_part(v_step, '|', 2) AND SQLERRM NOT LIKE '%' || split_part(v_step, '|', 2) || '%' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  v_got := public.fn_ca_horse_option_allow_shadow('probeFixtureOption', 'shadow', v_b);
  v_got := v_got || '|' || public.fn_ca_horse_option_allow_shadow('probeFixtureOption', 'shadow', v_a);
  IF v_got <> 'widened to shadow|unchanged'
     OR public.fn_ca_horse_option_switch_states('probeFixtureOption') IS DISTINCT FROM ARRAY['off', 'shadow', 'on_shadow', 'on'] THEN
    RAISE EXCEPTION 'probe: a shadow level widened by name is not offered (%)', v_got;
  END IF;
  UPDATE public.ca_horse_style_switch SET state = 'off' WHERE option = 'probeFixtureOption';

  -- two holds, from two migrations: both are kept, sorted; false never lifts one; a held option answers off alone
  v_got := public.fn_ca_horse_option_register('probeFixtureOption', 'plain', true, 'none', v_b);
  v_got := v_got || '|' || public.fn_ca_horse_option_register('probeFixtureOption', 'plain', true, 'none', v_a);
  v_got := v_got || '|' || public.fn_ca_horse_option_register('probeFixtureOption', 'plain', false, 'none', v_b);
  IF v_got <> 'held off-only and narrowed to none|held off-only|unchanged'
     OR public.fn_ca_horse_option_switch_states('probeFixtureOption') IS DISTINCT FROM ARRAY['off']
     OR (SELECT w.locked_by FROM public.ca_horse_option_whitelist w WHERE w.option = 'probeFixtureOption')
        IS DISTINCT FROM ARRAY[v_a, v_b]
     OR (SELECT w.registered_by FROM public.ca_horse_option_whitelist w WHERE w.option = 'probeFixtureOption')
        IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'probe: an off-only hold is not kept (%)', v_got;
  END IF;
  FOREACH v_step IN ARRAY ARRAY[
    'UPDATE public.ca_horse_style_switch SET state = ''on'', note = ''' || v_note || ''' WHERE option = ''probeFixtureOption''|ca_horse_style_switch_state_fits_option',
    'UPDATE public.ca_horse_style_switch SET state = ''on_shadow'', note = ''' || v_note || ''' WHERE option = ''probeFixtureOption''|ca_horse_style_switch_state_fits_option',
    'UPDATE public.ca_horse_option_whitelist SET locked_by = ''{}'' WHERE option = ''probeFixtureOption''|lifted only by fn_ca_horse_option_unlock',
    'UPDATE public.ca_horse_option_whitelist SET kind = ''style'', locked_by = ''{}'' WHERE option = ''probeFixtureOption''|keeps its name and its kind',
    'DELETE FROM public.ca_horse_option_whitelist WHERE option = ''probeFixtureOption''|removed only by fn_ca_horse_option_unregister',
    'SELECT public.fn_ca_horse_option_allow_shadow(''probeFixtureOption'', ''on_shadow'', ''' || v_b || ''')|lift the hold by name',
    'SELECT public.fn_ca_horse_option_unlock(''probeFixtureOption'', ARRAY[''' || v_a || '''], ''' || v_b || ''')|every hold is lifted by name or none is',
    'SELECT public.fn_ca_horse_option_unregister(''probeFixtureOption'', ''' || v_b || ''')|lift the hold by name'
  ] LOOP
    BEGIN
      EXECUTE split_part(v_step, '|', 1);
      RAISE EXCEPTION 'probe: not refused: %', split_part(v_step, '|', 1) USING ERRCODE = 'data_exception';
    EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_name = CONSTRAINT_NAME;
      IF v_name IS DISTINCT FROM split_part(v_step, '|', 2) AND SQLERRM NOT LIKE '%' || split_part(v_step, '|', 2) || '%' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  v_got := public.fn_ca_horse_option_unlock('probeFixtureOption', ARRAY[v_b, v_a], v_b);
  IF v_got <> 'unlocked'
     OR public.fn_ca_horse_option_switch_states('probeFixtureOption') IS DISTINCT FROM ARRAY['off', 'on'] THEN
    RAISE EXCEPTION 'probe: a hold lifted by name is still held, or its old shadow level came back';
  END IF;
  DELETE FROM public.ca_horse_style_switch WHERE option = 'probeFixtureOption';
  v_got := public.fn_ca_horse_option_unregister('probeFixtureOption', v_b);
  IF v_got <> 'unregistered'
     OR public.fn_ca_horse_option_switch_states('probeFixtureOption') IS NOT NULL THEN
    RAISE EXCEPTION 'probe: an unregistered option still answers';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;

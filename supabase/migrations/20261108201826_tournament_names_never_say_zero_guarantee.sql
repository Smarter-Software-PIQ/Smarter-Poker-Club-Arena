-- 20261108201826_tournament_names_never_say_zero_guarantee.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-08, verbatim: "IF A TOURNAMENT, SIT N GO OR SATELLITE DOESN'T
-- HAVE A GUARANTEE, IT SHOULD NEVER SAY 0 GTD   REMOVE THAT".
--
-- The lobby showed "40 Chip Freezeout - 0 GTD (NLH) Satellite 5". The digits
-- are not computed by the client: the client only prints a guarantee label
-- when guaranteed_prize > 0. The "0 GTD" is inside the stored NAME. Three
-- owner-weekly satellite schedules (hard coded by fn_ca_midway_weekly_catalog,
-- so their own rows cannot be edited here) carry it, every spawn copies it
-- into public.tournaments.name, and 11 tournaments held it when this was
-- written (8 REGISTERING, 1 RUNNING, 2 COMPLETED), read 2026-11-08.
--
-- ROOT FIX, at the one door every tournament row passes through:
--
--   1. public.fn_ca_text_without_zero_guarantee(text): removes a ZERO
--      guarantee phrase ("- 0 GTD", "$0 GTD", "0.00 Guaranteed",
--      "0K Guarantee") and only that. A real guarantee is never touched:
--      "1.5K GTD", "10 GTD", "1,000 GTD", "Nightly 10K GTD" stay exactly as
--      written (the zero must not follow a digit, a dot or a comma).
--   2. A BEFORE INSERT OR UPDATE OF name/description/short_description trigger
--      on public.tournaments applies it, so every future spawn from those
--      schedules (and anything else) is stored without the phrase.
--   3. fn_guard_managed_game_lifecycle already lets a registered event's copy
--      change to exactly fn_ca_text_without_dollar(old) (the 2026 copy
--      normalizer precedent). That function is used by nothing else, so it
--      now also removes the zero-guarantee phrase. The guard still refuses
--      every other change to a registered event's name: the only edit it
--      admits is this exact, deterministic one.
--   4. The rows that already say it are rewritten once, through that same
--      admitted edit. Names only: no money, status, guarantee, pool or
--      contract column is written. Probed 2026-11-08 in a self-aborting DO
--      block: every other tournaments trigger accepted the rewrite on all 11
--      rows (REGISTERING, RUNNING and COMPLETED).
--
-- No foreign key, no lock beyond the row updates of 11 rows, no cron.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_ca_text_without_zero_guarantee(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_text IS NULL
      OR p_text !~* '(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)'
    THEN p_text
    ELSE coalesce(
      nullif(
        btrim(regexp_replace(
          regexp_replace(
            p_text,
            '[[:space:]]*(-[[:space:]]*)?[$]?(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)[.]?',
            '', 'gi'),
          '[[:space:]]{2,}', ' ', 'g')),
        ''),
      p_text)
  END
$function$;

COMMENT ON FUNCTION public.fn_ca_text_without_zero_guarantee(text) IS
  'Dan 2026-11-08: a tournament with no guarantee never says "0 GTD". Removes only a zero guarantee phrase; a real guarantee label is untouched.';

-- The copy normalizer the lifecycle guard admits. Body preserved verbatim,
-- now passed through the zero-guarantee rule as well.
CREATE OR REPLACE FUNCTION public.fn_ca_text_without_dollar(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT public.fn_ca_text_without_zero_guarantee(
  CASE WHEN p_text IS NULL OR position('$' IN p_text) = 0 THEN p_text ELSE
    replace(
     regexp_replace(
      regexp_replace(
       regexp_replace(
        regexp_replace(
         regexp_replace(
          regexp_replace(p_text,
            '^\$([0-9]+) (Base|Guaranteed) Prize Pool\. Entry Is Free\..*$', '\1 Chip Guarantee'),
          'Free Entry\. \$([0-9]+) Base Prize Pool\.', 'Free Entry. \1 Chip Guarantee.', 'g'),
         '\$([0-9]+)((?: [A-Za-z0-9]+)*?) Freeroll', '\1 Chip Guarantee\2 Freeroll', 'g'),
        'Cost \$([0-9]+)(?:\.00)? And', 'Cost \1 Chips And', 'g'),
       'One \$([0-9]+)(?:\.00)? Add-On', 'One \1 Chip Add-On', 'g'),
      '\$([0-9]+(?:\.[0-9]+)?)', '\1', 'g'),
    '$', '') END)
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.name := public.fn_ca_text_without_zero_guarantee(NEW.name);
  NEW.description := public.fn_ca_text_without_zero_guarantee(NEW.description);
  NEW.short_description := public.fn_ca_text_without_zero_guarantee(NEW.short_description);
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee() FROM PUBLIC, anon, authenticated;

-- "ac_" runs after aa_diamond_guarantee_copy and ab_nov3_zero_guarantee (the
-- other copy writers) and before every guard, so guards see the final copy.
DROP TRIGGER IF EXISTS ac_tournament_copy_never_says_zero_guarantee ON public.tournaments;
CREATE TRIGGER ac_tournament_copy_never_says_zero_guarantee
  BEFORE INSERT OR UPDATE OF name, description, short_description ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_tournament_copy_never_says_zero_guarantee();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('tournaments', 'ac_tournament_copy_never_says_zero_guarantee',
  'Copy only: removes a zero guarantee phrase ("0 GTD") from name/description/short_description. Writes no money, status, guarantee or contract column. Dan 2026-11-08.')
ON CONFLICT (table_name, trigger_name) DO NOTHING;

-- The rows already carrying it, through the guard-admitted edit above.
UPDATE public.tournaments
   SET name = public.fn_ca_text_without_zero_guarantee(name),
       description = public.fn_ca_text_without_zero_guarantee(description),
       short_description = public.fn_ca_text_without_zero_guarantee(short_description)
 WHERE name ~* '(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)'
    OR coalesce(description, '') ~* '(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)'
    OR coalesce(short_description, '') ~* '(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)';

DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tournaments
     WHERE name ~* '(?<![0-9.,])0+([.]0+)?[kKmM]?[[:space:]]+(GTD|Guaranteed|Guarantee)'
  ) THEN
    RAISE EXCEPTION 'a tournament name still says a zero guarantee';
  END IF;
  IF public.fn_ca_text_without_zero_guarantee('40 Chip Freezeout - 1.5K GTD (NLH)')
       <> '40 Chip Freezeout - 1.5K GTD (NLH)'
     OR public.fn_ca_text_without_zero_guarantee('Big 10 GTD Event') <> 'Big 10 GTD Event'
     OR public.fn_ca_text_without_zero_guarantee('1,000 GTD') <> '1,000 GTD'
     OR public.fn_ca_text_without_zero_guarantee('40 Chip Freezeout - 0 GTD (NLH) Satellite 5')
       <> '40 Chip Freezeout (NLH) Satellite 5' THEN
    RAISE EXCEPTION 'zero guarantee rule touched a real guarantee or missed a zero one';
  END IF;
END
$assert$;

COMMIT;

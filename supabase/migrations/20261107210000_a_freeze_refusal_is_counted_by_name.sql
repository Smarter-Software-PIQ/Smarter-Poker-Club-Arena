-- A FREEZE REFUSAL IS COUNTED BY NAME (Dan 2026-11-07).
--
-- At 19:20-19:21 UTC the owner's NLH and PLO Lightning joins were refused
-- eleven times by the maintenance freeze (fn_lightning_rejoin_seated RAISE
-- 'PLATFORM_FROZEN'). His browser did report them: client_error_events holds
-- 10 occurrences for user 47965354 under source
-- LightningEntryPage.buyin_context_failed. But they were filed under code
-- P0001, the code EVERY plpgsql RAISE shares, so nothing could tell a real
-- player refused by a freeze from any other refusal, and no gauge or alarm
-- counted them.
--
-- From this migration, fn_client_error_health also returns:
--   freeze_refusals_10m       occurrences of a freeze refusal, last 10 min
--   freeze_refusal_users_10m  distinct real players refused by a freeze
-- A freeze refusal is code PLATFORM_FROZEN (what the client now files it
-- under, src/utils/errorReporter.ts), code 55006 (the freeze guard's own
-- SQLSTATE), or a P0001 whose message starts PLATFORM_FROZEN (bundles
-- published before the client change). Automated sessions are excluded as
-- before, and so are horses (they have no browser; excluded here anyway, so a
-- future horse client could never inflate a player count).
--
-- The ClientErrorSpike top code no longer counts freeze refusals: they are
-- expected while a freeze holds and are now counted on their own gauge, read
-- by the info alert PlayersRefusedDuringFreeze (infra/monitoring/alert-rules.yml).
-- The three original columns keep their names, types and order, so the
-- collector that reads them is unaffected.

DROP FUNCTION public.fn_client_error_health();

CREATE FUNCTION public.fn_client_error_health()
RETURNS TABLE (
  client_errors_10m               integer,
  client_error_users_10m          integer,
  client_error_top_code_users_10m integer,
  client_error_top_code           text,
  freeze_refusals_10m             integer,
  freeze_refusal_users_10m        integer
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  WITH recent AS (
    SELECT e.code, e.user_id, e.occurrences,
           (e.code IN ('PLATFORM_FROZEN', '55006')
            OR (e.code = 'P0001' AND coalesce(e.message, '') LIKE 'PLATFORM\_FROZEN%')) AS is_freeze
      FROM public.client_error_events e
     WHERE e.received_at > now() - interval '10 minutes'
       AND NOT e.automated
  ), per_code AS (
    SELECT code, count(DISTINCT user_id)::integer AS users
      FROM recent
     WHERE NOT is_freeze
     GROUP BY code
  ), refused AS (
    SELECT r.user_id, r.occurrences
      FROM recent r
     WHERE r.is_freeze
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id AND p.is_horse)
  )
  SELECT coalesce((SELECT sum(occurrences) FROM recent), 0)::integer,
         (SELECT count(DISTINCT user_id) FROM recent)::integer,
         coalesce((SELECT max(users) FROM per_code), 0)::integer,
         (SELECT code FROM per_code ORDER BY users DESC, code LIMIT 1),
         coalesce((SELECT sum(occurrences) FROM refused), 0)::integer,
         (SELECT count(DISTINCT user_id) FROM refused)::integer
$function$;

REVOKE ALL ON FUNCTION public.fn_client_error_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_client_error_health() TO service_role;
